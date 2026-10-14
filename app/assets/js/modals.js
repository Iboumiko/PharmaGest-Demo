/* PharmaGest V52 — comportement commun des fenêtres (modales) sur téléphone.
   1) hauteur réelle de l'écran visible (clavier compris)  2) structure en-tête / contenu défilant / boutons fixes
   3) clavier : touche Entrée / « Suivant » passe au champ suivant, « OK » valide au dernier champ
   4) champ actif ramené dans la zone visible  5) blocage du défilement de la page derrière.
   Ne modifie ni les données ni la logique des pages ; toute erreur est absorbée. */
(function pharmaModals(){
  'use strict';
  try{
    var OVERLAY_SEL='.modal-overlay,.modal-backdrop,.preview-overlay,#supplierModal,#productScannerModal,[role="dialog"][aria-modal="true"]';
    var HEADER_SEL='.modal-header,.adjust-modal-header,.preview-modal-header,[class$="-header"]';
    var FOOTER_SEL='.modal-footer,.modal-actions,.adjust-modal-footer,.preview-modal-footer,[class$="-footer"]';
    var BODY_SEL='.modal-body,.adjust-modal-body,.preview-modal-body';
    var FIELD_SEL='input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit]):not([disabled]):not([readonly]),select:not([disabled]),textarea:not([disabled]):not([readonly])';

    /* ---- 1. hauteur visible ---- */
    function setVh(){
      var h=(window.visualViewport&&window.visualViewport.height)||window.innerHeight;
      document.documentElement.style.setProperty('--pg-vh',Math.round(h)+'px');
    }
    setVh();
    window.addEventListener('resize',setVh);
    if(window.visualViewport){ window.visualViewport.addEventListener('resize',setVh); window.visualViewport.addEventListener('scroll',setVh); }

    /* ---- 2. structure ---- */
    function childMatching(el,sel){ for(var i=0;i<el.children.length;i++){ if(el.children[i].matches(sel)) return el.children[i]; } return null; }
    function findPanel(overlay){
      var kids=[].slice.call(overlay.children).filter(function(c){return c.tagName!=='SCRIPT'&&c.tagName!=='STYLE';});
      if(!kids.length) return null;
      var withParts=kids.filter(function(c){return c.querySelector(HEADER_SEL)||c.querySelector(FOOTER_SEL)||c.querySelector(BODY_SEL);});
      return withParts[0]||kids[0];
    }
    function normalize(overlay){
      var panel=findPanel(overlay); if(!panel) return;
      overlay.classList.add('pgm-overlay'); panel.classList.add('pgm-panel');
      // Beaucoup de fenêtres enveloppent contenu + boutons dans un <form> : c'est alors le <form> qui porte la structure.
      var scope=panel;
      var formKid=childMatching(panel,'form');
      if(formKid&&(childMatching(formKid,BODY_SEL)||childMatching(formKid,FOOTER_SEL))){ scope=formKid; formKid.classList.add('pgm-form'); }
      var header=childMatching(panel,HEADER_SEL)||(scope!==panel?childMatching(scope,HEADER_SEL):null);
      var footer=childMatching(scope,FOOTER_SEL), body=childMatching(scope,BODY_SEL);
      if(header) header.classList.add('pgm-header');
      if(footer) footer.classList.add('pgm-footer');
      if(body) body.classList.add('pgm-body');
      else if(!scope.querySelector(':scope > .pgm-body')){
        // Pas de zone de contenu dédiée : on regroupe tout ce qui n'est ni en-tête ni boutons.
        var wrap=document.createElement('div'); wrap.className='pgm-body';
        var nodes=[].slice.call(scope.childNodes).filter(function(n){return n!==header&&n!==footer;});
        if(nodes.length){
          scope.insertBefore(wrap,footer||null);
          nodes.forEach(function(n){wrap.appendChild(n);});
        }
      }
    }

    /* ---- 3. clavier : Entrée = champ suivant ---- */
    function fieldsOf(panel){
      return [].slice.call(panel.querySelectorAll(FIELD_SEL)).filter(function(f){
        var cs=getComputedStyle(f); return cs.display!=='none'&&cs.visibility!=='hidden'&&f.offsetParent!==null;
      });
    }
    function decorate(panel){
      var f=fieldsOf(panel);
      f.forEach(function(el,i){
        if(el.tagName==='TEXTAREA') return;
        el.setAttribute('enterkeyhint',i<f.length-1?'next':'done');
        if(el.type==='number'&&!el.getAttribute('inputmode')) el.setAttribute('inputmode',(el.step&&el.step.indexOf('.')>-1)||el.step==='any'?'decimal':'numeric');
      });
    }
    function primaryButton(panel){
      return panel.querySelector('.pgm-footer .btn-primary, .pgm-footer [type=submit], .pgm-footer .primary, .pgm-footer button:last-child');
    }
    document.addEventListener('keydown',function(e){
      if(e.key!=='Enter'||e.shiftKey||e.ctrlKey||e.altKey||e.isComposing) return;
      var t=e.target; if(!t||!t.closest) return;
      var panel=t.closest('.pgm-panel'); if(!panel) return;
      if(t.tagName==='TEXTAREA'||t.tagName==='BUTTON'||t.tagName==='A') return;
      if(t.tagName==='INPUT'&&/^(button|submit|checkbox|radio|file)$/.test(t.type)) return;
      var list=fieldsOf(panel), i=list.indexOf(t);
      if(i<0) return;
      if(i<list.length-1){
        e.preventDefault();
        var next=list[i+1]; next.focus();
        try{ next.scrollIntoView({block:'center',behavior:'smooth'}); }catch(_){}
        if(next.select&&next.tagName==='INPUT'&&/^(text|number|tel|email|search)$/.test(next.type)){ try{next.select();}catch(_){} }
      }else{
        // dernier champ : on ferme le clavier et on valide (comportement natif si le champ est dans un <form>)
        var form=t.closest('form');
        if(form) return;
        e.preventDefault(); t.blur();
        var b=primaryButton(panel); if(b) b.click();
      }
    },true);

    /* ---- 4. champ actif visible ---- */
    document.addEventListener('focusin',function(e){
      var t=e.target; if(!t||!t.closest||!t.closest('.pgm-panel')) return;
      if(!/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      setTimeout(function(){ try{ t.scrollIntoView({block:'center',behavior:'smooth'}); }catch(_){} },320); // après l'ouverture du clavier
    });

    /* ---- 5. verrou du défilement de la page ---- */
    function anyOpen(){
      return [].slice.call(document.querySelectorAll('.pgm-overlay')).some(function(o){
        var cs=getComputedStyle(o); return cs.display!=='none'&&cs.visibility!=='hidden'&&o.getClientRects().length>0;
      });
    }
    var tick=null;
    function refresh(){
      tick=null;
      try{
        [].slice.call(document.querySelectorAll(OVERLAY_SEL)).forEach(function(o){ if(!o.classList.contains('pgm-overlay')||!o.querySelector('.pgm-panel')||!o.querySelector('.pgm-body')) normalize(o); });
        [].slice.call(document.querySelectorAll('.pgm-panel')).forEach(decorate);
        document.body.classList.toggle('pgm-lock',anyOpen());
      }catch(e){}
    }
    function schedule(){ if(!tick) tick=setTimeout(refresh,60); }

    function start(){
      refresh();
      new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden']});
    }
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
  }catch(e){ try{console.warn('Fenêtres PharmaGest : module indisponible',e);}catch(_){} }
})();
