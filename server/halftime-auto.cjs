const fs=require('node:fs'),crypto=require('node:crypto'),half=require('./halftime.cjs');
function createAutomation({file,getState,commit,readGSI,onGSI=()=>{},onShow=async()=>{},onHide=async()=>{},onTick=async()=>null}){
 let disk={map:'',seen:[],lastRound:null,active:false,inBreak:false,returnScene:'prematch',lastTrigger:null};try{disk={...disk,...JSON.parse(fs.readFileSync(file,'utf8'))}}catch{}
 let timer,busy=false,closed=false,status={connected:false,phase:'waiting',error:''};
 function save(){fs.writeFileSync(file+'.tmp',JSON.stringify(disk));fs.renameSync(file+'.tmp',file);}
 function publish(state,h){commit({...state,halftime:{...h,revision:h.revision+1}});}
 let operations=Promise.resolve();
 const serial=fn=>{const p=operations.then(fn);operations=p.catch(()=>{});return p;};
 function hide(reason='manual',id=disk.sessionId){return serial(async()=>{if(!disk.active||id!==disk.sessionId)return;await onHide(disk.sessionId,reason);const s=getState(),h=half.normalize(s.halftime);disk.active=false;save();publish(s,h);});}
 function show(g=null,mode='half'){return serial(async()=>{const sessionId=crypto.randomUUID(),obsManaged=await onShow(sessionId,mode)===true;const s=getState();let h=half.action(half.action(s.halftime,'reset'),'start');
  if(g&&h.autoScore&&Number.isFinite(g.map?.teamCT?.score)&&Number.isFinite(g.map?.teamT?.score)){const a=g.map[h.gsiLeft==='T'?'teamT':'teamCT'],b=g.map[h.gsiLeft==='T'?'teamCT':'teamT'];h.scoreSource='gsi';h.frozen={a:a.score,b:b.score,map:String(g.map.name).replace(/^de_/,''),at:Date.now()};}
  if(!disk.active)disk.returnScene=s.liveScene==='halftime'||s.liveScene==='entrance'?'prematch':s.liveScene;
  disk.sessionId=sessionId;disk.obsManaged=obsManaged;disk.mode=mode;disk.active=true;disk.lastTrigger={at:Date.now(),map:g?.map?.name||'',reason:g?'gsi':'manual',mode};save();publish(s,h);
 });}
 async function tick(){if(busy||closed)return;busy=true;try{
  const g=await readGSI();if(closed)return;const s=getState(),h=half.normalize(s.halftime),canReturn=h.autoReturn&&(disk.lastTrigger?.reason==='gsi'||disk.inBreak)&&!(disk.obsManaged&&disk.mode==='full');
  if(disk.active&&((disk.mode==='full'?s.highlightLayouts?.fullAuto===false:!h.autoEnabled)&&disk.lastTrigger?.reason==='gsi'))await hide('disabled');
  const fresh=g?.connected&&Number.isFinite(g.sourceAgeMs)&&g.sourceAgeMs<=10000;status={connected:!!fresh,phase:g?.phase||'waiting',error:''};if(!fresh)return;onGSI(g);
  const map=g.map?.name,round=Number.isFinite(g.map?.round)?g.map.round:NaN,phase=g.map?.phase;if(!map)return;
  const reset=map!==disk.map||phase==='warmup'||phase==='live'&&Number.isFinite(round)&&round<3&&disk.seen.length>0;
  if(reset){if(disk.active&&canReturn)await hide('map-reset');if(disk.map!==map||disk.seen.length){disk.map=map;disk.seen=[];disk.inBreak=false;disk.lastRound=null;save();}}
  if(phase==='warmup'){if(disk.active&&canReturn)await hide('warmup');return;}
  // A full OBS playlist owns its lifetime, even when the server loads the next map.
  if(disk.active&&disk.obsManaged&&disk.mode==='full')return;
  if(phase==='gameover'){
   const ct=g.map?.teamCT?.score,t=g.map?.teamT?.score,token=map+':gameover';
   if(s.highlightLayouts?.fullAuto!==false&&Number.isFinite(ct)&&Number.isFinite(t)&&ct!==t&&!disk.seen.includes(token)){await show(g,'full');disk.seen.push(token);disk.inBreak=false;save();}return;
  }
  const signal=g.phase==='halftime'||phase==='intermission';
  const ct=g.map?.teamCT?.score,t=g.map?.teamT?.score,total=Number.isFinite(ct)&&Number.isFinite(t)?ct+t:round;
  // Explicit halftime signals only: tactical/technical timeouts and ordinary round ends do not qualify.
  const token=map+':'+(Number.isFinite(total)?Math.max(12,total):'half');
  if(signal){if(h.autoEnabled&&!disk.inBreak&&!disk.seen.includes(token)){await show(g);disk.inBreak=true;disk.seen.push(token);disk.seen=disk.seen.slice(-32);disk.lastRound=Number.isFinite(round)?round:null;save();}}
  else if(phase==='live'&&['freezetime','live'].includes(g.phase)&&Number.isFinite(round)){
   if(disk.inBreak){disk.inBreak=false;save();}
   // GSI map.round counts completed rounds; round 13 is map.round === 12.
   const seconds=g.phaseEndsIn;
   if(disk.active&&disk.mode!=='full'&&h.autoReturn&&g.phase==='live'&&round===12&&Number.isFinite(seconds)&&seconds>0&&seconds<=110)await hide('round-13-110');
  }
 }catch(e){status={...status,error:e.message};}finally{
  try{const {id,reason}=await serial(async()=>{const id=disk.active?disk.sessionId:null;return {id,reason:await onTick(id)};});if(reason&&disk.active&&disk.sessionId===id)await hide(reason,id);}catch(e){status={...status,error:e.message};}
  busy=false;
 }}
 return {start(){closed=false;clearInterval(timer);timer=setInterval(tick,500);timer.unref?.();void tick();},close(){closed=true;clearInterval(timer);},tick,show,hide,meta(){return {...status,active:disk.active,sessionId:disk.sessionId,mode:disk.mode||'half',lastTrigger:disk.lastTrigger,returnScene:disk.returnScene};}};
}
module.exports={createAutomation};
