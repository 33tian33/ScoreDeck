'use strict';
const {resolveMain}=require('./integration-identity.cjs');
const mapKey=v=>String(v||'').toLowerCase().replace(/^.*\//,'').replace(/^de_/,'').replace(/[^a-z0-9]/g,'').replace(/^dustii$/,'dust2');
const MAPS=['dust2','mirage','inferno','nuke','ancient','anubis','overpass','train','vertigo','cache'];
const TEMPLATES={1:['A:ban','B:ban','A:ban','B:ban','A:ban','B:ban',':decider'],2:['A:ban','B:ban','A:ban','B:ban','A:pick','B:pick',':unused'],3:['A:ban','B:ban','A:pick','B:pick','A:ban','B:ban',':decider'],5:['A:ban','B:ban','A:pick','B:pick','A:pick','B:pick',':decider']};
const firstSide=value=>value==='B'?'B':'A';
function template(bo,first='A'){return (TEMPLATES[bo]||TEMPLATES[3]).map(v=>{const [team,action]=v.split(':');return {team:firstSide(first)==='B'&&team?(team==='A'?'B':'A'):team,action,map:''};});}
function bpValid(m){return !!m&&m.bpBestOf===m?.bestOf&&(!m.bpTeams||JSON.stringify(m.bpTeams)===JSON.stringify([m.teamAId||'',m.teamBId||'']));}
function applyBP(m,steps,first=m.bpFirstSide||'A',preserveOrder=false){
 if(!['A','B'].includes(first))throw Error('请选择有效的 BP 先手方');
 const expected=template(m.bestOf,first);if(!Array.isArray(steps)||steps.length!==expected.length)throw Error('BP 步骤与 BO 不一致');
 if(preserveOrder){
  const counts={};for(const v of steps){if(!v||!['ban','pick','decider','unused'].includes(v.action))throw Error('无效 BP 操作');counts[v.action]=(counts[v.action]||0)+1;if(['ban','pick'].includes(v.action)?!['A','B'].includes(v.team):v.team!=='')throw Error('BP 队伍归属无效');if(!v.map)throw Error('文本导入须包含完整地图');}
  for(const action of ['ban','pick','decider','unused'])if((counts[action]||0)!==expected.filter(v=>v.action===action).length)throw Error('禁选数量与 BO 不一致');
  if(steps.at(-1).action!==(m.bestOf===2?'unused':'decider'))throw Error('最后一图须为剩余地图');
  if(steps.find(v=>v.team)?.team!==first)throw Error('先手方与首条 BP 不一致');
 }
 const used=new Set(),bp=expected.map((e,i)=>{
  if(preserveOrder)e={team:steps[i].team,action:steps[i].action};
  const v=steps[i]||{},map=mapKey(v.map);if(map&&!MAPS.includes(map))throw Error('地图不在支持列表中');if(map&&used.has(map))throw Error('同一地图不能重复禁选');if(map)used.add(map);
  const result={...e,map};
  if(['pick','decider'].includes(e.action)){
   const old=bpValid(m)&&map&&m.bp?.[i]?.map===map&&m.bp[i].action===e.action?m.bp[i]:{};
   const picker=v.sidePicker??old.sidePicker??'',side=v.startSide??old.startSide??'';
   if(!['','A','B'].includes(picker)||!['','CT','T'].includes(side))throw Error('选边须为 A/B 队与 CT/T');
   if(side&&!picker)throw Error('请先选择选边队伍');
   if(!map&&(picker||side))throw Error('请先选择地图再设置选边');
   if(picker)result.sidePicker=picker;if(side)result.startSide=side;
  }else if(v.sidePicker||v.startSide)throw Error('BAN 或未使用地图不能设置选边');
  return result;
 });
 const maps=structuredClone(m.mapScores||[]),details=structuredClone(m.mapDetails||[]);let i=0;
 for(const v of bp){if(!['pick','decider'].includes(v.action))continue;const old=maps[i];
  if(old&&old.map&&mapKey(old.map)!==v.map){
   if(old.a!=null||old.b!=null)throw Error('该图已有比分，请先清除后再更换 BP');
   const d=details[i];
   if(d&&(d.a!=null||d.b!=null||['teamA','teamB'].some(side=>(d[side]||[]).some(p=>['kills','deaths','assists','adr','rating'].some(key=>p[key]!=null)))))throw Error('该图已有选手数据，请先清除后再更换 BP');
  }
  maps[i]={...old,map:v.map?`de_${v.map}`:`MAP ${i+1}`,a:old?.a??null,b:old?.b??null};if(details[i])details[i].map=maps[i].map;i++;
 }
 Object.assign(m,{bp,bpOrder:preserveOrder?'imported':'template',bpBestOf:m.bestOf,bpFirstSide:first,bpTeams:[m.teamAId||'',m.teamBId||''],mapScores:maps});if(m.mapDetails)m.mapDetails=details;
 return m;
}
function matchesPlayerName(name,playerId,team){
 const actual=String(name).trim().toLowerCase(),expected=String(playerId).trim().toLowerCase();
 if(actual===expected)return true;
 // GOTV may prepend the roster team's name or tag. Keep the whole nickname intact.
 return [team.name,team.shortName].some(value=>{
  const prefix=String(value||'').trim().toLowerCase();
  if(!prefix||!actual.startsWith(prefix))return false;
  const rest=actual.slice(prefix.length);
  return /^\s/.test(rest)&&rest.replace(/^\s+/,'')===expected;
 });
}
function currentMatch(s){const id=resolveMain(s).matchId;return s.matches?.find(m=>m.id===id);}
function mapIndex(m,name){
 const key=mapKey(name);if(!MAPS.includes(key))return -1;
 if(bpValid(m)&&m.bp?.some(v=>mapKey(v.map)===key&&['ban','unused'].includes(v.action)))return -1;
 const maps=(m.mapScores||[]).slice(0,m.bestOf),hits=maps.flatMap((x,i)=>mapKey(x.map)===key?[i]:[]);
 if(hits.length>1)return -1;
 let i=hits[0]??-1;
 if(i<0)i=maps.findIndex((x,i)=>/^MAP\s*\d*$/i.test(x.map||'')&&x.a==null&&x.b==null&&!hasResult(m.mapDetails?.[i])&&!m.mapDetails?.[i]?.manualLocked);
 return i;
}
const statKeys=['kills','deaths','assists','adr','rating'];
const hasResult=d=>!!d&&(d.a!=null||d.b!=null||['teamA','teamB'].some(side=>(d[side]||[]).some(p=>statKeys.some(k=>p[k]!=null))));
const playerStats=p=>Object.fromEntries(['kills','deaths','assists','adr'].map(k=>[k,Number.isFinite(p.match_stats?.[k])&&p.match_stats[k]>=0?p.match_stats[k]:null]));
function ingest(s,g){
 if(!g.connected||!Number.isFinite(g.sourceAgeMs)||g.sourceAgeMs>10000||!['live','intermission','gameover'].includes(g.map?.phase))return false;
 const m=currentMatch(s),flow=require('./tournament-flow.cjs');
 if(flow.enabled(s)&&!flow.isActive(s)||!m||!m.teamAId||!m.teamBId||m.gsiEnabled===false)return false;
 const index=mapIndex(m,g.map.name);if(index<0||index<(m.currentMapIndex||0))return false;
 if(m.bestOf!==2){
  const earlier=(m.mapScores||[]).slice(0,index).filter(require('./scoredeck-rules.cjs').validMap),wins=Math.floor(m.bestOf/2)+1;
  if(earlier.filter(d=>d.a>d.b).length>=wins||earlier.filter(d=>d.b>d.a).length>=wins)return false;
 }
 const old=m.mapDetails?.[index]||{};
 if(old.manualLocked||old.source==='manual'&&hasResult(old)||old.gsiPhase==='gameover'&&g.map.phase!=='gameover')return false;
 const teams=['A','B'].map(k=>s.teams.find(t=>t.id===m['team'+k+'Id']));if(teams.some(t=>!t))return false;
 const entries=Object.entries(g.allplayers||{}).filter(([,p])=>['CT','T'].includes(p.team)&&p.match_stats);if(!entries.length)return false;
 m.gsiBindings||={};
 const roster=teams.flatMap((t,i)=>(t.players||[]).map((p,j)=>({side:i?'B':'A',p,team:t,starter:old['team'+(i?'B':'A')]?.find(v=>v.playerId===p.id)?.starter??p.starter??j<5}))),mapped=[],bindings={};
 for(const [id,p]of entries){
  const previous=m.gsiBindings?.[id],manual=previous&&(!previous.source||previous.source==='manual')&&roster.find(r=>r.side===previous.side&&r.p.id===previous.playerId);
  const exact=roster.filter(r=>r.p.steamId===id);let binding=null;
  if(exact.length===1)binding={side:exact[0].side,playerId:exact[0].p.id,source:'steam64'};
  else if(!exact.length){
   if(manual&&!manual.p.steamId)binding={side:manual.side,playerId:manual.p.id,source:'manual'};
   else {const candidates=roster.filter(r=>!r.p.steamId&&(String(r.p.id)===id||(p.name&&matchesPlayerName(p.name,r.p.id,r.team))));
    if(candidates.length===1)binding={side:candidates[0].side,playerId:candidates[0].p.id,source:'name'};}
  }
  if(binding)mapped.push({id,p,...binding});else delete m.gsiBindings[id];
 }
 // Conflicting accounts remain unresolved; never assign one roster row twice.
 const usage=new Map(),slot=x=>JSON.stringify([x.side,x.playerId]);for(const x of mapped)usage.set(slot(x),(usage.get(slot(x))||0)+1);
 for(let i=mapped.length-1;i>=0;i--)if(usage.get(slot(mapped[i]))>1){delete m.gsiBindings[mapped[i].id];mapped.splice(i,1);}
 // Require consistent evidence, including team prefixes, on both in-game sides.
 const prefixSide=p=>{
  const name=String(p.name||'').trim().toLowerCase(),hits=teams.flatMap((t,i)=>[t.name,t.shortName].some(v=>v&&name.startsWith(String(v).trim().toLowerCase()+' '))?[i?'B':'A']:[]);
  return hits.length===1?hits[0]:null;
 };
 const evidence={CT:new Set(),T:new Set()};
 mapped.forEach(x=>evidence[x.p.team].add(x.side));
 for(const [,p]of entries){const side=prefixSide(p);if(side)evidence[p.team].add(side);}
 const aSide=evidence.CT.size===1&&evidence.T.size===1&&[...evidence.CT][0]!==[...evidence.T][0]?([...evidence.CT][0]==='A'?'CT':'T'):null;
 if(!aSide)return false;
 const a=g.map[aSide==='CT'?'teamCT':'teamT']?.score,b=g.map[aSide==='CT'?'teamT':'teamCT']?.score;
 if(!Number.isInteger(a)||a<0||!Number.isInteger(b)||b<0)return false;
 if(old.gsiPhase==='gameover'&&(old.a!==a||old.b!==b))return false;
 if(old.gsiPhase==='gameover'&&entries.length<(old.gsiPlayerCount||0))return false;
 const notices=[];
 for(const side of ['A','B']){
  const gameSide=side==='A'?aSide:aSide==='CT'?'T':'CT',active=entries.filter(([,p])=>p.team===gameSide),known=mapped.filter(x=>x.side===side),unknown=active.filter(([id])=>!mapped.some(x=>x.id===id));
  const starters=roster.filter(r=>r.side===side&&r.starter),remaining=starters.filter(r=>!known.some(x=>x.playerId===r.p.id));
  // Only a full five-player side with four identified starters permits elimination.
  if(g.map.phase==='gameover'&&active.length===5&&unknown.length===1&&known.length===4&&starters.length===5&&remaining.length===1&&known.every(x=>starters.some(r=>r.p.id===x.playerId))){
   const [id,p]=unknown[0],r=remaining[0];
   // An explicitly configured different Steam account is not an unknown nickname.
   if(!r.p.steamId||r.p.steamId===id){
    mapped.push({id,p,side,playerId:r.p.id,source:'elimination'});
    notices.push({type:'inferred',side,id,name:p.name||id,playerId:r.p.id,...playerStats(p)});
   }
  }
  for(const [id,p]of unknown)if(!mapped.some(x=>x.id===id))notices.push({type:'unmatched',side,id,name:p.name||id,...playerStats(p)});
 }
 for(const x of mapped)bindings[x.id]={side:x.side,playerId:x.playerId,source:x.source};
 const map=`de_${mapKey(g.map.name)}`,record={...old,map,a,b,source:'gsi',gsiPhase:g.map.phase,gsiPlayerCount:entries.length,gsiNotices:notices};
 for(const side of ['A','B'])record['team'+side]=roster.filter(r=>r.side===side).map(r=>{
  const x=mapped.find(x=>x.side===side&&x.playerId===r.p.id);
  const prev=old['team'+side]?.find(v=>v.playerId===r.p.id);
  return {playerId:r.p.id,starter:x?true:r.starter,kills:null,deaths:null,assists:null,adr:null,rating:null,...(x?{steamId:x.id,...playerStats(x.p),rating:prev?.rating??null}:{})};
 });
 // Keep exactly the observed five when a known substitute replaces a default starter.
 for(const side of ['A','B'])if(mapped.filter(x=>x.side===side).length===5)record['team'+side].forEach(p=>p.starter=mapped.some(x=>x.side===side&&x.playerId===p.playerId));
 const fingerprint=JSON.stringify({record,index,bindings});if(m.gsiFingerprint===fingerprint)return false;
 m.gsiFingerprint=fingerprint;m.gsiBindings={...Object.fromEntries(Object.entries(m.gsiBindings||{}).filter(([,v])=>!v.source||v.source==='manual')),...bindings};
 m.mapDetails||=[];m.mapDetails[index]=record;m.mapScores[index]={map,a,b};m.currentMapIndex=index;m.gsiUpdatedAt=Date.now();m.gsiPhase=g.map.phase;
 m.gsiUnbound=notices.filter(n=>n.type==='unmatched');require('./scoredeck-rules.cjs').normalizeMatch(m);
 return true;
}
// Explicit result saves are authoritative over live packets and older result snapshots.
function saveResult(s,body){
 const m=s.matches.find(m=>m.id===body.matchId);
 if(!m)throw Error('比赛已删除，请关闭窗口后检查赛程。');
 if(m.teamAId!==body.teamAId||m.teamBId!==body.teamBId||m.bestOf!==body.bestOf)throw Error('比赛双方或 BO 已改变，请重新打开赛果窗口。');
 if(!Array.isArray(body.mapDetails)||body.mapDetails.length<m.bestOf||body.mapDetails.length>5)throw Error('逐图赛果不完整');
 if(body.baseMapDetails!==undefined&&(!Array.isArray(body.baseMapDetails)||body.baseMapDetails.length!==body.mapDetails.length))throw Error('赛果草稿版本不完整，请重新打开窗口');
 const changed=body.mapDetails.map((d,i)=>body.baseMapDetails?JSON.stringify(d)!==JSON.stringify(body.baseMapDetails[i]):hasResult(d));
 const details=body.mapDetails.map((d,i)=>structuredClone(!changed[i]&&m.mapDetails?.[i]?m.mapDetails[i]:d));
 for(const d of details.slice(0,m.bestOf)){
  for(const side of ['teamA','teamB']){
   if(!Array.isArray(d[side]))throw Error('逐图阵容不完整');
   if(changed[details.indexOf(d)]&&d[side].filter(p=>p.starter).length!==5)throw Error('每张地图的双方阵容都必须点亮 5 名首发后才能保存');
   const ids=d[side].map(p=>p.playerId),team=s.teams.find(t=>t.id===m[side+'Id']);
   if(new Set(ids).size!==ids.length||ids.some(id=>!team?.players.some(p=>p.id===id)))throw Error('逐图选手 ID 重复或不属于本队');
   for(const p of d[side])for(const k of statKeys)if(p[k]!=null&&(!Number.isFinite(p[k])||p[k]<0||(['kills','deaths','assists'].includes(k)&&!Number.isInteger(p[k]))))throw Error('选手战绩必须为有效非负数，K/D/A 必须为整数');
  }
  for(const k of ['a','b'])if(d[k]!==null&&(!Number.isInteger(d[k])||d[k]<0))throw Error('地图比分必须为非负整数');
 }
 const maps=new Set();
 for(const [i,d]of details.entries()){
  d.map=String(d.map||'MAP').trim()||'MAP';
  if(i<m.bestOf&&!/^MAP\s*\d*$/i.test(d.map)){const key=mapKey(d.map);if(maps.has(key))throw Error('同一地图不能重复录入');maps.add(key);}
  if(changed[i]){d.source='manual';d.manualLocked=true;d.gsiNotices=m.mapDetails?.[i]?.gsiNotices||[];}
 }
 m.mapDetails=details;m.mapScores=details.map(d=>({map:d.map,a:d.a,b:d.b}));
 m.mvp=body.mvp||undefined;
 // Manual authority belongs to the edited map; later maps can still auto-fill.
 delete m.gsiFingerprint;
 require('./scoredeck-rules.cjs').normalizeMatch(m,{forceMaps:true,finishBo2:true});
 if(m.teamAId&&m.teamBId&&details.slice(0,m.bestOf).some(d=>d.a!==null&&d.b!==null)&&m.status==='tbd')m.status='upcoming';
 return m;
}
function stats(s){const m=currentMatch(s);if(!m)return {map:'',teams:[],rows:[[],[]],score:[null,null]};const index=Math.max(0,Math.min(m.bestOf-1,Number(s.statsMapIndex??m.currentMapIndex)||0)),d=m.mapDetails?.[index]||{},score=m.mapScores?.[index]||{},teams=['A','B'].map(side=>s.teams.find(t=>t.id===m['team'+side+'Id'])||{});return {matchId:m.id,index,map:d.map||score.map||'',round:m.round,phase:d.gsiPhase||'',updatedAt:m.gsiUpdatedAt||null,teams,score:[d.a??score.a??null,d.b??score.b??null],rows:['A','B'].map((side,i)=>(d['team'+side]||teams[i].players?.map((p,j)=>({playerId:p.id,starter:p.starter??j<5}))||[]).filter(p=>p.starter).slice(0,5)),bp:bpValid(m)?m.bp||[]:[]};}
module.exports={MAPS,mapKey,template,bpValid,applyBP,ingest,saveResult,stats,currentMatch};
