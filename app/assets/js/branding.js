/* PharmaGest — identité dynamique de l'établissement.
   Règle d'affichage (toutes les pages) :
   - « PharmaGest » = nom du logiciel, en petit ;
   - le nom de l'établissement saisi par le client = titre principal ;
   - tant que le client n'a rien saisi : « PharmaGest » seul, sans texte de remplacement.
   L'en-tête de la barre latérale est reconstruit ici, à un seul endroit, pour que
   toutes les pages restent identiques. */
(function pharmaBranding(){
  var NAME_KEY='pg_company_name';
  var DEFAULT_NAME='PharmaGest';

  function cachedName(){ try{ return String(localStorage.getItem(NAME_KEY)||'').trim(); }catch(e){ return ''; } }
  function cacheName(v){ try{ localStorage.setItem(NAME_KEY,v||''); }catch(e){} }

  function injectStyle(){
    if(document.getElementById('pg-brand-style')) return;
    var st=document.createElement('style');
    st.id='pg-brand-style';
    st.textContent=
      '.pg-brand{display:flex!important;flex-direction:column!important;align-items:flex-start!important;gap:3px!important;padding:6px 8px 14px!important;text-align:left!important;background:none!important;}'+
      '.pg-brand-app{display:block;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#8fb4d9!important;line-height:1.2;margin:0;}'+
      '.pg-brand-name{display:block;font-size:19px;font-weight:800;color:#fff!important;line-height:1.25;overflow-wrap:anywhere;margin:0;}'+
      '.pg-brand.pg-brand-noname .pg-brand-app{display:none;}';
    document.head.appendChild(st);
  }

  function normalizeHeaders(){
    if(document.querySelector('.logo-main')) return; // page de connexion : structure propre
    injectStyle();
    document.querySelectorAll('.brand, .logo').forEach(function(el){
      if(el.classList.contains('pg-brand')) return;
      el.classList.add('pg-brand');
      el.innerHTML='<span class="pg-brand-app">PharmaGest</span><strong class="pg-brand-name" data-establishment-name>'+DEFAULT_NAME+'</strong>';
    });
  }

  function applyName(name){
    var clean=String(name||'').trim();
    document.querySelectorAll('[data-establishment-name]').forEach(function(el){ el.textContent=clean||DEFAULT_NAME; });
    document.querySelectorAll('.pg-brand').forEach(function(el){ el.classList.toggle('pg-brand-noname',!clean); });
    return clean;
  }

  function init(){
    normalizeHeaders();
    applyName(cachedName()); // affichage immédiat, sans attendre le réseau
    refresh();
  }

  async function refresh(){
    try{
      var response=await fetch('/api/settings',{headers:{Authorization:'Bearer '+(localStorage.getItem('dpa_token')||'')}});
      if(!response.ok) return;
      var payload=await response.json();
      var settings=(payload&&typeof payload.settings==='object'&&payload.settings)?payload.settings:(payload||{});
      var general=settings.general||{};
      var name=String(general.companyName||'').trim();
      var address=String(general.address||'').trim();
      var phone=String(general.phone||'').trim();
      var footer=String((settings.recu||{}).footer||'Merci pour votre confiance.').trim();
      cacheName(name);
      applyName(name);
      document.querySelectorAll('[data-establishment-address]').forEach(function(el){el.textContent=address;});
      document.querySelectorAll('[data-establishment-phone]').forEach(function(el){el.textContent=phone;});
      document.querySelectorAll('[data-receipt-footer]').forEach(function(el){el.textContent=footer;});
      // Anciennes pages : remplacer uniquement l'ancien nom d'établissement, jamais PharmaGest.
      if(name){
        var legacy=/Dépôt Pharmaceutique Albarka Roumboun Laka|DPA Roumboun Laka/gi;
        document.querySelectorAll('body *').forEach(function(el){
          if(el.children.length===0&&el.textContent&&legacy.test(el.textContent)){
            legacy.lastIndex=0;
            el.textContent=el.textContent.replace(legacy,name);
          }
          legacy.lastIndex=0;
        });
        document.title=document.title.replace(legacy,name);
      }
    }catch(e){ console.warn('Branding PharmaGest indisponible:',e); }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
