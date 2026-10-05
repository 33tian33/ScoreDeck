const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(saved){
 const made=[],writes=[],area={x:0,y:0,width:1920,height:1040};
 class Window{constructor(options){this.options=options;this.bounds={x:0,y:0,width:options.width,height:options.height};this.events={};this.webContents={setWindowOpenHandler(){}};made.push(this);}setMenuBarVisibility(){}setFocusable(v){this.focusable=v;}setIgnoreMouseEvents(v){this.ignore=v;}setMovable(v){this.movable=v;}setResizable(v){this.resizable=v;}setMinimumSize(w,h){this.min=[w,h];}setAlwaysOnTop(v,level){this.top=v;this.topLevel=level;}moveTop(){this.raises=(this.raises||0)+1;}isVisible(){return true;}removeListener(){}restore(){this.restored=true;}setBounds(v){this.bounds=v;}getBounds(){return this.bounds;}on(k,f){this.events[k]=f;}once(k,f){this.events[k]=f;}loadURL(){}showInactive(){}isDestroyed(){return false;}isMinimized(){return false;}}
 const ctx={require:name=>name==='electron'?{app:{requestSingleInstanceLock:()=>true},BrowserWindow:Window,screen:{getAllDisplays:()=>[{id:1,workArea:area}],getDisplayMatching:()=>({workArea:area}),getDisplayNearestPoint:()=>({id:1,workArea:area}),getCursorScreenPoint:()=>({x:0,y:0})}}:name==='node:fs'?{readFileSync:()=>JSON.stringify(saved),writeFileSync:(p,s)=>writes.push(JSON.parse(s))}:name==='node:path'?path:name==='./director-topmost.cjs'?require('../desktop/director-topmost.cjs'):{createBroadcastServer(){}},process};vm.createContext(ctx);
 const code=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');vm.runInContext(code.slice(0,code.indexOf('app.on("second-instance"')),ctx);vm.runInContext("directorLayoutFile='test.json';localOrigin='http://localhost';directorAction('open');",ctx);
 return {win:made[0],writes,call:code=>vm.runInContext(code,ctx)};
}
test('director creates an interactive, movable, framed, resizable native window',()=>{
 const t=setup();const w=t.win;assert.equal(w.options.focusable,true);assert.equal(w.options.frame,true);assert.equal(w.options.thickFrame,true);assert.equal(w.options.skipTaskbar,false);assert.equal(w.focusable,true);assert.equal(w.ignore,false);assert.equal(w.movable,true);assert.equal(w.resizable,true);assert.equal(w.top,true);assert.equal(w.topLevel,'screen-saver');assert.deepEqual(w.min,[800,200]);assert.equal(w.bounds.height,220);
});
test('legacy tall dimensions migrate once, manual bounds persist and compact action resets height',()=>{
 const t=setup({x:200,y:200,width:1100,height:380});assert.equal(t.win.bounds.height,220);t.win.bounds={x:100,y:100,width:900,height:205};t.win.events.resize();assert.equal(t.writes[0].layoutRevision,3);assert.equal(t.writes[0].height,205);
 const restored=setup(t.writes[0]);assert.equal(restored.win.bounds.height,205);restored.call("directorAction('compact')");assert.equal(restored.win.bounds.height,220);
});

test('opening the existing minimized director restores and raises the same window',()=>{
 const t=setup(),w=t.win;w.isMinimized=()=>!w.restored;
 t.call("directorAction('open')");assert.equal(w.restored,true);assert.equal(w.raises,1);assert.equal(w.topLevel,'screen-saver');
});
