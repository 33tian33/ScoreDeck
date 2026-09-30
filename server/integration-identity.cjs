const fs=require('node:fs'),path=require('node:path');
const F=require('./tournament-flow.cjs'),V=require('./flow-display.cjs');
function resolveMain(state,swapped=false){
 const match=F.enabled(state)?V.primary(state):(state.matches||[]).find(m=>m.id===state.selectedMatchId)||(state.matches||[])[0];
 const team=(id,label)=>{const t=state.teams?.find(t=>t.id===id);return {id:t?.id||'',name:t?.name||label,shortName:t?.shortName||'TBD',color:t?.color||'#888888',logo:t?.logoPrimary||''};};
 const sides=[team(match?.teamAId,'待定队伍 A'),team(match?.teamBId,'待定队伍 B')];
 return {matchId:match?.id||'',round:match?.round||'',stage:state.stages?.find(s=>s.id===match?.stageId)?.name||'',teams:swapped?sides.reverse():sides};
}
async function imageData(value,dataDir){
 if(!value)return '';
 if(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)){if(value.length>1400000)throw Error('队标超过 1 MB，请在队伍管理中重新上传');return value;}
 let bytes,type;
 if(value.startsWith('/media/')){
  const rel=decodeURIComponent(value.slice(7));if(!rel||/[\\/]/.test(rel)||rel==='..')throw Error('队标路径无效');
  const file=path.join(dataDir,'media',rel);if(fs.statSync(file).size>1024*1024)throw Error('队标超过 1 MB');bytes=await fs.promises.readFile(file);type=({'.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp'})[path.extname(file).toLowerCase()];
 }else if(/^https?:\/\//.test(value)){
  const r=await fetch(value,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('队标读取失败');type=(r.headers.get('content-type')||'').split(';')[0].replace('image/','');const chunks=[];let total=0;for await(const b of r.body){total+=b.length;if(total>1024*1024)throw Error('队标超过 1 MB');chunks.push(b);}bytes=Buffer.concat(chunks);
 }else throw Error('队标地址不受支持');
 if(!['png','jpeg','webp'].includes(type))throw Error('队标须为 PNG、JPEG 或 WebP');return `data:image/${type};base64,${bytes.toString('base64')}`;
}
function createIdentitySync({getState,dataDir,prefs,records,url}){
 let closed=false;const status={},cache=new Map();
 for(const id of ['replay','voicebridge'])status[id]={busy:false,error:'',signature:'',syncedAt:0};
 function meta(id){return {...resolveMain(getState(),prefs[id].swapTeams),followMain:prefs[id].followMain!==false,swapTeams:!!prefs[id].swapTeams,syncError:status[id].error,syncedAt:status[id].syncedAt};}
 async function request(id,endpoint,payload){const r=await fetch(url(id)+endpoint,{method:payload?'POST':'GET',headers:{'Content-Type':'application/json','X-ScoreDeck-Instance':records[id].instance||''},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(8000)});const body=await r.json();if(!r.ok)throw Error(body.error||`HTTP ${r.status}`);return body;}
 async function sync(id,force=false){
  const r=records[id],st=status[id];if(closed||st.busy||r.phase!=='running')return;
  st.busy=true;
  try{
   const resolved=resolveMain(getState(),prefs[id].swapTeams),follow=prefs[id].followMain!==false;
   const signature=JSON.stringify([r.generation,follow,follow?resolved:null]);if(!force&&st.signature===signature)return;
   const teams=[];if(follow)for(const t of resolved.teams){let logo=cache.get(t.logo);if(logo===undefined){logo=await imageData(t.logo,dataDir);if(cache.size>16)cache.clear();cache.set(t.logo,logo);}teams.push({...t,logo});}
   if(id==='replay'){
    const current=(await request(id,'/api/state')).state.config.teams||{};
    await request(id,'/api/teams',{...current,scoredeck_managed:follow,...(follow?{ct:{name:teams[0].name,logo:teams[0].logo},t:{name:teams[1].name,logo:teams[1].logo}}:{})});
   }else await request(id,'/api/scoredeck/teams',{managed:follow,matchId:resolved.matchId,...(follow?{teams}:{})});
   st.signature=signature;st.error='';st.syncedAt=Date.now();
  }catch(e){st.error=e.message;}finally{st.busy=false;}
 }
 const timer=setInterval(()=>{sync('replay');sync('voicebridge');},1000);timer.unref();
 return {meta,sync,reset(id){status[id].signature='';},close(){closed=true;clearInterval(timer);}};
}
module.exports={resolveMain,imageData,createIdentitySync};
