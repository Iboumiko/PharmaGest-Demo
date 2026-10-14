/* PharmaGest V52 — choix du thème (mode jour / mode nuit), mémorisé sur l'appareil.
   À charger dans <head> : le thème est appliqué avant l'affichage (pas de flash blanc). */
(function pharmaTheme(){
  'use strict';
  var KEY='pg_theme', listeners=[];
  function read(){ try{ return localStorage.getItem(KEY)==='dark'?'dark':'light'; }catch(e){ return 'light'; } }
  function apply(t){
    try{
      document.documentElement.setAttribute('data-theme',t);
      var m=document.querySelector('meta[name="theme-color"]'); if(m) m.setAttribute('content',t==='dark'?'#101418':'#ffffff');
    }catch(e){}
  }
  function set(t){
    t=(t==='dark')?'dark':'light';
    try{ localStorage.setItem(KEY,t); }catch(e){}
    apply(t);
    listeners.forEach(function(fn){ try{fn(t);}catch(e){} });
    var fab=document.getElementById('pgThemeFab'); if(fab) fab.textContent=t==='dark'?'☀️':'🌙';
  }
  apply(read());
  window.PharmaTheme={
    get:read, set:set,
    toggle:function(){ set(read()==='dark'?'light':'dark'); },
    onChange:function(fn){ listeners.push(fn); }
  };
  // Bouton flottant quand il n'y a pas de barre du haut mobile (connexion, accueil, écran large)
  function fab(){
    try{
      if(document.getElementById('pgThemeFab')) return;
      var bar=document.getElementById('pgAppBar');
      if(bar&&getComputedStyle(bar).display!=='none') return;
      var b=document.createElement('button');
      b.id='pgThemeFab'; b.type='button';
      b.setAttribute('aria-label','Changer de thème (mode nuit / mode jour)');
      b.title='Mode nuit / Mode jour';
      b.textContent=read()==='dark'?'☀️':'🌙';
      b.addEventListener('click',function(){ window.PharmaTheme.toggle(); });
      document.body.appendChild(b);
    }catch(e){}
  }
  function later(){ setTimeout(fab,500); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',later); else later();
})();
