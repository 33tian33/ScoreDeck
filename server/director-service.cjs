'use strict';
// Allowlisted same-machine bridge. Camera commands and audio scheduling stay with their owning services.
function createDirectorService({radar,integrations,onWindow}){
 async function upstream(base,path,body,headers={},timeoutMs=5000){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(timeoutMs)});const data=await r.json();if(!r.ok)throw Error(data.error||'模块请求失败');return data;}
 async function tracker(action,body,guard=()=>{}){const base=radar.meta().controlUrl;const status=await upstream(base,'api/tracker');if(action){guard();return upstream(base,'api/tracker/'+action,body,{'X-Tracker-Key':status.key});}delete status.key;return status;}
 const voice=()=>{const v=integrations.all().voicebridge;if(v.phase!=='running')throw Error('请先启动 VoiceBridge');return v;};
 // Voice polling is single-flight and never blocks camera status or its lease heartbeat.
 let voiceCache=null,voiceAt=0,voiceError='',voiceFlight=null,voiceBase='',voiceGeneration=0;
 function refreshVoice(){
  let base;try{base=voice().controlUrl;}catch(e){voiceGeneration++;voiceBase='';voiceCache=null;voiceAt=0;voiceError=e.message;return;}
  if(base!==voiceBase){voiceGeneration++;voiceBase=base;voiceCache=null;voiceAt=0;voiceError='';}
  if(voiceFlight)return;
  const generation=voiceGeneration;
  voiceFlight=upstream(base,'api/director-bar/state',undefined,{},1200).then(data=>{
   if(generation===voiceGeneration){voiceCache=data;voiceAt=Date.now();voiceError='';}
  },e=>{if(generation===voiceGeneration)voiceError=e.name==='TimeoutError'?'VoiceBridge 响应超时；镜头状态独立刷新':e.message;}).finally(()=>{voiceFlight=null;});
 }
 const replay=()=>{const r=integrations.all().replay;if(r?.phase!=='running')throw Error('请先启动 Replay');return r;};
 let replayCache=null,replayAt=0,replayError='',replayFlight=null,replayKey='';
 function refreshReplay(){
  let module;try{module=replay();}catch(e){replayKey='';replayCache=null;replayAt=0;replayError=e.message;return;}
  const key=module.controlUrl+':'+module.generation;
  if(key!==replayKey){replayKey=key;replayCache=null;replayAt=0;replayError='';}
  if(replayFlight)return;
  replayFlight=upstream(module.controlUrl,'api/output/director',undefined,{},1200).then(data=>{
   if(key===replayKey){replayCache=data;replayAt=Date.now();replayError='';}
  },e=>{if(key===replayKey)replayError=e.name==='TimeoutError'?'Replay 状态更新超时':e.message;}).finally(()=>{replayFlight=null;});
 }
 return {async state(){refreshVoice();refreshReplay();let t;try{t=await tracker();}catch(e){t={error:e.message,counts:{}};}
  const voiceStale=!voiceCache||Date.now()-voiceAt>1500;
  return {tracker:t,voice:voiceStale?null:voiceCache,voiceStale,voiceError:voiceError||(voiceStale?'VoiceBridge 状态更新中':''),replay:Date.now()-replayAt>1500?null:replayCache,replayError,serverNow:Date.now()};},
 async action(name,body,guard=()=>{}){guard();if(name.startsWith('tracker/')){const action=name.slice(8);if(!['config','connect','disconnect','start','stop','cancel-return','heartbeat','toggle','refresh-controls','camera'].includes(action))throw Error('未知追踪操作');const result=await tracker(action,body,guard);delete result.key;return result;}
 if(name==='voice/start')return integrations.action('voicebridge','start');
 if(name==='replay/play'){
  if(!body||typeof body.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(body.id)||![.25,.5,1].includes(body.rate))throw Error('无效的 Replay 片段或倍率');
  return upstream(replay().controlUrl,'api/output/clip',{id:body.id,rate:body.rate});
 }
 if(['voice/play','voice/stop'].includes(name))return upstream(voice().controlUrl,name==='voice/play'?'api/play':'api/stop',body);
 if(name==='window'){if(!['open','close','screen','settings','dashboard','compact'].includes(body.action))throw Error('未知窗口操作');if(!onWindow)throw Error('悬浮窗口需在 ScoreDeck Windows 客户端打开；浏览器可直接打开控制栏页面');await onWindow(body.action);return {ok:true};}
 throw Error('未知导播操作');},
 replayUrl(id){if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw Error('无效 Replay 地址');return replay().controlUrl+'api/media/'+encodeURIComponent(id);},
 clipUrl(path){if(!/^clips\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.wav$/.test(path))throw Error('无效音频地址');return voice().controlUrl+path;}};
}
module.exports={createDirectorService};
