const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(){
 const timers=new Set();let tick;
 class Window extends EventEmitter{
  constructor(){super();this.visible=true;this.minimized=false;this.destroyed=false;this.raises=0;this.top=false;this.focused=false;this.focusCalls=0;}
  isDestroyed(){return this.destroyed;}isMinimized(){return this.minimized;}isVisible(){return this.visible;}
  setAlwaysOnTop(value,level){this.top=value;this.level=level;this.emit('always-on-top-changed',{},value);}
  moveTop(){this.raises++;}focus(){this.focusCalls++;this.focused=true;}
 }
 const context={module:{exports:{}},setInterval(fn,ms){assert.equal(ms,1000);tick=fn;const timer={unref(){}};timers.add(timer);return timer;},clearInterval(timer){timers.delete(timer);}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop/director-topmost.cjs'),'utf8'),context);
 const window=new Window(),controller=context.module.exports.keepDirectorOnTop(window);
 return {window,controller,timers,tick:()=>tick()};
}
test('director regains top z-order after blur, restore, display movement and competing topmost windows without taking focus',()=>{
 const f=fixture(),w=f.window;assert.equal(w.top,true);assert.equal(w.level,'screen-saver');
 for(const event of ['show','restore','focus','blur','move','resize']){const before=w.raises;w.emit(event);assert.equal(w.raises,before+1,event);}
 const before=w.raises;f.tick();assert.equal(w.raises,before+1,'timer must raise even when topmost is already true');
 w.top=false;w.emit('always-on-top-changed',{},false);assert.equal(w.top,true);
 assert.equal(w.focusCalls,0);assert.equal(w.focused,false);f.controller.dispose();
});
test('topmost recovery respects intentionally hidden/minimized windows and cleans up on close',()=>{
 const f=fixture(),w=f.window;
 w.visible=false;f.tick();assert.equal(w.raises,0);
 w.visible=true;w.minimized=true;f.tick();assert.equal(w.raises,0);
 w.minimized=false;w.emit('restore');assert.equal(w.raises,1);
 w.destroyed=true;w.emit('closed');assert.equal(f.timers.size,0);
 const before=w.raises;f.tick();w.emit('blur');assert.equal(w.raises,before);
 for(const event of ['show','restore','focus','blur','move','resize','always-on-top-changed','closed'])assert.equal(w.listenerCount(event),0,event);
 f.controller.dispose();
});
