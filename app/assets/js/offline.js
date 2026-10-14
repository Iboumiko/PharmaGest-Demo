/* =========================================================
   PharmaGest V30 — PWA Offline First
   - Fonctionne sur HTTPS local, même si le serveur devient momentanément
     inaccessible alors que le Wi-Fi reste connecté.
   - Catalogue produits en IndexedDB.
   - Ventes hors connexion avec operation_id idempotent.
   - Détection serveur par heartbeat, pas uniquement navigator.onLine.
   - Synchronisation automatique dès que le serveur revient.
   - Les ventes en attente ne sont jamais supprimées automatiquement.
========================================================= */
(() => {
  const DB_NAME = 'pharmagest-offline';
  const DB_VERSION = 3;
  const SALES_STORE = 'pending_sales';
  const META_STORE = 'meta';
    const HEARTBEAT_MS = 10 * 1000;
  const CATALOG_REFRESH_MS = 60 * 1000;
  const DASHBOARD_KEY = 'pharmagest_dashboard_snapshot';
  const DEVICE_KEY = 'pharmagest_device_id';

  let dbPromise = null;
  let serverReachable = false;
  let heartbeatBusy = false;
  let lastCatalogFetch = 0;

  function uuid() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const h = [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }

  function deviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = uuid(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SALES_STORE)) {
          const store = db.createObjectStore(SALES_STORE, { keyPath: 'operation_id' });
          store.createIndex('created_at', 'created_at');
          store.createIndex('status', 'status');
        }
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function put(storeName, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function remove(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getMeta(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const req = tx.objectStore(META_STORE).get(key);
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveCatalog(catalog) {
    await put(META_STORE, { key: 'catalog', value: catalog, saved_at: Date.now() });
    lastCatalogFetch = Date.now();
    window.dispatchEvent(new CustomEvent('pharmagest:catalog-saved', { detail: catalog }));
  }

  async function getCatalog() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const req = tx.objectStore(META_STORE).get('catalog');
      req.onsuccess = () => resolve(req.result?.value || null);
      req.onerror = () => reject(req.error);
    });
  }

  function markOnline() {
    localStorage.setItem('pharmagest_last_online', String(Date.now()));
    serverReachable = true;
  }

  function markOfflineUse() {
    serverReachable = false;
    updateBanner().catch(() => {});
  }

  function isOfflineModeAllowed() {
    // Le mode hors connexion n'expire pas artificiellement.
    // Il nécessite simplement qu'un catalogue ait déjà été synchronisé.
    return !!getCatalog;
  }

  function saveDashboardSnapshot(data) {
    try {
      localStorage.setItem(DASHBOARD_KEY, JSON.stringify({ data, saved_at: Date.now() }));
    } catch (_) {}
  }

  function getDashboardSnapshot() {
    try {
      const raw = localStorage.getItem(DASHBOARD_KEY);
      if (!raw) return null;
      return JSON.parse(raw)?.data || null;
    } catch (_) {
      return null;
    }
  }

  async function cacheDashboard() {
    const token = localStorage.getItem('dpa_token');
    if (!token) return null;
    try {
      const response = await fetch('/api/dashboard', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`Dashboard HTTP ${response.status}`);
      const data = await response.json();
      saveDashboardSnapshot(data);
      return data;
    } catch (_) {
      return getDashboardSnapshot();
    }
  }

  async function openOfflineSale() {
    localStorage.setItem('pharmagest_offline_sale_requested', '1');
    const target = './vente.html';

    if (navigator.serviceWorker?.controller) {
      location.assign(target);
      return;
    }

    try {
      const cached = await caches.match(new URL(target, location.href).href);
      if (cached) {
        const html = await cached.text();
        document.open();
        document.write(html);
        document.close();
        return;
      }
    } catch (_) {}

    location.assign(target);
  }

  async function cacheCatalog(force = false) {
    const token = localStorage.getItem('dpa_token');
    if (!token) return null;
    if (!force && lastCatalogFetch && Date.now() - lastCatalogFetch < CATALOG_REFRESH_MS) {
      return getCatalog();
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch('/api/offline/catalog', {
        cache: 'no-store',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`Catalogue HTTP ${response.status}`);
      const data = await response.json();
      await saveCatalog(data);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function queueSale(payload, receipt) {
    const catalog = await getCatalog();
    const lastOnline = Number(localStorage.getItem('pharmagest_last_online') || 0);
    if (!catalog) throw new Error('Aucun catalogue hors connexion. Connectez-vous une fois au serveur avant la coupure.');

    const operation_id = payload.operation_id || uuid();
    const itemMap = new Map((catalog.products || []).map(p => [String(p.id), p]));
    for (const item of payload.items || []) {
      const p = itemMap.get(String(item.product_id));
      if (!p) throw new Error('Produit absent du catalogue hors connexion.');
      const requested = Number(item.quantity || 0);
      if (!Number.isInteger(requested) || requested <= 0) throw new Error(`Quantité invalide pour ${p.name}.`);
      const stock = Number(p.stock || 0);
      const reserved = Number(p._offline_consumed || 0);
      if (requested > stock - reserved) throw new Error(`Stock hors connexion insuffisant pour ${p.name}.`);
      p._offline_consumed = reserved + requested;
    }
    await saveCatalog(catalog);

    const record = {
      operation_id,
      payload: { ...payload, operation_id },
      receipt,
      created_at: Date.now(),
      status: 'PENDING',
      device_id: deviceId()
    };
    await put(SALES_STORE, record);
    return record;
  }

  async function pendingSales() { return getAll(SALES_STORE); }

  async function sync() {
    const token = localStorage.getItem('dpa_token');
    if (!token) return { sent: 0, failed: 0, remaining: (await pendingSales()).length };

    const records = (await pendingSales())
      .filter(x => x.status === 'PENDING')
      .sort((a,b) => a.created_at - b.created_at);
    let sent = 0, failed = 0;

    for (const record of records) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        let response;
        try {
          response = await fetch('/api/sales', {
            method: 'POST',
            cache: 'no-store',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(record.payload)
          });
        } finally { clearTimeout(timer); }

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          failed++;
          // Conserver la vente et la retenter automatiquement, quelle que soit
          // l'erreur HTTP temporaire rencontrée lors de la synchronisation.
          await put(SALES_STORE, {
            ...record,
            status: 'PENDING',
            last_error: data.error || `HTTP ${response.status}`,
            last_attempt: Date.now()
          });
          continue;
        }
        await remove(SALES_STORE, record.operation_id);
        sent++;
      } catch (error) {
        failed++;
        serverReachable = false;
        await put(SALES_STORE, { ...record, last_error: error.message, last_attempt: Date.now() });
        break;
      }
    }

    const remaining = (await pendingSales()).length;
    window.dispatchEvent(new CustomEvent('pharmagest:sync', { detail: { sent, failed, remaining } }));
    return { sent, failed, remaining };
  }

  function ensureBanner() {
    if (document.getElementById('pharmagestOfflineBanner')) return document.getElementById('pharmagestOfflineBanner');
    const el = document.createElement('div');
    el.id = 'pharmagestOfflineBanner';
    el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;padding:10px 14px;border-radius:10px;background:#7a1f1f;color:#fff;font:600 13px system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.2);display:none;text-align:center;';
    document.body.appendChild(el);
    return el;
  }

  async function updateBanner() {
    if (!document.body) return;
    const banner = ensureBanner();
    const pending = await pendingSales();
    if (serverReachable) {
      banner.style.display = 'none';
      return;
    }

    banner.style.display = 'block';
    banner.innerHTML = `Connexion au serveur indisponible • <b>travail hors connexion actif</b> • ${pending.length} vente(s) en attente`;
  }

  async function checkServer() {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!data.ok) throw new Error('API indisponible');
        const wasOffline = !serverReachable;
        markOnline();
        try { await cacheDashboard(); } catch (_) {}
        if (wasOffline || !lastCatalogFetch || Date.now() - lastCatalogFetch >= CATALOG_REFRESH_MS) {
          try { await cacheCatalog(true); } catch (_) { serverReachable = false; }
        }
        // La synchronisation ne dépend jamais du rafraîchissement du catalogue.
        await sync();
      } finally { clearTimeout(timer); }
    } catch (_) {
      serverReachable = false;
    } finally {
      heartbeatBusy = false;
      updateBanner().catch(() => {});
    }
  }

  let deferredInstallPrompt = null;

  function showInstallButton() {
    if (document.getElementById('pharmagestInstallButton')) return;
    const button = document.createElement('button');
    button.id = 'pharmagestInstallButton';
    button.type = 'button';
    button.textContent = 'Installer PharmaGest';
    button.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:100000;border:0;border-radius:12px;padding:11px 16px;background:#0b2a4a;color:#fff;font:700 14px system-ui,sans-serif;box-shadow:0 5px 18px rgba(0,0,0,.25);cursor:pointer;';
    button.onclick = async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      try { await deferredInstallPrompt.userChoice; } catch (_) {}
      deferredInstallPrompt = null;
      button.remove();
    };
    document.body.appendChild(button);
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.getElementById('pharmagestInstallButton')?.remove();
  });

  function installPwa() {
    return; // démo : pas de service worker
    if (!('serviceWorker' in navigator)) return;
    if (!window.isSecureContext && location.hostname !== 'localhost') return;
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }

  window.PharmaGestOffline = {
    uuid,
    deviceId,
    cacheCatalog,
    getCatalog,
    cacheDashboard,
    getDashboardSnapshot,
    openOfflineSale,
    queueSale,
    pendingSales,
    sync,
    markOfflineUse,
    isServerReachable: () => serverReachable,
    isOfflineModeAllowed,
  };

  window.addEventListener('online', () => checkServer());
  window.addEventListener('focus', () => checkServer());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkServer(); });
  window.addEventListener('offline', () => {
    serverReachable = false;
    updateBanner().catch(() => {});
    window.dispatchEvent(new CustomEvent('pharmagest:offline'));
  });

  setTimeout(() => checkServer(), 400);
  setInterval(() => checkServer(), HEARTBEAT_MS);
  setInterval(() => sync().catch(() => {}), 15000);
  setInterval(() => updateBanner().catch(() => {}), 1000);
  installPwa();
})();
