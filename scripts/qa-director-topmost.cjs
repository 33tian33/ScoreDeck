// Run as an Electron main process against disposable test windows.
const {app,BrowserWindow}=require('electron');
const {execFileSync}=require('node:child_process'),fs=require('node:fs'),assert=require('node:assert/strict');
const {keepDirectorOnTop}=require('../desktop/director-topmost.cjs');
const userData=require('node:path').join(require('node:path').dirname(process.env.SCOREDECK_QA_REPORT),'topmost-electron-data');
fs.mkdirSync(userData,{recursive:true});app.setPath('userData',userData);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const readOrder=String.raw`
import ctypes,json,sys
u=ctypes.windll.user32
u.GetTopWindow.argtypes=[ctypes.c_void_p];u.GetTopWindow.restype=ctypes.c_void_p
u.GetWindow.argtypes=[ctypes.c_void_p,ctypes.c_uint];u.GetWindow.restype=ctypes.c_void_p
u.GetForegroundWindow.restype=ctypes.c_void_p
handles=[int(v) for v in sys.argv[1:]]
order=[];h=u.GetTopWindow(None)
while h and len(order)<10000:
    order.append(h);h=u.GetWindow(h,2)
print(json.dumps({'positions':[order.index(h) if h in order else -1 for h in handles],'foreground':u.GetForegroundWindow()}))
`;
app.whenReady().then(async()=>{
 let director,competitor,controller;const checks=[];
 try{
  director=new BrowserWindow({width:800,height:220,show:false,title:'ScoreDeck topmost verification',webPreferences:{sandbox:true}});
  competitor=new BrowserWindow({width:850,height:350,show:false,title:'ScoreDeck competing window verification',webPreferences:{sandbox:true}});
  controller=keepDirectorOnTop(director);director.showInactive();competitor.show();
  const hwnd=w=>Number(w.getNativeWindowHandle().readBigUInt64LE());
  function inspect(){return JSON.parse(execFileSync(process.env.SCOREDECK_QA_PYTHON,['-c',readOrder,String(hwnd(director)),String(hwnd(competitor))],{encoding:'utf8',windowsHide:true}));}
  async function challenge(name,fullscreen=false){
   competitor.setAlwaysOnTop(true,'screen-saver');competitor.setFullScreen(fullscreen);competitor.focus();
   await wait(150);competitor.moveTop();
   const before=inspect();assert.ok(before.foreground&&before.foreground!==hwnd(director),'another window must own input focus');
   await wait(1250);const after=inspect();
   assert.ok(after.positions.every(n=>n>=0)&&after.positions[0]<after.positions[1],name+': director must recover the higher z-order');
   assert.notEqual(after.foreground,hwnd(director),name+': director must not take input focus');
   assert.equal(director.isAlwaysOnTop(),true);checks.push({name,before,after});
  }
  await challenge('competing topmost window');
  await challenge('borderless fullscreen window',true);
  competitor.setFullScreen(false);director.setAlwaysOnTop(false);await wait(50);assert.equal(director.isAlwaysOnTop(),true);
  director.minimize();await wait(1200);assert.equal(director.isMinimized(),true,'watchdog must respect minimizing');
  director.restore();await challenge('restored director');
  director.hide();await wait(1200);assert.equal(director.isVisible(),false,'watchdog must respect hiding');
  controller.dispose();director.destroy();await wait(1100);
  fs.writeFileSync(process.env.SCOREDECK_QA_REPORT,JSON.stringify({ok:true,electron:process.versions.electron,checks,minimizeHideClose:true},null,2));
 }catch(error){fs.writeFileSync(process.env.SCOREDECK_QA_REPORT,JSON.stringify({ok:false,error:error.stack,checks},null,2));process.exitCode=1;}
 finally{controller?.dispose();if(director&&!director.isDestroyed())director.destroy();if(competitor&&!competitor.isDestroyed())competitor.destroy();app.exit(process.exitCode||0);}
});
