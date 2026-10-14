/* PharmaGest V51 — habillage mobile commun : barre du haut, barre du bas, tiroir de menu et nouvel accueil.
   Ne modifie jamais les données ni la logique des pages ; toute erreur est absorbée (aucun plantage possible). */
(function pharmaMobileShell(){
  'use strict';
  try{
    var PAGE=(location.pathname.split('/').pop()||'index.html').toLowerCase();
    if(PAGE==='login.html'||PAGE==='accueil.html') return;
    if(!localStorage.getItem('dpa_token')) return;

    var native=window.PharmaGestNative||null;
    var user={}; try{ user=JSON.parse(localStorage.getItem('dpa_user')||'{}')||{}; }catch(e){}
    var role=''; try{ role=String((native&&native.getRole&&native.getRole())||user.role||'').toLowerCase(); }catch(e){ role=String(user.role||'').toLowerCase(); }
    var isAdmin=role!=='seller';
    var userName=String(user.name||user.username||(isAdmin?'Administrateur':'Vendeur'));
    var roleLabel=isAdmin?'Administrateur':'Vendeur';

    function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
    function money(n){return String(Math.round(Number(n)||0)).replace(/\B(?=(\d{3})+(?!\d))/g,' ');}
    function initials(n){var p=String(n).trim().split(/\s+/).filter(Boolean);return ((p[0]||'?')[0]+(p[1]?p[1][0]:'')).toUpperCase();}

    /* ---------------- icônes (traits, couleur héritée) ---------------- */
    var S='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    var ICON={
      home:S+'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/></svg>',
      cart:S+'<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5H5l2.2 11h11l2-8H6"/></svg>',
      box:S+'<path d="M12 2.8 20.5 7v10L12 21.2 3.5 17V7z"/><path d="M3.8 7.2 12 11.4l8.2-4.2"/><path d="M12 11.4v9.6"/></svg>',
      layers:S+'<path d="m12 3 9 4.5-9 4.5-9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/></svg>',
      scan:S+'<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8"/><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8"/><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16"/><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 9h2v2H8zM14 9h2v2h-2zM8 14h2v2H8zM14 14h2v2h-2z"/></svg>',
      bell:S+'<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z"/><path d="M10 21h4"/></svg>',
      user:S+'<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c.8-3.8 3.7-5.8 7.5-5.8s6.7 2 7.5 5.8"/></svg>',
      dots:S+'<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/></svg>',
      burger:S+'<path d="M4 7h16M4 12h16M4 17h16"/></svg>',
      moon:S+'<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/></svg>',
      sun:S+'<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg>'
    };
    var LOGO='<svg class="pg-logo" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="pgLg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#19b6a8"/><stop offset="1" stop-color="#1d5fd6"/></linearGradient></defs>'
      +'<path fill="url(#pgLg)" fill-rule="evenodd" d="M8,2h8v6h6v8h-6v6H8v-6H2V8h6z M11.717,15.111 L15.111,11.717 A2,2 0 0 0 12.283,8.889 L8.889,12.283 A2,2 0 0 0 11.717,15.111 Z"/></svg>';

    /* ---------------- menus selon le rôle ---------------- */
    var MENU=isAdmin
      ?[['Principal',[['index.html','⌂','Tableau de bord'],['vente.html','🛒','Ventes'],['scanner.html','📷','Scanner']]],
        ['Gestion',[['produits.html','📦','Produits'],['stocks.html','▣','Stocks'],['lots.html','◫','Lots & péremptions'],['receptions.html','↓','Réceptions'],['fournisseurs.html','🚚','Fournisseurs']]],
        ['Analyse',[['rapports.html','▥','Rapports'],['vente_partenaire.html','⇄','Vente partenaire'],['audit.html','◉','Journal d’audit'],['notifications.html','🔔','Notifications']]],
        ['Administration',[['utilisateurs.html','♙','Utilisateurs'],['parametres.html','⚙','Paramètres'],['profil.html','☺','Mon profil']]]]
      :[['Menu',[['index.html','⌂','Tableau de bord'],['vente.html','🛒','Vente / Caisse'],['scanner.html','📷','Scanner'],['stocks.html','▣','Stocks'],['notifications.html','🔔','Notifications'],['profil.html','☺','Mon profil']]]];
    var TABS=isAdmin
      ?[['index.html','Accueil','home'],['vente.html','Ventes','cart'],['produits.html','Produits','box']]
      :[['index.html','Accueil','home'],['vente.html','Ventes','cart'],['stocks.html','Stock','layers']];

    function networkState(){
      var online=navigator.onLine!==false, label='En ligne';
      try{
        var st=JSON.parse((native&&native.getNetworkStatusJson&&native.getNetworkStatusJson())||'{}');
        if(isAdmin){ online=!!st.hotspotActive||st.hotspotActive===undefined&&online; label=online?'En ligne':'Hors ligne'; }
        else { online=!!st.sellerNetworkConnected; label=online?'En ligne':'Mode hors ligne'; }
      }catch(e){}
      return {online:online,label:label};
    }
    function establishment(){ try{return String(localStorage.getItem('pg_company_name')||'').trim();}catch(e){return '';} }

    /* ---------------- thème (mode nuit / jour) ---------------- */
    function isDark(){ try{ return window.PharmaTheme&&window.PharmaTheme.get()==='dark'; }catch(e){ return false; } }
    function themeIcon(){ return isDark()?ICON.sun:ICON.moon; }
    function toggleTheme(){ try{ window.PharmaTheme&&window.PharmaTheme.toggle(); }catch(e){} drawBar(); drawDrawer(); refreshBadges(); }

    /* ---------------- barre du haut ---------------- */
    var bar=document.createElement('div'); bar.id='pgAppBar';
    function drawBar(){
      var est=establishment();
      bar.innerHTML='<a class="pg-brand-row" href="index.html">'+LOGO+'<span><span class="pg-wordmark">Pharma<b>Gest</b></span>'+(est?'<span class="pg-estab">'+esc(est)+'</span>':'')+'</span></a>'
        +'<span class="pg-bar-actions"><button class="pg-burger" id="pgThemeBtn" type="button" aria-label="Mode nuit / mode jour">'+themeIcon()+'</button>'
        +'<button class="pg-burger" id="pgBurger" type="button" aria-label="Ouvrir le menu">'+ICON.burger+'</button></span>';
      var b=bar.querySelector('#pgBurger'); if(b) b.addEventListener('click',openDrawer);
      var tb=bar.querySelector('#pgThemeBtn'); if(tb) tb.addEventListener('click',toggleTheme);
    }

    /* ---------------- barre du bas ---------------- */
    var tab=document.createElement('nav'); tab.id='pgTabBar'; tab.setAttribute('aria-label','Navigation principale');
    function drawTabs(){
      var inTabs=TABS.some(function(t){return t[0]===PAGE;});
      tab.innerHTML=TABS.map(function(t){
        return '<a href="'+t[0]+'" class="'+(t[0]===PAGE?'active':'')+'">'+ICON[t[2]]+'<span>'+t[1]+'</span></a>';
      }).join('')+'<button type="button" id="pgTabMore" class="'+(inTabs?'':'active')+'">'+ICON.dots+'<span>Plus</span><span class="pg-tab-badge" id="pgTabBadge" style="display:none"></span></button>';
      var m=tab.querySelector('#pgTabMore'); if(m) m.addEventListener('click',openDrawer);
    }

    /* ---------------- tiroir ---------------- */
    var shade=document.createElement('div'); shade.id='pgDrawerShade';
    var drawer=document.createElement('aside'); drawer.id='pgDrawer'; drawer.setAttribute('aria-label','Menu');
    function drawDrawer(){
      var ns=networkState();
      drawer.innerHTML='<div class="pg-d-user"><div class="pg-avatar">'+esc(initials(userName))+'</div><div><div style="font-weight:800;font-size:17px;color:#0f2740">'+esc(userName)+'</div>'
        +'<div style="font-size:13px;font-weight:600;color:'+(ns.online?'#1b9a6b':'#c2570c')+'">'+esc(roleLabel)+' · '+esc(ns.label)+'</div></div></div>'
        +'<button class="pg-d-theme" id="pgDrawerTheme" type="button"><span class="pg-d-ico">'+(isDark()?'☀️':'🌙')+'</span><span>'+(isDark()?'Passer en mode jour':'Passer en mode nuit')+'</span></button>'
        +'<div class="pg-d-menu">'+MENU.map(function(sec){
          return '<div class="pg-d-section">'+esc(sec[0])+'</div>'+sec[1].map(function(it){
            return '<a class="pg-d-link'+(it[0]===PAGE?' active':'')+'" href="'+it[0]+'"><span class="pg-d-ico">'+it[1]+'</span><span>'+esc(it[2])+'</span>'
              +(it[0]==='notifications.html'?'<span class="pg-d-badge" id="pgDrawerBadge" style="display:none"></span>':'')+'</a>';
          }).join('');
        }).join('')+'</div>'
        +'<button class="pg-d-logout" id="pgLogout" type="button">Déconnexion</button>';
      var dt=drawer.querySelector('#pgDrawerTheme'); if(dt) dt.addEventListener('click',toggleTheme);
      var lo=drawer.querySelector('#pgLogout');
      if(lo) lo.addEventListener('click',function(){
        ['dpa_token','dpa_user','dpa_local_user_id','dpa_session_active'].forEach(function(k){try{localStorage.removeItem(k);}catch(e){}});
        location.replace('login.html');
      });
    }
    function openDrawer(){ drawDrawer(); refreshBadges(); document.body.classList.add('pg-drawer-open'); }
    function closeDrawer(){ document.body.classList.remove('pg-drawer-open'); }
    shade.addEventListener('click',closeDrawer);
    document.addEventListener('keydown',function(e){ if(e.key==='Escape') closeDrawer(); });

    /* ---------------- badges de notifications non lues ---------------- */
    function unread(){ try{return Number((native&&native.getUnreadNotificationCount&&native.getUnreadNotificationCount())||0)||0;}catch(e){return 0;} }
    function refreshBadges(){
      var n=unread(), txt=n>99?'99+':String(n);
      ['pgTabBadge','pgDrawerBadge','pgTileBadge'].forEach(function(id){
        var el=document.getElementById(id); if(!el) return;
        el.textContent=txt; el.style.display=n>0?'inline-block':'none';
      });
    }

    /* ---------------- accueil : carte utilisateur, tuiles, dernières ventes ---------------- */
    function drawHome(){
      if(PAGE!=='index.html') return;
      var content=document.querySelector('section.content')||document.querySelector('.content')||document.querySelector('main');
      if(!content||document.getElementById('pgHome')) return;
      var tiles=isAdmin
        ?[['vente.html','green','cart','Vente'],['produits.html','blue','box','Produits'],['stocks.html','orange','layers','Stock'],['scanner.html','purple','scan','Scanner']]
        :[['vente.html','green','cart','Vente'],['notifications.html','blue','bell','Notifications'],['stocks.html','orange','layers','Stock'],['scanner.html','purple','scan','Scanner']];
      var home=document.createElement('div'); home.id='pgHome';
      home.innerHTML='<a class="pg-profile" href="profil.html"><div class="pg-avatar">'+esc(initials(userName))+'</div>'
        +'<div><div class="pg-name">'+esc(isAdmin?userName:roleLabel)+'</div><div class="pg-state" id="pgState"><i></i><span>En ligne</span></div></div><span class="pg-chev">›</span></a>'
        +'<div class="pg-tiles">'+tiles.map(function(t){
          return '<a class="pg-tile '+t[1]+'" href="'+t[0]+'">'+ICON[t[2]]+'<span>'+t[3]+'</span>'
            +(t[0]==='notifications.html'?'<span class="pg-tile-badge" id="pgTileBadge" style="display:none"></span>':'')+'</a>';
        }).join('')+'</div>'
        +'<div class="pg-recent"><h2>Dernières ventes</h2><div id="pgSales"><div class="pg-empty">Chargement…</div></div></div>';
      content.insertBefore(home,content.firstChild);
      document.body.classList.add('pg-home');
      refreshState(); loadSales();
    }
    function refreshState(){
      var el=document.getElementById('pgState'); if(!el) return;
      var ns=networkState(); el.className='pg-state'+(ns.online?'':' off'); el.querySelector('span').textContent=ns.label;
    }
    var salesBusy=false;
    function loadSales(){
      var box=document.getElementById('pgSales'); if(!box||salesBusy) return;
      salesBusy=true;
      var from=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
      fetch('/api/sales?from='+from,{headers:{Authorization:'Bearer '+(localStorage.getItem('dpa_token')||'')}})
        .then(function(r){return r.ok?r.json():[];})
        .then(function(list){
          list=Array.isArray(list)?list.slice(0,5):[];
          if(!list.length){ box.innerHTML='<div class="pg-empty">Aucune vente pour le moment.</div>'; return; }
          box.innerHTML=list.map(function(s){
            var num=s.sale_number||s.number||s.reference||String(s.id||'').slice(0,8);
            var d=new Date(s.created_at||s.date||''), t=isNaN(d.getTime())?'':d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
            return '<div class="pg-sale"><span class="n">'+esc(num)+'</span><span class="a">'+money(s.total)+' FCFA</span><span class="t">'+esc(t)+'</span></div>';
          }).join('');
        })
        .catch(function(){ box.innerHTML='<div class="pg-empty">Ventes indisponibles pour le moment.</div>'; })
        .then(function(){ salesBusy=false; });
    }

    /* ---------------- montage ---------------- */
    function mount(){
      document.body.classList.add('pg-mobile');
      drawBar(); drawTabs(); drawDrawer();
      document.body.appendChild(bar); document.body.appendChild(tab);
      document.body.appendChild(shade); document.body.appendChild(drawer);
      drawHome(); refreshBadges();
      setTimeout(drawBar,1500); setTimeout(drawBar,4500); // nom de l'établissement chargé par branding.js
      setInterval(function(){ refreshBadges(); refreshState(); },5000);
      setInterval(function(){ if(document.getElementById('pgSales')) loadSales(); },30000);
      window.addEventListener('pharmagest-stock-changed',function(){ if(document.getElementById('pgSales')) setTimeout(loadSales,800); });      try{ requestAnimationFrame(function(){ window.__pgShow&&window.__pgShow(); }); }catch(_){}
    }
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
  }catch(e){ try{console.warn('Habillage mobile PharmaGest indisponible :',e);}catch(_){} }
})();
