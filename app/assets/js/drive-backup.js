/* PharmaGest Android — sauvegarde automatique sur Google Drive (V66).
 *
 * - L'Admin se connecte UNE fois à son compte Google (navigateur, flux OAuth + PKCE) ; le compte reste dans l'application.
 * - Dès qu'Internet est détecté ET que des données ont changé depuis la dernière sauvegarde, l'application envoie sa sauvegarde sur Drive.
 * - UN SEUL fichier (« PharmaGest_sauvegarde.json ») : chaque envoi ÉCRASE le précédent, et les anciennes révisions que Drive conserve
 *   sont supprimées, pour ne pas consommer d'espace.
 * - Rien n'est envoyé si les données n'ont pas changé (comparaison d'empreinte).
 *
 * Seules 3 fonctions natives sont utilisées (pont Kotlin) : openExternalUrl, googleStartLoopback, httpRequest ; + hasInternet, getGoogleConfig.
 * Tout le protocole est ici, en JavaScript.
 */
(function(){
  'use strict';
  var N=window.PharmaGestNative;
  if(!N || window.PharmaDrive) return;

  var AUTH='https://accounts.google.com/o/oauth2/v2/auth';
  var TOKEN='https://oauth2.googleapis.com/token';
  var REVOKE='https://oauth2.googleapis.com/revoke';
  var USERINFO='https://www.googleapis.com/oauth2/v3/userinfo';
  var DRIVE='https://www.googleapis.com/drive/v3/files';
  var UPLOAD='https://www.googleapis.com/upload/drive/v2/files';
  var SCOPE='openid email https://www.googleapis.com/auth/drive.file';
  var FILE_NAME='PharmaGest_sauvegarde.json';
  var STATE_KEY='pg_drive', TOKEN_KEY='pg_google_tokens';
  var CFG={debounceMs:60000,pollMs:600000,firstDelayMs:8000,maxBackoffMs:1800000};

  var busy=false, seq=0, pending={}, timers={debounce:0,poll:0};

  /* ---------------------------------------------------------------- utilitaires */
  function role(){ try{ return String(N.getRole?N.getRole():''); }catch(e){ return ''; } }
  function isAdmin(){ return role()==='admin'; }
  function cfg(){
    try{ var raw=N.getGoogleConfig?N.getGoogleConfig():''; var c=raw?JSON.parse(raw):null; return (c&&c.clientId&&c.clientSecret)?c:null; }catch(e){ return null; }
  }
  function inet(){
    try{ if(typeof N.hasInternet==='function') return !!N.hasInternet(); }catch(e){}
    return navigator.onLine!==false;
  }
  function jget(k){ try{ var o=JSON.parse(localStorage.getItem(k)||'null'); return (o&&typeof o==='object')?o:{}; }catch(e){ return {}; } }
  function jset(k,o){ try{ localStorage.setItem(k,JSON.stringify(o)); }catch(e){} }
  function getState(){ return jget(STATE_KEY); }
  function setState(p){ var s=Object.assign(getState(),p); jset(STATE_KEY,s); emit(); return s; }
  function rev(){ return Number(localStorage.getItem('pg_data_rev'))||0; }
  function emit(){ try{ window.dispatchEvent(new Event('pg-drive-changed')); }catch(e){} }
  function qs(o){ return Object.keys(o).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(o[k]); }).join('&'); }
  function rand(n){
    var a=new Uint8Array(n); crypto.getRandomValues(a);
    var cs='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~', s='';
    for(var i=0;i<n;i++) s+=cs[a[i]%cs.length];
    return s;
  }
  function b64url(buf){
    var b=new Uint8Array(buf), s=''; for(var i=0;i<b.length;i++) s+=String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  async function sha256(text){ return await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)); }
  async function sha256hex(text){ return Array.prototype.map.call(new Uint8Array(await sha256(text)),function(x){ return ('0'+x.toString(16)).slice(-2); }).join(''); }
  function fail(msg,props){ var e=new Error(msg); if(props) Object.assign(e,props); return e; }

  /* ---------------------------------------------------------------- HTTP (pont natif) */
  window.__pgHttpDone=function(id,status,text){ var p=pending[id]; if(p){ delete pending[id]; p(Number(status),String(text==null?'':text)); } };
  function http(method,url,headers,body){
    return new Promise(function(resolve,reject){
      var id='h'+(++seq)+'_'+Math.random().toString(36).slice(2,8);
      var t=setTimeout(function(){ delete pending[id]; reject(fail('Délai dépassé',{network:true})); },90000);
      pending[id]=function(status,text){ clearTimeout(t); resolve({status:status,text:text}); };
      try{ N.httpRequest(id,method,url,JSON.stringify(headers||{}),body==null?'':String(body)); }
      catch(e){ clearTimeout(t); delete pending[id]; reject(fail('Requête impossible',{network:true})); }
    });
  }
  function parse(text){ try{ return JSON.parse(text); }catch(e){ return null; } }

  /* ---------------------------------------------------------------- jetons Google */
  function tokens(){ return jget(TOKEN_KEY); }
  async function tokenRequest(params){
    var c=cfg(); if(!c) throw fail('Configuration Google manquante.',{config:true});
    var body=qs(Object.assign({client_id:c.clientId,client_secret:c.clientSecret},params));
    var r=await http('POST',TOKEN,{'Content-Type':'application/x-www-form-urlencoded'},body);
    if(r.status===0) throw fail('Connexion à Google impossible.',{network:true});
    var j=parse(r.text)||{};
    if(r.status!==200) throw fail(j.error_description||j.error||('Erreur Google '+r.status),{google:j.error||'',status:r.status});
    return j;
  }
  async function accessToken(force){
    var t=tokens();
    if(!t.refresh_token) throw fail('Compte Google non connecté.',{reauth:true});
    if(!force && t.access_token && t.expires_at>Date.now()+60000) return t.access_token;
    try{
      var j=await tokenRequest({grant_type:'refresh_token',refresh_token:t.refresh_token});
      jset(TOKEN_KEY,{refresh_token:t.refresh_token,access_token:j.access_token,expires_at:Date.now()+(Number(j.expires_in)||3600)*1000});
      return j.access_token;
    }catch(e){
      if(e.google==='invalid_grant'||e.google==='invalid_client') throw fail('La connexion à Google a expiré. Reconnectez-vous.',{reauth:true});
      throw e;
    }
  }

  /* ---------------------------------------------------------------- Drive */
  function driveError(r){
    var j=parse(r.text)||{}, err=j.error||{}, reason=(err.errors&&err.errors[0]&&err.errors[0].reason)||'';
    var msg=err.message||('Erreur Google Drive '+r.status);
    if(reason==='storageQuotaExceeded'||reason==='quotaExceeded') msg='Espace Google Drive insuffisant.';
    else if(r.status===403) msg='Accès à Google Drive refusé ('+(reason||'403')+').';
    return fail(msg,{status:r.status,quota:reason==='storageQuotaExceeded'});
  }
  async function drive(method,url,body,contentType){
    for(var attempt=0;attempt<2;attempt++){
      var tok=await accessToken(attempt>0);
      var h={Authorization:'Bearer '+tok}; if(contentType) h['Content-Type']=contentType;
      var r=await http(method,url,h,body);
      if(r.status===0) throw fail('Connexion à Google impossible.',{network:true});
      if(r.status===401 && attempt===0) continue;      // jeton expiré : on le renouvelle une fois
      return r;
    }
    throw fail('Autorisation Google refusée. Reconnectez-vous.',{reauth:true});
  }
  async function findFile(){
    var q="name = '"+FILE_NAME+"' and trashed = false";
    var r=await drive('GET',DRIVE+'?'+qs({q:q,fields:'files(id,name,modifiedTime,size)',orderBy:'modifiedTime desc',pageSize:'10',spaces:'drive'}));
    if(r.status!==200) throw driveError(r);
    var f=(parse(r.text)||{}).files||[];
    return f.length?f[0]:null;
  }
  async function createFile(){
    var r=await drive('POST',DRIVE+'?fields=id',JSON.stringify({name:FILE_NAME,mimeType:'application/json'}),'application/json; charset=UTF-8');
    if(r.status!==200) throw driveError(r);
    return parse(r.text).id;
  }
  async function ensureFileId(){
    var st=getState(); if(st.fileId) return st.fileId;
    var f=await findFile(); var id=f?f.id:await createFile();
    setState({fileId:id}); return id;
  }
  async function upload(id,text){
    var r=await drive('PUT',UPLOAD+'/'+encodeURIComponent(id)+'?'+qs({uploadType:'media',fields:'id,modifiedDate,fileSize'}),text,'application/json; charset=UTF-8');
    if(r.status===404){ throw fail('Fichier introuvable',{status:404}); }
    if(r.status!==200) throw driveError(r);
  }
  // Drive garde les anciennes versions d'un fichier remplacé (et elles comptent dans l'espace) : on ne garde que la plus récente.
  async function pruneRevisions(id){
    try{
      var r=await drive('GET',DRIVE+'/'+encodeURIComponent(id)+'/revisions?'+qs({fields:'revisions(id,modifiedTime)',pageSize:'200'}));
      if(r.status!==200) return;
      var list=((parse(r.text)||{}).revisions||[]).slice().sort(function(a,b){ return String(a.modifiedTime).localeCompare(String(b.modifiedTime)); });
      for(var i=0;i<list.length-1;i++) await drive('DELETE',DRIVE+'/'+encodeURIComponent(id)+'/revisions/'+encodeURIComponent(list[i].id));
    }catch(e){}
  }

  /* ---------------------------------------------------------------- sauvegarde */
  async function contentHash(data){
    // L'empreinte ignore l'heure de création et les infos techniques de l'appareil : seul un vrai changement de données déclenche un envoi.
    var d=Object.assign({},data); delete d.created_at; delete d.app_meta;
    return await sha256hex(JSON.stringify(d));
  }
  function describe(e){
    if(e.reauth) return 'Reconnexion Google nécessaire.';
    if(e.network) return 'Connexion à Google impossible pour le moment.';
    return e.message||'Erreur de sauvegarde.';
  }
  async function syncNow(opts){
    opts=opts||{};
    if(!isAdmin()) return {skipped:'role'};
    var st=getState();
    if(!tokens().refresh_token) return {skipped:'not-signed-in'};
    if(!opts.manual && st.enabled===false) return {skipped:'disabled'};
    if(busy) return {skipped:'busy'};
    if(!opts.manual && st.nextRetryAt && st.nextRetryAt>Date.now()) return {skipped:'backoff'};
    if(!inet()){ emit(); return {skipped:'offline'}; }
    var r0=rev();
    if(!opts.manual && !opts.force && st.lastHash && st.lastRev===r0) return {skipped:'unchanged'};
    if(typeof window.__pharmagestBuildBackup!=='function') return {skipped:'engine'};
    busy=true; emit();
    try{
      var data=await window.__pharmagestBuildBackup();
      var hash=await contentHash(data);
      if(!opts.force && st.lastHash===hash){ setState({lastRev:r0,lastCheckAt:Date.now(),lastError:'',failCount:0,nextRetryAt:0}); return {skipped:'same-content'}; }
      var text=JSON.stringify(data);
      var id=await ensureFileId();
      try{ await upload(id,text); }
      catch(e){ if(e.status===404){ id=await createFile(); setState({fileId:id}); await upload(id,text); } else throw e; }
      await pruneRevisions(id);
      setState({lastHash:hash,lastRev:r0,lastAt:Date.now(),lastSize:text.length,lastError:'',failCount:0,nextRetryAt:0,needsReauth:false});
      return {uploaded:true,size:text.length};
    }catch(e){
      var n=(getState().failCount||0)+1;
      setState({lastError:describe(e),failCount:n,needsReauth:!!e.reauth,nextRetryAt:e.reauth?0:Date.now()+Math.min(CFG.maxBackoffMs,60000*Math.pow(2,n-1))});
      return {error:describe(e)};
    }finally{ busy=false; emit(); }
  }

  /* ---------------------------------------------------------------- connexion / déconnexion */
  /* Connexion en deux temps : (1) signIn ouvre Google et note la demande en cours ; (2) resumePending termine la connexion dès que la réponse de Google
   * est arrivée (événement, retour dans l'appli, ou sondage toutes les 1,5 s). Ainsi la connexion aboutit même si l'écran a été recréé
   * pendant que le navigateur était ouvert. */
  var PENDING_KEY='pg_google_pending', waiter=null, completing=false;
  function waitSignedIn(){
    return new Promise(function(resolve,reject){
      var t=setTimeout(function(){ waiter=null; reject(fail('Connexion Google non terminée. Réessayez.')); },300000);
      waiter={ok:function(v){ clearTimeout(t); waiter=null; resolve(v); }, ko:function(e){ clearTimeout(t); waiter=null; reject(e); }};
    });
  }
  async function resumePending(){
    var p=jget(PENDING_KEY); if(!p.state||completing) return;
    if(Date.now()-(p.at||0)>330000){ try{ localStorage.removeItem(PENDING_KEY); }catch(e){} return; }
    var raw=''; try{ raw=String(N.googleTakeResult?N.googleTakeResult():''); }catch(e){}
    var d=parse(raw); if(!d||(!d.code&&!d.error)) return;
    if(d.state && d.state!==p.state) return;
    completing=true; try{ localStorage.removeItem(PENDING_KEY); }catch(e){}
    try{
      if(d.error) throw fail(d.error==='access_denied'?'Connexion Google annulée.':'Google a refusé la connexion ('+d.error+').');
      var j=await tokenRequest({grant_type:'authorization_code',code:d.code,code_verifier:p.verifier,redirect_uri:p.redirect});
      if(!j.refresh_token) throw fail('Google n’a pas fourni d’autorisation durable. Réessayez.');
      jset(TOKEN_KEY,{refresh_token:j.refresh_token,access_token:j.access_token,expires_at:Date.now()+(Number(j.expires_in)||3600)*1000});
      var email='';
      try{ var u=await http('GET',USERINFO,{Authorization:'Bearer '+j.access_token}); email=(parse(u.text)||{}).email||''; }catch(e){}
      jset(STATE_KEY,{email:email,enabled:true,signedAt:Date.now()});
      emit(); startLoop(); setTimeout(function(){ syncNow({force:true}); },500);
      if(waiter) waiter.ok({email:email});
    }catch(e){
      setState({signInError:e.message||'Connexion Google impossible.'});
      if(waiter) waiter.ko(e);
    }finally{ completing=false; emit(); }
  }
  async function signIn(){
    if(!isAdmin()) throw fail('Réservé au téléphone Admin.');
    var c=cfg(); if(!c) throw fail('Configuration Google manquante (voir README_GOOGLE_DRIVE.md).',{config:true});
    if(!inet()) throw fail('Une connexion Internet est nécessaire pour se connecter à Google.',{network:true});
    var verifier=rand(64), state=rand(24), challenge=b64url(await sha256(verifier));
    try{ if(N.googleTakeResult) N.googleTakeResult(); }catch(e){}                       // oublie une ancienne réponse
    var port=String(N.googleStartLoopback?N.googleStartLoopback():'');
    if(!/^\d+$/.test(port)) throw fail('Impossible de préparer la connexion Google.');
    var redirect='http://127.0.0.1:'+port;
    var url=AUTH+'?'+qs({client_id:c.clientId,redirect_uri:redirect,response_type:'code',scope:SCOPE,state:state,code_challenge:challenge,code_challenge_method:'S256',access_type:'offline',prompt:'consent'});
    jset(PENDING_KEY,{verifier:verifier,state:state,redirect:redirect,at:Date.now()});
    setState({signInError:''});
    var waiting=waitSignedIn(); waiting.catch(function(){});
    if(!N.openExternalUrl(url)){ try{ localStorage.removeItem(PENDING_KEY); }catch(e){} if(waiter) waiter.ko(fail('x')); throw fail('Impossible d’ouvrir le navigateur.'); }
    return await waiting;
  }
  window.addEventListener('pharmagest-google-code',function(){ resumePending(); });
  document.addEventListener('visibilitychange',function(){ if(!document.hidden) resumePending(); });
  window.addEventListener('focus',function(){ resumePending(); });
  window.addEventListener('pageshow',function(){ resumePending(); });
  setInterval(function(){ if(jget(PENDING_KEY).state) resumePending(); },1500);
  setTimeout(resumePending,300);
  async function signOut(){
    var t=tokens();
    try{ if(t.refresh_token) await http('POST',REVOKE,{'Content-Type':'application/x-www-form-urlencoded'},qs({token:t.refresh_token})); }catch(e){}
    try{ localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(STATE_KEY); }catch(e){}
    emit();
  }
  // Pour la restauration : télécharge la sauvegarde (la plus récente) depuis Drive.
  async function fetchLatest(){
    if(!inet()) throw fail('Une connexion Internet est nécessaire.',{network:true});
    var f=await findFile(); if(!f) throw fail('Aucune sauvegarde PharmaGest trouvée sur ce compte Google Drive.');
    var r=await drive('GET',DRIVE+'/'+encodeURIComponent(f.id)+'?alt=media');
    if(r.status!==200) throw driveError(r);
    var data=parse(r.text);
    if(!data||data.format!=='PHARMAGEST_BACKUP') throw fail('Le fichier trouvé sur Drive n’est pas une sauvegarde PharmaGest valide.');
    return {data:data,modifiedTime:f.modifiedTime,size:r.text.length};
  }

  /* ---------------------------------------------------------------- déclencheurs */
  function tick(delay){ setTimeout(function(){ syncNow({}); },delay||0); }
  function startLoop(){
    if(!isAdmin()||timers.poll) return;
    timers.poll=setInterval(function(){ tick(0); },CFG.pollMs);
  }
  window.addEventListener('pg-data-changed',function(){
    if(!tokens().refresh_token||!isAdmin()) return;
    clearTimeout(timers.debounce); timers.debounce=setTimeout(function(){ syncNow({}); },CFG.debounceMs);   // regroupe les modifications rapprochées
  });
  window.addEventListener('online',function(){ tick(3000); });
  window.addEventListener('pharmagest-internet',function(){ tick(3000); });
  document.addEventListener('visibilitychange',function(){ if(!document.hidden) tick(1000); });
  if(isAdmin() && tokens().refresh_token){ startLoop(); setTimeout(function(){ syncNow({}); },CFG.firstDelayMs); }

  /* ---------------------------------------------------------------- ventes des vendeurs via Drive
   * Vendeur : envoie son journal de ventes (un fichier par téléphone) dès qu'il a Internet ; l'accès Drive lui est transmis automatiquement par le téléphone Admin
   * quand ils sont sur le même réseau. Admin : lit tous les journaux et applique les ventes manquantes (sans doublon), même à distance. */
  /* Rafraîchit l'écran de l'Admin tout seul après l'arrivée de ventes (accueil, rapports, stocks...), sans jamais interrompre une saisie :
   * on attend qu'aucun champ ne soit en cours de saisie et qu'aucune fenêtre ne soit ouverte ; la position de défilement est conservée. */
  var REFRESH_PAGES=['accueil.html','rapports.html','stocks.html','produits.html','lots.html','audit.html','notifications.html'];
  var refreshWanted=false, refreshTimer=0;
  function safeToRefresh(){
    if(document.hidden) return false;
    var a=document.activeElement;
    if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
    return !document.querySelector('.modal-overlay.open,.modal-backdrop.open,[class*="modal"].open,[class*="overlay"].open,dialog[open]');
  }
  function refreshScreen(){
    var page=(location.pathname.split('/').pop()||'').toLowerCase();
    if(REFRESH_PAGES.indexOf(page)<0) return;
    refreshWanted=true; clearInterval(refreshTimer);
    var tries=0;
    refreshTimer=setInterval(function(){
      tries++;
      if(!refreshWanted||tries>60){ clearInterval(refreshTimer); return; }       // on abandonne après 2 minutes
      if(!safeToRefresh()) return;
      refreshWanted=false; clearInterval(refreshTimer);
      try{ sessionStorage.setItem('pg_scroll',page+'|'+(window.scrollY||0)); }catch(e){}
      location.reload();
    },2000);
  }
  document.addEventListener('visibilitychange',function(){ if(!document.hidden&&refreshWanted){ clearInterval(refreshTimer); refreshScreen(); } });
  setTimeout(function(){
    try{
      var v=String(sessionStorage.getItem('pg_scroll')||'').split('|'), page=(location.pathname.split('/').pop()||'').toLowerCase();
      sessionStorage.removeItem('pg_scroll');
      if(v[0]===page&&Number(v[1])>0) setTimeout(function(){ window.scrollTo(0,Number(v[1])); },700);
    }catch(e){}
  },100);

  var JOURNAL_PREFIX='PharmaGest_ventes_', JSTATE_KEY='pg_drive_sellers';
  function isSeller(){ return role()==='seller'; }
  function jstate(){ return jget(JSTATE_KEY); }
  function jsetState(p){ var s=Object.assign(jget(JSTATE_KEY),p); jset(JSTATE_KEY,s); emit(); return s; }
  async function findNamed(name){
    var r=await drive('GET',DRIVE+'?'+qs({q:"name = '"+name+"' and trashed = false",fields:'files(id,name,modifiedTime)',orderBy:'modifiedTime desc',pageSize:'5',spaces:'drive'}));
    if(r.status!==200) throw driveError(r);
    var f=(parse(r.text)||{}).files||[]; return f.length?f[0]:null;
  }
  async function createNamed(name){
    var r=await drive('POST',DRIVE+'?fields=id',JSON.stringify({name:name,mimeType:'application/json'}),'application/json; charset=UTF-8');
    if(r.status!==200) throw driveError(r);
    return parse(r.text).id;
  }
  async function fetchSharedToken(){
    if(tokens().refresh_token) return true;
    if(!inet()) return false;
    try{
      var tok=''; try{ tok=localStorage.getItem('dpa_token')||''; }catch(e){}
      var r=await window.fetch('/api/drive/credentials',{headers:{Authorization:'Bearer '+tok}});
      var j=r.ok?await r.json():null;
      if(j&&j.refresh_token){ jset(TOKEN_KEY,{refresh_token:j.refresh_token}); return true; }
    }catch(e){}
    return false;
  }
  var sellerBusy=false;
  async function syncSeller(){
    if(!isSeller()||sellerBusy||!cfg()||!inet()||typeof window.__pharmagestBuildSellerJournal!=='function') return;
    sellerBusy=true;
    try{
      if(!(await fetchSharedToken())) return;
      var j=await window.__pharmagestBuildSellerJournal(); if(!j) return;
      var hash=await sha256hex(JSON.stringify(j.entries)), st=jstate();
      if(st.hash===hash&&st.fileId) return;
      var name=JOURNAL_PREFIX+String(j.device_id||'telephone').replace(/[^A-Za-z0-9_-]/g,'')+'.json', id=st.fileId;
      if(!id){ var f=await findNamed(name); id=f?f.id:await createNamed(name); }
      var text=JSON.stringify(j), url=function(i){ return UPLOAD+'/'+encodeURIComponent(i)+'?'+qs({uploadType:'media',fields:'id'}); };
      var r=await drive('PUT',url(id),text,'application/json; charset=UTF-8');
      if(r.status===404){ id=await createNamed(name); r=await drive('PUT',url(id),text,'application/json; charset=UTF-8'); }
      if(r.status!==200) throw driveError(r);
      jsetState({fileId:id,hash:hash,lastAt:Date.now(),error:''});
    }catch(e){
      jsetState({error:describe(e)});
      if(e.reauth){ try{ localStorage.removeItem(TOKEN_KEY); }catch(x){} }
    }finally{ sellerBusy=false; }
  }
  var importBusy=false, lastImportAt=0;
  async function importSellers(){
    if(!isAdmin()||importBusy||!tokens().refresh_token||!inet()||typeof window.__pharmagestReplaySale!=='function') return;
    if(Date.now()-lastImportAt<15000) return;
    lastImportAt=Date.now(); importBusy=true;
    try{
      var r=await drive('GET',DRIVE+'?'+qs({q:"name contains '"+JOURNAL_PREFIX+"' and trashed = false",fields:'files(id,name,modifiedTime)',pageSize:'50',spaces:'drive'}));
      if(r.status!==200) throw driveError(r);
      var files=(parse(r.text)||{}).files||[], st=jstate(), seen=Object.assign({},st.seen), failed=Object.assign({},st.failed), imported=0, firstError='';
      for(var i=0;i<files.length;i++){
        var f=files[i];
        if(seen[f.id]===f.modifiedTime && !failed[f.id]) continue;
        var d=await drive('GET',DRIVE+'/'+encodeURIComponent(f.id)+'?alt=media');
        if(d.status!==200) continue;
        var j=parse(d.text); if(!j||j.format!=='PHARMAGEST_SELLER_JOURNAL'||!Array.isArray(j.entries)) continue;
        var bad=0;
        for(var k=0;k<j.entries.length;k++){
          var res=await window.__pharmagestReplaySale(j,j.entries[k]);
          if(res&&res.imported) imported++;
          else if(res&&res.error){ bad++; if(!firstError) firstError=res.error; }
        }
        seen[f.id]=f.modifiedTime; failed[f.id]=bad>0;
      }
      if(imported>0){
        if(window.__pharmagestMarkChanged) window.__pharmagestMarkChanged();
        try{ window.dispatchEvent(new Event('pharmagest-stock-changed')); }catch(e){}
        refreshScreen();
      }
      jsetState({seen:seen,failed:failed,imported:(st.imported||0)+imported,lastAt:Date.now(),error:firstError});
    }catch(e){ jsetState({error:describe(e)}); }
    finally{ importBusy=false; }
  }
  if(isSeller()){
    setTimeout(syncSeller,8000); setInterval(syncSeller,300000);
    window.addEventListener('pg-data-changed',function(){ clearTimeout(timers.sj); timers.sj=setTimeout(syncSeller,4000); });
    window.addEventListener('online',function(){ setTimeout(syncSeller,3000); });
    window.addEventListener('pharmagest-internet',function(){ setTimeout(syncSeller,3000); });
    document.addEventListener('visibilitychange',function(){ if(!document.hidden) setTimeout(syncSeller,1500); });
  }
  if(isAdmin()){
    setTimeout(importSellers,6000); setInterval(importSellers,20000);
    window.addEventListener('online',function(){ setTimeout(importSellers,3000); });
    window.addEventListener('pharmagest-internet',function(){ setTimeout(importSellers,3000); });
    document.addEventListener('visibilitychange',function(){ if(!document.hidden) setTimeout(importSellers,2000); });
  }

  window.PharmaDrive={
    importSellers:importSellers, syncSeller:syncSeller,

    status:function(){
      var s=getState(), t=tokens();
      return {configured:!!cfg(),admin:isAdmin(),signedIn:!!t.refresh_token,email:s.email||'',enabled:s.enabled!==false,busy:busy,online:inet(),
              lastAt:s.lastAt||0,lastSize:s.lastSize||0,lastError:s.lastError||'',signInError:s.signInError||'',sellerImported:jstate().imported||0,sellerLastAt:jstate().lastAt||0,sellerError:jstate().error||'',needsReauth:!!s.needsReauth,pending:rev()!==(s.lastRev||0)||!s.lastHash};
    },
    signIn:signIn, signOut:signOut, syncNow:syncNow, fetchLatest:fetchLatest,
    // Saisie des identifiants Google directement dans l'application (plus besoin de recompiler).
    clientId:function(){ try{ return String(N.getGoogleClientId?N.getGoogleClientId():''); }catch(e){ return ''; } },
    saveConfig:function(id,secret){
      id=String(id||'').trim(); secret=String(secret||'').trim();
      if(!isAdmin()) throw fail('Réservé au téléphone Admin.');
      if(!/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id)) throw fail('ID client invalide : il doit ressembler à 123456-abc….apps.googleusercontent.com');
      if(secret.length<10) throw fail('Code secret du client invalide.');
      if(!N.setGoogleConfig||!N.setGoogleConfig(id,secret)) throw fail('Impossible d’enregistrer les identifiants.');
      emit(); return true;
    },
    clearConfig:function(){ try{ if(N.clearGoogleConfig) N.clearGoogleConfig(); }catch(e){} emit(); },
    setEnabled:function(v){ setState({enabled:!!v}); if(v) tick(300); },
    _cfg:CFG
  };
})();
