const { app, BrowserWindow, shell, dialog, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createBroadcastServer } = require("../server/broadcast-server.cjs");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }
let mainWindow, directorWindow, settingsWindow, localOrigin, directorScreen=0, directorLayoutFile;
function placeDirector(saved){
 if(!directorWindow)return;const displays=screen.getAllDisplays(),area=screen.getDisplayMatching(saved||directorWindow.getBounds()).workArea;
 const target=saved||{...directorWindow.getBounds(),x:area.x+8};
 const width=Math.min(area.width,Math.max(Math.min(800,area.width),target.width||1200));
 const height=Math.min(area.height,Math.max(Math.min(200,area.height),target.height||220));
 directorWindow.setBounds({width,height,x:Math.max(area.x,Math.min(target.x??area.x+8,area.x+area.width-width)),y:Math.max(area.y,Math.min(target.y??area.y+area.height-height-8,area.y+area.height-height))});
}
function saveDirectorBounds(){if(!directorWindow||directorWindow.isDestroyed()||directorWindow.isMinimized())return;try{fs.writeFileSync(directorLayoutFile,JSON.stringify({...directorWindow.getBounds(),layoutRevision:3}));}catch{}}
function directorAction(action){
 if(action==='compact'){if(directorWindow){const b=directorWindow.getBounds();placeDirector({...b,height:220});}return;}
 if(action==='close'){directorWindow?.close();return;}
 if(action==='dashboard'){mainWindow.show();mainWindow.focus();return;}
 if(action==='settings'){
  if(settingsWindow){settingsWindow.show();settingsWindow.focus();return;}
  settingsWindow=new BrowserWindow({width:780,height:760,minWidth:640,backgroundColor:'#212121',title:'导播控制栏设置',webPreferences:{contextIsolation:true,sandbox:true}});settingsWindow.setMenuBarVisibility(false);settingsWindow.loadURL(localOrigin+'/director-settings.html');settingsWindow.on('closed',()=>settingsWindow=null);return;
 }
 if(action==='screen'){if(directorWindow){const displays=screen.getAllDisplays(),current=screen.getDisplayMatching(directorWindow.getBounds()),index=displays.findIndex(d=>d.id===current.id),area=displays[(index+1)%displays.length].workArea,b=directorWindow.getBounds();placeDirector({...b,x:area.x+8,y:area.y+area.height-b.height-8});}return;}
 if(directorWindow){directorWindow.showInactive();return;}
 const displays=screen.getAllDisplays(),nearest=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());directorScreen=Math.max(0,displays.findIndex(d=>d.id===nearest.id));
 directorWindow=new BrowserWindow({width:1200,height:220,minWidth:800,minHeight:200,frame:true,thickFrame:true,movable:true,title:'ScoreDeck 导播控制栏',autoHideMenuBar:true,focusable:true,alwaysOnTop:true,skipTaskbar:false,resizable:true,maximizable:false,fullscreenable:false,show:false,backgroundColor:'#171717',webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
 directorWindow.setMenuBarVisibility(false);directorWindow.setFocusable(true);directorWindow.setIgnoreMouseEvents(false);directorWindow.setMovable(true);directorWindow.setResizable(true);directorWindow.setMinimumSize(800,200);directorWindow.setAlwaysOnTop(true);
 const area=nearest.workArea;let saved={width:area.width-16,height:220,x:area.x+8,y:area.y+area.height-228};
 try{const input=JSON.parse(fs.readFileSync(directorLayoutFile,'utf8'));if(['x','y','width','height'].every(k=>Number.isFinite(input[k])))saved={...input,height:input.layoutRevision===3?input.height:220};}catch{}
 placeDirector(saved);directorWindow.on('resize',saveDirectorBounds);directorWindow.on('move',saveDirectorBounds);directorWindow.on('close',saveDirectorBounds);directorWindow.loadURL(localOrigin+'/director-bar.html');directorWindow.once('ready-to-show',()=>directorWindow?.showInactive());directorWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));directorWindow.on('closed',()=>directorWindow=null);
}

app.on("second-instance", () => { if (mainWindow) { if(mainWindow.isMinimized())mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
let graphicsServer;
const executableDir = path.dirname(process.execPath);
const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR
  ? path.resolve(process.env.PORTABLE_EXECUTABLE_DIR)
  : fs.existsSync(path.join(executableDir, "portable.flag")) ? executableDir : null;
if (portableRoot) {
  fs.mkdirSync(portableRoot, { recursive: true });
  app.setPath("userData", path.join(portableRoot, "ScoreDeck CS Portable Cache"));
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#212121",
    title: `ScoreDeck CS 导播台 · ${require('../package.json').version}`,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(url);
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    try {
      const requested = new URL(target);
      const local = new URL(url);
      if (requested.origin === local.origin && requested.pathname.startsWith("/output/")) return { action: "allow" };
    } catch {}
    shell.openExternal(target);
    return { action: "deny" };
  });
}

function migrateLegacyData(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const targetState = path.join(dataDir, "broadcast-state.json");
  const targetSettings = path.join(dataDir, "settings.json");
  if (fs.existsSync(targetState) || fs.existsSync(targetSettings)) return;
  const appData = app.getPath("appData");
  const candidates = [
    path.join(appData, "ScoreDeck CS 导播台 2.3"),
    path.join(appData, "ScoreDeck CS 导播台"),
    path.join(appData, "scoredeck-cs-broadcast"),
    path.join(appData, "ScoreDeck CS 导播台 · 2.1 验证版"),
    path.join(appData, "ScoreDeck CS 导播台 2.2"),
    path.join(appData, "ScoreDeck CS 导播台 2.2.1"),
  ];
  const source = candidates.filter(candidate => fs.existsSync(path.join(candidate,"broadcast-state.json"))).sort((a,b) => fs.statSync(path.join(b,"broadcast-state.json")).mtimeMs-fs.statSync(path.join(a,"broadcast-state.json")).mtimeMs)[0];
  if (!source) return;
  if (fs.existsSync(path.join(source,"media"))) fs.cpSync(path.join(source,"media"),path.join(dataDir,"media"),{recursive:true});
  for (const name of ["broadcast-state.json", "settings.json"]) {
    const from = path.join(source, name);
    const to = path.join(dataDir, name);
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

app.whenReady().then(async () => {
  const webRoot = app.isPackaged ? path.join(__dirname, "..", "dist") : path.join(__dirname, "..", "dist");
  const dataDir = portableRoot ? path.join(portableRoot, "ScoreDeck CS Portable Data") : path.join(app.getPath("appData"), "ScoreDeck CS 导播台 2.3");
  migrateLegacyData(dataDir);
  directorLayoutFile=path.join(dataDir,"director-window.json");
  graphicsServer = createBroadcastServer({
    webRoot,
    dataDir,
    onDirectorWindow: directorAction,
    onFullImport: () => { app.relaunch(); app.quit(); },
    selectIntegrationDirectory: async (id) => {
      const result=await dialog.showOpenDialog(mainWindow,{title:`导入旧版 ${id} 配置：选择程序或数据目录`,properties:['openDirectory'],buttonLabel:'导入配置'});
      return result.canceled?null:result.filePaths[0];
    },
    selectRadarDirectory: async (defaultPath) => {
      const result = await dialog.showOpenDialog(mainWindow, {title:"选择 CS2 安装目录或 game\\csgo\\cfg 文件夹",defaultPath,properties:["openDirectory"],buttonLabel:"配置 GSI"});
      return result.canceled ? null : result.filePaths[0];
    },
    onPortChanged: (port) => {localOrigin=`http://127.0.0.1:${port}`;mainWindow?.loadURL(localOrigin+'/');directorWindow?.loadURL(localOrigin+'/director-bar.html');settingsWindow?.loadURL(localOrigin+'/director-settings.html');},
  });
  const meta = await graphicsServer.listen();
  localOrigin=meta.localUrl;createWindow(`${meta.localUrl}/`);
  mainWindow.on('closed',()=>{directorWindow?.close();settingsWindow?.close();app.quit();});
  screen.on('display-metrics-changed',()=>placeDirector());screen.on('display-removed',()=>placeDirector());
}).catch(error => {
  const message = `ScoreDeck 无法启动：${error.message}\n请确认程序已完整解压、目录可写。`;
  try { fs.appendFileSync(path.join(portableRoot || app.getPath("userData"), "startup-error.log"), new Date().toISOString()+" "+error.stack+"\n"); } catch {}
  dialog.showErrorBox("ScoreDeck 启动失败", message); app.quit();
});

let quitting=false;
app.on('before-quit',event=>{
  if(quitting||!graphicsServer)return;
  event.preventDefault();quitting=true;
  graphicsServer.close().catch(error=>dialog.showErrorBox('模块退出异常',error.message)).finally(()=>app.quit());
});
app.on('window-all-closed',()=>app.quit());
