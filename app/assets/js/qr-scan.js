/* PharmaGest V58 — lecteur de QR code commun (appairage PC, appairage vendeur).
   Pourquoi : la WebView Android n'offre presque jamais `BarcodeDetector` ; les anciens écrans ne fonctionnaient donc pas
   (ou renvoyaient vers le scanner de produits de la vente, qui ne sait lire que les codes-barres).
   Moteurs, par ordre de préférence :
     1) BarcodeDetector (si le navigateur sait lire « qr_code »),
     2) décodeur ZXing du téléphone : la page envoie une image en niveaux de gris à PharmaGestNative.decodeQrFromGray().
   API : PharmaQrScanner.start(videoEl, {onCode(texte)->bool}) ; .stop() ; .isRunning().
   onCode renvoie true pour arrêter le scan (appelle stop() lui-même), false/undefined pour continuer. */
(function(){
  'use strict';
  var stream=null, running=false, timer=null, engine=null, detector=null, lastText='', lastAt=0, busy=false;
  var canvas=null, ctx=null;
  var MAX_SIDE=800;      // taille maximale de l'image analysée (≈ 480 Ko en gris)
  var INTERVAL_MS=300;   // ≈ 3 analyses par seconde : assez fluide sans chauffer le téléphone

  function nativeDecoder(){
    try{ return !!(window.PharmaGestNative && typeof window.PharmaGestNative.decodeQrFromGray==='function'); }
    catch(e){ return false; }
  }
  async function pickEngine(){
    if('BarcodeDetector' in window){
      try{
        var f=await BarcodeDetector.getSupportedFormats();
        if(f && f.indexOf('qr_code')>=0){ detector=new BarcodeDetector({formats:['qr_code']}); return 'detector'; }
      }catch(e){}
    }
    if(nativeDecoder()) return 'native';
    return null;
  }

  /* --- image -> niveaux de gris -> base64 (pour le décodeur natif) --- */
  function grab(video){
    var vw=video.videoWidth, vh=video.videoHeight;
    if(!vw||!vh) return null;
    var scale=Math.min(1, MAX_SIDE/Math.max(vw,vh));
    var w=Math.max(1,Math.round(vw*scale)), h=Math.max(1,Math.round(vh*scale));
    if(!canvas){ canvas=document.createElement('canvas'); }
    if(canvas.width!==w) canvas.width=w;
    if(canvas.height!==h) canvas.height=h;
    if(!ctx){ ctx=canvas.getContext('2d',{willReadFrequently:true}); }
    ctx.drawImage(video,0,0,w,h);
    return toGray(ctx.getImageData(0,0,w,h).data,w,h);
  }
  function toGray(rgba,w,h){
    var g=new Uint8Array(w*h);
    for(var i=0,j=0;j<g.length;i+=4,j++){ g[j]=(rgba[i]*77+rgba[i+1]*151+rgba[i+2]*28)>>8; }
    return {gray:g,w:w,h:h};
  }
  function toBase64(u8){
    var s='', chunk=0x8000;
    for(var i=0;i<u8.length;i+=chunk){ s+=String.fromCharCode.apply(null,u8.subarray(i,i+chunk)); }
    return btoa(s);
  }

  async function readOnce(video){
    if(engine==='detector'){
      var codes=await detector.detect(video);
      return (codes && codes[0] && codes[0].rawValue) || '';
    }
    var img=grab(video);
    if(!img) return '';
    var out=await window.PharmaGestNative.decodeQrFromGray(toBase64(img.gray),img.w,img.h);   // « await » : sans effet sur la réponse synchrone d'Android
    return out ? String(out) : '';
  }

  function loop(video,onCode){
    if(!running) return;
    timer=setTimeout(async function(){
      if(!running) return;
      if(busy){ loop(video,onCode); return; }
      busy=true;
      try{
        var text=await readOnce(video);
        var now=Date.now();
        // Le même QR est vu plusieurs fois par seconde : on ne le signale qu'une fois toutes les 2 s.
        if(text && !(text===lastText && now-lastAt<2000)){
          lastText=text; lastAt=now;
          var stop=false;
          try{ stop=!!(onCode && onCode(text)); }catch(e){}
          if(stop){ busy=false; stop_(); return; }
        }
      }catch(e){ /* image illisible : on réessaie */ }
      busy=false;
      loop(video,onCode);
    },INTERVAL_MS);
  }

  function friendlyCameraError(e){
    var n=e&&e.name;
    if(n==='NotAllowedError'||n==='SecurityError') return 'Autorisation caméra refusée. Autorisez la caméra pour PharmaGest dans les paramètres du téléphone.';
    if(n==='NotFoundError'||n==='OverconstrainedError') return 'Aucune caméra disponible sur cet appareil.';
    if(n==='NotReadableError') return 'La caméra est utilisée par une autre application. Fermez-la puis réessayez.';
    return (e&&e.message)||'Caméra indisponible.';
  }

  async function start(video,opts){
    opts=opts||{};
    stop_();
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia) throw new Error('La caméra n’est pas disponible sur cet appareil.');
    engine=await pickEngine();
    if(!engine) throw new Error('La lecture des QR codes n’est pas disponible sur cet appareil.');
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
    }catch(e){ throw new Error(friendlyCameraError(e)); }
    try{
      video.setAttribute('playsinline',''); video.muted=true; video.srcObject=stream;
      await video.play();
    }catch(e){ stop_(); throw new Error(friendlyCameraError(e)); }
    running=true; lastText=''; lastAt=0; busy=false;
    loop(video,opts.onCode);
    return engine;
  }

  function stop_(){
    running=false;
    if(timer){ clearTimeout(timer); timer=null; }
    if(stream){ try{ stream.getTracks().forEach(function(t){ t.stop(); }); }catch(e){} stream=null; }
  }

  window.PharmaQrScanner={
    start:start,
    stop:stop_,
    isRunning:function(){ return running; },
    // exposé pour les tests uniquement
    _test:{toGray:toGray,toBase64:toBase64}
  };
})();
