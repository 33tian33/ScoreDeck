import {validateScoreDeckTeams,applyScoreDeckTeams} from './lib/scoredeck-teams.mjs';
import {barState} from './lib/director-bar.mjs';
import './lib/env.mjs';
import {ApiSettings} from './lib/api-settings.mjs';
import {loadCs2Hotwords,installCs2Hotwords} from './lib/hotwords.mjs';
import {validateTeamNames,applyTeamNames} from './lib/team-names.mjs';
import { Desktop } from './lib/desktop.mjs';
import { WebSocketServer } from './lib/vendor/ws/wrapper.mjs';
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PcmBridge } from './lib/pcm-bridge.mjs';
import { CaptureStore } from './lib/capture-store.mjs';
import { AsrPipeline } from './lib/asr.mjs';
import { ChannelEngine } from './lib/channel-engine.mjs';
import { readMonoWav, wav, RATE } from './lib/audio.mjs';
import { atomicJson } from './lib/atomic-json.mjs';
import { resolvePublic } from './lib/static.mjs';
const root=fileURLToPath(new URL('.',import.meta.url)),publicDir=join(root,'public');
const dataRoot=process.env.VB_DATA_DIR||root;await mkdir(dataRoot,{recursive:true});
const apiSettings=new ApiSettings(join(dataRoot,'api-settings.json'));await apiSettings.load();
const cs2Hotwords=await loadCs2Hotwords(join(root,'data/cs2-hotwords-v1.json'));
let hotwordBusy=false;
const number=(key,def,min,max)=>{const n=Number(process.env[key]||def);if(!Number.isFinite(n)||n<min||n>max)throw new Error(`无效配置 ${key}`);return n;};
const port=number('PORT',8787,0,65535),host=process.env.HOST||'127.0.0.1';
if(!['127.0.0.1','localhost'].includes(host))throw new Error('0.4 仅允许本机监听；请使用本机 OBS 浏览器源');
const demo=JSON.parse(await readFile(join(root,'data/demo-channels.json'),'utf8'));
let desktopConfig=null;try{desktopConfig=JSON.parse(await readFile(join(dataRoot,'desktop-settings.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const runtime=desktopConfig?.path||process.env.RUNTIME_DIR||join(dataRoot,'runtime');await mkdir(runtime,{recursive:true});
let scoredeckIdentity={managed:false};try{scoredeckIdentity=validateScoreDeckTeams(JSON.parse(await readFile(join(dataRoot,'scoredeck-teams.json'),'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
let teamNames={};try{teamNames=validateTeamNames(JSON.parse(await readFile(join(dataRoot,'team-names.json'),'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
const captureGB=desktopConfig?.maxGB??number('MAX_CAPTURE_GB',8,.1,1000);
const desktop=new Desktop(root,runtime,captureGB,dataRoot);
let operator={outputId:'',keepMuted:false,directorDelaySeconds:0};try{operator={...operator,...JSON.parse(await readFile(join(runtime,'operator.json'),'utf8'))};}catch(e){if(e.code!=='ENOENT')throw e;}
if(!Number.isFinite(operator.directorDelaySeconds)||operator.directorDelaySeconds<0||operator.directorDelaySeconds>86400)operator.directorDelaySeconds=0;
const saveOperator=()=>atomicJson(join(runtime,'operator.json'),operator);
let volumeState={checkedAt:0,message:'尚未读取'},volumeBusy=false;
async function checkVolume(action='status'){if(volumeBusy)throw new Error('音量检查正在进行');volumeBusy=true;try{const v=await desktop.volume(action);volumeState={...v,checkedAt:Date.now(),message:''};return v;}catch(e){volumeState={checkedAt:Date.now(),message:e.message};throw e;}finally{volumeBusy=false;changed();}}
const monitors=new Set(),segmentEdits=new Set();
const clients=new Set(),overlayClients=new Map();let playback=null,lastPlayback=null,store,asr,channels,engines,mode='live',switching=false,closing=false,dirty=true;
const asrProvider=process.env.ASR_PROVIDER||'aliyun';
if(!['aliyun','openai'].includes(asrProvider))throw new Error('ASR_PROVIDER 必须为 aliyun 或 openai');
const asrOptions={provider:asrProvider,apiKey:(asrProvider==='aliyun'?process.env.DASHSCOPE_API_KEY:process.env.OPENAI_API_KEY)||'',wsUrl:process.env.ASR_WS_URL||undefined,workspaceId:process.env.DASHSCOPE_WORKSPACE_ID||'',baseUrl:process.env.ASR_BASE_URL||'https://api.openai.com/v1',model:process.env.ASR_MODEL||(asrProvider==='aliyun'?'paraformer-realtime-v2':'whisper-1'),language:process.env.ASR_LANGUAGE||'zh',timeoutMs:number('ASR_TIMEOUT_MS',30000,1000,120000),concurrency:number('ASR_CONCURRENCY',4,1,16),streaming:process.env.ASR_STREAMING!=='false',streamConcurrency:number('ASR_STREAM_CONCURRENCY',10,1,16),vocabularyId:process.env.ASR_VOCABULARY_ID||'',chunkSeconds:number('ASR_CHUNK_SECONDS',4,1,20),threshold:number('VAD_THRESHOLD',0.008,0.00001,1),minSpeechMs:number('VAD_MIN_SPEECH_MS',120,40,500),preRollMs:number('VAD_PRE_ROLL_MS',200,0,500),silenceMs:number('VAD_SILENCE_MS',600,200,1500),postRollMs:number('VAD_POST_ROLL_MS',100,0,200)};
const bridge=new PcmBridge({port:number('PCM_BRIDGE_PORT',8790,0,65535)});
function event(type,payload){const msg=`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;for(const res of clients){if(res.writableLength>2*1024*1024){res.destroy();clients.delete(res);}else res.write(msg);}}
function snapshot(){const b=bridge.status();return {version:'0.6.4-sd',sessionId:store.sessionId,mode,scoredeckManaged:scoredeckIdentity.managed,channels:channels.map(c=>({...c,connectionStatus:mode==='demo'?'demo':b.bindings.some(x=>x.active&&x.channelId===c.id)?'listening':'waiting'})),playback,lastPlayback,bridge:{...b,archive:store.status().tracks},capture:store.status(),asr:asr.status(),obs:{clients:[...overlayClients].filter(([,v])=>Date.now()-v.at<6000).map(([id])=>id),outputs:[...overlayClients].filter(([,v])=>Date.now()-v.at<6000).map(([clientId,v])=>({clientId,...v})),selected:operator.outputId},audioControl:{keepMuted:operator.keepMuted,...volumeState},config:{directorDelaySeconds:operator.directorDelaySeconds,deepSeekEnabled:process.env.DEEPSEEK_ENABLED!=='false'&&!!process.env.DEEPSEEK_API_KEY,model:process.env.DEEPSEEK_MODEL||'deepseek-flash',channelLimit:2}};}
function changed(){dirty=true;}
let playbackTimer=null;
function cancelPlaybackTimer(){clearTimeout(playbackTimer);playbackTimer=null;}
function dispatchPlayback(p){
  if(playback!==p||closing||switching)return;
  const remaining=p.scheduledAt-Date.now();
  if(remaining>0){playbackTimer=setTimeout(()=>dispatchPlayback(p),Math.min(remaining,2147483647));return;}
  const connected=[...overlayClients].filter(([,v])=>Date.now()-v.at<6000&&v.outputId===operator.outputId);
  if(connected.length!==1||connected[0][0]!==p.targetClientId){lastPlayback={...p,status:'error',error:'等待结束时原绑定 OBS 输出离线、重名或已重新连接，请重新推送'};playback=null;event('stop',{});changed();return;}
  p.status='loading';p.issuedAt=Date.now();event('playback',p);changed();
}

async function persist(){const current=store;await atomicJson(join(current.root,'state.json'),{sessionId:current.sessionId,mode,channels});await current.saveManifest();}
async function makeSession(nextMode='live',resumeId=null){
  if(segmentEdits.size)throw new Error('片段正在保存，请稍后切换会话');if(switching)throw new Error('正在切换会话');switching=true;
  try {
    if(store){for(const e of engines.values())e.close();await asr.close();await Promise.allSettled([...engines.values()].map(e=>e.queue));await persist();await store.close();}
    cancelPlaybackTimer();mode=nextMode;playback=null;event('stop',{});store=new CaptureStore(join(runtime,'sessions'),{...(resumeId?{sessionId:resumeId}:{}),maxBytes:captureGB*1024**3});await store.init({resume:!!resumeId});
    const sessionStore=store,sessionMode=mode;
    channels=demo.channels.map(c=>({id:c.id,name:c.name,shortName:c.shortName,color:c.color,utterances:[],segments:[],analysis:{source:'empty',warning:null,latencyMs:0}}));
    if(resumeId){try{const saved=JSON.parse(await readFile(join(store.root,'state.json'),'utf8'));if(saved.sessionId===resumeId)channels=saved.channels;}catch(e){if(e.code!=='ENOENT')throw e;}}
    applyTeamNames(channels,teamNames);applyScoreDeckTeams(channels,scoredeckIdentity);
    engines=new Map(channels.map(c=>[c.id,new ChannelEngine(c,async segment=>{
      const startMs=segment.trimStartMs??Math.max(0,segment.startMs-1000),endMs=segment.trimEndMs??(segment.endMs+800);let bytes;
      if(sessionMode==='demo'){const def=demo.channels.find(d=>d.id===c.id);const pcm=await readMonoWav(join(publicDir,def.audioUrl.split('/').at(-1)));bytes=wav(pcm.subarray(Math.floor(startMs*RATE/1000)*2,Math.min(pcm.length,Math.ceil(endMs*RATE/1000)*2)));}
      else {if(segment.endMs>sessionStore.latestMs+1000)throw new Error('片段超出已采集音频范围');bytes=await sessionStore.mix(c.id,startMs,endMs);}
      const dir=join(sessionStore.root,'clips');await mkdir(dir,{recursive:true});const filename=`${randomUUID()}.wav`;await writeFile(join(dir,filename),bytes);
      return {audioUrl:`/clips/${sessionStore.sessionId}/${filename}`,audioDurationMs:(bytes.length-44)/2/RATE*1000,clipStartMs:startMs};
    },{apiKey:process.env.DEEPSEEK_ENABLED==='false'?'':process.env.DEEPSEEK_API_KEY||'',model:process.env.DEEPSEEK_MODEL||'deepseek-flash',timeoutMs:number('DEEPSEEK_TIMEOUT_MS',3500,200,30000),onChange:changed,commitBefore:()=>sessionMode==='demo'?Infinity:asr.watermark(c.id)})]));
    asr=new AsrPipeline(store,async items=>{if(store!==sessionStore)return;await accept(items);},{...asrOptions,onChange:changed});await atomicJson(join(runtime,'current.json'),{sessionId:store.sessionId,mode});changed();
  }finally{switching=false;}
}
function validate(item){if(!item||!engines.has(item.channelId))throw new Error('未知频道');if(item.sessionId!==store.sessionId)throw new Error('sessionId 不匹配，请先读取 /api/state');
  for(const key of ['id','speakerId','speakerName','text'])if(typeof item[key]!=='string'||!item[key].trim()||item[key].length>2000)throw new Error(`无效 ${key}`);
  if(!Number.isFinite(item.startMs)||!Number.isFinite(item.endMs)||item.startMs<0||item.endMs<=item.startMs||item.endMs-item.startMs>120000)throw new Error('无效时间码');
  return {...item,stable:item.stable!==false,revision:Number.isSafeInteger(item.revision)?item.revision:0,text:item.text.slice(0,1000),startMs:Math.round(item.startMs),endMs:Math.round(item.endMs)};
}
async function accept(items){const valid=items.map(validate);for(const c of channels){const incoming=valid.filter(i=>i.channelId===c.id);if(c.utterances.length+incoming.length>20000)throw new Error('会话话语达到上限，请新建会话');}
  await Promise.all(channels.map(c=>{const own=valid.filter(i=>i.channelId===c.id);return own.length?engines.get(c.id).add(own):null;}));changed();}
let previous=null;try{previous=JSON.parse(await readFile(join(runtime,'current.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(previous && !/^[a-f0-9-]{36}$/.test(previous.sessionId))throw new Error('invalid_saved_session');
await makeSession(previous?.mode||operator.archiveMode||'live',previous?.sessionId||null);
await asr.recover();
bridge.on('audio',(frame,speaker)=>{if(switching||closing||mode!=='live'||!engines.has(frame.channelId))return;
  const binding=bridge.status().bindings.find(b=>b.sourceId===frame.sourceId&&b.connectionHandlerId===String(frame.connectionHandlerId));
  if(!binding?.active||binding.channelId!==frame.channelId)return;
  if(bridge.status().bindings.filter(b=>b.active&&b.channelId===frame.channelId).length>1){channels.find(c=>c.id===frame.channelId).analysis.warning='同一频道绑定多个连接，已暂停采集；请解除重复绑定';changed();return;}
  const captured=store.ingest(frame,speaker);asr.ingest(captured);
  if(captured)for(const ws of monitors)if(ws.readyState===1&&ws.selection?.channelId===captured.channelId&&(!ws.selection.speakerId||ws.selection.speakerId===captured.speakerId)){
    if(ws.bufferedAmount>1024*1024){ws.close(1013,'monitor_backpressure');continue;}
    ws.send(JSON.stringify({start:captured.startSample/48000,speakerId:captured.speakerId,pcm:captured.pcm.toString('base64')}));
  }
  changed();});
bridge.on('control',changed);bridge.on('bridge-error',changed);await bridge.start();
const muteTimer=setInterval(()=>{if(process.platform==='win32'&&!volumeBusy&&!closing)checkVolume(operator.keepMuted?'mute':'status').catch(()=>{});},3000);muteTimer.unref();
const tick=setInterval(()=>{
  for(const [id,v] of overlayClients)if(Date.now()-v.at>10000)overlayClients.delete(id);
  if(playback&&playback.status!=='scheduled'&&Date.now()-playback.issuedAt>(playback.status==='loading'?12000:playback.audioDurationMs+15000)){lastPlayback={...playback,status:'error',error:'OBS 播放回执超时'};playback=null;event('stop',{});changed();}
  if(!switching)for(const e of engines.values())if(e.lastInputAt&&Date.now()-e.lastInputAt>1800&&!asr.hasPending(e.channel.id)&&e.channel.segments.some(s=>s.status==='open')){e.lastInputAt=0;e.analyze(true).catch(error=>{e.channel.analysis.warning=error.message;changed();});}
  if(dirty&&!switching){dirty=false;event('state',snapshot());}else for(const res of clients)res.write(': heartbeat\n\n');
},500);tick.unref();
let persisting=false;const saver=setInterval(async()=>{if(persisting||switching)return;persisting=true;try{await persist();}catch(e){console.error('保存失败:',e.message);}finally{persisting=false;}},10000);saver.unref();
function json(res,status,data){const b=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(b);}
async function body(req){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>4*1024*1024)throw new Error('请求体过大');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
async function sendFile(req,res,path){const b=await readFile(path);const headers={'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wav':'audio/wav'}[extname(path)]||'application/octet-stream','Cache-Control':'no-cache','Accept-Ranges':'bytes'};
  const range=req.headers.range;if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);let start=m&&m[1]?Number(m[1]):0,end=m&&m[2]?Number(m[2]):b.length-1;if(m&&!m[1]&&m[2]){start=Math.max(0,b.length-Number(m[2]));end=b.length-1;}
    if(!m||start>=b.length||end<start){res.writeHead(416,{'Content-Range':`bytes */${b.length}`});res.end();return;}end=Math.min(end,b.length-1);res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${b.length}`,'Content-Length':end-start+1});res.end(req.method==='HEAD'?undefined:b.subarray(start,end+1));return;}
  res.writeHead(200,{...headers,'Content-Length':b.length});res.end(req.method==='HEAD'?undefined:b);
}
const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  // Refuse browser requests from unrelated origins, including DNS rebinding hosts.
  const requestHost=(req.headers.host||'').split(':')[0];if(!['127.0.0.1','localhost'].includes(requestHost))return json(res,403,{error:'host_not_allowed'});
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'origin_not_allowed'});
  if(url.pathname==='/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;}
  if(req.method==='GET'&&url.pathname==='/api/director-bar/state')return json(res,200,barState(snapshot(),null,store.wallOrigin));
  if(req.method==='GET'&&url.pathname==='/healthz')return json(res,200,{ok:!closing,instance:process.env.SD_INSTANCE||'',version:'0.6.4-sd',pcmBridge:bridge.status(),asr:asr.status()});
  if(req.method==='GET'&&url.pathname==='/api/settings/api'){res.setHeader('Cache-Control','no-store');return json(res,200,{...apiSettings.public(),canRestart:process.env.VB_SUPERVISED==='1'});}
  if(req.method==='GET'&&url.pathname==='/api/settings/hotwords')return json(res,200,{version:cs2Hotwords.version,mapPool:cs2Hotwords.mapPool,groups:cs2Hotwords.groups,count:cs2Hotwords.count});
  if(req.method==='GET'&&url.pathname==='/api/desktop/settings')return json(res,200,{...await desktop.settings(),canRestart:process.env.VB_SUPERVISED==='1'});
  if(req.method==='GET'&&url.pathname==='/api/desktop/connections')return json(res,200,await desktop.inventory());
  if(req.method==='GET'&&url.pathname==='/api/desktop/audio')return json(res,200,{keepMuted:operator.keepMuted,...volumeState});
  if(req.method==='GET'&&url.pathname==='/scoredeck/config')return json(res,200,{origin:process.env.SD_ORIGIN||''});
  if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,snapshot());
  if(req.method==='GET'&&url.pathname==='/api/bridge/status')return json(res,200,snapshot().bridge);
  if(req.method==='GET'&&url.pathname==='/api/demo')return json(res,200,demo);
  if(req.method==='POST'){
    const b=await body(req);
    if(switching)return json(res,409,{error:'session_switching'});
    if(url.pathname==='/api/settings/director'){
      const value=b.directorDelaySeconds;
      if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>86400)throw new Error('导播端延迟须为 0 至 86400 秒');
      const next={...operator,directorDelaySeconds:value};await atomicJson(join(runtime,'operator.json'),next);operator.directorDelaySeconds=value;changed();return json(res,200,{directorDelaySeconds:value});
    }
    if(url.pathname==='/api/settings/api'){res.setHeader('Cache-Control','no-store');return json(res,200,await apiSettings.save(b));}
    if(url.pathname==='/api/settings/hotwords/cs2'){
      if(hotwordBusy)return json(res,409,{error:'热词表正在创建，请稍后'});
      hotwordBusy=true;
      try{res.setHeader('Cache-Control','no-store');return json(res,200,await installCs2Hotwords({preset:cs2Hotwords,settings:apiSettings,statePath:join(dataRoot,'hotwords-preset.json')}));}
      finally{hotwordBusy=false;}
    }
    if(url.pathname==='/api/scoredeck/teams'){
      if(!process.env.SD_INSTANCE||req.headers['x-scoredeck-instance']!==process.env.SD_INSTANCE)return json(res,403,{error:'ScoreDeck 同步授权无效'});
      const next=validateScoreDeckTeams(b);await atomicJson(join(dataRoot,'scoredeck-teams.json'),next);scoredeckIdentity=next;applyScoreDeckTeams(channels,next);await persist();changed();return json(res,200,{ok:true});
    }
    if(url.pathname==='/api/desktop/teams'){
      if(scoredeckIdentity.managed)return json(res,409,{error:'队名与队标由 ScoreDeck 当前主赛管理，请使用外部设置按钮修改映射或关闭跟随'});
      const names=validateTeamNames(b);await atomicJson(join(dataRoot,'team-names.json'),names);teamNames=names;applyTeamNames(channels,names);
      if(playback)playback.channelName=names[playback.channelId]||playback.channelName;
      await persist();changed();return json(res,200,{ok:true,names});
    }
    if(url.pathname==='/api/desktop/settings')return json(res,200,await desktop.save(b));
    if(url.pathname==='/api/desktop/install')return json(res,200,await desktop.install(b));
    if(url.pathname==='/api/desktop/bind')return json(res,200,await desktop.command(b));
    if(url.pathname==='/api/desktop/volume'){if(b.action==='unmute'){operator.keepMuted=false;await saveOperator();}return json(res,200,await checkVolume(b.action));}
    if(url.pathname==='/api/desktop/keep-muted'){desktop.requireWindows();if(typeof b.enabled!=='boolean')throw new Error('无效设置');operator.keepMuted=b.enabled;await saveOperator();if(b.enabled&&!volumeBusy)await checkVolume('mute').catch(()=>{});changed();return json(res,200,{keepMuted:operator.keepMuted,...volumeState});}
    if(url.pathname==='/api/desktop/restart'){
      if(process.env.VB_SUPERVISED!=='1')throw new Error('当前非便携启动模式，请关闭程序后重新启动');
      json(res,200,{ok:true});setTimeout(()=>shutdown().then(()=>process.exit(75)).catch(e=>{console.error(e);process.exit(1);}),200);return;
    }
    if(url.pathname==='/api/reset'){await makeSession(b.mode==='demo'?'demo':'live');return json(res,200,{ok:true,sessionId:store.sessionId});}
    if(url.pathname==='/api/utterances'){await accept(b.utterances||[b]);return json(res,202,{ok:true});}
    if(url.pathname==='/api/asr/retry'){await asr.retry();return json(res,200,{ok:true});}
    if(url.pathname==='/api/finalize'){
      await asr.flush();const targets=b.channelId?[engines.get(b.channelId)]:[...engines.values()];if(targets.some(e=>!e))throw new Error('未知频道');
      if(targets.some(e=>asr.hasPending(e.channel.id)))return json(res,409,{error:'识别仍有待处理任务，请等待或重试失败任务后提交'});
      await Promise.all(targets.map(async e=>{await e.analyze(true);await e.retryClips();}));changed();return json(res,200,{ok:true});}
    if(url.pathname==='/api/obs/heartbeat'){if(typeof b.clientId!=='string'||b.clientId.length>100)throw new Error('无效客户端');const outputId=String(b.outputId||'program');if(!/^[a-zA-Z0-9_-]{1,40}$/.test(outputId))throw new Error('无效输出名称');if(!overlayClients.has(b.clientId)&&overlayClients.size>=32)throw new Error('输出连接过多');overlayClients.set(b.clientId,{at:Date.now(),outputId});changed();return json(res,200,{ok:true});}
    if(url.pathname==='/api/obs/bind'){if(playback)throw new Error('请先停止播出再切换输出');if(typeof b.outputId!=='string'||!(/^[a-zA-Z0-9_-]{1,40}$/.test(b.outputId)))throw new Error('无效输出名称');const matches=[...overlayClients.values()].filter(v=>v.outputId===b.outputId&&Date.now()-v.at<6000);if(matches.length!==1)throw new Error('该输出离线或存在重复连接，请为每个输出设置不同名称');operator.outputId=b.outputId;await saveOperator();changed();return json(res,200,{ok:true});}
    if(url.pathname==='/api/segment/update'){
      const c=channels.find(c=>c.id===b.channelId),s=c?.segments.find(s=>s.id===b.segmentId);if(!s||s.status!=='committed')throw new Error('请选择已完成片段');if(playback?.segmentId===s.id)throw new Error('请先停止该片段播出');if(segmentEdits.has(s.id))throw new Error('该片段正在保存');
      segmentEdits.add(s.id);try{const patch={};
        if(b.reviewState!==undefined){if(!['pending','favorite','ignored','played'].includes(b.reviewState))throw new Error('无效片段状态');patch.reviewState=b.reviewState;}
        if(b.category!==undefined){if(!['encouragement','opponent_taunt','morale','conflict'].includes(b.category))throw new Error('无效分类');patch.category=b.category;patch.reviewRequired=false;patch.humanReviewed=true;}
        if(b.title!==undefined){if(typeof b.title!=='string'||!b.title.trim()||b.title.length>80)throw new Error('标题须为1至80字');patch.title=b.title.trim();}
        if(b.trimStartMs!==undefined||b.trimEndMs!==undefined){const start=b.trimStartMs,end=b.trimEndMs;if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end-start>120000)throw new Error('修剪范围须为0至120秒且结束晚于开始');
          let maximum=store.latestMs;if(mode==='demo'){const def=demo.channels.find(d=>d.id===c.id);maximum=(await readMonoWav(join(publicDir,def.audioUrl.split('/').at(-1)))).length/2/RATE*1000;}
          if(end>maximum)throw new Error('结束时间超出已录音范围');patch.trimStartMs=start;patch.trimEndMs=end;Object.assign(patch,await engines.get(c.id).makeClip({...s,...patch}),{audioReady:true});
        }
        Object.assign(s,patch);await persist();changed();return json(res,200,{ok:true,segment:s});
      }finally{segmentEdits.delete(s.id);}
    }
    if(url.pathname==='/api/obs/ack'){
      if(playback?.id===b.playbackId&&playback.status!=='scheduled'&&playback.targetClientId===b.clientId){
        if(b.status==='started'&&playback.status==='loading'){playback.status='playing';playback.startedAt=Date.now();const s=channels.find(c=>c.id===playback.channelId)?.segments.find(s=>s.id===playback.segmentId);if(s){s.playedAt=Date.now();s.playCount=(s.playCount||0)+1;if(s.reviewState!=='favorite')s.reviewState='played';await persist();}}
        if(['ended','error'].includes(b.status)){lastPlayback={...playback,status:b.status,error:String(b.error||'').slice(0,200)};playback=null;}
        changed();
      }return json(res,200,{ok:true});}
    if(url.pathname==='/api/play'){
      const c=channels.find(c=>c.id===b.channelId),s=c?.segments.find(s=>s.id===b.segmentId);if(!s||!s.eligible||s.status!=='committed'||!s.audioReady)return json(res,409,{error:'片段尚未就绪'});
      if(playback)return json(res,409,{error:'已有片段播出中，请先停止播出'});if(segmentEdits.has(s.id))return json(res,409,{error:'片段正在保存'});if(s.reviewState==='ignored')return json(res,409,{error:'该片段已忽略，请先恢复待播'});const connected=[...overlayClients].filter(([,v])=>Date.now()-v.at<6000&&v.outputId===operator.outputId);if(!operator.outputId||connected.length!==1)return json(res,409,{error:'请绑定唯一在线的OBS输出；输出离线或重名时不会自动切换'});
      const utterances=s.utteranceIds.map(id=>c.utterances.find(u=>u.id===id)).filter(Boolean);
      const requestedAt=Date.now(),delaySeconds=operator.directorDelaySeconds,sourceStartedAt=store.wallOrigin+(s.trimStartMs??s.startMs),scheduledAt=delaySeconds===0?requestedAt:Math.max(requestedAt,sourceStartedAt+delaySeconds*1000);
      playback={requestedAt,delaySeconds,sourceStartedAt,scheduledAt,id:randomUUID(),targetClientId:connected[0][0],channelId:c.id,channelName:c.name,channelLogo:c.logo||'',channelColor:c.color,title:s.title,summary:s.summary,category:s.category,segmentId:s.id,audioUrl:s.audioUrl,audioDurationMs:s.audioDurationMs,startMs:0,endMs:s.audioDurationMs,issuedAt:null,status:'scheduled',transcript:utterances.map(u=>`${u.speakerName}：${u.text}`),cues:utterances.map(u=>({text:`${u.speakerName}：${u.text}`,startMs:Math.max(0,u.startMs-s.clipStartMs),endMs:u.endMs-s.clipStartMs}))};dispatchPlayback(playback);changed();return json(res,200,playback);}
    if(url.pathname==='/api/stop'){cancelPlaybackTimer();playback=null;event('stop',{});changed();return json(res,200,{ok:true});}
    return json(res,404,{error:'not_found'});
  }
  if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'method_not_allowed'});
  if(url.pathname.startsWith('/clips/')){const m=/^\/clips\/([a-f0-9-]{36})\/([a-f0-9-]{36}\.wav)$/.exec(url.pathname);if(!m)return json(res,404,{error:'not_found'});return await sendFile(req,res,join(runtime,'sessions',m[1],'clips',m[2]));}
  const requested=url.pathname==='/'?'index.html':url.pathname==='/overlay'?'overlay.html':decodeURIComponent(url.pathname.slice(1));const path=resolvePublic(publicDir,requested);if(!path)return json(res,403,{error:'forbidden'});await sendFile(req,res,path);
}catch(e){if(!res.headersSent)json(res,e.code==='ENOENT'?404:400,{error:e.message});else res.end();}});
const monitorServer=new WebSocketServer({noServer:true,maxPayload:2048});
server.on('upgrade',(req,socket,head)=>{
 const h=(req.headers.host||'').split(':')[0];
 if(req.url!=='/monitor'||!['127.0.0.1','localhost'].includes(h)||req.headers.origin!==`http://${req.headers.host}`){socket.destroy();return;}
 monitorServer.handleUpgrade(req,socket,head,ws=>{
   monitors.add(ws);ws.on('close',()=>monitors.delete(ws));ws.on('error',()=>monitors.delete(ws));
   ws.on('message',raw=>{try{const v=JSON.parse(raw);if(!engines.has(v.channelId)||typeof(v.speakerId||'')!=='string')throw new Error('bad selection');ws.selection={channelId:v.channelId,speakerId:v.speakerId||''};}catch{ws.close(1008);}});
 });
});
server.listen(port,host,()=>console.log(`VoiceBridge 0.6.4-SD http://${host}:${server.address().port} | UDP ${bridge.port} | ASR ${asrOptions.apiKey?'enabled':'needs key'}`));
async function shutdown(){if(closing)return;closing=true;cancelPlaybackTimer();clearInterval(tick);clearInterval(saver);clearInterval(muteTimer);for(const ws of monitors)ws.close();monitorServer.close();bridge.close();for(const c of clients)c.end();server.close();await asr.close();for(const e of engines.values())e.close();await Promise.allSettled([...engines.values()].map(e=>e.queue));await persist();await store.close();}
process.on('message',m=>{if(m?.type==='scoredeck-stop')shutdown().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});});
if(process.env.VB_SUPERVISED==='1'&&process.connected)process.once('disconnect',()=>shutdown().then(()=>process.exit(0)).catch(()=>process.exit(1)));
process.once('SIGINT',()=>shutdown().catch(console.error));process.once('SIGTERM',()=>shutdown().catch(console.error));
