'use strict';
const {resolveMain}=require('./integration-identity.cjs');
const mapKey=v=>String(v||'').toLowerCase().replace(/^.*\//,'').replace(/^de_/,'').replace(/[^a-z0-9]/g,'').replace(/^dustii$/,'dust2');
const MAPS=['dust2','mirage','inferno','nuke','ancient','anubis','overpass','train','vertigo'];
const TEMPLATES={1:['A:ban','B:ban','A:ban','B:ban','A:ban','B:ban',':decider'],2:['A:ban','B:ban','A:ban','B:ban','A:pick','B:pick',':unused'],3:['A:ban','B:ban','A:pick','B:pick','A:ban','B:ban',':decider'],5:['A:ban','B:ban','A:pick','B:pick','A:pick','B:pick',':decider']};
const firstSide=value=>value==='B'?'B':'A';
function template(bo,first='A'){return (TEMPLATES[bo]||TEMPLATES[3]).map(v=>{const [team,action]=v.split(':');return {team:firstSide(first)==='B'&&team?(team==='A'?'B':'A'):team,action,map:''};});}
function bpValid(m){return !!m&&m.bpBestOf===m?.bestOf&&(!m.bpTeams||JSON.stringify(m.bpTeams)===JSON.stringify([m.teamAId||'',m.teamBId||'']));}
function applyBP(m,steps,first=m.bpFirstSide||'A'){
 if(!['A','B'].includes(first))throw Error('请选择有效的 BP 先手方');
 const expected=template(m.bestOf,first);if(!Array.isArray(steps)||steps.length!==expected.length)throw Error('BP 步骤与 BO 不一致');
 const used=new Set(),bp=expected.map((e,i)=>{
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
 Object.assign(m,{bp,bpBestOf:m.bestOf,bpFirstSide:first,bpTeams:[m.teamAId||'',m.teamBId||''],mapScores:maps});if(m.mapDetails)m.mapDetails=details;
 return m;
}
function currentMatch(s){const id=resolveMain(s).matchId;return s.matches?.find(m=>m.id===id);}
function mapIndex(m,name){
 const key=mapKey(name);if(!MAPS.includes(key))return -1;
 if(bpValid(m)&&m.bp?.some(v=>mapKey(v.map)===key&&['ban','unused'].includes(v.action)))return -1;
 let i=(m.mapScores||[]).slice(0,m.bestOf).findIndex(x=>mapKey(x.map)===key);
 if(i<0)i=(m.mapScores||[]).slice(0,m.bestOf).findIndex(x=>/^MAP\s*\d*$/i.test(x.map||'')&&x.a==null&&x.b==null);
 return i;
}
function ingest(s,g){if(!g.connected||!Number.isFinite(g.sourceAgeMs)||g.sourceAgeMs>10000||!['live','intermission','gameover'].includes(g.map?.phase))return false;const m=currentMatch(s);if(require('./tournament-flow.cjs').enabled(s)&&!require('./tournament-flow.cjs').isActive(s))return false;if(!m||!m.teamAId||!m.teamBId||m.gsiEnabled===false)return false;const index=mapIndex(m,g.map.name);if(index<0)return false;const teams=['A','B'].map(k=>s.teams.find(t=>t.id===m['team'+k+'Id']));if(teams.some(t=>!t))return false;
 const entries=Object.entries(g.allplayers||{}).filter(([,p])=>['CT','T'].includes(p.team)&&p.match_stats);if(!entries.length)return false;
 m.gsiBindings||={};const roster=teams.flatMap((t,i)=>(t.players||[]).map(p=>({side:i?'B':'A',p})));const mapped=[];
 for(const [id,p]of entries){
  const exact=roster.filter(r=>r.p.steamId===id);let binding=null;
  if(exact.length===1)binding={side:exact[0].side,playerId:exact[0].p.id,source:'steam64'};
  else if(!exact.length){
   const previous=m.gsiBindings[id];
   if(previous&&(!previous.source||previous.source==='manual')&&roster.some(r=>!r.p.steamId&&r.side===previous.side&&r.p.id===previous.playerId))binding={...previous,source:'manual'};
   if(!binding){const candidates=roster.filter(r=>!r.p.steamId&&(String(r.p.id)===id||(p.name&&String(r.p.id).toLowerCase()===String(p.name).toLowerCase())));
    if(candidates.length===1)binding={side:candidates[0].side,playerId:candidates[0].p.id,source:'name'};
   }
  }
  if(binding){m.gsiBindings[id]=binding;mapped.push({id,p,...binding});}else delete m.gsiBindings[id];
 }
 // A roster slot must never receive statistics from two accounts in the same packet.
 const usage=new Map(),slot=x=>JSON.stringify([x.side,x.playerId]);for(const x of mapped)usage.set(slot(x),(usage.get(slot(x))||0)+1);
 for(let i=mapped.length-1;i>=0;i--)if(usage.get(slot(mapped[i]))>1){delete m.gsiBindings[mapped[i].id];mapped.splice(i,1);}
 if(!mapped.length)return false;
 const counts={CT:{A:0,B:0},T:{A:0,B:0}};mapped.forEach(x=>counts[x.p.team][x.side]++);let aSide=counts.CT.A>counts.CT.B&&counts.T.B>counts.T.A?'CT':counts.T.A>counts.T.B&&counts.CT.B>counts.CT.A?'T':null;
 // Team identity must be observed on both sides. No roster-order or CT/T guessing.
 if(!aSide)return false;
 const a=g.map[aSide==='CT'?'teamCT':'teamT']?.score,b=g.map[aSide==='CT'?'teamT':'teamCT']?.score;if(!Number.isFinite(a)||!Number.isFinite(b))return false;
 const map=`de_${mapKey(g.map.name)}`,old=m.mapDetails?.[index]||{},record={...old,map,a,b,source:'gsi'};
 for(const side of ['A','B'])record['team'+side]=(teams[side==='A'?0:1].players||[]).map((p,i)=>{const x=mapped.find(x=>x.side===side&&x.playerId===p.id),prev=old['team'+side]?.find(v=>v.playerId===p.id)||{playerId:p.id,starter:p.starter??i<5,kills:null,deaths:null,assists:null,rating:null};if(!x)return prev;const st=x.p.match_stats,num=k=>Number.isFinite(st[k])?Math.max(0,st[k]):null;return {...prev,starter:true,steamId:x.id,kills:num('kills'),deaths:num('deaths'),assists:num('assists'),adr:Number.isFinite(st.adr)?st.adr:null};});
 const fingerprint=JSON.stringify({record,index,phase:g.map.phase});if(m.gsiFingerprint===fingerprint)return false;m.gsiFingerprint=fingerprint;m.mapDetails||=[];m.mapDetails[index]=record;m.mapScores[index]={map,a,b};m.currentMapIndex=index;m.gsiUpdatedAt=Date.now();m.gsiPhase=g.map.phase;require('./scoredeck-rules.cjs').normalizeMatch(m);m.gsiUnbound=entries.filter(([id])=>!m.gsiBindings[id]).map(([id,p])=>({id,name:p.name,side:p.team}));
 // Live round scores are not final map/series outcomes; leave series progression to the director.
 return true;
}
function stats(s){const m=currentMatch(s);if(!m)return {map:'',teams:[],rows:[[],[]],score:[null,null]};const index=Math.max(0,Math.min(m.bestOf-1,Number(s.statsMapIndex??m.currentMapIndex)||0)),d=m.mapDetails?.[index]||{},score=m.mapScores?.[index]||{},teams=['A','B'].map(side=>s.teams.find(t=>t.id===m['team'+side+'Id'])||{});return {matchId:m.id,index,map:d.map||score.map||'',round:m.round,phase:m.gsiPhase||'',updatedAt:m.gsiUpdatedAt||null,teams,score:[d.a??score.a??null,d.b??score.b??null],rows:['A','B'].map((side,i)=>(d['team'+side]||teams[i].players?.map((p,j)=>({playerId:p.id,starter:p.starter??j<5}))||[]).filter(p=>p.starter).slice(0,5)),bp:bpValid(m)?m.bp||[]:[]};}
module.exports={MAPS,mapKey,template,bpValid,applyBP,ingest,stats,currentMatch};
