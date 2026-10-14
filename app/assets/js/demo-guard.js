/* PharmaGest — mode démonstration (GitHub Pages). Chargé en tête de chaque page de l'application.
 * - Sans session démo, renvoie vers la page d'accueil de la démo.
 * - Affiche une pastille « DÉMO » pour changer de rôle / réinitialiser. */
(function(){
  var page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  var logged=false; try{ logged=!!localStorage.getItem('dpa_token'); }catch(e){}
  if(page==='login.html'||!logged){ location.replace('../index.html'); return; }
  document.addEventListener('DOMContentLoaded',function(){
    var u={}; try{ u=JSON.parse(localStorage.getItem('dpa_user')||'{}'); }catch(e){}
    var role=String(u.role||'').toLowerCase()==='seller'?'Vendeur':'Admin';
    var a=document.createElement('a'); a.href='../index.html';
    a.textContent='DÉMO · '+role+' · changer';
    a.setAttribute('style','position:fixed;left:8px;bottom:calc(74px + env(safe-area-inset-bottom,0px));z-index:99999;background:#0b2a4a;color:#fff;font:600 11px/1 system-ui,sans-serif;padding:7px 10px;border-radius:999px;text-decoration:none;opacity:.88;box-shadow:0 2px 8px rgba(0,0,0,.25)');
    document.body.appendChild(a);
    // Fonctions qui dépendent du téléphone (réseau Wi‑Fi Admin/vendeurs, Google Drive) : masquées en démo.
    var st=document.createElement('style'); st.textContent='#driveCard{display:none!important}'; document.head.appendChild(st);
    function hideNet(){ var n=document.getElementById('pgNetAccess'); if(!n) return false; var p=n.closest('.panel'); if(p) p.style.display='none'; return true; }
    if(!hideNet()){ var mo=new MutationObserver(function(){ if(hideNet()) mo.disconnect(); }); mo.observe(document.body,{childList:true,subtree:true}); setTimeout(function(){ mo.disconnect(); },10000); }
  });
})();
