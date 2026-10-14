(function(){
  'use strict';

  function user(){
    try{return JSON.parse(localStorage.getItem('dpa_user')||'{}')}catch{return {}}
  }

  function role(){
    return String(user().role||'').toLowerCase();
  }

  function page(){
    return (location.pathname.split('/').pop()||'index.html').toLowerCase();
  }

  const sellerAllowed = new Set(['index.html','vente.html','scanner.html','stocks.html','profil.html','notifications.html']);
  const adminPages = new Set(['index.html','vente.html','scanner.html','produits.html','stocks.html','receptions.html','fournisseurs.html','lots.html','rapports.html','utilisateurs.html','audit.html','parametres.html','vente_partenaire.html','profil.html','notifications.html']);

  function go(p){ location.href=p; }

  function enforce(){
    const r=role();
    if(!localStorage.getItem('dpa_token')){
      if(page()!=='login.html' && page()!=='accueil.html') go('login.html');
      return;
    }
    if(r==='seller' && page()==='login.html' && /[?&]rescan=1/.test(location.search)) return; // rescan du QR pour resynchroniser
    if(r==='seller' && !sellerAllowed.has(page())) go('index.html');
    if(r==='admin' && !adminPages.has(page())) go('index.html');
  }

  function toast(message){
    try{
      let t=document.getElementById('pgToast');
      if(!t){
        t=document.createElement('div');
        t.id='pgToast';
        t.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:calc(100vw - 32px);background:#0b1f3a;color:#fff;padding:12px 16px;border-radius:12px;font:600 14px/1.35 system-ui,Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.3);z-index:99999;opacity:0;transition:opacity .2s;pointer-events:none;text-align:center';
        (document.body||document.documentElement).appendChild(t);
      }
      t.textContent=String(message||'');
      t.style.opacity='1';
      clearTimeout(t._h);
      t._h=setTimeout(()=>{t.style.opacity='0';},4500);
    }catch(e){}
  }

  function addProfileLink(){
    const nav=document.querySelector('nav, .nav, .menu');
    if(!nav) return;
    if(!nav.querySelector('[data-pharmagest-profile]')){
      const a=document.createElement('a');
      a.href='profil.html';
      a.dataset.pharmagestProfile='1';
      a.innerHTML='<span class="menu-icon">◉</span><span>Mon profil</span>';
      nav.appendChild(a);
    }
  }

  /* Lien « Notifications » (avec badge des non lues) dans le menu de chaque page. */
  function addNotificationsLink(){
    if(page()==='login.html'||page()==='accueil.html') return;
    const nav=document.querySelector('nav, .nav, .menu');
    if(!nav||nav.querySelector('[data-pg-notif]')||nav.querySelector('a[href="notifications.html"]')) return;
    const first=nav.querySelector('a');
    const a=document.createElement('a');
    a.href='notifications.html';
    a.dataset.pgNotif='1';
    if(first) a.className=first.className.replace(/\bactive\b/,'').trim();
    a.innerHTML='<span class="menu-icon">🔔</span><span>Notifications</span><span class="pg-badge" id="pgNotifBadge" style="display:none;margin-left:8px;min-width:20px;padding:1px 6px;border-radius:999px;background:#d92d20;color:#fff;font-size:12px;font-weight:800;text-align:center"></span>';
    nav.appendChild(a);
  }
  function refreshNotifBadge(){
    try{
      const n=Number(window.PharmaGestNative?.getUnreadNotificationCount?.()||0);
      document.querySelectorAll('#pgNotifBadge, .pg-badge[data-pg-count]').forEach(b=>{
        b.textContent=n>99?'99+':String(n);
        b.style.display=n>0?'inline-block':'none';
      });
    }catch(e){}
  }

  function roleMenu(){
    const r=role();
    document.querySelectorAll('nav a, .nav a, .menu a').forEach(a=>{
      const href=(a.getAttribute('href')||'').split('?')[0].split('#')[0];
      if(r==='seller'){
        const ok=['index.html','vente.html','scanner.html','stocks.html','profil.html','notifications.html'].includes(href);
        a.style.display=ok?'flex':'none';
      }
    });
    if(r==='seller') addProfileLink();
    addNotificationsLink();
    refreshNotifBadge();
  }

  /*
   * Etat de l'affichage du QR.
   * IMPORTANT : refresh() est appelé toutes les 2 secondes pour suivre
   * le réseau. Il ne doit JAMAIS reconstruire la zone d'appairage alors
   * qu'un QR est déjà affiché, sinon le QR disparaît avant d'être scanné.
   */
  const PAIRING_STORAGE_KEY = 'pharmagest_pairing_display';
  let pairingVisible = false;
  let pairingExpiresAt = 0;
  let pairingTimer = null;

  function clearPairingState(removeStored=true){
    pairingVisible = false;
    pairingExpiresAt = 0;
    if(pairingTimer){
      clearTimeout(pairingTimer);
      pairingTimer = null;
    }
    if(removeStored){
      try{localStorage.removeItem(PAIRING_STORAGE_KEY)}catch{}
    }
  }

  function pairingStorage(){
    try{return JSON.parse(localStorage.getItem(PAIRING_STORAGE_KEY)||'null')}catch{return null}
  }

  async function copyText(value){
    try{
      if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(value);
        toast('Adresse du serveur copiée');
        return;
      }
    }catch{}
    try{
      const ta=document.createElement('textarea');
      ta.value=value;
      ta.style.position='fixed';
      ta.style.opacity='0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('Adresse du serveur copiée');
    }catch{toast('Impossible de copier l’adresse');}
  }

  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,c=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
  }

  function renderPairing(ac,data,scrollToQr){
    if(!ac || !data?.payload || !data?.server_base || !data?.expires_at) return false;
    const qr=window.PharmaGestNative?.makeQrDataUri?.(data.payload)||'';
    if(!qr) return false;

    pairingVisible=true;
    pairingExpiresAt=new Date(data.expires_at).getTime();
    try{localStorage.setItem(PAIRING_STORAGE_KEY,JSON.stringify(data))}catch{}

    ac.innerHTML=
      '<div class="system-info pairing-qr-card" style="text-align:center;overflow:visible">'+
        '<b style="font-size:16px">QR de connexion PharmaGest</b>'+
        '<div style="margin:10px auto 4px;max-width:430px;padding:10px 12px;border-radius:12px;background:#f1fbf8;border:1px solid #cfeee5"><div style="font-size:10px;text-transform:uppercase;font-weight:800;color:#5d7270">Plan de secours — code manuel</div><div style="font-size:30px;letter-spacing:6px;font-weight:900;color:#082b52;margin-top:4px">'+escapeHtml(data.pairing_code||'------')+'</div><div style="font-size:11px;color:#687386;margin-top:4px">Si le QR ne fonctionne pas, un Admin ou un vendeur peut rechercher automatiquement le serveur puis saisir ce code.</div></div>'+
        '<p style="margin:8px 0 12px;color:#687386">Un Admin ou un vendeur peut scanner ce code puis saisir ses identifiants.</p>'+
        '<div style="display:flex;justify-content:center;overflow:visible;padding:6px 0">'+
          '<img src="'+qr+'" alt="QR de connexion PharmaGest PharmaGest" style="display:block;width:min(320px,82vw);max-width:100%;height:auto;aspect-ratio:1/1;image-rendering:pixelated;background:#fff;padding:12px;border-radius:12px;border:1px solid #e5e7eb;box-shadow:0 4px 18px rgba(0,0,0,.08)">'+
        '</div>'+
        '<div style="margin:12px auto 0;max-width:430px;text-align:left;padding:14px;border:1px solid #dfe8ec;border-radius:12px;background:#fff">'+
          '<div style="font-size:11px;text-transform:uppercase;font-weight:800;color:#71808b">Connexion manuelle au hotspot Admin</div>'+
          '<div style="margin-top:9px"><div style="font-size:11px;color:#687386">Nom du hotspot (SSID)</div><div style="font-weight:800;color:#082b52;margin-top:3px;overflow-wrap:anywhere">'+escapeHtml(data.ssid||'Non disponible')+'</div></div>'+
          '<div style="margin-top:9px"><div style="font-size:11px;color:#687386">Mot de passe du hotspot</div><div style="font-weight:800;color:#082b52;margin-top:3px;overflow-wrap:anywhere">'+escapeHtml(data.password||'Non disponible')+'</div></div>'+
          '<div style="margin-top:10px;padding-top:10px;border-top:1px solid #edf1f3"><div style="font-size:11px;color:#687386">Adresse du serveur</div><div style="display:flex;gap:8px;align-items:center;margin-top:4px"><code style="flex:1;min-width:0;overflow-wrap:anywhere;color:#082b52">'+escapeHtml(data.server_base)+'</code><button id="pgCopyAddress" type="button" class="logout" style="flex:0 0 auto">Copier</button></div></div>'+
          '<div style="font-size:11px;color:#687386;margin-top:8px">Le QR sert à autoriser un téléphone (Admin ou vendeur). Pour un ordinateur, saisissez le code à 6 chiffres sur le PC. La connexion Wi‑Fi se fait manuellement avec le SSID et le mot de passe affichés ci-dessus.</div>'+
        '</div>'+
        '<p style="margin:10px 0 0;font-size:12px;color:#687386">Valable 10 minutes et réutilisable pendant cette période pour plusieurs appareils autorisés.</p>'+
        '<button id="pgPairNew" class="action" type="button" style="margin-top:12px;border:0;background:#f7fbfc;text-align:left;width:100%">'+
          '<div class="action-title">Générer un autre QR</div>'+
          '<div class="action-text">Le QR actuel sera remplacé par un nouveau code.</div>'+
        '</button>'+
      '</div>';

    document.getElementById('pgCopyAddress')?.addEventListener('click',()=>copyText(String(data.server_base)));
    document.getElementById('pgPairNew')?.addEventListener('click',createPairing);
    if(pairingTimer) clearTimeout(pairingTimer);
    pairingTimer=setTimeout(()=>showPairingExpired(ac),Math.max(1000,pairingExpiresAt-Date.now()));
    // Le QR reste actif pendant sa validité, mais la page ne défile vers lui QUE lorsque l'Admin vient de le créer.
    // (Avant : chaque ouverture du tableau de bord restaurait le QR et faisait sauter la page vers le bas.)
    if(scrollToQr) requestAnimationFrame(()=>document.getElementById('pharmagestNetworkPanel')?.scrollIntoView({behavior:'smooth',block:'nearest'}));
    return true;
  }

  function restorePairing(ac){
    const data=pairingStorage();
    if(!data?.payload || !data?.expires_at || new Date(data.expires_at).getTime()<=Date.now()){
      clearPairingState();
      return false;
    }
    if(!renderPairing(ac,data)){
      clearPairingState();
      return false;
    }
    return true;
  }

  function showPairingExpired(ac){
    clearPairingState(true);
    if(!ac) return;
    ac.innerHTML=
      '<div class="system-info" style="text-align:center">'+
        '<b>QR de connexion PharmaGest expiré</b>'+
        '<p style="margin:8px 0;color:#687386">Créez un nouveau QR pour autoriser un nouvel appareil.</p>'+
        '<button id="pgPairAgain" class="action" type="button" style="border:0;background:#f7fbfc;text-align:left;width:100%">'+
          '<div class="action-title">Créer un nouveau QR de connexion PharmaGest</div>'+
          '<div class="action-text">Le nouveau QR restera affiché jusqu’à son expiration et pourra servir à plusieurs appareils.</div>'+
        '</button>'+
      '</div>';
    document.getElementById('pgPairAgain')?.addEventListener('click',createPairing);
  }

  async function createPairing(){
    const ac=document.getElementById('pgNetAccess');
    if(!ac) return;
    try{
      const d=await fetch('/api/pairing/create',{
        method:'POST',
        headers:{Authorization:'Bearer '+(localStorage.getItem('dpa_token')||'')}
      }).then(x=>x.json());
      if(!d.token || !d.server_base) throw new Error(d.error||'Impossible de créer l’appairage.');
      const payload=JSON.stringify({type:'pharmagest-pair',v:2,base:d.server_base,token:d.token,expires_at:d.expires_at,ssid:d.ssid||'',password:d.password||'',admin_id:d.installation_id||''});
      const data={token:d.token,pairing_code:d.pairing_code||'',expires_at:d.expires_at,server_base:d.server_base,payload,ssid:d.ssid||'',password:d.password||''};
      if(!renderPairing(ac,data,true)) throw new Error('Génération du QR indisponible.');
    }catch(e){
      ac.innerHTML='<div class="system-info">'+escapeHtml(e.message||e)+'</div>';
      clearPairingState();
    }
  }

  function networkPanel(){
    if(page()!=='index.html') return;
    if(document.getElementById('pharmagestNetworkPanel')) return;

    const r=role();
    const content=document.querySelector('.content');
    if(!content) return;

    const p=document.createElement('section');
    p.id='pharmagestNetworkPanel';
    p.className='panel';
    p.style.marginTop='20px';
    p.style.overflow='visible';

    p.innerHTML=
      '<div class="panel-header">' +
        '<div class="panel-title">'+(r==='seller'?'Connexion au maître':'Réseau maître / vendeurs')+'</div>' +
        '<button id="pgNetRefresh" class="logout" type="button">Actualiser</button>' +
      '</div>' +
      '<div class="panel-body" style="overflow:visible">' +
        '<div id="pgNetStatus" class="system-info">Recherche automatique du réseau PharmaGest…</div>' +
        '<div id="pgNetAccess" style="margin-top:12px;overflow:visible"></div>' +
      '</div>';

    content.appendChild(p);

    const refresh=()=>{
      let n={};
      try{n=JSON.parse(window.PharmaGestNative?.getNetworkStatusJson?.()||'{}')}catch{}

      const base=(()=>{
        try{return window.PharmaGestNative?.getServerBase?.()||''}catch{return ''}
      })();

      const st=document.getElementById('pgNetStatus');
      const ac=document.getElementById('pgNetAccess');
      if(!st || !ac) return;

      const connected=!!base || n.status==='connected' || n.status==='active';

      st.innerHTML=
        '<div class="system-row"><span class="system-label">État</span><span class="system-value '+(connected?'online':'')+'">'+(connected?'CONNECTÉ':'RECHERCHE')+'</span></div>' +
        '<div class="system-row"><span class="system-label">Réseau</span><span class="system-value">'+(n.ssid||'PharmaGest')+'</span></div>' +
        '<div class="system-row"><span class="system-label">Adresse maître</span><span class="system-value">'+(base||n.address||'Détection automatique')+'</span></div>';

      /*
       * Tant que le QR est affiché et n'est pas expiré, on conserve
       * intégralement son DOM. Le refresh réseau ne peut plus l'effacer.
       */
      if(r==='admin' && pairingVisible){
        if(pairingExpiresAt && Date.now() >= pairingExpiresAt){
          showPairingExpired(ac);
        }
        return;
      }

      if(r==='admin'){
        ac.innerHTML=
          '<div style="display:grid;gap:9px">' +
            '<button id="pgPair" class="action" type="button" style="border:0;background:#f7fbfc;text-align:left;width:100%">' +
              '<div class="action-title">Créer un QR de connexion PharmaGest</div>' +
              '<div class="action-text">À utiliser une seule fois pour associer le téléphone d’un vendeur à cet établissement.</div>' +
            '</button>' +
            '<button id="pgShowAccess" class="action" type="button" style="border:0;background:#f7fbfc;text-align:left;width:100%">' +
              '<div class="action-title">Connexion quotidienne au serveur</div>' +
              '<div class="action-text">Le vendeur recherche automatiquement le serveur dès que votre hotspot est ouvert.</div>' +
            '</button>' +
            '<button id="pgKeepAlive" class="action" type="button" style="border:0;background:#fff8ec;text-align:left;width:100%">' +
              '<div class="action-title">Garder PharmaGest actif</div>' +
              '<div class="action-text">Empêche le téléphone de fermer l’application en arrière-plan (Honor, Huawei, Xiaomi, Tecno...). Touchez deux fois : autorisation batterie, puis réglages du téléphone.</div>' +
            '</button>' +
          '</div>';
      }else{
        ac.innerHTML=
          '<div style="display:grid;gap:9px">' +
            '<button id="pgWifi" class="action" type="button" style="border:0;background:#f7fbfc;text-align:left;width:100%">' +
              '<div class="action-title">Rechercher le serveur automatiquement</div>' +
              '<div class="action-text">PharmaGest recherche le serveur Admin sur le réseau local.</div>' +
            '</button>' +
            '<button id="pgRescan" class="action" type="button" style="border:0;background:#eefaf6;text-align:left;width:100%">' +
              '<div class="action-title">Scanner le QR de l’admin pour synchroniser</div>' +
              '<div class="action-text">À utiliser au retour chez l’admin : aucun identifiant à ressaisir.</div>' +
            '</button>' +
            '<button id="pgManualPair" class="action" type="button" style="border:0;background:#f7fbfc;text-align:left;width:100%">' +
              '<div class="action-title">Plan de secours : appairage par code</div>' +
              '<div class="action-text">Si le QR ne fonctionne pas, utilisez le code à 6 chiffres affiché sur le téléphone Admin.</div>' +
            '</button>' +
          '</div>';
      }

      document.getElementById('pgPair')?.addEventListener('click',createPairing);
      (function(){
        let step=0;
        document.getElementById('pgKeepAlive')?.addEventListener('click',()=>{
          try{ window.PharmaGestNative?.openKeepAliveSettings?.(step===0?'battery':'vendor'); }catch{}
          step=(step+1)%2;
        });
      })();
      document.getElementById('pgRescan')?.addEventListener('click',()=>{location.href='login.html?rescan=1';});

      document.getElementById('pgShowAccess')?.addEventListener('click',()=>{
        let nn={};
        try{nn=JSON.parse(window.PharmaGestNative?.getNetworkStatusJson?.()||'{}')}catch{}
        ac.innerHTML=
          '<div class="system-info">' +
            '<div class="system-row"><span class="system-label">Hotspot</span><span class="system-value">'+(nn.ssid||'PharmaGest')+'</span></div>' +
            '<div class="system-row"><span class="system-label">Serveur</span><span class="system-value">'+(nn.serverBase||nn.address||'Détection automatique')+'</span></div>' +
            '<p style="margin-top:12px;color:#687386">Le QR de connexion PharmaGest sert uniquement à l’appairage initial. Pour les reconnexions quotidiennes, le vendeur ouvre son application et recherche simplement le serveur PharmaGest lorsque votre hotspot est actif.</p>' +
          '</div>';
      });

      document.getElementById('pgWifi')?.addEventListener('click',()=>{
        try{window.PharmaGestNative.startNetworkFromWeb()}catch{}
        setTimeout(()=>refresh(),700);
      });
      document.getElementById('pgManualPair')?.addEventListener('click',()=>{
        const code=prompt('Entrez le code d’appairage à 6 chiffres affiché sur le téléphone Admin :','');
        const clean=String(code||'').replace(/\D/g,'').slice(0,6);
        if(clean.length!==6){toast('Le code doit contenir 6 chiffres.');return;}
        localStorage.setItem('pg_pair_manual_code',clean);
        location.href='login.html';
      });
    };

    document.getElementById('pgNetRefresh')?.addEventListener('click',()=>{
      try{window.PharmaGestNative.startNetworkFromWeb()}catch{}
      setTimeout(refresh,500);
    });

    const restored=restorePairing(document.getElementById('pgNetAccess'));
    if(!restored) refresh();
    setInterval(refresh,2000);
  }

  /* ------------------------------------------------------------------
     ADMIN — message quand un vendeur se synchronise
     ------------------------------------------------------------------ */
  const SYNC_SEEN_KEY='pg_sync_events_seen';
  function startSyncEventsWatcher(){
    if(role()!=='admin') return;
    let busy=false;
    async function poll(){
      if(busy||!localStorage.getItem('dpa_token')) return;
      busy=true;
      try{
        let since=localStorage.getItem(SYNC_SEEN_KEY)||'';
        const first=!since;
        if(first){ since=new Date().toISOString(); localStorage.setItem(SYNC_SEEN_KEY,since); busy=false; return; }
        const r=await fetch('/api/sync/events?since='+encodeURIComponent(since),{headers:{Authorization:'Bearer '+localStorage.getItem('dpa_token')}});
        if(!r.ok) return;
        const data=await r.json();
        const events=Array.isArray(data?.events)?data.events:[];
        for(const ev of events){
          const name=ev.seller||'Vendeur';
          const msg=(ev.sent>0)
            ? 'Les données du vendeur '+name+' sont synchronisées ('+ev.sent+' vente'+(ev.sent>1?'s':'')+' reçue'+(ev.sent>1?'s':'')+').'
            : 'Les données du vendeur '+name+' sont synchronisées.';
          toast(msg);
          try{ window.PharmaGestNative?.showNotification?.('Synchronisation vendeur',msg); }catch(e){}
          localStorage.setItem(SYNC_SEEN_KEY,String(ev.at));
        }
      }catch(e){}finally{busy=false;}
    }
    setInterval(poll,5000);
    setTimeout(poll,1500);
  }

  /* ------------------------------------------------------------------
     ALERTES — résumé envoyé à Android (stock bas + expiration).
     Android le garde en mémoire et affiche les notifications, même
     application fermée (rappel quotidien), sans relire la base.
     ------------------------------------------------------------------ */
  function startAlertSnapshotLoop(){
    if(!window.PharmaGestNative?.updateAlertSnapshot) return;
    let busy=false;
    async function push(){
      if(busy||!localStorage.getItem('dpa_token')) return;
      busy=true;
      try{
        const h={Authorization:'Bearer '+localStorage.getItem('dpa_token')};
        const [aR,sR]=await Promise.all([fetch('/api/alerts',{headers:h}),fetch('/api/stock',{headers:h})]);
        const alerts=aR.ok?await aR.json():[];
        const stock=sR.ok?await sR.json():[];
        const expiry=(Array.isArray(alerts)?alerts:[])
          .filter(a=>a && a.expiry_date && Number(a.quantity||0)>0)
          .map(a=>({name:String(a.name||'Produit'),lot:String(a.lot_number||'—'),expiry_date:String(a.expiry_date).slice(0,10),qty:Number(a.quantity||0)}));
        const byProduct=new Map();
        for(const r of (Array.isArray(stock)?stock:[])){
          const id=String(r.product_id??r.id);
          const cur=byProduct.get(id)||{name:String(r.name||'Produit'),stock:0,threshold:0};
          cur.stock+=Number(r.stock??r.current_stock??0)||0;
          cur.threshold=Math.max(cur.threshold,Number(r.alert_threshold??r.minimum??r.min_stock??0)||0);
          byProduct.set(id,cur);
        }
        const low=[...byProduct.values()].filter(p=>p.threshold>0&&p.stock<=p.threshold).map(p=>({name:p.name,stock:p.stock,threshold:p.threshold}));
        window.PharmaGestNative.updateAlertSnapshot(JSON.stringify({generated_at:new Date().toISOString(),expiry,low}));
      }catch(e){}finally{busy=false;}
    }
    setTimeout(push,2500);
    setInterval(push,60000);
    window.addEventListener('pharmagest-stock-changed',push);
  }

  /* V63 : « mode sécurisé » — après 2 arrêts en 10 minutes, le réseau est coupé pour garder l'application utilisable. */
  function safeModeBanner(){
    try{
      if(page()!=='index.html') return;
      if(!window.PharmaGestNative?.isSafeMode?.()) return;
      if(document.getElementById('pgSafeBanner')) return;
      const content=document.querySelector('.content'); if(!content) return;
      const b=document.createElement('section');
      b.id='pgSafeBanner'; b.className='panel';
      b.style.cssText='margin-bottom:14px;border-left:5px solid #f59a23;background:#fff8ec';
      b.innerHTML='<div class="panel-body"><b>Mode sécurisé</b>'+
        '<p style="margin:6px 0 10px;color:#6b5320">PharmaGest s’est arrêté plusieurs fois récemment : le réseau (hotspot, serveur local, synchronisation) est désactivé pour garder l’application utilisable. Vos données locales sont intactes.</p>'+
        '<button id="pgSafeRetry" class="action" type="button" style="border:0;background:#fff;width:100%;text-align:left"><div class="action-title">Réessayer le réseau</div><div class="action-text">Si l’application se ferme à nouveau, elle reviendra automatiquement en mode sécurisé.</div></button></div>';
      content.insertBefore(b,content.firstChild);
      document.getElementById('pgSafeRetry')?.addEventListener('click',()=>{
        try{window.PharmaGestNative.retryNetwork()}catch{}
        b.remove(); toast('Nouvelle tentative du réseau…');
      });
    }catch{}
  }

  /* V66 : sauvegarde automatique Google Drive — le module se charge sur toutes les pages du téléphone Admin connecté (et des vendeurs : envoi de leur journal de ventes). */
  function loadDriveBackup(){
    try{
      if(window.PharmaDrive||document.querySelector('script[data-drive-backup]')) return;
      if(!['admin','seller'].includes(String(window.PharmaGestNative?.getRole?.()||''))) return;
      if(page()==='login.html'||page()==='accueil.html'||!localStorage.getItem('dpa_token')) return;
      const s=document.createElement('script'); s.src='assets/js/drive-backup.js'; s.setAttribute('data-drive-backup','1'); document.head.appendChild(s);
    }catch{}
  }

  function init(){
    enforce();
    loadDriveBackup();
    safeModeBanner();
    setInterval(refreshNotifBadge,5000);
    if(page()!=='login.html' && page()!=='accueil.html' && localStorage.getItem('dpa_token')){
      startSyncEventsWatcher();
      startAlertSnapshotLoop();
    }
    if(page()!=='login.html'){
      roleMenu();
      networkPanel();
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
