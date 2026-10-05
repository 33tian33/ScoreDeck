const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const crypto = require("node:crypto");
const rules = require("./scoredeck-rules.cjs");
const archive = require("./archive.cjs");
const half = require("./halftime.cjs");
const highlights=require("./highlights.cjs"),matchData=require("./match-data.cjs");
const { createDefaultState, migrateState } = require("./default-state.cjs");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".woff2": "font/woff2",
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

function collectBody(request, limit = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error(`请求数据超过 ${Math.round(limit/1024/1024)}MB，请使用素材归档`)); return; }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function collectBuffer(request, limit = 256 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error("Video file is too large")); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function getNetworkUrls(port) {
  const urls = [];
  try {
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const address of addresses || []) {
        if (address.family === "IPv4" && !address.internal) urls.push(`http://${address.address}:${port}`);
      }
    }
  } catch {
    return [];
  }
  return [...new Set(urls)];
}

function validState(value) {
  if(!(value && typeof value==="object" && Array.isArray(value.teams) && Array.isArray(value.matches) && value.tournament && value.theme))return false;
  const ids=value.teams.map(t=>t?.id),matches=value.matches.map(m=>m?.id);
  return ids.every(id=>typeof id==='string'&&id.length>0)&&new Set(ids).size===ids.length&&matches.every(id=>typeof id==='string'&&id.length>0)&&new Set(matches).size===matches.length&&value.teams.every(t=>typeof t.name==='string'&&(!t.players||Array.isArray(t.players)))&&value.matches.every(m=>(!m.teamAId||ids.includes(m.teamAId))&&(!m.teamBId||ids.includes(m.teamBId))&&(!m.teamAId||m.teamAId!==m.teamBId));
}

function portIsAvailable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen(port, "0.0.0.0", () => probe.close(() => resolve(true)));
  });
}

function serveFile(request, response, filePath, cacheControl = "public, max-age=3600") {
  const extension = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const range = request.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
      response.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      return response.end();
    }
    response.writeHead(206, {
      "Content-Type": MIME[extension] || "application/octet-stream",
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
    });
    return fs.createReadStream(filePath, { start, end }).pipe(response);
  }
  response.writeHead(200, {
    "Content-Type": MIME[extension] || "application/octet-stream",
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
  });
  fs.createReadStream(filePath).pipe(response);
}

function createBroadcastServer({ webRoot, dataDir, initialPort = 17890, initialCountdownPort = 17891, onPortChanged, selectRadarDirectory, selectIntegrationDirectory, integrationOptions, onFullImport, onDirectorWindow } = {}) {
  const resolvedWebRoot = path.resolve(webRoot || path.join(__dirname, "..", "dist"));
  const resolvedDataDir = path.resolve(dataDir || path.join(__dirname, "..", "data"));
  const fullPackage=require("./full-package.cjs");
  fullPackage.applyPending(resolvedDataDir);
  const stateFile = path.join(resolvedDataDir, "broadcast-state.json");
  const settingsFile = path.join(resolvedDataDir, "settings.json");
  const radar = require("./radar-service.cjs").createRadarService({ dataDir: resolvedDataDir });
  const setupRadar = require("./radar-setup.cjs").createSetup({ selectDirectory: selectRadarDirectory, port: radar.meta().gsiPort });
  const integrations=require("./integration-service.cjs").createIntegrationService({getState:()=>state,dataDir:resolvedDataDir,selectDirectory:selectIntegrationDirectory,...integrationOptions});
  let recoveryNotice="";
  const backupDir=path.join(resolvedDataDir,"backups");
  const backupList=()=>fs.existsSync(backupDir)?fs.readdirSync(backupDir).filter(n=>n.endsWith('.json')).sort().reverse():[];
  let storedState=readJson(stateFile,null);
  if(fs.existsSync(stateFile)&&(!validState(storedState))){
    const preserved=path.join(resolvedDataDir,`broadcast-state.corrupt-${Date.now()}.json`);
    fs.copyFileSync(stateFile,preserved);
    storedState=null;
    for(const name of backupList()){const candidate=readJson(path.join(backupDir,name),null);if(validState(candidate)){storedState=candidate;break;}}
    recoveryNotice=storedState?"存档异常，已从最近备份恢复；原文件已保留。":"存档异常，原文件已保留。请导入同步包或恢复备份。";
  }
  let state = migrateState(storedState || createDefaultState());
  if(state.liveScene==='halftime')state.liveScene='prematch';
  let settings = readJson(settingsFile, { port: Number(process.env.SCOREDECK_PORT) || initialPort, countdownPort: Number(process.env.SCOREDECK_COUNTDOWN_PORT) || initialCountdownPort });
  let currentPort = Number(process.env.SCOREDECK_PORT) || Number(settings.port) || initialPort;
  let countdownPort = Number(process.env.SCOREDECK_COUNTDOWN_PORT) || Number(settings.countdownPort) || initialCountdownPort;
  if (countdownPort === currentPort) countdownPort = currentPort + 1;
  const keyFile=path.join(resolvedDataDir,"control-key.txt");
  fs.mkdirSync(resolvedDataDir,{recursive:true});
  const director=require('./director-service.cjs').createDirectorService({radar,integrations,onWindow:onDirectorWindow});
  let controlKey=fs.existsSync(keyFile)?fs.readFileSync(keyFile,'utf8').trim():crypto.randomBytes(24).toString('hex');
  if(!fs.existsSync(keyFile))fs.writeFileSync(keyFile,controlKey);
  const serverEpoch=crypto.randomUUID();
  let controlEpoch=crypto.randomUUID();
  state.serverEpoch=serverEpoch;state.controlEpoch=controlEpoch;
  if(state.outputCycle?.enabled&&!Number.isFinite(Date.parse(state.outputCycle.startAt)))state.outputCycle.startAt=new Date().toISOString();
  const completedMutations=new Map();
  let lastBackup=0;
  const snapshot=(reason='auto')=>{
    if(reason==='auto'&&Date.now()-lastBackup<30000)return;
    fs.mkdirSync(backupDir,{recursive:true});
    const name=new Date().toISOString().replace(/[:.]/g,'-')+`-${reason}.json`;
    atomicWrite(path.join(backupDir,name),state);lastBackup=Date.now();
    for(const old of backupList().slice(30))fs.unlinkSync(path.join(backupDir,old));
  };
  let server;
  let countdownServer;
  let portChanging=false;
  let entranceReturnTimer;
  const clients = new Set();
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": keep-alive\n\n");
  }, 15000);
  heartbeat.unref?.();

  if (recoveryNotice || !storedState || JSON.stringify(storedState) !== JSON.stringify(state)) atomicWrite(stateFile, state);
  if (!fs.existsSync(settingsFile) || !settings.countdownPort) atomicWrite(settingsFile, { port: currentPort, countdownPort });

  const mediaReferences=value=>{
    const refs=new Set();const scan=v=>{if(typeof v==='string'&&v.startsWith('/media/')){const name=v.split(/[?#]/)[0];if(!/^\/media\/[a-zA-Z0-9_.-]+\.(mp4|webm|ogv|png|jpg|jpeg|webp|gif|svg)$/.test(name))throw Error('素材路径不受支持：'+name);refs.add(name);}else if(v&&typeof v==='object')for(const item of Object.values(v))scan(item);};scan(value);return refs;
  };
  const validateMedia=value=>{const missing=[...mediaReferences(value)].filter(ref=>!fs.existsSync(path.join(resolvedDataDir,ref.slice(1))));if(missing.length)throw Error('缺少本地素材：'+missing.join('、'));};
  const meta = () => ({
    version:require('../package.json').version, recoveryNotice, serverEpoch, controlEpoch, serverTime:Date.now(),
    radar: radar.meta(),
    port: currentPort,
    localUrl: `http://127.0.0.1:${currentPort}`,
    networkUrls: getNetworkUrls(currentPort),
    countdownPort,
    countdownLocalUrl: `http://127.0.0.1:${countdownPort}/output/countdown`,
    countdownNetworkUrls: getNetworkUrls(countdownPort).map((url) => `${url}/output/countdown`),
  });
  const broadcast = (event, value) => {
    if(event==='state')value={...value,serverTime:Date.now()};
    const payload = `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
    for (const client of clients) client.write(payload);
  };
  const entranceDurationMs = () => {
    const d = state.entrance?.durations || {};
    const identity = Number(d.identity || 2.4);
    const lineup = Number(d.lineup || 2.6);
    const clutch = Number(d.clutch || 2.1);
    const transition = Number(d.transition || (20 / 30));
    // Mirrors the v0.4 overlap schedule used by the browser output.
    const total = state.entrance?.showClutch === false
      ? 2 * (identity + lineup) + 1.6 * transition
      : 2 * (identity + lineup + clutch) + 2 * transition;
    return Math.max(1000, total * 1000);
  };
  const scheduleEntranceReturn = () => {
    if (entranceReturnTimer) clearTimeout(entranceReturnTimer);
    entranceReturnTimer = null;
    if (state.entrance?.status !== "running" || !state.entrance.startAt) return;
    const remaining = new Date(state.entrance.startAt).getTime() + entranceDurationMs() - Date.now();
    entranceReturnTimer = setTimeout(() => {
      if (state.entrance?.status !== "running") return;
      state = {
        ...state,
        revision: Number(state.revision || 0) + 1,
        liveScene: "prematch",
        entrance: { ...state.entrance, status: "idle", startAt: null },
      };
      atomicWrite(stateFile, state);
      broadcast("state", state);
    }, Math.max(0, remaining));
    entranceReturnTimer.unref?.();
  };

  let latestGSI=null;
  const consumeGSI=g=>{latestGSI=g;const next=structuredClone(state);if(matchData.ingest(next,g)){next.revision=Number(state.revision||0)+1;next.lastSavedAt=new Date().toISOString();atomicWrite(stateFile,next);state=next;broadcast('state',state);}};
  const automation=require('./halftime-auto.cjs').createAutomation({file:path.join(resolvedDataDir,'halftime-auto-state.json'),getState:()=>state,onGSI:consumeGSI,readGSI:async()=>{if(!radar.meta().running)return {connected:false};const r=await fetch(radar.meta().controlUrl+'api/phase',{signal:AbortSignal.timeout(2000)});if(!r.ok)throw Error('GSI 服务未连接');return r.json();},commit:next=>{next.revision=Number(state.revision||0)+1;next.lastSavedAt=new Date().toISOString();atomicWrite(stateFile,next);state=next;broadcast('state',state);scheduleEntranceReturn();}});
  const halftimeSnapshot=(mode)=>({customLayout:!!state.highlightLayouts,mode:mode==='full'?'full':mode==='half'?'half':automation.meta().mode,layouts:highlights.normalize(state.highlightLayouts,half.normalize(state.halftime)),auto:automation.meta(),config:half.normalize(state.halftime),resolved:highlights.resolve(state,half.normalize(state.halftime)),serverTime:Date.now(),serverEpoch,controlEpoch,radar:radar.meta(),replay:{phase:integrations.all().replay.phase},matches:state.matches.map(m=>({id:m.id,round:m.round,stage:m.stage,teamAId:m.teamAId,teamBId:m.teamBId})),teams:state.teams.map(t=>({id:t.id,name:t.name})),selectedMatchId:state.selectedMatchId});
  let replayCache=null,replayCacheAt=0,replayCacheMode="";
  const replayItems=async(mode=automation.meta().mode)=>{
    const module=integrations.all().replay;if(module.phase!=='running')throw Error('请先启动 Replay 并选择半场精选');
    if(replayCache&&replayCacheMode===mode&&Date.now()-replayCacheAt<500)return replayCache;
    const response=await fetch(module.controlUrl+'api/state',{signal:AbortSignal.timeout(2000)});if(!response.ok)throw Error('Replay 未连接');
    const snapshot=await response.json(),s=snapshot.state,c=s.config;
    replayCache=(mode==='full'?(s.full_queue||[]):(s.half_queue||[])).map(id=>(s.artifacts||[]).find(a=>a.id===id)).filter(a=>a&&(s.jobs||[]).some(j=>j.id===a.job_id&&j.match===c.match&&j.map===c.map&&j.epoch===c.epoch)).map(a=>({id:a.id,name:a.name,round:a.round,duration:a.duration}));replayCacheAt=Date.now();replayCacheMode=mode;return replayCache;
  };

  let archiveBusy=false,restorePending=false;
  const downloads=new Map();
  async function pauseModules(){
    const running=Object.entries(integrations.all()).filter(([,m])=>m.phase==='running').map(([id])=>id);
    if(Object.values(integrations.all()).some(m=>m.busy||['starting','stopping','restarting'].includes(m.phase)))throw Error('模块正在启动或停止，请稍后再试');
    const radarRunning=radar.meta().running;automation.close();clearTimeout(entranceReturnTimer);
    try{for(const id of running)await integrations.action(id,'stop');await radar.close();}
    catch(error){for(const id of running)await integrations.action(id,'start').catch(()=>{});if(radarRunning)await radar.start();automation.start();scheduleEntranceReturn();throw error;}
    return async()=>{if(radarRunning)await radar.start();for(const id of running)await integrations.action(id,'start').catch(()=>{});automation.start();scheduleEntranceReturn();};
  }
  const handler = async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.socket.localPort === countdownPort && url.pathname === "/") {
      response.writeHead(302, { Location: "/output/countdown", "Cache-Control": "no-store" });
      return response.end();
    }
    const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
    const origin=request.headers.origin;
    if(origin && origin!==`http://${request.headers.host}`)return json(response,403,{error:"不允许来自其他站点的请求"});
    if(request.method==='OPTIONS'){response.writeHead(204,{Allow:'GET,POST,PUT,PATCH,OPTIONS'});return response.end();}
    if(['POST','PUT','PATCH','DELETE'].includes(request.method)&&request.headers['x-scoredeck-key']!==controlKey)return json(response,401,{error:"需要导播授权，请使用本机复制的远程控制链接。"});
    if((archiveBusy||restorePending)&&['POST','PUT','PATCH','DELETE'].includes(request.method))return json(response,409,{error:restorePending?'完整包已导入，请重启 ScoreDeck 后继续':'正在生成完整包，请稍候'});
    const protectedWrite=['/api/state','/api/archive','/api/archive/export','/api/archive/import','/api/backups/restore','/api/handoff'].includes(url.pathname)&&['POST','PUT','PATCH'].includes(request.method);
    if(protectedWrite&&(request.headers['x-scoredeck-epoch']!==serverEpoch||request.headers['x-scoredeck-control-epoch']!==controlEpoch))return json(response,409,{error:'服务或导播授权已变化，请重新连接；旧操作未执行。',current:state});
    if(url.pathname==='/api/handoff'&&request.method==='POST'){
      if(!local)return json(response,403,{error:'请在主机上完成导播交接。'});
      const nextKey=crypto.randomBytes(24).toString('hex');
      fs.writeFileSync(keyFile+'.tmp',nextKey);fs.renameSync(keyFile+'.tmp',keyFile);
      controlKey=nextKey;controlEpoch=crypto.randomUUID();completedMutations.clear();
      state={...state,controlEpoch,revision:Number(state.revision)+1};
      atomicWrite(stateFile,state);broadcast('state',state);
      return json(response,200,{controlKey,controlEpoch,state:{...state,serverTime:Date.now()},networkUrls:getNetworkUrls(currentPort)});
    }
    if(url.pathname.startsWith('/api/director/')){
      if(!local||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))return json(response,403,{error:'导播控制栏仅限本机'});
      try{
        if(url.pathname==='/api/director/state'&&request.method==='GET')return json(response,200,await director.state());
        if((url.pathname.startsWith('/api/director/clips/')||url.pathname.startsWith('/api/director/replay/media/'))&&['GET','HEAD'].includes(request.method)){
          const replayMedia=url.pathname.startsWith('/api/director/replay/media/');
          const target=replayMedia?director.replayUrl(url.pathname.slice('/api/director/replay/media/'.length)):director.clipUrl(url.pathname.slice('/api/director/'.length));
          const upstream=http.request(target,{method:request.method,headers:request.headers.range?{Range:request.headers.range}:{}},r=>{response.writeHead(r.statusCode,{'Content-Type':replayMedia?'video/mp4':'audio/wav','Cache-Control':'no-store',...Object.fromEntries(['content-length','content-range','accept-ranges'].filter(k=>r.headers[k]).map(k=>[k,r.headers[k]]))});r.pipe(response);});
          upstream.setTimeout(5000,()=>upstream.destroy(Error('音频读取超时')));upstream.on('error',e=>{if(!response.headersSent)json(response,502,{error:e.message});else response.destroy();});response.on('close',()=>upstream.destroy());upstream.end();return;
        }
        if(request.method==='POST'){
          if(request.headers['x-scoredeck-epoch']!==serverEpoch||request.headers['x-scoredeck-control-epoch']!==controlEpoch)return json(response,409,{error:'导播授权已变化，请刷新控制栏'});
          return json(response,200,await director.action(url.pathname.slice('/api/director/'.length),await collectBody(request,4096),()=>{if(request.headers['x-scoredeck-key']!==controlKey||request.headers['x-scoredeck-epoch']!==serverEpoch||request.headers['x-scoredeck-control-epoch']!==controlEpoch||archiveBusy||restorePending)throw Error('导播授权或服务状态已变化，操作未执行');}));
        }
        return json(response,404,{error:'未知导播接口'});
      }catch(error){return json(response,409,{error:error.message});}
    }
    if(url.pathname==='/api/integrations'||url.pathname.startsWith('/api/integrations/')){
      if(!local)return json(response,403,{error:'Replay 和 VoiceBridge 控制台仅在运行 ScoreDeck 的本机使用。'});
      if(url.pathname==='/api/integrations'&&request.method==='GET')return json(response,200,integrations.all());
      const match=/^\/api\/integrations\/(replay|voicebridge)\/(start|stop|restart|settings|import|identity)$/.exec(url.pathname);
      if(!match||request.method!=='POST')return json(response,404,{error:'不存在的模块操作'});
      if(portChanging)return json(response,409,{error:'正在切换 ScoreDeck 端口，请稍后重试'});
      try{return json(response,200,await integrations.action(match[1],match[2],await collectBody(request,4096)));}
      catch(error){return json(response,409,{error:error.message});}
    }
    if (url.pathname === "/api/radar/setup" && request.method === "POST") {
      if (!local) return json(response,403,{error:"请在运行 ScoreDeck 的电脑上配置 CS2 GSI。"});
      const body=await collectBody(request,4096);
      return json(response,200,await setupRadar(body));
    }
    if (url.pathname === "/api/radar" && request.method === "GET") return json(response,200,radar.meta());
    if (url.pathname === "/api/health") return json(response, 200, { ok: true, revision: state.revision });
    if (url.pathname === "/api/meta") return json(response, 200, {...meta(),...(local?{controlKey}:{})});
    if (url.pathname === "/api/state" && request.method === "GET") return json(response, 200, {...state,serverTime:Date.now()});
    const assertWriter=()=>{if(request.headers['x-scoredeck-key']!==controlKey||request.headers['x-scoredeck-epoch']!==serverEpoch||request.headers['x-scoredeck-control-epoch']!==controlEpoch)throw Error('服务或导播授权已变化，旧请求未执行');};
    const persist=(next,reason='auto')=>{
      assertWriter();
      if(!validState(next))throw Error("赛事数据无效：请检查队伍、比赛及其引用。");
      rules.validateSteamIds(next);
      next=migrateState(next);require('./tournament-flow.cjs').enforceSave(state,next,reason);rules.reconcileBracket(next);rules.reconcileSwiss(next,reason==='auto'?state:undefined);
      const externalize=value=>{
        if(!value||typeof value!=='object')return;
        for(const key of Object.keys(value)){
          const item=value[key];
          if(['avatar','logoPrimary','logoSecondary','logoImage'].includes(key)&&typeof item==='string'){
            const match=/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/=\s]+)$/.exec(item);
            if(match){const bytes=Buffer.from(match[2],'base64');if(bytes.length>8*1024*1024)throw Error('单张图片超过 8MB');const name='img-'+crypto.createHash('sha256').update(bytes).digest('hex').slice(0,24)+'.'+(match[1]==='jpeg'?'jpg':match[1]);const dir=path.join(resolvedDataDir,'media');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,name);if(!fs.existsSync(file))fs.writeFileSync(file,bytes);value[key]='/media/'+name;}
          }else externalize(item);
        }
      };
      externalize(next);
      if(reason!=='auto')validateMedia(next);
      if(next.outputCycle?.enabled&&(!state.outputCycle?.enabled||JSON.stringify(next.outputCycle.nodes)!==JSON.stringify(state.outputCycle.nodes)))next.outputCycle.startAt=new Date().toISOString();
      if(next.entrance?.status==='running'&&next.liveScene!=='entrance')next.entrance={...next.entrance,status:'idle',startAt:null};
      next.serverEpoch=serverEpoch;next.controlEpoch=controlEpoch;delete next.serverTime;
      next.revision=Number(state.revision||0)+1;next.lastSavedAt=new Date().toISOString();
      snapshot(reason);atomicWrite(stateFile,next);state=next;broadcast('state',state);scheduleEntranceReturn();return state;
    };
    if(url.pathname==='/api/highlights'&&request.method==='GET')return json(response,200,halftimeSnapshot(url.searchParams.get('mode')));
    if(url.pathname==='/api/highlights'&&request.method==='POST'){
      try{const body=await collectBody(request,150000);assertWriter();const prev=highlights.normalize(state.highlightLayouts,half.normalize(state.halftime));if(body.expectedRevision!==prev.revision)return json(response,409,{error:'画面已被其他操作修改，请重新载入'});const next=highlights.normalize({...body.layouts,revision:prev.revision+1});validateMedia(next);persist({...state,highlightLayouts:next});return json(response,200,halftimeSnapshot(body.mode));}catch(e){return json(response,400,{error:e.message});}
    }
    if(url.pathname==='/api/match-data'&&request.method==='GET')return json(response,200,{...matchData.stats(state),connected:!!latestGSI?.connected&&latestGSI.sourceAgeMs<=10000,players:Object.entries(latestGSI?.allplayers||{}).map(([id,p])=>({id,name:p.name,side:p.team})),templates:matchData.template(matchData.currentMatch(state)?.bestOf,matchData.currentMatch(state)?.bpFirstSide),maps:matchData.MAPS});
    if(url.pathname==='/api/match-bp'&&request.method==='POST'){
      try{const body=await collectBody(request,30000);assertWriter();const next=structuredClone(state),m=next.matches.find(m=>m.id===body.matchId);if(!m)throw Error('比赛不存在');if((body.base?.teamAId!==undefined&&body.base.teamAId!==m.teamAId)||(body.base?.teamBId!==undefined&&body.base.teamBId!==m.teamBId)||body.base?.bestOf!==m.bestOf||JSON.stringify(body.base?.bp)!==JSON.stringify(m.bp||[])||(body.base?.bpFirstSide||'A')!==(m.bpFirstSide||'A'))return json(response,409,{error:'BP 或 BO 已变化，请重新载入'});matchData.applyBP(m,body.steps,body.firstSide??m.bpFirstSide??'A');persist(next);return json(response,200,{ok:true});}catch(e){return json(response,400,{error:e.message});}
    }
    if(url.pathname==='/api/halftime'&&request.method==='GET')return json(response,200,halftimeSnapshot(url.searchParams.get('mode')));
    if(url.pathname==='/api/halftime/replay'&&request.method==='GET'){
      try{return json(response,200,{items:await replayItems(url.searchParams.get('mode')||undefined),serverTime:Date.now()});}catch(e){return json(response,200,{items:[],error:e.message,serverTime:Date.now()});}
    }
    if(url.pathname.startsWith('/api/halftime/replay/media/')&&['GET','HEAD'].includes(request.method)){
      const id=url.pathname.split('/').at(-1);
      if(!/^[a-zA-Z0-9_-]+$/.test(id))return json(response,400,{error:'无效素材'});
      if(!(await replayItems(url.searchParams.get('mode')||undefined)).some(a=>a.id===id))return json(response,404,{error:'素材已离开半场精选'});
      const upstream=http.request(integrations.all().replay.controlUrl+'api/media/'+id,{method:request.method,headers:request.headers.range?{Range:request.headers.range}:{}},r=>{
        const headers={};for(const k of ['content-type','content-length','content-range','accept-ranges','etag'])if(r.headers[k])headers[k]=r.headers[k];
        response.writeHead(r.statusCode,headers);r.pipe(response);
      });
      upstream.setTimeout(15000,()=>upstream.destroy(Error('Replay 媒体超时')));
      upstream.on('error',()=>{if(!response.headersSent)json(response,502,{error:'Replay 媒体不可用'});else response.destroy();});
      response.on('close',()=>upstream.destroy());upstream.end();return;
    }
    if(url.pathname==='/api/halftime/media'&&request.method==='POST'){
      try{assertWriter();const ext={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','video/mp4':'.mp4','video/webm':'.webm'}[String(request.headers['content-type']).split(';')[0]];
        if(!ext)return json(response,415,{error:'支持 PNG / JPG / WebP / MP4 / WebM'});
        const bytes=await collectBuffer(request,ext.startsWith('.mp')||ext==='.webm'?256*1024*1024:8*1024*1024);assertWriter();if(!bytes.length)throw Error('文件为空');
        const name='halftime-'+crypto.createHash('sha256').update(bytes).digest('hex').slice(0,24)+ext,dir=path.join(resolvedDataDir,'media');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),bytes);return json(response,200,{url:'/media/'+name});
      }catch(e){return json(response,400,{error:e.message});}
    }
    if(url.pathname==='/api/halftime/program'&&request.method==='POST'){
      try{const body=await collectBody(request,1024);assertWriter();if(body.expectedRevision!==half.normalize(state.halftime).revision)return json(response,409,{error:'中场状态已变化，请重试'});if(body.action==='show')automation.show(null,body.mode==='full'?'full':'half');else if(body.action==='hide')automation.hide();else throw Error('未知播出操作');return json(response,200,halftimeSnapshot());}catch(e){return json(response,400,{error:e.message});}
    }
    if(url.pathname==='/api/halftime'&&request.method==='POST'){
      try{const body=await collectBody(request,24000);assertWriter();const before=half.normalize(state.halftime);
        if(body.expectedRevision!==before.revision)return json(response,409,{error:'中场设置已变化，请重新载入后保存'});
        let next;
        if(body.action==='settings'){next=half.normalize({...body.settings,clock:before.clock,media:before.media,frozen:before.frozen,revision:before.revision+1});if(before.clock.status==='idle')next.clock.remainingMs=next.durationSeconds*1000;}
        else if(body.action==='capture-score')next={...before,revision:before.revision+1};
        else next=half.action(before,body.action);
        if(body.action==='capture-score'||body.action==='start'&&before.scoreSource==='gsi'&&(before.clock.status==='idle'||half.remaining(before.clock,Date.now())===0)){
          const r=await fetch(radar.meta().controlUrl+'api/state',{signal:AbortSignal.timeout(2000)}),g=await r.json();
          if(!r.ok||!g.connected||g.sourceAgeMs>10000||!g.map?.teamCT||!g.map?.teamT)throw Error('RadarHUD 尚无有效比分，请接入 GSI 或改为手动比分');
          const a=g.map[next.gsiLeft==='CT'?'teamCT':'teamT'],b=g.map[next.gsiLeft==='CT'?'teamT':'teamCT'];
          if(!Number.isFinite(a.score)||!Number.isFinite(b.score))throw Error('GSI 比分不可用');
          next.frozen={a:a.score,b:b.score,map:String(g.map.name).replace(/^de_/,''),at:Date.now()};
        }
        assertWriter();if(before.revision!==half.normalize(state.halftime).revision)return json(response,409,{error:'中场设置已变化，本次操作未执行'});
        validateMedia(next);persist({...state,halftime:next});return json(response,200,halftimeSnapshot());
      }catch(e){return json(response,400,{error:e.message});}
    }
    if(url.pathname==='/api/state'&&request.method==='PATCH'){
      try{
        const body=await collectBody(request);
        if(completedMutations.has(body.mutationId))return json(response,200,state);
        if(!Array.isArray(body.changes)||body.changes.length>10000)return json(response,400,{error:'修改内容无效'});
        const next=structuredClone(state);
        for(const change of body.changes){
          if(!Array.isArray(change.path)||!change.path.length||change.path.length>20||change.path.some(k=>typeof k!=='string'||['__proto__','constructor','prototype'].includes(k))||['revision','lastSavedAt'].includes(change.path[0]))throw Error('不允许的字段');
          if(change.entityId && next[change.path[0]]?.[change.path[1]]?.id!==change.entityId)return json(response,409,{error:'队伍或比赛顺序已变化，请重新编辑',current:state});
          if(change.guards!==undefined){
            if(!Array.isArray(change.guards)||change.guards.length>8)throw Error('不允许的校验条件');
            for(const guard of change.guards){
              if(!Array.isArray(guard.path)||guard.path.some(k=>typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)))throw Error('不允许的校验字段');
              const value=guard.path.reduce((v,k)=>v?.[k],state);
              if(JSON.stringify(value)!==JSON.stringify(guard.value))return json(response,409,{error:'比赛双方、阵容或记录已变化，请重新打开编辑窗口',current:state});
            }
          }
          let target=next;
          for(const part of change.path.slice(0,-1)){if(!target||typeof target!=='object'||!Object.hasOwn(target,part)){return json(response,409,{error:'数据已变化，请重新编辑',current:state});}target=target[part];}
          const name=change.path.at(-1);
          if(!target||typeof target!=='object'||(change.missingBefore?Object.hasOwn(target,name):JSON.stringify(target[name])!==JSON.stringify(change.before)))return json(response,409,{error:'相同字段已被其他修改更新',current:state});
          if(change.remove)delete target[name];else target[name]=change.after;
        }
        const saved=persist(next);
        if(body.mutationId){completedMutations.set(body.mutationId,true);if(completedMutations.size>256)completedMutations.delete(completedMutations.keys().next().value);}
        return json(response,200,{...saved,serverTime:Date.now()});
      }catch(error){return json(response,400,{error:error.message});}
    }
    if(url.pathname==='/api/state'&&request.method==='PUT'){
      try{const next=await collectBody(request,128*1024*1024);
        if(Number(next.expectedRevision)!==Number(state.revision))return json(response,409,{error:'赛事已有新修改，请重新确认导入',current:state});
        delete next.expectedRevision;return json(response,200,persist(next,'replace'));
      }catch(error){return json(response,400,{error:error.message});}
    }
    if(url.pathname==='/api/backups'&&request.method==='GET')return json(response,200,backupList().map(name=>({name,size:fs.statSync(path.join(backupDir,name)).size})));
    if(url.pathname==='/api/backups/restore'&&request.method==='POST'){
      try{const body=await collectBody(request,2048);if(Number(body.expectedRevision)!==Number(state.revision))return json(response,409,{error:'赛事已有新修改，请重新确认恢复'});
        if(!backupList().includes(body.name))throw Error('备份不存在');
        return json(response,200,persist(readJson(path.join(backupDir,body.name),null),'restore'));
      }catch(error){return json(response,400,{error:error.message});}
    }
    if(url.pathname==='/api/archive/export'&&request.method==='POST'){
      let captured,resume;
      try{
        if(request.headers['x-scoredeck-key']!==controlKey)throw Error('需要导播授权');
        archiveBusy=true;resume=await pauseModules();
        captured=await fullPackage.capture(resolvedDataDir);
        const file=path.join(captured.temp,'ScoreDeck-Full.sdpack');
        await fullPackage.writePackage(captured,file);
        const id=crypto.randomBytes(24).toString('hex');downloads.set(id,{file,temp:captured.temp});
        setTimeout(()=>{const item=downloads.get(id);if(item){downloads.delete(id);fs.rmSync(item.temp,{recursive:true,force:true});}},3600000).unref?.();
        captured=null;await resume?.();resume=null;return json(response,200,{url:'/api/archive/download?id='+id,name:'ScoreDeck-Full.sdpack'});
      }catch(error){return json(response,400,{error:error.message});}
      finally{if(captured)fs.rmSync(captured.temp,{recursive:true,force:true});try{await resume?.();}finally{archiveBusy=false;}}
    }
    if(url.pathname==='/api/archive/download'&&request.method==='GET'){
      const item=downloads.get(url.searchParams.get('id'));if(!item)return json(response,404,{error:'下载已过期，请重新导出'});
      response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="ScoreDeck-Full.sdpack"','Content-Length':fs.statSync(item.file).size,'Cache-Control':'no-store'});
      fs.createReadStream(item.file).on('error',()=>response.destroy()).pipe(response);return;
    }
    if(url.pathname==='/api/archive/import'&&request.method==='POST'){
      let temporary,resume;const pending=resolvedDataDir+'.restore-pending';
      try{
        const expected=Number(url.searchParams.get('revision'));if(expected!==Number(state.revision))return json(response,409,{error:'赛事已有新修改，请重新导入'});
        archiveBusy=true;
        temporary=await fs.promises.mkdtemp(path.join(require('node:os').tmpdir(),'scoredeck-import-'));
        const file=path.join(temporary,'input.sdpack');
        await require('node:stream/promises').pipeline(request,fs.createWriteStream(file));
        assertWriter();if(expected!==Number(state.revision))throw Error('赛事已有新修改，请重新导入');
        if(fs.existsSync(pending))fs.rmSync(pending,{recursive:true,force:true});
        await fullPackage.readPackage(file,pending,resolvedDataDir);
        const next=JSON.parse(fs.readFileSync(path.join(pending,'broadcast-state.json'),'utf8'));if(!validState(next))throw Error('完整包赛事数据无效');
        migrateState(next);
        for(const ref of mediaReferences(next))if(!fs.existsSync(path.join(pending,ref.slice(1))))throw Error('完整包缺少素材：'+ref);
        // Runtime authorization remains local; archived module/API settings are restored.
        fs.writeFileSync(path.join(pending,'control-key.txt'),controlKey);
        resume=await pauseModules();
        fs.writeFileSync(pending+'.ready','1');restorePending=true;
        json(response,200,{restartRequired:true,automaticRestart:!!onFullImport});
        if(onFullImport)setTimeout(()=>onFullImport(),500);return;
      }catch(error){if(!restorePending)fs.rmSync(pending,{recursive:true,force:true});return json(response,400,{error:error.message});}
      finally{if(temporary)fs.rmSync(temporary,{recursive:true,force:true});if(!restorePending)await resume?.();archiveBusy=false;}
    }
    if(url.pathname==='/api/archive'&&request.method==='GET'){
      const refs=mediaReferences(state);validateMedia(state);
      const files=[['broadcast-state.json',Buffer.from(JSON.stringify(state,null,2))]];
      const dir=path.join(resolvedDataDir,'media');
      for(const ref of refs)files.push([ref.slice(1),fs.readFileSync(path.join(dir,path.basename(ref)))]);
      if(files.reduce((n,[_,b])=>n+b.length,0)>500*1024*1024)return json(response,413,{error:'赛事素材超过 500MB，请压缩视频后导出。'});
      const bytes=archive.pack(files);response.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="ScoreDeck-Event-2.9.zip"','Content-Length':bytes.length,'Cache-Control':'no-store'});return response.end(bytes);
    }
    if(url.pathname==='/api/archive'&&request.method==='POST'){
      try{const expected=Number(url.searchParams.get('revision'));const bytes=await collectBuffer(request,512*1024*1024);if(expected!==Number(state.revision))return json(response,409,{error:'赛事已有新修改，请重新确认导入'});
        assertWriter();const files=archive.unpack(bytes),next=JSON.parse(files.get('broadcast-state.json').toString());if(!validState(next))throw Error('赛事数据无效');
        // Validate before writing any media and use content-derived names, preserving existing backups' media references.
        migrateState(next);
        const absent=[...mediaReferences(next)].filter(ref=>!files.has(ref.slice(1)));
        if(absent.length)throw Error('归档缺少素材：'+absent.join('、'));

        for(const [name,buffer]of files)if(name.startsWith('media/')){
          const fileName=crypto.createHash('sha256').update(buffer).digest('hex').slice(0,20)+path.extname(name);
          const dir=path.join(resolvedDataDir,'media');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,fileName),buffer);
          const remap=value=>{if(!value||typeof value!=='object')return;for(const k of Object.keys(value)){if(value[k]==='/'+name)value[k]='/media/'+fileName;else remap(value[k]);}};remap(next);
        }
        return json(response,200,persist(next,'import'));
      }catch(error){return json(response,400,{error:error.message});}
    }

    if (url.pathname === "/api/media/background-video" && request.method === "POST") {
      try {
        const contentTypes = { "video/mp4": ".mp4", "video/webm": ".webm", "video/ogg": ".ogv" };
        const contentType = String(request.headers["content-type"] || "").split(";")[0];
        const extension = contentTypes[contentType];
        if (!extension) return json(response, 415, { error: "Only MP4, WebM and OGV videos are supported" });
        const buffer = await collectBuffer(request);
        if (!buffer.length) return json(response, 400, { error: "Video file is empty" });
        const mediaDir = path.join(resolvedDataDir, "media");
        fs.mkdirSync(mediaDir, { recursive: true });
        const fileName = `background-${crypto.createHash("sha256").update(buffer).digest("hex").slice(0,20)}${extension}`;
        const temporary = path.join(mediaDir, `${fileName}.tmp`);
        fs.writeFileSync(temporary, buffer);
        fs.renameSync(temporary, path.join(mediaDir, fileName));
        return json(response, 200, { url: `/media/${fileName}`, size: buffer.length });
      } catch (error) { return json(response, 400, { error: error.message }); }
    }
    if (['/api/port','/api/countdown-port'].includes(url.pathname)&&request.method==='PUT'){
      if(portChanging)return json(response,409,{error:'正在切换端口，请稍后重试'});
      if(integrations.active())return json(response,409,{error:'请先停止 Replay 和 VoiceBridge，再修改 ScoreDeck 端口。'});
      portChanging=true;let replacement;
      try{
        const body=await collectBody(request,1024),requested=Number(body.port),countdown=url.pathname==='/api/countdown-port';
        const oldPort=countdown?countdownPort:currentPort,other=countdown?currentPort:countdownPort;
        if(!Number.isInteger(requested)||requested<1024||requested>65535||requested===other)throw Error('端口必须是不同的 1024–65535 整数');
        if(requested===oldPort)return json(response,200,{port:oldPort});
        if(request.headers['x-scoredeck-key']!==controlKey)throw Error('导播授权已变化');
        replacement=http.createServer((req,res)=>handler(req,res).catch(error=>json(res,500,{error:error.message})));
        await new Promise((resolve,reject)=>{replacement.once('error',reject);replacement.listen(requested,'0.0.0.0',()=>{replacement.removeListener('error',reject);resolve();});});
        if(request.headers['x-scoredeck-key']!==controlKey)throw Error('导播授权已变化');
        const nextSettings={...settings,port:countdown?currentPort:requested,countdownPort:countdown?requested:countdownPort};
        atomicWrite(settingsFile,nextSettings);settings=nextSettings;
        const old=countdown?countdownServer:server;
        if(countdown){countdownServer=replacement;countdownPort=requested;}else{server=replacement;currentPort=requested;}
        replacement.on('error',error=>console.error(error));replacement=null;
        integrations.configure(`http://127.0.0.1:${currentPort}`,[currentPort,countdownPort,radar.meta().hudPort,radar.meta().gsiPort]);
        broadcast('meta',meta());json(response,200,{port:requested});
        for(const client of clients)if(client.sdPort===oldPort){client.end();clients.delete(client);}
        old.close();if(!countdown&&onPortChanged)setTimeout(()=>onPortChanged(currentPort),100);
      }catch(error){replacement?.close();return json(response,error.code==='EADDRINUSE'?409:400,{error:error.code==='EADDRINUSE'?'端口已被占用':error.message});}
      finally{portChanging=false;}
      return;
    }
    if (url.pathname === "/api/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      response.write(`event: state\ndata: ${JSON.stringify({...state,serverTime:Date.now()})}\n\n`);
      response.write(`event: meta\ndata: ${JSON.stringify(meta())}\n\n`);
      response.sdPort=request.socket.localPort;clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }

    if (url.pathname.startsWith("/media/")) {
      const mediaRoot = path.join(resolvedDataDir, "media");
      const mediaPath = path.join(mediaRoot, path.basename(url.pathname));
      if (!mediaPath.startsWith(mediaRoot) || !fs.existsSync(mediaPath) || fs.statSync(mediaPath).isDirectory()) return json(response, 404, { error: "Media not found" });
      return serveFile(request, response, mediaPath, "no-cache");
    }

    const requested = url.pathname === "/" ? "/index.html" : ["/output/halftime","/output/halftime-auto"].includes(url.pathname) ? "/halftime-output.html" : url.pathname === "/highlights" ? "/highlights-editor.html" : url.pathname === "/halftime" ? "/halftime-control.html" : url.pathname;
    const safePath = path.normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
    let filePath = path.join(resolvedWebRoot, safePath);
    if (!filePath.startsWith(resolvedWebRoot)) return json(response, 403, { error: "Forbidden" });
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(resolvedWebRoot, "index.html");
    if (!fs.existsSync(filePath)) return json(response, 503, { error: "Web build not found. Run npm run build first." });
    const extension = path.extname(filePath).toLowerCase();
    const cacheControl = extension === ".html"
      ? "no-store"
      : [".js", ".css", ".cjs"].includes(extension)
        ? "no-cache"
        : "public, max-age=3600";
    return serveFile(request, response, filePath, cacheControl);
  };

  server = http.createServer((request, response) => handler(request, response).catch((error) => json(response, 500, { error: error.message })));
  countdownServer = http.createServer((request, response) => handler(request, response).catch((error) => json(response, 500, { error: error.message })));
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") console.error(`端口 ${currentPort} 已被占用。可设置 SCOREDECK_PORT 后重试。`);
    else console.error(error);
  });
  countdownServer.on("error", (error) => {
    if (error.code === "EADDRINUSE") console.error(`倒计时端口 ${countdownPort} 已被占用。可设置 SCOREDECK_COUNTDOWN_PORT 后重试。`);
    else console.error(error);
  });

  function listenOnAvailable(instance, desiredPort, excludedPort, label) {
    return new Promise((resolve, reject) => {
      let candidate = Number(desiredPort);
      const attempt = () => {
        if (candidate > 65535) return reject(new Error(`${label}没有可用端口`));
        if (candidate === excludedPort) candidate += 1;
        const onListening = () => {
          instance.removeListener("error", onError);
          resolve(candidate);
        };
        const onError = (error) => {
          instance.removeListener("listening", onListening);
          if (error.code === "EADDRINUSE") {
            candidate += 1;
            setTimeout(attempt, 5);
          } else reject(error);
        };
        instance.once("listening", onListening);
        instance.once("error", onError);
        instance.listen(candidate, "0.0.0.0");
      };
      attempt();
    });
  }

  return {
    async listen() {
      currentPort = await listenOnAvailable(server, currentPort, 0, "主服务");
      countdownPort = await listenOnAvailable(countdownServer, countdownPort, currentPort, "倒计时服务");
      if (settings.port !== currentPort || settings.countdownPort !== countdownPort) {
        settings = { ...settings, port: currentPort, countdownPort };
        atomicWrite(settingsFile, settings);
      }
      await radar.start();
      integrations.configure(`http://127.0.0.1:${currentPort}`,[currentPort,countdownPort,radar.meta().hudPort,radar.meta().gsiPort]);
      await integrations.autoStart();
      scheduleEntranceReturn();
      automation.start();
      return meta();
    },
    close() {
      automation.close();
      clearInterval(heartbeat);
      if (entranceReturnTimer) clearTimeout(entranceReturnTimer);
      for (const client of clients) client.end();
      clients.clear();
      return Promise.all([
        integrations.close(),
        radar.close(),
        new Promise((resolve) => server.listening ? server.close(resolve) : resolve()),
        new Promise((resolve) => countdownServer.listening ? countdownServer.close(resolve) : resolve()),
      ]);
    },
    meta,
  };
}

module.exports = { createBroadcastServer };
