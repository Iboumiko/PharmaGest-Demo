/* PharmaGest Android - moteur local V3
 * Intercepte les appels /api des pages V30 et les exécute dans IndexedDB.
 * Aucun serveur, Internet ou PostgreSQL n'est requis.
 */
(function () {
  'use strict';
  const DB='pharmagest_local_v4', VER=3;
  const STORES=['users','products','suppliers','lots','receipts','receipt_items','sales','sale_items','stock_movements','audit_logs','settings','app_meta','sync_queue','sync_state','pairing_sessions','device_links'];
  const INDEXES={users:['username','role','active'],products:['code','barcode','datamatrix','name','active'],suppliers:['name','active'],lots:['product_id','lot_number','expiry_date','supplier_id'],receipts:['receipt_number','supplier_id','created_at'],receipt_items:['receipt_id','product_id','lot_id'],sales:['sale_number','seller_id','created_at','operation_id'],sale_items:['sale_id','product_id','lot_id'],stock_movements:['product_id','lot_id','created_at'],audit_logs:['user_id','created_at'],settings:[],app_meta:['key'],sync_queue:['status','created_at'],sync_state:['key'],pairing_sessions:['token','pairing_code','expires_at','status'],device_links:['device_id','user_id','active']};
  // PILOTE V8 : compte Super Admin intégré. Obfuscation légère pour éviter le stockage en clair dans le JS.
  const PILOT_USERNAME = [115,117,112,101,114,97,100,109,105,110].map(n=>String.fromCharCode(n)).join('');
  const PILOT_PASSWORD_SHA256 = ['5829b9c7ee554a1ac818a5d67582548efed4fa751c0344c08d19133f1781','ba8d'].join('');
  const PILOT_OWNER_NAME = 'Super Admin PharmaGest';
  const originalFetch=window.fetch.bind(window);
  // V58 : appel réseau DIRECT (non redirigé vers le moteur local) — nécessaire pour joindre le PC depuis l'appairage.
  window.__pharmagestDirectFetch=function(u,i){return originalFetch(u,i);};
  const uid=()=>crypto.randomUUID ? crypto.randomUUID() : 'id-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  const now=()=>new Date().toISOString();
  const json=(data,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}));
  function db(){return new Promise((res,rej)=>{const r=indexedDB.open(DB,VER);r.onupgradeneeded=e=>{const d=e.target.result; STORES.forEach(s=>{let os=d.objectStoreNames.contains(s)?e.target.transaction.objectStore(s):d.createObjectStore(s,{keyPath:'id'});for(const idx of (INDEXES[s]||[])){if(!os.indexNames.contains(idx))os.createIndex(idx,idx,{unique:false});}});};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
  async function all(store){const d=await db();return new Promise((res,rej)=>{const q=d.transaction(store,'readonly').objectStore(store).getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>rej(q.error);});}
  async function put(store,obj){const d=await db();return new Promise((res,rej)=>{const q=d.transaction(store,'readwrite').objectStore(store).put(obj);q.onsuccess=()=>res(obj);q.onerror=()=>rej(q.error);});}
  async function del(store,id){const d=await db();return new Promise((res,rej)=>{const q=d.transaction(store,'readwrite').objectStore(store).delete(id);q.onsuccess=()=>res();q.onerror=()=>rej(q.error);});}
  async function clear(store){const d=await db();return new Promise((res,rej)=>{const q=d.transaction(store,'readwrite').objectStore(store).clear();q.onsuccess=()=>res();q.onerror=()=>rej(q.error);});}
  async function get(store,id){
    const d=await db();
    return new Promise((res,rej)=>{
      const os=d.transaction(store,'readonly').objectStore(store);
      if(id===undefined || id===null){
        const q=os.getAll();
        q.onsuccess=()=>res(q.result?.[0]);
        q.onerror=()=>rej(q.error);
        return;
      }
      const q=os.get(id);
      q.onsuccess=()=>res(q.result);
      q.onerror=()=>rej(q.error);
    });
  }
  // Une seule initialisation à la fois : plusieurs requêtes lancées en même temps au démarrage créaient chacune un compte Super Admin (doublons).
  let seedPromise=null;
  function ensureCatalogSeed(force){
    if(force) seedPromise=null;
    if(!seedPromise) seedPromise=seedCatalog().catch(e=>{ seedPromise=null; throw e; });
    return seedPromise;
  }
  async function seedCatalog(){
    let users=await all('users');
    const isAdminInstallation=nativeRole()==='admin' || !nativeRole();
    if(isAdminInstallation){
      // L'identité propriétaire enregistrée à l'installation est prioritaire.
      // Cela évite de rétrograder le vrai Super Admin lorsqu'un compte pilote existe aussi.
      const settingsRecord=await get('settings');
      const configuredOwnerId=settingsRecord?.settings?.installation?.ownerId;
      const isOwnerRecord=u=>u && (u.is_owner===true || u.is_owner===1 || String(u.is_owner).toLowerCase()==='true' || ['owner','super_admin'].includes(String(u.role||'').trim().toLowerCase()));
      let canonicalOwner=(configuredOwnerId ? users.find(u=>String(u.id)===String(configuredOwnerId)) : null)
        || users.filter(isOwnerRecord).sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||'')))[0]
        || users.find(u=>normalizeUsername(u.username)===PILOT_USERNAME)
        || null;

      // Doublons du compte Super Admin (même identifiant « superadmin ») : on en garde un seul et on efface les autres.
      const pilotRows=users.filter(u=>normalizeUsername(u.username)===PILOT_USERNAME);
      if(pilotRows.length>1){
        const keep=(configuredOwnerId ? pilotRows.find(u=>String(u.id)===String(configuredOwnerId)) : null)
          || pilotRows.slice().sort((a,b)=>(Number(a.password_hash===PILOT_PASSWORD_SHA256)-Number(b.password_hash===PILOT_PASSWORD_SHA256))||String(a.created_at||'').localeCompare(String(b.created_at||'')))[0];   // priorité au compte dont le mot de passe a été changé, puis au plus ancien
        for(const dup of pilotRows){
          if(dup===keep) continue;
          await del('users',dup.id);
          users=users.filter(u=>u!==dup);
        }
        if(canonicalOwner && !users.some(u=>String(u.id)===String(canonicalOwner.id))) canonicalOwner=keep;
        if(configuredOwnerId && !users.some(u=>String(u.id)===String(configuredOwnerId))){
          const sr=await get('settings');
          if(sr&&sr.settings&&sr.settings.installation){ sr.settings.installation.ownerId=keep.id; await put('settings',sr); }
        }
      }

      if(!canonicalOwner){
        canonicalOwner={id:uid(),name:PILOT_OWNER_NAME,username:PILOT_USERNAME,password_hash:PILOT_PASSWORD_SHA256,role:'admin',is_owner:true,active:true,created_at:now()};
        await put('users',canonicalOwner);
        users.push(canonicalOwner);
      }

      canonicalOwner.role='admin';
      canonicalOwner.is_owner=true;
      await put('users',canonicalOwner);

      // Une seule identité Super Admin : tous les autres comptes restent des admins ordinaires.
      for(const user of users){
        if(String(user.id)===String(canonicalOwner.id)) continue;
        if(isOwnerRecord(user)){
          user.is_owner=false;
          if(['owner','super_admin'].includes(String(user.role||'').trim().toLowerCase())) user.role='admin';
          await put('users',user);
        }
      }
    }
    if(!(await get('settings'))){
      await put('settings',{id:'settings',settings:{general:{companyName:'',phone:'',address:''},recu:{footer:'Merci pour votre confiance.'}},updated_at:now()});
    }
    if(!localStorage.getItem('pg_installation_id') && isAdminInstallation){
      localStorage.setItem('pg_installation_id','PG-'+Math.random().toString(36).slice(2,10).toUpperCase());
    }
    if(!(await get('sync_state','master'))){
      await put('sync_state',{id:'master',key:'master',status:'local',last_sync:null,server_base:''});
    }
    await put('app_meta',{id:'schema',key:'schema',value:{version:VER,name:'PharmaGest Base V5',migrated_at:now()} });
  }
  // Rapport de synchronisation vendeur -> Admin (message « données synchronisées » chez l'admin).
  let syncReportPending=true, flushedSinceReport=0, syncReporting=false;
  async function saveSyncState(state){
    const old=await get('sync_state','master')||{id:'master',key:'master',status:'local'};
    const next={...old,...state,id:'master',key:'master',updated_at:now()};
    await put('sync_state',next);
    if(next.status==='disconnected') syncReportPending=true;
    if(old.status && next.status!==old.status && ['connected','disconnected'].includes(next.status)){
      const u=await currentUser().catch(()=>null);
      await audit(u,next.status==='connected'?'SERVER_CONNECTED':'SERVER_DISCONNECTED','connection',null,{server_base:next.server_base||'',last_error:next.error||null,pending_sync:(await all('sync_queue')).filter(q=>q.status==='pending').length});
    }
    return next;
  }
  async function cacheMasterCatalog(data){
    if(!data)return;
    if(data.settings) await put('settings',{id:'settings',settings:data.settings,updated_at:now()});
    if(Array.isArray(data.suppliers)){for(const x of data.suppliers) await put('suppliers',{...x,id:x.id});}
    if(Array.isArray(data.products)){for(const p of data.products){const old=await get('products',p.id);await put('products',{...(old||{}),...p,id:p.id});}}
    if(Array.isArray(data.lots)){for(const l of data.lots) await put('lots',{...l,id:l.id});}
    const meta=await get('app_meta','catalog_cache')||{id:'catalog_cache',key:'catalog_cache'};
    await put('app_meta',{...meta,value:{products:data.products||[],lots:data.lots||[],suppliers:data.suppliers||[],settings:data.settings||{},generated_at:data.generated_at||now()},updated_at:now()});
    await saveSyncState({status:'connected',last_sync:now(),server_base:nativeServerSafe()});
  }
  async function syncFromMaster(){
    if(nativeRole()!=='seller')return false;
    const base=nativeServerSafe();
    if(!base){await saveSyncState({status:'disconnected',server_base:'',error:'Aucun serveur Admin configuré'});return false;}
    try{
      const r=await originalFetch(base+'/api/offline/catalog',{headers:{'Content-Type':'application/json',...(token()?{'Authorization':'Bearer '+token()}: {})},cache:'no-store'});
      if(!r.ok)throw new Error('Serveur Admin indisponible (HTTP '+r.status+')');
      const data=await r.json();
      await cacheMasterCatalog(data);
      return true;
    }catch(e){await saveSyncState({status:'disconnected',server_base:base,error:e.message});return false;}
  }
  function nativeServerSafe(){try{return window.PharmaGestNative?.getServerBase?.()||''}catch{return ''}}
  async function reportSyncIfNeeded(){
    try{
      if(nativeRole()!=='seller'||syncReporting)return;
      const base=nativeServerSafe();
      if(!base){syncReportPending=true;return;}
      const state=await get('sync_state','master');
      if(state?.status!=='connected'){syncReportPending=true;return;}
      if(!syncReportPending&&flushedSinceReport===0)return;
      if((await all('sync_queue')).some(q=>q.status==='pending'))return; // on attend la fin de l'envoi des ventes
      syncReporting=true;
      const r=await originalFetch(base+'/api/sync/report',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token()||''),'X-PharmaGest-Remote':'1'},body:JSON.stringify({device_id:localStorage.getItem('pharmagest_device_id')||'',sent:flushedSinceReport})});
      if(r.ok){syncReportPending=false;flushedSinceReport=0;}
    }catch(e){/* réseau coupé : on réessaiera au prochain cycle */}finally{syncReporting=false;}
  }
  async function flushOfflineQueue(){
    if(nativeRole()!=='seller')return;
    const base=nativeServerSafe();if(!base)return;
    const rows=(await all('sync_queue')).filter(x=>x.status==='pending').sort((a,b)=>a.created_at.localeCompare(b.created_at));
    for(const q of rows){
      try{
        const r=await originalFetch(base+q.path,{method:q.method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token()||'')},body:q.body});
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.error||'Synchronisation refusée');
        q.status='done';q.response=d;q.synced_at=now();await put('sync_queue',q);flushedSinceReport++;
        const remoteSale=d.sale||d.data;
        if(q.local_sale_id&&remoteSale){const localSale=await get('sales',q.local_sale_id);if(localSale){await put('sales',{...localSale,...remoteSale,id:localSale.id,operation_id:q.operation_id,synced_at:now(),offline:false});}}
      }catch(e){q.status='pending';q.last_error=e.message;await put('sync_queue',q);break;}
    }
  }
  async function hashPassword(value){
    const data=new TextEncoder().encode(String(value));
    const digest=await crypto.subtle.digest('SHA-256',data);
    return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  function normalizeUsername(value){
    return String(value ?? '').trim().toLowerCase();
  }
  function normalizeRole(value){
    const r=String(value ?? '').trim().toLowerCase();
    if(r==='seller'||r==='vendeur'||r==='vendor'||r==='sales') return 'seller';
    if(r==='admin'||r==='administrator'||r==='administrateur'||r==='super_admin'||r==='owner') return 'admin';
    return r;
  }
  function isActiveUser(user){
    return user?.active===true || String(user?.active ?? '').toLowerCase()==='true' || user?.active===1;
  }
  async function passwordMatches(user,password){
    const supplied=String(password ?? '');
    if(user?.password_hash){
      const stored=String(user.password_hash);
      // Format natif PharmaGest : SHA-256 hexadécimal.
      if(/^[a-f0-9]{64}$/i.test(stored)) return stored.toLowerCase()===(await hashPassword(supplied)).toLowerCase();
      // Compatibilité avec les anciennes fiches qui conservaient encore le mot de passe localement.
      if(stored===supplied) return true;
      return false;
    }
    if(user?.password!==undefined && user?.password!==null) return String(user.password)===supplied;
    return false;
  }
  async function hasOwner(){
    const us=await all('users');
    return us.some(u=>u.active && (u.is_owner===true || u.role==='owner' || u.role==='super_admin'));
  }
  function token(){return localStorage.getItem('dpa_token')||'';}
  async function currentUser(){const t=token();if(!t)return null;let payload=null;try{payload=JSON.parse(atob((t.split('.')[1]||'').replace(/-/g,'+').replace(/_/g,'/')));}catch{}const users=await all('users');if(payload&&payload.id){const stored=users.find(x=>String(x.id)===String(payload.id));if(stored)return stored;}const localId=localStorage.getItem('dpa_local_user_id');return users.find(x=>String(x.id)===String(localId))||payload||null;}
  async function isSuperAdminUser(user){
    if(!user)return false;
    const settingsRecord=await get('settings');
    const ownerId=settingsRecord?.settings?.installation?.ownerId;
    // Quand l'installation a un propriétaire déclaré et que ce compte existe, cet identifiant fait autorité.
    if(ownerId!==undefined && ownerId!==null && String(ownerId).trim()!=='') {
      const ownerExists=(await all('users')).some(candidate=>String(candidate.id)===String(ownerId));
      if(ownerExists) return String(user.id)===String(ownerId);
    }
    const ownerFlag=user.is_owner===true || user.is_owner===1 || ['true','1','yes'].includes(String(user.is_owner??'').trim().toLowerCase());
    const role=String(user.role||'').trim().toLowerCase();
    return ownerFlag || normalizeUsername(user.username)===PILOT_USERNAME || role==='super_admin' || role==='owner';
  }
  function deviceId(){
    let id=localStorage.getItem('pharmagest_device_id');
    if(!id){id=uid();localStorage.setItem('pharmagest_device_id',id);}
    return id;
  }
  function randomToken(){return uid().replace(/-/g,'')+uid().replace(/-/g,'');}
  function pairingBase(){return nativeServerSafe();}
  function makeToken(u){const payload=btoa(JSON.stringify({id:u.id,name:u.name,role:u.role,session:'persistent-local'}));return 'local.'+payload+'.android';}
  async function audit(u,action,entity,entity_id=null,details={}){await put('audit_logs',{id:uid(),user_id:u?.id||null,user_name:u?.name||'Système',action,entity,entity_id,details,created_at:now()});}
  async function products(){const ps=await all('products'), ls=await all('lots');return ps.filter(p=>p.active!==false).map(p=>{const valid=ls.filter(l=>l.product_id===p.id);return {...p,stock:valid.filter(l=>String(l.expiry_date||'9999-12-31')>=new Date().toISOString().slice(0,10)).reduce((s,l)=>s+Number(l.quantity||0),0),expired_stock:valid.filter(l=>String(l.expiry_date||'9999-12-31')<new Date().toISOString().slice(0,10)).reduce((s,l)=>s+Number(l.quantity||0),0)};});}
  async function stockRows(){const ps=await all('products'),ls=await all('lots');const today=new Date().toISOString().slice(0,10);const rows=[];for(const p of ps.filter(x=>x && x.active!==false)){const valid=ls.filter(l=>String(l.product_id)===String(p.id)&&String(l.expiry_date||'9999-12-31')>=today);if(valid.length){for(const l of valid)rows.push({id:`${p.id}-${l.id}`,product_id:p.id,name:p.name||'',code:p.code||'',barcode:p.barcode||'',unit_name:p.unit_name||'boîte',alert_threshold:Number(p.alert_threshold||0),purchase_price:Number(p.purchase_price||0),sale_price:Number(p.sale_price||0),stock:Number(l.quantity||0),current_stock:Number(l.quantity||0),lot_id:l.id,lot_number:l.lot_number||'—',expiry_date:l.expiry_date||'',value_purchase:Number(l.quantity||0)*Number(p.purchase_price||0)});}else rows.push({id:`${p.id}-none`,product_id:p.id,name:p.name||'',code:p.code||'',barcode:p.barcode||'',unit_name:p.unit_name||'boîte',alert_threshold:Number(p.alert_threshold||0),purchase_price:Number(p.purchase_price||0),sale_price:Number(p.sale_price||0),stock:0,current_stock:0,lot_id:null,lot_number:'—',expiry_date:'',value_purchase:0});}return rows;}
  async function lots(){const ps=await all('products'),ss=await all('suppliers'),ls=await all('lots');const today=new Date();today.setHours(0,0,0,0);return ls.map(l=>{const p=ps.find(x=>x.id===l.product_id)||{},s=ss.find(x=>x.id===l.supplier_id)||{};const d=new Date(l.expiry_date);const status=d<today?'expired':d<=new Date(today.getTime()+30*864e5)?'soon':'ok';return {...l,product_name:p.name||'',product_code:p.code||'',supplier_name:s.name||'',status};});}
  async function dashboard(){const ps=await products(),ss=await all('users'),sales=await all('sales'),ls=await lots();const day=new Date().toISOString().slice(0,10);const today=sales.filter(s=>String(s.created_at).slice(0,10)===day);return {revenue:today.reduce((a,s)=>a+Number(s.total||0),0),sales:today.length,products:ps.reduce((a,p)=>a+Number(p.stock||0),0),sellers:ss.filter(u=>u.active&&u.role==='seller').length,expired:ls.filter(l=>l.status==='expired'&&l.quantity>0).length,soon:ls.filter(l=>l.status==='soon'&&l.quantity>0).length,low:ps.filter(p=>p.stock<=p.alert_threshold).length};}
  async function salesReport(url){
    const sales=await all('sales');
    const users=await all('users');
    const items=await all('sale_items');
    const productsList=await all('products');
    const params=new URL(url,location.href).searchParams;
    const from=params.get('from');
    const to=params.get('to');
    const toExclusive=to?new Date(`${to}T00:00:00`):null;
    if(toExclusive) toExclusive.setDate(toExclusive.getDate()+1);
    const fromDate=from?new Date(`${from}T00:00:00`):null;
    const selected=sales.filter(s=>{
      const d=new Date(s.created_at||s.date||'');
      if(Number.isNaN(d.getTime())) return false;
      if(fromDate && d<fromDate) return false;
      if(toExclusive && d>=toExclusive) return false;
      return true;
    });
    return selected.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).map(s=>{
      const saleItems=items.filter(i=>i.sale_id===s.id).map(i=>{
        const p=productsList.find(x=>x.id===i.product_id)||{};
        const quantity=Number(i.quantity||0);
        const unitPrice=Number(i.unit_price ?? p.sale_price ?? 0);
        return {...i,product_name:p.name||'Produit non précisé',product_code:p.code||p.barcode||'—',quantity,unit_price:unitPrice,total:quantity*unitPrice};
      });
      const calculatedTotal=saleItems.reduce((sum,i)=>sum+Number(i.total||0),0);
      return {...s,seller:users.find(u=>u.id===s.seller_id)?.name||'—',items:saleItems,total:Number(s.total ?? calculatedTotal)};
    });
  }
  async function body(req){try{return req.body?JSON.parse(req.body):{};}catch{return {};}}
  // ---------------------------------------------------------------------------------------------------------------------
  // Sauvegarde : fabrication, restauration, et marqueur de modification (utilisé par la sauvegarde automatique Google Drive).
  // ---------------------------------------------------------------------------------------------------------------------
  const BACKUP_STORES=['users','products','suppliers','lots','receipts','receipt_items','sales','sale_items','stock_movements','audit_logs','settings','app_meta'];
  async function buildBackupData(){
    return {
      format:'PHARMAGEST_BACKUP',
      version:1,
      created_at:now(),
      application:'PharmaGest',
      users:await all('users'),
      products:await all('products'),
      suppliers:await all('suppliers'),
      lots:await all('lots'),
      receipts:await all('receipts'),
      receipt_items:await all('receipt_items'),
      sales:await all('sales'),
      sale_items:await all('sale_items'),
      stock_movements:await all('stock_movements'),
      audit_logs:await all('audit_logs'),
      settings:await get('settings'),
      app_meta:await all('app_meta')
    };
  }
  async function applyBackupData(b){
    for(const s of BACKUP_STORES){
      if(!(s in b)) continue;
      await clear(s);
      const value=b[s];
      if(s==='settings'){
        if(value && typeof value==='object') await put('settings',value.id?value:{id:'settings',settings:value});
      }else{
        for(const x of (Array.isArray(value)?value:[value])) if(x) await put(s,x);
      }
    }
  }
  window.__pharmagestBuildBackup=buildBackupData;
  // Journal des ventes d'un téléphone vendeur (envoyé sur Drive) : les 30 derniers jours de ventes faites par ce téléphone.
  window.__pharmagestBuildSellerJournal=async function(){
    if(nativeRole()!=='seller') return null;
    const cu=await currentUser().catch(()=>null); if(!cu) return null;
    const since=Date.now()-30*86400000, entries=[];
    for(const q of (await all('sync_queue'))){
      if(!q||q.method!=='POST'||q.path!=='/api/sales') continue;
      if(!(Date.parse(q.created_at||'')>=since)) continue;
      let b={};try{b=JSON.parse(q.body||'{}');}catch{}
      const op=String(b.operation_id||q.operation_id||''); if(!op) continue;
      const ls=q.local_sale_id?await get('sales',q.local_sale_id):null;
      entries.push({operation_id:op,body:q.body,created_at:q.created_at,seller_id:(ls&&ls.seller_id)||cu.id});
    }
    return {format:'PHARMAGEST_SELLER_JOURNAL',version:1,device_id:localStorage.getItem('pharmagest_device_id')||'',seller_id:cu.id,seller_name:cu.name||cu.username||'',updated_at:now(),entries};
  };
  // Admin : applique une vente d'un journal vendeur (sans doublon grâce à operation_id ; le stock est décompté comme pour une vente reçue en direct).
  window.__pharmagestReplaySale=async function(journal,entry){
    let b;try{b=JSON.parse(entry.body||'{}');}catch{return {skip:true};}
    const op=String(b.operation_id||entry.operation_id||''); if(!op) return {skip:true};
    if((await all('sales')).some(x=>x.operation_id===op)) return {skip:true,exists:true};
    const sid=entry.seller_id||journal.seller_id;
    const seller=(await all('users')).find(u=>String(u.id)===String(sid));
    if(!seller) return {error:'Vendeur inconnu sur ce téléphone Admin ('+(journal.seller_name||sid)+')'};
    try{ await route('/api/sales',{method:'POST',body:JSON.stringify({...b,operation_id:op}),remote:true,replayAt:entry.created_at,headers:{}},seller); return {imported:true}; }
    catch(err){ return {error:(err&&err.message)||'Vente non importée'}; }
  };
  // Numéro de révision des données : augmente à chaque modification réussie. La sauvegarde Drive ne repart que si ce numéro a changé.
  window.__pharmagestMarkChanged=function(){ try{ markDataChanged(); }catch(e){} };
  function markDataChanged(){
    try{ localStorage.setItem('pg_data_rev',String((Number(localStorage.getItem('pg_data_rev'))||0)+1)); window.dispatchEvent(new Event('pg-data-changed')); }catch(e){}
  }

  async function route(url,req,remoteUser=null){await ensureCatalogSeed();const u=new URL(url,location.href),path=u.pathname.replace(/^.*?\/api/,'')||'/';const method=(req.method||'GET').toUpperCase();const cu=req.remote?(remoteUser||null):(remoteUser||await currentUser());
    if(path==='/health')return {ok:true,service:'PharmaGest Android Local',database:'IndexedDB'};
    if(path==='/auth/login'&&method==='POST'){const b=await body(req),us=await all('users'),username=normalizeUsername(b.username),x=us.find(v=>normalizeUsername(v.username)===username&&isActiveUser(v));if(!x||!(await passwordMatches(x,b.password||'')))throw Object.assign(new Error('Identifiant ou mot de passe incorrect.'),{status:401});if(req.remote&&normalizeRole(x.role)==='seller'){const device=String(b.device_id||'').trim();const link=device?await get('device_links',device):null;if(!link||link.active!==true||link.user_id!==x.id)throw Object.assign(new Error('Cet appareil vendeur n’est pas appairé à cet établissement.'),{status:403});}if(!req.remote){localStorage.setItem('dpa_local_user_id',x.id);localStorage.setItem('dpa_session_active','1');localStorage.setItem('dpa_user',JSON.stringify({id:x.id,name:x.name,username:x.username,role:x.role,active:x.active,is_owner:!!x.is_owner}));}await audit(x,'LOGIN','auth',x.id,{remote:!!req.remote,device_id:String(b.device_id||'').trim()||null});return {token:makeToken(x),user:{id:x.id,name:x.name,username:x.username,role:x.role,active:x.active,is_owner:!!x.is_owner}};}
    if(path==='/me'){if(!cu)throw Object.assign(new Error('Authentification requise'),{status:401});return cu;}
    // L'appairage initial est volontairement exécuté avant le contrôle de session :
    // le vendeur n'a pas encore de token local lorsqu'il contacte le maître pour la première fois.
    if(path==='/pairing/verify'&&method==='POST'){
      const b=await body(req);
      const token=String(b.token||'').trim();
      const pairingCode=String(b.pairing_code||'').replace(/\D/g,'').slice(0,6);
      let pair=token?await get('pairing_sessions',token):null;
      if(!pair && pairingCode){
        const sessions=await all('pairing_sessions');
        pair=sessions.find(x=>String(x.pairing_code||'')===pairingCode && x.status==='pending')||null;
      }
      let expiresAt=pair?.expires_at||b.pair_expires_at||'';
      const expired=!expiresAt || Number.isNaN(new Date(expiresAt).getTime()) || new Date(expiresAt).getTime()<Date.now();
      if(expired)throw Object.assign(new Error('Code d’appairage invalide ou expiré. Générez un nouveau QR depuis le téléphone Admin.'),{status:401});
      if(pair && pair.status!=='pending')throw Object.assign(new Error('Ce code d’appairage a déjà été utilisé ou révoqué. Générez un nouveau QR depuis le téléphone Admin.'),{status:401});
      // Le QR d'établissement n'est pas réservé aux vendeurs : un compte Admin
      // ou Vendeur peut l'utiliser. Le rôle réel est déterminé par le compte
      // authentifié, jamais par le QR. Le même QR/code reste réutilisable pendant
      // sa fenêtre de validité afin de permettre plusieurs appareils autorisés.
      const pairingCreatedBy=pair?.created_by||null;
      const username=normalizeUsername(b.username);
      const us=await all('users');
      const x=us.find(v=>normalizeUsername(v.username)===username);
      if(!x) throw Object.assign(new Error('Utilisateur introuvable dans la base Admin. Vérifiez l’identifiant saisi.'),{status:401,code:'USER_NOT_FOUND'});
      if(!isActiveUser(x)) throw Object.assign(new Error('Ce compte est désactivé dans la base Admin.'),{status:403,code:'USER_INACTIVE'});
      const role=normalizeRole(x.role);
      if(!['seller','admin','super_admin','owner'].includes(role)) throw Object.assign(new Error('Le rôle de ce compte ne permet pas l’appairage.'),{status:403,code:'ROLE_NOT_ALLOWED'});
      if(!(await passwordMatches(x,b.password||''))) throw Object.assign(new Error('Identifiant ou mot de passe incorrect.'),{status:401,code:'PASSWORD_MISMATCH'});
      const device=String(b.device_id||'').trim();
      if(!device)throw Object.assign(new Error('Identifiant appareil manquant.'),{status:400});
      await put('device_links',{id:device,device_id:device,user_id:x.id,user_name:x.name,username:x.username,role:x.role,active:true,type:String(b.device_type||'mobile'),linked_at:now(),linked_by:pairingCreatedBy});
      // Ne pas consommer le QR : il reste valable jusqu'à expires_at et peut
      // servir à plusieurs vendeurs, admins ou au PC.
      if(pair){pair.last_used_at=now();pair.last_device_id=device;pair.last_user_id=x.id;pair.last_role=role;await put('pairing_sessions',pair);}
      await audit(x,'PAIRING','device',device,{role,created_by:pairingCreatedBy||null,source:'establishment_qr'});
      return {success:true,paired:true,token:makeToken(x),user:{id:x.id,name:x.name,username:x.username,role:x.role,active:x.active,is_owner:!!x.is_owner},installation_id:localStorage.getItem('pg_installation_id')||''};
    }
    // PC : appairage initial par code uniquement.
    // Le PC est déjà connecté au hotspot Admin et n'a pas à connaître les identifiants Admin.
    // Le code temporaire autorise la machine ; l'utilisateur se connectera ensuite séparément
    // avec ses propres identifiants sur l'écran de connexion du PC.
    if(path==='/pc/pair-code'&&method==='POST'){
      const b=await body(req);
      const code=String(b.pairing_code||'').replace(/\D/g,'').slice(0,6);
      if(code.length!==6) throw Object.assign(new Error('Code d’appairage invalide.'),{status:400});
      const sessions=await all('pairing_sessions');
      const pair=sessions.find(x=>String(x.pairing_code||'')===code&&x.status==='pending')||null;
      if(!pair) throw Object.assign(new Error('Code d’appairage invalide, déjà utilisé ou expiré.'),{status:401});
      const expiresAt=pair.expires_at||'';
      if(!expiresAt||Number.isNaN(new Date(expiresAt).getTime())||new Date(expiresAt).getTime()<Date.now()){
        pair.status='expired'; await put('pairing_sessions',pair);
        throw Object.assign(new Error('Code d’appairage expiré. Créez un nouveau code depuis le téléphone Admin.'),{status:401});
      }
      const creatorId=String(pair.created_by||'').trim();
      const users=await all('users');
      const creator=users.find(u=>String(u.id)===creatorId&&isActiveUser(u));
      if(!creator||!['admin','super_admin','owner'].includes(normalizeRole(creator.role))) throw Object.assign(new Error('La session d’appairage n’est plus valide. Créez un nouveau code depuis le téléphone Admin.'),{status:403});
      const device=String(b.device_id||uid()).trim();
      const pcName=String(b.pc_name||'PharmaGest PC').trim()||'PharmaGest PC';
      await put('device_links',{id:device,device_id:device,user_id:creator.id,user_name:creator.name,username:creator.username,role:creator.role,active:true,type:'pc',linked_at:now(),linked_by:creator.id,pc_name:pcName});
      pair.last_used_at=now(); pair.last_device_id=device; pair.last_user_id=creator.id; pair.last_role='admin'; pair.last_device_type='pc'; pair.last_pc_name=pcName; await put('pairing_sessions',pair);
      const tokenAdmin=makeToken(creator);
      await audit(creator,'PC_PAIRING','device',device,{pc_name:pcName,source:'pairing_code_only'});
      return {success:true,paired:true,token:tokenAdmin,device_id:device,pc_name:pcName,installation_id:localStorage.getItem('pg_installation_id')||''};
    }
    // PC : ancien parcours avec identifiants Admin conservé pour compatibilité.
    if(path==='/pc/pair'&&method==='POST'){
      const b=await body(req);
      const code=String(b.pairing_code||'').replace(/\D/g,'').slice(0,6);
      if(code.length!==6) throw Object.assign(new Error('Code d’appairage PC invalide.'),{status:400});
      const sessions=await all('pairing_sessions');
      const pair=sessions.find(x=>String(x.pairing_code||'')===code&&x.status==='pending')||null;
      if(!pair) throw Object.assign(new Error('Code d’appairage invalide, déjà utilisé ou expiré.'),{status:401});
      const expiresAt=pair.expires_at||'';
      if(!expiresAt||Number.isNaN(new Date(expiresAt).getTime())||new Date(expiresAt).getTime()<Date.now()){
        pair.status='expired'; await put('pairing_sessions',pair);
        throw Object.assign(new Error('Code d’appairage expiré. Créez un nouveau code depuis le téléphone Admin.'),{status:401});
      }
      const username=normalizeUsername(b.username), users=await all('users');
      const x=users.find(v=>normalizeUsername(v.username)===username&&isActiveUser(v));
      if(!x||!['admin','super_admin','owner'].includes(normalizeRole(x.role))) throw Object.assign(new Error('Seul un compte Admin peut autoriser un ordinateur.'),{status:403});
      if(!(await passwordMatches(x,b.password||''))) throw Object.assign(new Error('Mot de passe Admin incorrect.'),{status:401});
      const device=String(b.device_id||uid()).trim();
      pair.last_used_at=now(); pair.last_device_id=device; pair.last_user_id=x.id; pair.last_role='admin'; pair.device_type='pc'; await put('pairing_sessions',pair);
      await put('device_links',{id:device,device_id:device,user_id:x.id,user_name:x.name,username:x.username,role:'admin',active:true,type:'pc',linked_at:now(),linked_by:x.id});
      const tokenAdmin=makeToken(x);
      await audit(x,'PC_PAIRING','device',device,{pc_name:String(b.pc_name||'PharmaGest PC')});
      return {success:true,paired:true,token:tokenAdmin,user:{id:x.id,name:x.name,username:x.username,role:'admin',active:true,is_owner:!!x.is_owner},device_id:device,pc_name:String(b.pc_name||'PharmaGest PC'),installation_id:localStorage.getItem('pg_installation_id')||''};
    }
    if(!cu)throw Object.assign(new Error('Authentification requise'),{status:401});
    // ============================================================
    // PC <-> TELEPHONE : synchronisation bidirectionnelle locale
    // ============================================================
    const PC_SYNC_STORES=['users','products','suppliers','lots','receipts','receipt_items','sales','sale_items','stock_movements','audit_logs','settings','app_meta'];
    function syncStamp(row){return String(row?.updated_at||row?.modified_at||row?.created_at||'1970-01-01T00:00:00.000Z');}
    async function exportPcSync(){
      const stores={};
      for(const store of PC_SYNC_STORES) stores[store]=await all(store);
      return {protocol:'pharmagest-pc-sync',version:1,installation_id:localStorage.getItem('pg_installation_id')||'',generated_at:now(),stores};
    }
    async function importPcSync(snapshot,source='remote'){
      if(!snapshot || snapshot.protocol!=='pharmagest-pc-sync') throw Object.assign(new Error('Paquet de synchronisation PharmaGest invalide.'),{status:400});
      const stores=snapshot.stores||{}; const result={inserted:0,updated:0,kept:0,conflicts:0,stores:{}};
      for(const store of PC_SYNC_STORES){
        const incoming=Array.isArray(stores[store])?stores[store]:[]; if(!incoming.length) continue;
        let ins=0,upd=0,keep=0,conf=0;
        const localRows=await all(store); const map=new Map(localRows.map(x=>[String(x.id),x]));
        for(const row of incoming){ if(!row || row.id===undefined || row.id===null) continue; const old=map.get(String(row.id));
          if(!old){await put(store,row);ins++;continue;}
          const a=syncStamp(old), b=syncStamp(row);
          if(b>a){await put(store,row);upd++;}
          else if(a>b){keep++;}
          else if(JSON.stringify(old)!==JSON.stringify(row)){conf++; keep++;}
          else keep++;
        }
        result.inserted+=ins;result.updated+=upd;result.kept+=keep;result.conflicts+=conf;result.stores[store]={inserted:ins,updated:upd,kept:keep,conflicts:conf};
      }
      const u=await currentUser();
      await audit(u,'PC_SYNC_MERGE','sync',null,{source,protocol_version:1,...result});
      return result;
    }
    window.__pharmagestPcSyncExport=exportPcSync;
    window.__pharmagestPcSyncImport=importPcSync;
    if(path==='/pc/sync/export'&&method==='GET'){
      if(!cu || !['admin','super_admin','owner'].includes(normalizeRole(cu.role))) throw Object.assign(new Error('Accès administrateur requis.'),{status:403});
      return await exportPcSync();
    }
    if(path==='/pc/sync/import'&&method==='POST'){
      if(!cu || !['admin','super_admin','owner'].includes(normalizeRole(cu.role))) throw Object.assign(new Error('Accès administrateur requis.'),{status:403});
      return {success:true,...await importPcSync(await body(req),'pc')};
    }
    if(path==='/pc/link'&&method==='GET'){
      if(!cu || !['admin','super_admin','owner'].includes(normalizeRole(cu.role))) throw Object.assign(new Error('Accès administrateur requis.'),{status:403});
      return (await get('app_meta','pc_link'))?.value||null;
    }
    if(path==='/pc/link'&&method==='POST'){
      if(!cu || !['admin','super_admin','owner'].includes(normalizeRole(cu.role))) throw Object.assign(new Error('Accès administrateur requis.'),{status:403});
      const b=await body(req); const value={base:String(b.base||'').trim().replace(/\/$/,''),token:String(b.token||''),device_id:String(b.device_id||''),pc_name:String(b.pc_name||'PharmaGest PC'),paired_at:now()};
      if(!value.base || !value.token) throw Object.assign(new Error('Connexion PC incomplète.'),{status:400});
      await put('app_meta',{id:'pc_link',key:'pc_link',value,updated_at:now()});
      await audit(cu,'PC_LINKED','device',value.device_id||null,{base:value.base,pc_name:value.pc_name});
      return {success:true,value};
    }
    if(path==='/dashboard')return dashboard();
    if(path==='/stock'&&method==='GET')return stockRows();
    if(path==='/alerts'){const ls=await lots();return ls.filter(l=>l.quantity>0&&(l.status==='expired'||l.status==='soon')).map(l=>({type:l.status,name:l.product_name,lot_number:l.lot_number,expiry_date:l.expiry_date,quantity:l.quantity}));}
    if(path==='/pairing/create'&&method==='POST'){
      if(!cu||!['admin','super_admin','owner'].includes(normalizeRole(cu.role)))throw Object.assign(new Error('Seul un administrateur peut créer une connexion d’établissement.'),{status:403});
      const base=pairingBase();
      let networkInfo={};
      try{networkInfo=JSON.parse(window.PharmaGestNative?.getNetworkStatusJson?.()||'{}')}catch{}
      if(!networkInfo.hotspotActive)throw new Error('Le hotspot Admin n’est pas encore actif. Attendez l’affichage du nom et du mot de passe du hotspot puis réessayez.');
      if(!base)throw new Error('Le serveur local n’est pas encore disponible. Ouvrez le réseau maître puis réessayez.');
      const existingPairings=await all('pairing_sessions');
      for(const old of existingPairings){
        if(old.created_by===cu.id && old.status==='pending'){
          old.status='revoked';
          old.revoked_at=now();
          await put('pairing_sessions',old);
        }
      }
      const token=randomToken();
      const pairingCode=String(Math.floor(100000+Math.random()*900000));
      const expiresAt=new Date(Date.now()+10*60*1000).toISOString();
      await put('pairing_sessions',{id:token,token,pairing_code:pairingCode,expires_at:expiresAt,status:'pending',created_at:now(),created_by:cu.id});
      let installationId=localStorage.getItem('pg_installation_id')||'';
      if(!installationId){installationId='PG-'+Math.random().toString(36).slice(2,10).toUpperCase();localStorage.setItem('pg_installation_id',installationId);}
      return {token,pairing_code:pairingCode,expires_at:expiresAt,server_base:base,ssid:networkInfo.ssid||'',password:networkInfo.password||'',service_name:'PharmaGest',installation_id:installationId};
    }
    if(path==='/pairing/cache-user'&&method==='POST'&&!req.remote){
      const b=await body(req);
      const x={id:String(b.id||uid()),name:String(b.name||b.username||'Vendeur'),username:String(b.username||'').trim().toLowerCase(),password_hash:await hashPassword(String(b.password||'')),role:'seller',active:true,is_owner:false,created_at:now()};
      if(!x.username)throw new Error('Identifiant vendeur manquant.');
      await put('users',x);
      localStorage.setItem('dpa_local_user_id',x.id);
      return {success:true,user:{id:x.id,name:x.name,username:x.username,role:x.role,active:true,is_owner:false}};
    }
    if(path==='/sync/report'&&method==='POST'){
      if(normalizeRole(cu.role)!=='seller')throw Object.assign(new Error('Réservé aux vendeurs.'),{status:403});
      const b=await body(req),device=String(b.device_id||'').trim();
      const link=device?await get('device_links',device):null;
      if(!link||link.active!==true||String(link.user_id)!==String(cu.id))throw Object.assign(new Error('Cet appareil vendeur n’est pas appairé.'),{status:403});
      const sent=Math.max(0,Math.floor(Number(b.sent)||0));
      const feed=await get('app_meta','sync_feed')||{id:'sync_feed',key:'sync_feed',value:[]};
      const ev={id:uid(),at:now(),seller_id:cu.id,seller:cu.name||cu.username||'Vendeur',device_id:device,sent};
      feed.value=[ev,...(Array.isArray(feed.value)?feed.value:[])].slice(0,50);
      await put('app_meta',feed);
      await audit(cu,'SELLER_SYNC','sync',cu.id,{seller:ev.seller,sales_sent:sent,device_id:device});
      return {success:true,event:ev};
    }
    if(path==='/sync/events'&&method==='GET'){
      if(normalizeRole(cu.role)!=='admin')throw Object.assign(new Error('Accès administrateur requis.'),{status:403});
      const since=String(u.searchParams.get('since')||'');
      const feed=await get('app_meta','sync_feed');
      const events=(Array.isArray(feed?.value)?feed.value:[]).filter(e=>!since||String(e.at)>since).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
      return {events,now:now()};
    }
    if(path==='/pairing/status'&&method==='GET'){
      const device=String(u.searchParams.get('device_id')||'').trim();
      const link=device?await get('device_links',device):null;
      return {paired:!!link&&link.active===true,device_id:device,user_id:link?.user_id||null};
    }
    if(path==='/offline/catalog'&&method==='GET'){const ps=await products();return {products:ps,lots:await all('lots'),suppliers:await all('suppliers'),settings:(await get('settings'))?.settings||{},generated_at:now()};}
    if(path==='/products'&&method==='GET')return products();
    if(path==='/products'&&method==='POST'){const b=await body(req),p={id:uid(),...b,purchase_price:Number(b.purchase_price||0),sale_price:Number(b.sale_price||0),alert_threshold:Number(b.alert_threshold||0),units_per_carton:Number(b.units_per_carton||1),active:true,created_at:now()};await put('products',p);await audit(cu,'CREATE','products',p.id,{name:p.name});return p;}
    const productMatch=path.match(/^\/products\/([^/]+)$/);
    if(productMatch&&(method==='PUT'||method==='DELETE')){
      if(!cu||!['admin','super_admin','owner'].includes(normalizeRole(cu.role)))throw Object.assign(new Error('Seul un administrateur peut modifier ou supprimer un produit.'),{status:403});
      const pid=decodeURIComponent(productMatch[1]);
      const target=await get('products',pid);
      if(!target||target.active===false)throw Object.assign(new Error('Produit introuvable.'),{status:404});
      if(method==='PUT'){
        const b=await body(req);
        const code=String(b.code??target.code??'').trim(),name=String(b.name??target.name??'').trim();
        if(!code||!name)throw Object.assign(new Error('Le code et le nom du produit sont obligatoires.'),{status:400});
        const dup=(await all('products')).find(x=>x&&x.active!==false&&String(x.id)!==String(target.id)&&String(x.code||'').trim().toLowerCase()===code.toLowerCase());
        if(dup)throw Object.assign(new Error('Ce code produit existe déjà ('+(dup.name||code)+').'),{status:409});
        const txt=k=>b[k]===undefined?target[k]:String(b[k]??'').trim();
        const nul=k=>b[k]===undefined?(target[k]??null):(String(b[k]??'').trim()||null);
        const num=(k,min,def)=>b[k]===undefined?(target[k]??def):Math.max(min,Number(b[k])||def);
        const before={name:target.name,code:target.code,purchase_price:target.purchase_price,sale_price:target.sale_price};
        Object.assign(target,{code,name,active_ingredient:txt('active_ingredient'),dosage:txt('dosage'),form:txt('form'),category:txt('category'),laboratory:txt('laboratory'),
          barcode:nul('barcode'),datamatrix:nul('datamatrix'),purchase_price:num('purchase_price',0,0),sale_price:num('sale_price',0,0),alert_threshold:num('alert_threshold',0,0),
          unit_name:String(b.unit_name??target.unit_name??'').trim()||'boîte',units_per_carton:num('units_per_carton',1,1),updated_at:now(),updated_by:cu.id});
        await put('products',target);
        await audit(cu,'UPDATE','products',target.id,{name:target.name,before,after:{name:target.name,code:target.code,purchase_price:target.purchase_price,sale_price:target.sale_price}});
        return target;
      }
      // DELETE : suppression « douce » (le produit disparaît des listes, mais l'historique des ventes, réceptions et mouvements de stock reste lisible)
      target.active=false;target.deleted_at=now();target.deleted_by=cu.id;target.updated_at=now();
      await put('products',target);
      await audit(cu,'DELETE','products',target.id,{name:target.name,code:target.code});
      return {success:true,id:target.id};
    }
    if(path==='/drive/credentials'&&method==='GET'){
      // Le téléphone Admin transmet l'accès Google Drive aux téléphones vendeurs (réseau local) : ils n'ont pas à se connecter à Google.
      if(!cu||cu.active===false||nativeRole()==='seller')throw Object.assign(new Error('Non autorisé.'),{status:403});
      let gt={};try{gt=JSON.parse(localStorage.getItem('pg_google_tokens')||'{}');}catch{}
      if(!gt.refresh_token)throw Object.assign(new Error('Google Drive n’est pas connecté sur le téléphone Admin.'),{status:404});
      return {refresh_token:gt.refresh_token};
    }
    if(path==='/products/scan'&&method==='GET'){const code=u.searchParams.get('code')||'',ps=await products(),p=ps.find(x=>x.code===code||x.barcode===code||x.datamatrix===code);if(!p)throw Object.assign(new Error('Produit introuvable'),{status:404});return p;}
    if(path==='/lots'&&method==='GET')return lots();
    if(path==='/suppliers'&&method==='GET')return all('suppliers');
    if(path==='/suppliers'&&method==='POST'){const b=await body(req),s={id:uid(),...b,created_at:now()};await put('suppliers',s);await audit(cu,'CREATE','suppliers',s.id,{name:s.name});return s;}
    if(path==='/setup/status'&&method==='GET'){const owner=await hasOwner();return {initialized:owner,installation_id:localStorage.getItem('pg_installation_id')||''};}
    if(path==='/setup/owner'&&method==='POST'){
      if(await hasOwner()) throw Object.assign(new Error('Cette installation est déjà initialisée.'),{status:409});
      const b=await body(req);
      const name=String(b.name||'').trim(), username=String(b.username||'').trim().toLowerCase(), password=String(b.password||'');
      if(name.length<2) throw new Error('Le nom du propriétaire est requis.');
      if(!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) throw new Error('Identifiant invalide : 3 à 32 caractères.');
      if(password.length<6) throw new Error('Le mot de passe doit contenir au moins 6 caractères.');
      const existing=(await all('users')).find(u=>u.username===username);
      if(existing) throw Object.assign(new Error('Cet identifiant existe déjà.'),{status:409});
      const owner={id:uid(),name,username,password_hash:await hashPassword(password),role:'admin',is_owner:true,active:true,created_at:now()};
      await put('users',owner);
      const installId=localStorage.getItem('pg_installation_id')||('PG-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)).toUpperCase();
      localStorage.setItem('pg_installation_id',installId);
      await put('settings',{id:'settings',settings:{general:{companyName:'',phone:'',address:''},recu:{footer:'Merci pour votre confiance.'},installation:{id:installId,ownerId:owner.id,initializedAt:now()}},updated_at:now(),updated_by:owner.id});
      await audit(owner,'INSTALLATION','system',installId,{owner_username:username});
      await ensureCatalogSeed();
      return {success:true,installation_id:installId,user:{id:owner.id,name:owner.name,username:owner.username,role:owner.role,is_owner:true,active:true},message:'Installation initialisée avec succès.'};
    }
    if(path==='/users'&&method==='GET'){
      if(!cu||cu.role!=='admin')throw Object.assign(new Error('Accès administrateur requis.'),{status:403});
      const allUsers=await all('users');
      const sales=await all('sales');
      const bySeller={};
      for(const sale of sales){const id=String(sale.seller_id||'');if(!id)continue;if(!bySeller[id])bySeller[id]={count:0,revenue:0};bySeller[id].count++;bySeller[id].revenue+=Number(sale.total||0);}
      // La normalisation du propriétaire est centralisée dans ensureCatalogSeed().
      const rows=(await all('users')).map(({password,password_hash,...x})=>({...x,sales_count:bySeller[String(x.id)]?.count||0,sales_revenue:bySeller[String(x.id)]?.revenue||0})).sort((a,b)=>String(a.name||a.username||'').localeCompare(String(b.name||b.username||'')));
      const ownerCount=rows.filter(u=>u.active!==false&&u.is_owner===true).length;
      return {users:rows,stats:{total:rows.length,sellers:rows.filter(u=>normalizeRole(u.role)==='seller'&&isActiveUser(u)).length,admins:rows.filter(u=>normalizeRole(u.role)==='admin'&&isActiveUser(u)).length,disabled:rows.filter(u=>!isActiveUser(u)).length,superAdmins:ownerCount}};
    }
    if(path==='/users'&&method==='POST'){
      if(!cu||cu.role!=='admin') throw Object.assign(new Error('Seul un administrateur peut créer un utilisateur.'),{status:403});
      const b=await body(req);
      const username=String(b.username||'').trim().toLowerCase();
      const password=String(b.password||'changeme');
      const role=String(b.role||'seller').trim().toLowerCase();
      const creatorIsSuperAdmin=await isSuperAdminUser(cu);
      if(!username) throw new Error('Identifiant requis.');
      if(password.length<6) throw new Error('Le mot de passe doit contenir au moins 6 caractères.');
      if(!['admin','seller'].includes(role)) throw new Error('Rôle invalide. Choisissez Administrateur ou Vendeur.');
      if(role==='admin'&&!creatorIsSuperAdmin) throw Object.assign(new Error('Seul le Super Admin peut créer un administrateur.'),{status:403});
      if((await all('users')).some(u=>String(u.username||'').trim().toLowerCase()===username)) throw Object.assign(new Error('Cet identifiant existe déjà.'),{status:409});
      const x={id:uid(),name:b.name||b.full_name||username,username,phone:String(b.phone||'').trim(),password_hash:await hashPassword(password),role,active:b.active!==false,is_owner:false,created_at:now()};
      await put('users',x);
      await audit(cu,'CREATE','users',x.id,{username:x.username,role:x.role});
      const {password_hash,...safe}=x;
      return safe;
    }
    const userMatch=path.match(/^\/users\/([^/]+)(?:\/(password|status|history))?$/);
    if(userMatch){
      if(!cu||cu.role!=='admin')throw Object.assign(new Error('Accès administrateur requis.'),{status:403});
      const id=decodeURIComponent(userMatch[1]);
      const action=userMatch[2]||'';
      const target=await get('users',id);
      if(!target)throw Object.assign(new Error('Utilisateur introuvable.'),{status:404});
      // Règle des rôles : seul le Super Admin gère les administrateurs.
      // Un admin standard ne gère que les vendeurs (et son propre compte) : sans ce contrôle,
      // il pouvait changer le mot de passe du Super Admin ou désactiver un autre admin.
      const actorIsSuper=await isSuperAdminUser(cu);
      if(!actorIsSuper && String(target.id)!==String(cu.id) && (target.is_owner===true || normalizeRole(target.role)==='admin') && !(action==='history'&&method==='GET'))
        throw Object.assign(new Error('Seul le Super Admin peut modifier un administrateur.'),{status:403});
      if(action==='history'&&method==='GET'){
        const logs=await all('audit_logs');
        return logs.filter(x=>String(x.user_id||'')===String(id)).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
      }
      if(action==='password'&&method==='PATCH'){
        const b=await body(req),password=String(b.password||'');
        if(password.length<6)throw new Error('Le mot de passe doit contenir au moins 6 caractères.');
        target.password_hash=await hashPassword(password);
        await put('users',target);
        await audit(cu,'PASSWORD_CHANGE','users',target.id,{username:target.username});
        const {password_hash,...safe}=target;return safe;
      }
      if(action==='status'&&method==='PATCH'){
        const b=await body(req),active=!!b.active;
        if(target.id===cu.id&&!active)throw new Error('Vous ne pouvez pas désactiver votre propre compte.');
        if(target.is_owner&&!active)throw new Error('Le compte propriétaire ne peut pas être désactivé.');
        target.active=active;
        await put('users',target);
        await audit(cu,active?'ACTIVATE':'DEACTIVATE','users',target.id,{username:target.username});
        const {password_hash,...safe}=target;return safe;
      }
      if(method==='PUT'){
        const b=await body(req),username=String(b.username??target.username).trim().toLowerCase();
        if(!username)throw new Error('Identifiant requis.');
        const duplicate=(await all('users')).find(u=>u.id!==target.id&&u.username===username);
        if(duplicate)throw Object.assign(new Error('Cet identifiant existe déjà.'),{status:409});
        const requestedRole=String(b.role??target.role).trim().toLowerCase();
        const creatorIsSuperAdmin=await isSuperAdminUser(cu);
        if(target.is_owner&&requestedRole!=='admin')throw new Error('Le compte propriétaire doit rester administrateur.');
        if(!creatorIsSuperAdmin && normalizeRole(requestedRole)!==normalizeRole(target.role))throw Object.assign(new Error('Seul le Super Admin peut changer le rôle d’un utilisateur.'),{status:403});
        if(requestedRole==='admin'&&!creatorIsSuperAdmin&&String(target.role).toLowerCase()!=='admin')throw Object.assign(new Error('Seul le Super Admin peut promouvoir un utilisateur en administrateur.'),{status:403});
        target.name=String(b.name??target.name).trim()||target.username;
        target.username=username;
        target.phone=String(b.phone??target.phone??'').trim();
        target.role=requestedRole;
        if(!['admin','seller'].includes(target.role))throw new Error('Rôle invalide.');
        if(target.id!==cu.id && typeof b.active==='boolean')target.active=b.active;
        await put('users',target);
        await audit(cu,'UPDATE','users',target.id,{username:target.username,role:target.role});
        const {password_hash,...safe}=target;return safe;
      }
    }
    if(path==='/settings'&&method==='GET'){const local=(await get('settings'))?.settings||{};if(nativeRole()==='seller' && !nativeServerSafe()){const cache=(await get('app_meta','catalog_cache'))?.value;return cache?.settings||local;}return local;}
    if(path==='/settings'&&method==='PUT'){
      const b=await body(req),old=await get('settings')||{id:'settings',settings:{}};
      const incoming=b.settings||b;
      const base=old.settings||{};
      const merged={...base};
      for(const [section,value] of Object.entries(incoming||{})){
        if(value && typeof value==='object' && !Array.isArray(value) && base[section] && typeof base[section]==='object' && !Array.isArray(base[section])){
          merged[section]={...base[section],...value};
        }else if(value!==undefined){
          merged[section]=value;
        }
      }
      await put('settings',{...old,id:'settings',settings:merged,updated_at:now(),updated_by:cu.id});
      await audit(cu,'UPDATE','settings',null,{section:Object.keys(incoming||{})});
      return {success:true,settings:merged,updated_at:now()};
    }
    if(path==='/receipts'&&method==='GET'){
      const rs=await all('receipts'),ss=await all('suppliers'),items=await all('receipt_items'),ps=await all('products');
      return rs.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).map(r=>{
        const lines=items.filter(i=>String(i.receipt_id)===String(r.id));
        const totalUnits=lines.reduce((n,i)=>n+Number(i.quantity??(Number(i.cartons||0)*Number(i.units_per_carton||1)+Number(i.loose_units||0))),0);
        const totalValue=lines.reduce((n,i)=>n+Number(i.quantity||0)*Number(i.purchase_price||0),0);
        return {...r,supplier_name:ss.find(x=>String(x.id)===String(r.supplier_id))?.name||'—',items_count:lines.length,total_units:totalUnits,total_value:totalValue,total:totalValue};
      });
    }
    if(path.startsWith('/receipts/')&&method==='GET'){
      const id=decodeURIComponent(path.slice('/receipts/'.length));
      const receipt=(await all('receipts')).find(r=>String(r.id)===String(id));
      if(!receipt)throw Object.assign(new Error('Réception introuvable.'),{status:404});
      const [items,ps,ls,ss]=await Promise.all([all('receipt_items'),all('products'),all('lots'),all('suppliers')]);
      const lines=items.filter(i=>String(i.receipt_id)===String(receipt.id)).map(i=>{
        const product=ps.find(p=>String(p.id)===String(i.product_id))||{};
        const lot=ls.find(l=>String(l.id)===String(i.lot_id))||{};
        const quantity=Number(i.quantity??(Number(i.cartons||0)*Number(i.units_per_carton||product.units_per_carton||1)+Number(i.loose_units||0)));
        const purchase_price=Number(i.purchase_price||0);
        return {...i,product_name:product.name||product.code||'Produit',lot_number:lot.lot_number||i.lot_number||'—',expiry_date:lot.expiry_date||i.expiry_date||'',quantity,purchase_price,total_value:quantity*purchase_price};
      });
      const supplier=ss.find(x=>String(x.id)===String(receipt.supplier_id));
      const totalUnits=lines.reduce((n,i)=>n+Number(i.quantity||0),0),totalValue=lines.reduce((n,i)=>n+Number(i.total_value||0),0);
      return {receipt:{...receipt,supplier_name:supplier?.name||'—',items_count:lines.length,total_units:totalUnits,total_value:totalValue,total:totalValue},items:lines,items_count:lines.length,total_units:totalUnits,total_value:totalValue};
    }
    if(path==='/receipts'&&method==='POST'){
      if(cu.role!=='admin')throw Object.assign(new Error('Seul un administrateur peut enregistrer une réception.'),{status:403});
      const b=await body(req),r={id:uid(),receipt_number:'REC-'+new Date().getFullYear()+'-'+String((await all('receipts')).length+1).padStart(6,'0'),supplier_id:b.supplier_id||null,invoice_number:b.invoice_number||'',delivery_note:b.delivery_note||'',created_by:cu.id,received_at:now(),created_at:now()};
      await put('receipts',r);
      for(const it of (b.items||[])){
        const ps=await products(),p=ps.find(x=>String(x.id)===String(it.product_id));
        const unitsPerCarton=Number(p?.units_per_carton||1);
        const q=Number(it.quantity??(Number(it.cartons||0)*unitsPerCarton+Number(it.loose_units||0)));
        if(!p||q<=0)continue;
        let lot=(await all('lots')).find(l=>String(l.product_id)===String(it.product_id)&&String(l.lot_number)===String(it.lot_number));
        if(lot){lot.quantity=Number(lot.quantity||0)+q;lot.expiry_date=it.expiry_date||lot.expiry_date;await put('lots',lot);}
        else{lot={id:uid(),product_id:p.id,lot_number:it.lot_number,expiry_date:it.expiry_date,quantity:q,supplier_id:r.supplier_id,received_at:now(),created_at:now()};await put('lots',lot);}
        await put('receipt_items',{id:uid(),receipt_id:r.id,product_id:p.id,lot_id:lot.id,cartons:Number(it.cartons||0),loose_units:Number(it.loose_units||0),units_per_carton:unitsPerCarton,quantity:q,purchase_price:Number(it.purchase_price||0),created_at:now()});
        await put('stock_movements',{id:uid(),product_id:p.id,lot_id:lot.id,movement_type:'RECEIPT',quantity:q,reference_id:r.id,user_id:cu.id,created_at:now()});
      }
      await audit(cu,'CREATE','receipts',r.id,{receipt_number:r.receipt_number});
      const detailItems=(await all('receipt_items')).filter(i=>String(i.receipt_id)===String(r.id));
      r.items_count=detailItems.length;r.total_units=detailItems.reduce((n,i)=>n+Number(i.quantity||0),0);r.total_value=detailItems.reduce((n,i)=>n+Number(i.quantity||0)*Number(i.purchase_price||0),0);r.total=r.total_value;
      return r;
    }
    if(path==='/sales'&&method==='POST'){
      const b=await body(req),items=b.items||[];if(!items.length)throw new Error('Panier vide');
      const op=String(b.operation_id||uid());
      const existing=(await all('sales')).find(s=>s.operation_id===op);
      if(existing)return {success:true,sale:existing,total:Number(existing.total||0),idempotent:true};
      const ps=await products(),ls=await all('lots');
      const sale={id:uid(),sale_number:(nativeRole()==='seller'&&!req.remote?'HORS-LIGNE-':'VNT-')+new Date().getFullYear()+'-'+String((await all('sales')).length+1).padStart(6,'0'),seller_id:cu.id,total:0,payment_method:b.payment_method||'CASH',created_at:(req.replayAt||now()),operation_id:op,offline:nativeRole()==='seller'&&!req.remote};
      const lines=[];
      for(const it of items){
        let remaining=Number(it.quantity||0);
        const p=ps.find(x=>x.id===it.product_id);if(!p)throw new Error('Produit introuvable');
        const candidates=ls.filter(l=>l.product_id===p.id&&l.quantity>0&&l.expiry_date>=new Date().toISOString().slice(0,10)).sort((a,b)=>a.expiry_date.localeCompare(b.expiry_date)||String(a.received_at||'').localeCompare(String(b.received_at||'')));
        for(const l of candidates){if(!remaining)break;const take=Math.min(remaining,Number(l.quantity||0));l.quantity-=take;remaining-=take;await put('lots',l);lines.push({id:uid(),sale_id:sale.id,product_id:p.id,lot_id:l.id,quantity:take,unit_price:Number(p.sale_price||0),created_at:now()});await put('stock_movements',{id:uid(),product_id:p.id,lot_id:l.id,movement_type:'SALE',quantity:-take,reference_id:sale.id,user_id:cu.id,created_at:now()});sale.total+=take*Number(p.sale_price||0);}
        if(remaining>0)throw new Error('Stock insuffisant pour '+p.name);
      }
      await put('sales',sale);for(const l of lines)await put('sale_items',l);await audit(cu,'CREATE','sales',sale.id,{sale_number:sale.sale_number,total:sale.total,offline:!!sale.offline});
      if(nativeRole()==='seller'&&!req.remote){await put('sync_queue',{id:uid(),operation_id:op,status:'pending',method:'POST',path:'/api/sales',body:JSON.stringify({...b,operation_id:op}),created_at:now(),local_sale_id:sale.id});}
      return {success:true,sale,total:sale.total,items:lines,queued:!!sale.offline};
    }
    if(path==='/reports/sales'&&method==='GET')return salesReport(u);
    if(path==='/sales'&&method==='GET')return salesReport(u);
    if(path==='/audit'&&method==='GET'){
      const logs=await all('audit_logs');
      const activeAlerts=(await lots()).filter(l=>Number(l.quantity||0)>0&&(l.status==='expired'||l.status==='soon')).map(l=>({
        id:'active-alert-'+l.id,
        user_name:'Système',
        action:l.status==='expired'?'ALERTE_STOCK_PERIME':'ALERTE_PEREMPTION_PROCHE',
        entity:'alert',
        entity_id:l.id,
        details:{product:l.product_name,lot_number:l.lot_number,expiry_date:l.expiry_date,quantity:l.quantity,source:'alerte_stock_active'},
        status:'Active',
        created_at:now()
      }));
      return [...logs,...activeAlerts];
    }
    if(path==='/stock/movements'&&method==='GET')return all('stock_movements');
    if(path==='/stock/adjustment'&&method==='POST'){
      if(cu.role!=='admin')throw Object.assign(new Error('Seul un administrateur peut ajuster le stock.'),{status:403});
      const b=await body(req),ls=await all('lots'),l=ls.find(x=>String(x.id)===String(b.lot_id));
      if(!l)throw Object.assign(new Error('Lot introuvable.'),{status:404});
      const amount=Number(b.quantity||0),type=String(b.type||'IN').toUpperCase();
      if(!Number.isInteger(amount)||amount<=0)throw new Error('La quantité doit être un entier supérieur à zéro.');
      const delta=type==='OUT'?-amount:amount;
      if(Number(l.quantity||0)+delta<0)throw new Error('Stock insuffisant pour effectuer cette sortie.');
      l.quantity=Number(l.quantity||0)+delta;await put('lots',l);
      await put('stock_movements',{id:uid(),product_id:l.product_id,lot_id:l.id,movement_type:type==='OUT'?'ADJUSTMENT_OUT':'ADJUSTMENT_IN',quantity:delta,reason:b.reason||'',user_id:cu.id,created_at:now()});
      await audit(cu,'UPDATE','stock',l.id,{type,quantity:amount,reason:b.reason||'',new_quantity:l.quantity});
      return {success:true,message:'Ajustement enregistré.',quantity:l.quantity};
    }
    if(path==='/settings/backup'&&method==='GET'){
      return await buildBackupData();
    }
    if(path==='/settings/backup'&&method==='POST'){
      const b=await body(req);
      if(!b || b.format!=='PHARMAGEST_BACKUP' || Number(b.version)!==1) throw Object.assign(new Error('Fichier de sauvegarde PharmaGest invalide ou incompatible.'),{status:400});
      // V66 : la restauration efface puis réécrit chaque table. Si elle échoue en cours de route (fichier abîmé...), l'ancien état est remis
      // en place au lieu de laisser une base à moitié vide.
      const before=await buildBackupData();
      try{
        await applyBackupData(b);
      }catch(e){
        try{ await applyBackupData(before); }catch(_){}
        throw Object.assign(new Error('Restauration impossible ('+(e&&e.message||'fichier invalide')+'). Vos données actuelles ont été conservées.'),{status:400});
      }
      markDataChanged();
      seedPromise=null;   // la restauration a remplacé les comptes : on revérifie le Super Admin (doublons)
      return {success:true,restored_at:now()};
    }
    throw Object.assign(new Error('Route locale non supportée: '+method+' '+path),{status:404});
  }
  window.__pharmagestNativeRequest = async function(id, method, path, body, headersJson){
    try {
      const headers = JSON.parse(headersJson || '{}');
      // SÉCURITÉ : toute requête reçue par le serveur HTTP du téléphone Admin vient d'un autre appareil.
      // Elle ne doit JAMAIS hériter de la session administrateur locale (avant : sans jeton valide,
      // elle s'exécutait avec les droits de l'admin).
      const remote = true;
      const ru = await remoteUserFromHeaders(headers);
      const data = await route(new URL(path, location.href), {method: method || 'GET', body: body || '', headers, remote}, ru);
      if (String(method||'GET').toUpperCase()!=='GET') { notifyStockChanged(); markDataChanged(); }
      if (window.PharmaGestNative) window.PharmaGestNative.reply(id, JSON.stringify(data));
    } catch (e) {
      if (window.PharmaGestNative) window.PharmaGestNative.reply(id, JSON.stringify({error:e.message||'Erreur locale'}));
    }
  };


  function decodeToken(raw){
    try { const parts=String(raw||'').split('.'); if(parts.length<3)return null; const p=JSON.parse(atob(parts[1])); if(p.exp && Number(p.exp)<Math.floor(Date.now()/1000)) return null; return p; } catch { return null; }
  }
  async function remoteUserFromHeaders(headers){
    const h=headers||{}; const raw=h.authorization||h.Authorization||''; const token=String(raw).replace(/^Bearer\s+/i,'');
    const p=decodeToken(token); if(!p?.id) return null;
    const us=await all('users'); return us.find(u=>u.id===p.id && u.active) || null;
  }
  async function offlineCatalog(){try{return (await get('app_meta','catalog_cache'))?.value||null}catch{return null;}}

  function stockRowsFromCatalog(catalog){
    const products=Array.isArray(catalog?.products)?catalog.products:[];
    const lots=Array.isArray(catalog?.lots)?catalog.lots:[];
    const today=new Date().toISOString().slice(0,10);
    const rows=[];
    for(const p of products.filter(x=>x && x.active!==false)){
      const pl=lots.filter(l=>String(l.product_id)===String(p.id) && String(l.expiry_date||'9999-12-31')>=today);
      if(pl.length){
        for(const l of pl){
          rows.push({
            id:`${p.id}-${l.id}`,
            product_id:p.id,
            name:p.name||'', code:p.code||'', barcode:p.barcode||'',
            unit_name:p.unit_name||'boîte',
            alert_threshold:Number(p.alert_threshold||0),
            purchase_price:Number(p.purchase_price||0),
            sale_price:Number(p.sale_price||0),
            stock:Number(l.quantity||0),
            current_stock:Number(l.quantity||0),
            lot_id:l.id, lot_number:l.lot_number||'—', expiry_date:l.expiry_date||'',
            value_purchase:Number(l.quantity||0)*Number(p.purchase_price||0)
          });
        }
      } else {
        rows.push({
          id:`${p.id}-none`, product_id:p.id, name:p.name||'', code:p.code||'', barcode:p.barcode||'',
          unit_name:p.unit_name||'boîte', alert_threshold:Number(p.alert_threshold||0),
          purchase_price:Number(p.purchase_price||0), sale_price:Number(p.sale_price||0),
          stock:0, current_stock:0, lot_id:null, lot_number:'—', expiry_date:'', value_purchase:0
        });
      }
    }
    return rows;
  }


  function nativeRole(){ try { return window.PharmaGestNative ? window.PharmaGestNative.getRole() : ''; } catch { return ''; } }
  function nativeServer(){ try { return window.PharmaGestNative ? window.PharmaGestNative.getServerBase() : ''; } catch { return ''; } }

  window.fetch=async function(input,init={}){
    const url=typeof input==='string'?input:input?.url||'';
    let isApi=false, apiPath='';
    try { const u=new URL(url,location.href); isApi=u.pathname.includes('/api/'); apiPath=u.pathname+(u.search||''); } catch {}
    if(!isApi)return originalFetch(input,init);

    const base=nativeServer();
    const method=(init.method||'GET').toUpperCase();
    const localOnlySellerPath=apiPath.split('?')[0]==='/api/pairing/cache-user';

    // Vendeur connecté : le maître local devient l'API prioritaire.
    if(nativeRole()==='seller' && base && !localOnlySellerPath){
      // Le stock vendeur doit toujours provenir du catalogue central du maître.
      // /api/offline/catalog est la source centrale commune au moteur Admin/Vendeur.
      const pathOnly=apiPath.split('?')[0];
      if(pathOnly==='/api/stock' || pathOnly==='/api/alerts') {
        try {
          const remoteCatalog=await originalFetch(base+'/api/offline/catalog',{
            ...init, method:'GET', cache:'no-store',
            headers:{...(init.headers||{}), ...(token()?{'Authorization':'Bearer '+token()}: {})}
          });
          if(remoteCatalog.ok){
            const catalog=await remoteCatalog.json();
            await cacheMasterCatalog(catalog);
            if(pathOnly==='/api/stock') return json(stockRowsFromCatalog(catalog));
            const today=new Date().toISOString().slice(0,10);
            const soon=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
            const ps=Array.isArray(catalog.products)?catalog.products:[];
            const ls=Array.isArray(catalog.lots)?catalog.lots:[];
            return json(ls.filter(l=>Number(l.quantity||0)>0 && String(l.expiry_date||'9999-12-31')<=soon).map(l=>{
              const p=ps.find(x=>String(x.id)===String(l.product_id))||{};
              const type=String(l.expiry_date||'')<today?'expired':'soon';
              return {type,name:p.name||'Produit',lot_number:l.lot_number||'—',expiry_date:l.expiry_date,quantity:Number(l.quantity||0)};
            }));
          }
        } catch (_) {}
      }
      try {
        let remoteInit={...init,method,headers:{...(init.headers||{})}};
        // Le login vendeur doit être traité par le maître comme une requête distante,
        // même avant qu'un Bearer token existe. Le device_id est ajouté côté vendeur.
        remoteInit.headers['X-PharmaGest-Remote']='1';
        const remote=await originalFetch(base+apiPath,remoteInit);
        if(remote.ok) return remote;
        return remote;
      } catch (_) {
        // Coupure Wi-Fi : bascule automatiquement vers le stockage local.
      }
    }


    // Vendeur sans maître : les lectures utilisent le catalogue déjà synchronisé;
    // les écritures restent en attente pour la synchronisation ultérieure.
    if(nativeRole()==='seller' && !base){
      const pathOnly = apiPath.split('?')[0];
      if(pathOnly==='/products' || pathOnly==='/stock'){
        const c=await offlineCatalog();
        if(c?.products){
          if(pathOnly==='/products') return json(c.products);
          return json(stockRowsFromCatalog(c));
        }
      }
      if(pathOnly==='/health') return json({ok:false,service:'PharmaGest Client',offline:true},503);
      if(pathOnly==='/sales' && method==='POST'){const b=await body(req);const q={id:uid(),status:'pending',method:'POST',path:'/api/sales',body:JSON.stringify({...b,operation_id:b.operation_id||uid()}),created_at:now()};await put('sync_queue',q);return json({success:true,queued:true,offline:true,sale:{sale_number:'EN ATTENTE'},total:0});}
    }
    if(nativeRole()==='seller' && base){ await flushOfflineQueue(); await syncFromMaster(); }
    // Administrateur ou client hors connexion : moteur local.
    try{return await route(url,{...init,method,headers:init.headers||{}},null).then(x=>json(x));}
    catch(e){return json({error:e.message||'Erreur locale'},e.status||500);}
  };
  // Après une écriture qui change le stock : prévenir le résumé d'alertes (notifications).
  function notifyStockChanged(){ try{ setTimeout(()=>window.dispatchEvent(new Event('pharmagest-stock-changed')),300); }catch(e){} }
  const fetchBeforeAlerts=window.fetch;
  window.fetch=async function(input,init){
    const res=await fetchBeforeAlerts.call(this,input,init);
    try{
      const m=String((init&&init.method)||'GET').toUpperCase();
      const url=typeof input==='string'?input:((input&&input.url)||'');
      if(m!=='GET'&&res&&res.ok&&/\/api\/(sales|receipts|stock\/adjustment|lots)/.test(url)) notifyStockChanged();
      if(m!=='GET'&&res&&res.ok&&/\/api\//.test(url)&&!/\/api\/(auth|pairing|pc)\//.test(url)) markDataChanged();
    }catch(e){}
    return res;
  };
  window.PharmaGestSyncStatus=async function(){
    const state=await get('sync_state','master')||{status:'local',last_sync:null,server_base:''};
    const pending=(await all('sync_queue')).filter(q=>q.status==='pending').length;
    const failed=(await all('sync_queue')).filter(q=>q.status==='pending'&&q.last_error).length;
    return {status:state.status||'disconnected',last_sync:state.last_sync||null,server_base:state.server_base||nativeServerSafe(),error:state.error||'',pending,failed};
  };
  // Installation vierge : seul le compte pilote Super Admin est créé automatiquement sur le téléphone maître.
  ensureCatalogSeed().then(()=>{ if(nativeRole()==='seller'){flushOfflineQueue().then(syncFromMaster).then(reportSyncIfNeeded);setInterval(()=>{flushOfflineQueue().then(syncFromMaster).then(reportSyncIfNeeded)},5000);} }).catch(console.error);
})();
