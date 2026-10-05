'use strict';

// Keep the director above other topmost windows without activating it. Merely
// retaining WS_EX_TOPMOST does not keep its position within the topmost band.
function keepDirectorOnTop(window){
 let disposed=false,raising=false;
 function raise(){
  if(disposed||raising||window.isDestroyed()||window.isMinimized()||!window.isVisible())return;
  raising=true;
  try{
   window.setAlwaysOnTop(true,'screen-saver');
   window.moveTop();
  }finally{raising=false;}
 }
 window.setAlwaysOnTop(true,'screen-saver');
 const events=['show','restore','focus','blur','move','resize'];
 for(const event of events)window.on(event,raise);
 const onTopChanged=(_event,onTop)=>{if(!onTop)raise();};
 window.on('always-on-top-changed',onTopChanged);
 const timer=setInterval(raise,1000);timer.unref();
 function dispose(){
  if(disposed)return;disposed=true;clearInterval(timer);
  for(const event of events)window.removeListener(event,raise);
  window.removeListener('always-on-top-changed',onTopChanged);
  window.removeListener('closed',dispose);
 }
 window.once('closed',dispose);
 return {raise,dispose};
}

module.exports={keepDirectorOnTop};
