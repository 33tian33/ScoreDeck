(function(root,factory){const api=factory(typeof module==='object'?require('./scoredeck-rules.cjs'):root.ScoreDeckRules);if(typeof module==='object')module.exports=api;else root.ScoreDeckFlow=api;})(globalThis,function(R){
'use strict';
const clone=x=>structuredClone(x),enabled=s=>s.tournament?.formatId==='flow',id=()=>`s${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
const TERMINALS=['淘汰','Qualified','冠军','亚军','季军','殿军'];
const terminal=(label='')=>label&&label!=='淘汰'?{kind:'end',label:label==='晋级'?'Qualified':label}:{kind:'eliminate'};
const pending=()=>({kind:'pending'});
const stageOf=(s,key)=>s.stages?.find(x=>x.id===key);
const matchesOf=(s,key)=>s.matches.filter(x=>x.stageId===key);
const win=m=>`win:${m.id}`,lose=m=>`lose:${m.id}`,rank=(g,n)=>`rank:${g}:${n}`;
const comparatorRank=(key,n)=>`compare:${key}:${n}`;
function comparatorSources(s,st){
 if(st.type!=='group')return [];
 return st.groups.flatMap(g=>Array.from({length:g.size},(_,i)=>{
  const code=['GW','GD','GD','GL'][i],m=g.format==='gsl'?matchesOf(s,st.id).find(m=>!m.custom&&shortId(m)===`${g.id}-${code}`):null;
  return {key:g.format==='gsl'?(m?(i<2?win(m):lose(m)):''):rank(g.id,i+1),groupId:g.id,groupName:g.name,rank:i+1,label:`${g.name}第${i+1}名`};
 }).filter(x=>x.key));
}
function comparatorInputs(st,c){return Array.from({length:c.teamCount},(_,i)=>Object.keys(st.routes).find(key=>{const to=st.routes[key];return to.kind==='comparator'&&to.comparatorId===c.id&&to.position===i+1;})||'');}
function addComparator(s,stageId){const st=stageOf(s,stageId);if(st?.type!=='group')throw Error('跨组比较器只能添加到小组赛');const c={id:id(),name:`跨组比较器 ${(st.comparators||[]).length+1}`,teamCount:2};(st.comparators||=[]).push(c);for(let n=1;n<=c.teamCount;n++)st.routes[comparatorRank(c.id,n)]=pending();return c;}
function resizeComparator(s,stageId,key,count){const st=stageOf(s,stageId),c=st?.comparators?.find(c=>c.id===key);if(!c)throw Error('比较器不存在');if(!Number.isInteger(count)||count<2||count>st.slots.length)throw Error(`进入队伍数须为2至${st.slots.length}`);for(const [source,to] of Object.entries(st.routes))if(to.kind==='comparator'&&to.comparatorId===key&&to.position>count||source.startsWith(`compare:${key}:`)&&Number(source.split(':')[2])>count)source.startsWith('compare:')?delete st.routes[source]:st.routes[source]=pending();c.teamCount=count;for(let n=1;n<=count;n++)st.routes[comparatorRank(key,n)]||=pending();return c;}
function removeComparator(s,stageId,key){const st=stageOf(s,stageId);st.comparators=(st.comparators||[]).filter(c=>c.id!==key);for(const [source,to] of Object.entries(st.routes))if(source.startsWith(`compare:${key}:`))delete st.routes[source];else if(to.kind==='comparator'&&to.comparatorId===key)st.routes[source]=pending();return s;}
function setComparatorInput(s,stageId,key,position,source){const st=stageOf(s,stageId),c=st?.comparators?.find(c=>c.id===key);if(!c||!Number.isInteger(position)||position<1||position>c.teamCount)throw Error('比较器入场位置不存在');if(source){if(!comparatorSources(s,st).some(x=>x.key===source))throw Error('请选择小组最终名次');const to=st.routes[source];if(to&&!['pending','end','eliminate'].includes(to.kind)&&!(to.kind==='comparator'&&to.comparatorId===key&&to.position===position))throw Error('该小组名次已有去向，请先解除连接');}const old=comparatorInputs(st,c)[position-1];if(old)st.routes[old]=pending();if(source)setRoute(s,stageId,source,{kind:'comparator',comparatorId:key,position});return s;}
function comparatorTable(s,st,c){
 const sources=comparatorSources(s,st),tables=new Map(),rows=[];let complete=true;
 for(const key of comparatorInputs(st,c)){
  const src=sources.find(x=>x.key===key);if(!src){complete=false;continue;}
  const g=st.groups.find(g=>g.id===src.groupId),ms=matchesOf(s,st.id).filter(m=>m.groupId===g.id&&!m.custom);
  if(!tables.has(g.id))tables.set(g.id,groupTable(s,st,g));const table=tables.get(g.id);
  const ready=table.length===g.size&&ms.length>0&&ms.every(m=>m.status==='completed'&&R.normalizeMatch(clone(m)).status==='completed');
  const row=g.format==='gsl'?table.find(r=>r.team.id===result(s.matches.find(m=>m.id===key.slice(key.indexOf(':')+1)),src.rank<3?'winner':'loser').id):table[src.rank-1];
  if(!ready||!row)complete=false;
  if(row)rows.push({...row,source:key,groupId:g.id,groupName:g.name,groupRank:src.rank});
 }
 rows.sort(R.compareCrossGroup);return {rows,complete:complete&&rows.length===c.teamCount};
}
function blank(s){s.legacyFlowBackup=s.matches.length?{tournament:clone(s.tournament),matches:clone(s.matches)}:s.legacyFlowBackup;s.tournament.formatId='flow';s.tournament.format='自定义赛事流程';s.stages=[];s.matches=[];s.flowLifecycle={status:'draft'};s.selectedStageId='';s.selectedMatchId='';return s;}
function createStage(type='group',opts={}){
 const key=opts.id||id(),st={id:key,type,name:opts.name||({group:'小组赛',playoff:'Playoff',swiss:'瑞士轮',custom:'单场对决'}[type]),format:type==='playoff'?'single':type==='swiss'?'swiss16':type==='custom'?'custom':'round-robin',bestOf:type==='group'||type==='swiss'?1:3,teamCount:type==='playoff'?8:type==='swiss'?16:type==='custom'?2:4,groups:[],slots:[],routes:{},...opts};
 if(type==='group'&&!st.groups.length)st.groups=[{id:'g1',name:'A组',size:4,format:'round-robin',bestOf:1,tieBreak:'round-diff'}];
 resizeSlots(st);return st;
}
function resizeSlots(st){
 const old=new Map((st.slots||[]).map(x=>[x.id,x]));
 const groups=st.type==='group'?st.groups:[{id:'entry',size:st.type==='swiss'?16:st.teamCount}];
 st.slots=groups.flatMap(g=>Array.from({length:Number(g.size)},(_,i)=>{const key=`${g.id}-${i+1}`;return {...old.get(key),id:key,groupId:g.id,label:st.type==='group'?`${g.name} · ${i+1}号位`:`${i+1}号位`,teamId:old.get(key)?.teamId||''};}));return st;
}
function makeMatch(st,code,round,a,b,bo,groupId=''){
 const maps=Array.from({length:5},(_,i)=>({map:`MAP ${i+1}`,a:null,b:null}));
 return {id:`${st.id}-${code}`,stageId:st.id,stage:st.name,role:'normal',round,groupId,group:groupId?`${st.id}/${groupId}`:'',bracketRound:groupId&&st.groups.find(g=>g.id===groupId)?.format!=='gsl'?'':code.split('-')[0],teamAId:'',teamBId:'',entryA:a,entryB:b,scoreA:0,scoreB:0,bestOf:bo,status:'tbd',mapScores:maps,mapDetails:maps.map(m=>({...m,teamA:[],teamB:[]})),scheduleOrder:0};
}
function build(st){
 resizeSlots(st);const out=[],routes={},slot=i=>({kind:'slot',slotId:st.slots[i].id}),add=(code,round,a,b,bo=st.bestOf,g='')=>{const m=makeMatch(st,code,round,a,b,bo,g);out.push(m);return m;};
 const connect=(m,result,to,side)=>{routes[result==='winner'?win(m):lose(m)]={kind:'match',matchId:to.id,side};};
 if(st.type==='group')for(const g of st.groups){
   const entrants=st.slots.filter(x=>x.groupId===g.id).map(x=>({kind:'slot',slotId:x.id}));
   if(g.format==='gsl'){
    if(entrants.length!==4)throw Error('四队双败的小组必须为4队');
    const a=add(`${g.id}-G1`,'首轮 1',entrants[0],entrants[3],g.bestOf,g.id),b=add(`${g.id}-G2`,'首轮 2',entrants[1],entrants[2],g.bestOf,g.id),w=add(`${g.id}-GW`,'胜者组决赛',null,null,g.bestOf,g.id),l=add(`${g.id}-GL`,'败者组首轮',null,null,g.bestOf,g.id),d=add(`${g.id}-GD`,'晋级决胜局',null,null,g.bestOf,g.id);
    connect(a,'winner',w,'A');connect(b,'winner',w,'B');connect(a,'loser',l,'A');connect(b,'loser',l,'B');connect(w,'loser',d,'A');connect(l,'winner',d,'B');
   }else{
    const pool=entrants.length%2?[...entrants,null]:[...entrants];let n=0;
    for(let leg=0;leg<(g.format==='double-round'?2:1);leg++){
     const ring=pool.slice();for(let r=0;r<ring.length-1;r++){
      for(let i=0;i<ring.length/2;i++){let a=ring[i],b=ring[ring.length-1-i];if(a&&b){if((r+i+leg)%2)[a,b]=[b,a];add(`${g.id}-RR${++n}`,`${leg+1}循环 · 第${r+1}轮`,a,b,g.bestOf,g.id);}}
      ring.splice(1,0,ring.pop());
     }
    }
   }
   if(g.format!=='gsl')for(let r=1;r<=g.size;r++)routes[rank(g.id,r)]=terminal();
 }
 else if(st.type==='playoff'&&st.format==='double8'){
  if(st.teamCount!==8)throw Error('八队双败模板必须为8队');
  const w1=Array.from({length:4},(_,i)=>add(`W1-${i}`,'胜者组首轮',slot(i*2),slot(i*2+1)));
  const w2=Array.from({length:2},(_,i)=>add(`W2-${i}`,'胜者组半决赛',null,null));
  const wf=add('WF','胜者组决赛',null,null),l1=Array.from({length:2},(_,i)=>add(`L1-${i}`,'败者组第一轮',null,null)),l2=Array.from({length:2},(_,i)=>add(`L2-${i}`,'败者组第二轮',null,null)),l3=add('L3','败者组第三轮',null,null),lf=add('LF','败者组决赛',null,null),gf=add('GF','总决赛',null,null);
  w1.forEach((m,i)=>{connect(m,'winner',w2[Math.floor(i/2)],i%2?'B':'A');connect(m,'loser',l1[Math.floor(i/2)],i%2?'B':'A');});
  w2.forEach((m,i)=>{connect(m,'winner',wf,i?'B':'A');connect(m,'loser',l2[1-i],'B');connect(l1[i],'winner',l2[i],'A');connect(l2[i],'winner',l3,i?'B':'A');});
  connect(l3,'winner',lf,'A');connect(wf,'loser',lf,'B');connect(wf,'winner',gf,'A');connect(lf,'winner',gf,'B');gf.role='final';routes[win(gf)]=terminal('冠军');routes[lose(gf)]=terminal('亚军');
  // One grand final (no bracket reset), explicit in the editor.
 }else if(st.type==='playoff'){
  const count=Number(st.teamCount);if(!Number.isInteger(count)||count<2||count>32)throw Error('单败人数必须在2至32之间');
  let size=2;while(size<count)size*=2;
  let seeds=[1,2];while(seeds.length<size){const max=seeds.length*2+1;seeds=seeds.flatMap(x=>[x,max-x]);}
  let previous=[];
  for(let r=1,n=size/2;n>=1;r++,n/=2){const current=[];for(let i=0;i<n;i++){
   const entry=k=>seeds[k]<=count?slot(seeds[k]-1):{kind:'bye'};
   const m=add(`R${r}-${i}`,n===1?'决赛':n===2?'半决赛':`${n*2}强`,r===1?entry(i*2):null,r===1?entry(i*2+1):null);current.push(m);
   if(r>1){connect(previous[i*2],'winner',m,'A');connect(previous[i*2+1],'winner',m,'B');}
  }previous=current;}
  previous[0].role='final';routes[win(previous[0])]=terminal('冠军');routes[lose(previous[0])]=terminal('亚军');
 }else if(st.type==='swiss'){
  for(let r=1;r<=5;r++)for(let i=0;i<[8,8,8,6,3][r-1];i++){
   const m=add(`SW${r}-${i}`,`瑞士轮第${r}轮`,r===1?slot(i):null,r===1?slot(i+8):null,st.bestOf);m.swissRound=r;m.bracketRound=`SWISS${r}`;m.bracketIndex=i;
  }
  for(let n=1;n<=16;n++)routes[rank('swiss',n)]=terminal(n<=8?'晋级':'');
 }else add('M1','单场对决',slot(0),slot(1));
 for(const m of out)if(!isRoundRobin(st,m)&&st.type!=='swiss'){
  if(!routes[win(m)])routes[win(m)]=pending();if(!routes[lose(m)])routes[lose(m)]=st.type==='custom'?pending():terminal();
 }
 for(const c of st.comparators||[]){c.teamCount=Math.min(c.teamCount,st.slots.length);for(let n=1;n<=c.teamCount;n++)routes[comparatorRank(c.id,n)]=st.routes[comparatorRank(c.id,n)]||pending();}
 const candidates=new Set(comparatorSources({matches:out},st).map(x=>x.key));
 for(const [key,to] of Object.entries(st.routes))if(to.kind==='comparator'&&candidates.has(key)&&st.comparators?.some(c=>c.id===to.comparatorId&&to.position<=c.teamCount))routes[key]=to;
 st.routes=routes;return out;
}
function regenerate(s,stageId){const st=stageOf(s,stageId);if(!st)throw Error('赛段不存在');const old=matchesOf(s,stageId),ids=new Set(old.map(m=>m.id)),fresh=build(st),newIds=new Set(fresh.map(m=>m.id));s.matches=s.matches.filter(m=>m.stageId!==stageId).concat(fresh);for(const other of s.stages)for(const [key,to]of Object.entries(other.routes||{}))if(to.kind==='match'&&ids.has(to.matchId)&&!newIds.has(to.matchId))other.routes[key]=pending();renumber(s);return s;}
function addStage(s,type,opts){if(!enabled(s))blank(s);const st=createStage(type,opts);s.stages.push(st);s.matches.push(...build(st));s.selectedStageId=st.id;renumber(s);return st;}
function renumber(s){let n=0;for(const st of s.stages)for(const m of matchesOf(s,st.id)){m.stage=st.name;m.scheduleOrder=++n;}if(!s.matches.some(m=>m.id===s.selectedMatchId&&m.stageId===s.selectedStageId&&!m.inactive&&!m.autoBye))s.selectedMatchId=s.matches.find(m=>m.stageId===s.selectedStageId&&!m.inactive&&!m.autoBye)?.id||'';}
function removeStage(s,key){const ids=new Set(matchesOf(s,key).map(m=>m.id));s.stages=s.stages.filter(st=>st.id!==key);s.matches=s.matches.filter(m=>m.stageId!==key);for(const st of s.stages)for(const[k,to]of Object.entries(st.routes))if(to.stageId===key||ids.has(to.matchId))st.routes[k]=pending();if(s.selectedStageId===key)s.selectedStageId=s.stages[0]?.id||'';renumber(s);}
function addMatch(s,stageId,role='normal'){const st=stageOf(s,stageId);let number=1;while(s.matches.some(m=>m.id===`${stageId}-EX${number}`))number++;const m=makeMatch(st,`EX${number}`,'附加对决',null,null,3);m.custom=true;m.bracketRound='CUSTOM';s.matches.push(m);st.routes[win(m)]=pending();st.routes[lose(m)]=pending();setRole(s,m.id,role);m.round=role==='final'?'决赛':role==='thirdPlace'?'季军赛':'附加对决';renumber(s);return m;}
function removeMatch(s,matchId){const m=s.matches.find(m=>m.id===matchId);if(!m)throw Error('比赛不存在');const owner=stageOf(s,m.stageId);if(isRoundRobin(owner,m)||owner.type==='swiss'&&!m.custom)throw Error('循环赛与瑞士轮的比赛由赛制生成，请调整赛制；附加对决可独立删除');s.matches=s.matches.filter(x=>x!==m);for(const st of s.stages){delete st.routes[win(m)];delete st.routes[lose(m)];for(const[k,to]of Object.entries(st.routes))if(to.matchId===matchId)st.routes[k]=pending();}renumber(s);}
function isRoundRobin(st,m){return st.type==='group'&&!m.custom&&st.groups.find(g=>g.id===m.groupId)?.format!=='gsl';}
function outputs(s,st){const rows=[];
 for(const c of st.comparators||[])for(let n=1;n<=c.teamCount;n++)rows.push({key:comparatorRank(c.id,n),label:`${c.name}第${n}名`,comparatorId:c.id});
 if(st.type==='swiss')for(let i=1;i<=16;i++)rows.push({key:rank('swiss',i),label:`瑞士轮最终第${i}名`});
 if(st.type==='group')for(const g of st.groups)if(g.format!=='gsl')for(let i=1;i<=g.size;i++)rows.push({key:rank(g.id,i),label:`${g.name}第${i}名`});
 for(const m of matchesOf(s,st.id))if(!isRoundRobin(st,m)&&(st.type!=='swiss'||m.custom))rows.push({key:win(m),label:`${m.round} · ${shortId(m)} 胜者`,matchId:m.id,result:'winner'},{key:lose(m),label:`${m.round} · ${shortId(m)} 败者`,matchId:m.id,result:'loser'});
 return rows;
}
const shortId=m=>m.id.slice(m.stageId.length+1);
function routeSource(key,st){if(key.startsWith('compare:')){const [,comparatorId,n]=key.split(':');return {kind:'comparison',stageId:st.id,comparatorId,rank:Number(n)};}if(key.startsWith('win:')||key.startsWith('lose:'))return {kind:'result',matchId:key.slice(key.indexOf(':')+1),result:key.startsWith('win:')?'winner':'loser'};const [,groupId,n]=key.split(':');return {kind:'rank',stageId:st.id,groupId,rank:Number(n)};}
function indexes(s){const ins=new Map(),slots=new Map();for(const st of s.stages)for(const[key,to]of Object.entries(st.routes||{})){const src=routeSource(key,st);if(to.kind==='match')ins.set(`${to.matchId}/${to.side}`,src);if(to.kind==='slot')slots.set(`${to.stageId}/${to.slotId}`,src);}return {ins,slots};}
function dependencies(s){const {ins,slots}=indexes(s),deps=new Map();
 const sourceDeps=(src,st,seen=new Set())=>{if(!src)return [];if(src.kind==='comparison'){const owner=stageOf(s,src.stageId),c=owner.comparators.find(c=>c.id===src.comparatorId),sources=comparatorSources(s,owner),groups=new Set(comparatorInputs(owner,c).map(key=>sources.find(x=>x.key===key)?.groupId));return matchesOf(s,owner.id).filter(m=>!m.custom&&groups.has(m.groupId)).map(m=>m.id);}if(src.kind==='result')return [src.matchId];if(src.kind==='rank')return matchesOf(s,src.stageId).filter(m=>!m.custom&&(src.groupId==='swiss'||m.groupId===src.groupId)).map(m=>m.id);if(src.kind==='slot'){const key=`${st.id}/${src.slotId}`;if(seen.has(key))return [];seen.add(key);return sourceDeps(slots.get(key),st,seen);}return [];};
 for(const m of s.matches){const st=stageOf(s,m.stageId);deps.set(m.id,['A','B'].flatMap(side=>sourceDeps(ins.get(`${m.id}/${side}`)||m[`entry${side}`],st)));}
 return deps;
}
function validate(s){if(!enabled(s))return [];const errors=[],stages=s.stages||[],ids=new Set(),teams=new Set(s.teams.map(t=>t.id)),mids=new Map(s.matches.map(m=>[m.id,m])),targets=new Set();
 if(stages.length>64)return ['最多支持64个赛段'];if(mids.size!==s.matches.length)errors.push('对阵编号重复');
 for(const st of stages){
  if(!st.id||ids.has(st.id))errors.push('赛段编号重复或缺失');ids.add(st.id);
  if(!['group','playoff','swiss','custom'].includes(st.type))errors.push(`${st.name}：赛段类型无效`);
  const used=new Set(),slotIds=new Set();for(const sl of st.slots||[]){if(slotIds.has(sl.id))errors.push(`${st.name}：位置编号重复`);slotIds.add(sl.id);if(sl.teamId){if(!teams.has(sl.teamId))errors.push(`${st.name}：队伍已被删除`);if(used.has(sl.teamId))errors.push(`${st.name}：同一支队伍不能占两个入场位置`);used.add(sl.teamId);}}
  if(st.type==='group')for(const g of st.groups){if(!Number.isInteger(g.size)||g.size<2||g.size>32)errors.push(`${st.name}：每组人数须为2至32`);if(g.format==='gsl'&&g.size!==4)errors.push('四队双败必须4队');}
  const comparatorIds=new Set();for(const c of st.comparators||[]){if(st.type!=='group'||!c.id||c.id.includes(':')||comparatorIds.has(c.id))errors.push(`${st.name}：比较器编号或所属赛段无效`);comparatorIds.add(c.id);if(!Number.isInteger(c.teamCount)||c.teamCount<2||c.teamCount>st.slots.length)errors.push(`${st.name}：比较器队伍数须为2至${st.slots.length}`);if(!String(c.name||'').trim())errors.push('比较器名称不能为空');}
  const valid=new Set(outputs(s,st).map(x=>x.key));
  // Incomplete exits are valid drafts; activation performs exhaustive path checks.
  for(const[key,to]of Object.entries(st.routes||{})){
   if(!valid.has(key)){errors.push(`${st.name}：来源不存在 ${key}`);continue;}
   if(!to||!['pending','slot','match','end','eliminate','comparator'].includes(to.kind)){errors.push(`${st.name}：无效去向`);continue;}
   if(to.kind==='end'&&!TERMINALS.includes(to.label))errors.push(`${st.name}：无效终结状态 ${to.label||''}`);
   let target='';if(to.kind==='comparator'){
    const c=st.comparators?.find(c=>c.id===to.comparatorId);if(!c||!Number.isInteger(to.position)||to.position<1||to.position>c.teamCount)errors.push(`${st.name}：比较器入场位置不存在`);
    if(!comparatorSources(s,st).some(x=>x.key===key))errors.push('比较器只能接收本赛段的小组最终名次');target=`comparator/${st.id}/${to.comparatorId}/${to.position}`;
   }else if(to.kind==='slot'){
    const dst=stageOf(s,to.stageId),sl=dst?.slots.find(x=>x.id===to.slotId);if(!sl)errors.push(`${st.name}：目标位置不存在`);
    if(stages.indexOf(dst)<=stages.indexOf(st))errors.push('只能连接到后续赛段的入场位置');
    if(sl?.teamId)errors.push('目标位置已有直邀队伍，请先清空队伍');target=`slot/${to.stageId}/${to.slotId}`;
   }else if(to.kind==='match'){
    const dst=mids.get(to.matchId);if(!dst||!['A','B'].includes(to.side))errors.push(`${st.name}：目标比赛不存在`);
    if(dst){if(stages.findIndex(x=>x.id===dst.stageId)<stages.indexOf(st))errors.push('不能连接到此前赛段');if(dst.entryA&&to.side==='A'||dst.entryB&&to.side==='B')errors.push('目标比赛位置已有入场来源，请先清空');const ds=stageOf(s,dst.stageId);if(isRoundRobin(ds,dst)||ds.type==='swiss'&&!dst.custom)errors.push('循环赛与瑞士轮请连接赛段入场位置');}
    target=`match/${to.matchId}/${to.side}`;
   }
   if(target){if(targets.has(target))errors.push('一个位置只能接收一个晋级来源');targets.add(target);}
  }
 }
 for(const m of s.matches){const st=stageOf(s,m.stageId);if(!st){errors.push('比赛缺少所属赛段');continue;}if(!(isRoundRobin(st,m)?[1,2,3,5]:[1,3,5]).includes(m.bestOf))errors.push(`${m.round}：BO数不合法`);for(const side of ['A','B']){const src=m[`entry${side}`];if(src&&!['slot','team','bye'].includes(src.kind))errors.push(`${m.round}：入场来源无效`);if(src?.kind==='slot'&&!st.slots.some(sl=>sl.id===src.slotId))errors.push(`${m.round}：入场位置不存在`);if(src?.kind==='team'&&!teams.has(src.teamId))errors.push('比赛引用不存在的队伍');}}
 for(const m of s.matches){if(!['normal','final','thirdPlace'].includes(m.role||'normal'))errors.push(`${m.round}：对阵类型无效`);const fixed=roleTerminals(m.role);if(fixed){const st=stageOf(s,m.stageId);fixed.forEach((t,i)=>{const to=st?.routes?.[i?lose(m):win(m)];if(to?.kind!=='end'||to.label!==t)errors.push(`${m.round}：${m.role==='final'?'决赛':'季军赛'}必须固定为${fixed.join(' / ')}`);});}}
 if(errors.length)return [...new Set(errors)];
 const deps=dependencies(s),done=new Set(),active=new Set();function visit(key){if(active.has(key)){errors.push('连线形成循环，请改为向后推进');return;}if(done.has(key))return;active.add(key);for(const d of deps.get(key)||[])visit(d);active.delete(key);done.add(key);}for(const m of s.matches)visit(m.id);
 return [...new Set(errors)];
}
function assertValid(s){const e=validate(s);if(e.length)throw Error(e.join('；'));return s;}
function result(m,result){if(!m)return {ready:false,id:''};if(m.autoBye)return result==='winner'?{ready:true,id:m.teamAId||m.teamBId}:{ready:true,id:'',bye:true};if(m.status!=='completed')return {ready:false,id:''};const check=R.normalizeMatch(clone(m));if(check.status!=='completed')return {ready:false,id:''};const a=String(m.scoreA).toUpperCase(),b=String(m.scoreB).toUpperCase();let o=['W','WW'].includes(a)?1:['W','WW'].includes(b)?-1:Math.sign(Number(a)-Number(b));if(!o)return {ready:false,id:''};return {ready:true,id:(o>0)===(result==='winner')?m.teamAId:m.teamBId};}
function groupTable(s,st,g){const slotTeams=st.slots.filter(x=>x.groupId===g.id).map(x=>x.resolvedTeamId||x.teamId).filter(Boolean),map=new Map(s.teams.map(t=>[t.id,t]));const group=`${st.id}/${g.id}`;
 const state={tournament:{groupTieBreak:g.tieBreak||s.tournament.groupTieBreak},teams:slotTeams.map(key=>({...map.get(key),group})),matches:matchesOf(s,st.id).filter(m=>m.groupId===g.id&&!m.custom).map(m=>({...m,bracketRound:''}))};
 let rows=R.standings(state,group);if(g.rankOrder?.length===slotTeams.length&&new Set(g.rankOrder).size===slotTeams.length&&g.rankOrder.every(x=>slotTeams.includes(x)))rows.sort((a,b)=>g.rankOrder.indexOf(a.team.id)-g.rankOrder.indexOf(b.team.id));return rows;
}
function swissTable(s,st){const ids=st.slots.map(sl=>sl.resolvedTeamId||sl.teamId).filter(Boolean),stats=new Map(ids.map((key,i)=>[key,{team:s.teams.find(t=>t.id===key),won:0,lost:0,played:0,bu:0,seed:i,opponents:[]}])) ;
 for(const m of matchesOf(s,st.id).filter(m=>m.swissRound&&!m.custom)){const r=result(m,'winner');if(!r.ready)continue;const a=stats.get(m.teamAId),b=stats.get(m.teamBId);if(!a||!b)continue;a.played++;b.played++;a.opponents.push(b.team.id);b.opponents.push(a.team.id);r.id===a.team.id?(a.won++,b.lost++):(b.won++,a.lost++);}
 for(const r of stats.values())r.bu=r.opponents.reduce((n,key)=>n+stats.get(key).won-stats.get(key).lost,0);
 return [...stats.values()].sort((a,b)=>b.won-a.won||a.lost-b.lost||b.bu-a.bu||a.seed-b.seed);
}
function clearResult(m){const hadResult=m.status==='live'||m.status==='completed';if(hadResult)m.invalidatedResult={teamAId:m.teamAId,teamBId:m.teamBId,scoreA:m.scoreA,scoreB:m.scoreB,mapScores:clone(m.mapScores||[]),mapDetails:clone(m.mapDetails||[]),mvp:clone(m.mvp||null)};m.status='tbd';m.scoreA=0;m.scoreB=0;m.mapScores=(m.mapScores||[]).map(x=>({...x,a:null,b:null}));m.mapDetails=(m.mapDetails||[]).map(x=>({...x,a:null,b:null,teamA:[],teamB:[]}));delete m.mvp;delete m.autoBye;delete m.bp;delete m.bpBestOf;delete m.bpTeams;if(hadResult)m.resultInvalidated=true;}
function reconcile(s){if(!enabled(s))return s;assertValid(s);const {ins,slots}=indexes(s),byId=new Map(s.matches.map(m=>[m.id,m])),done=new Set(),doing=new Set(),stageDone=new Set(),comparisonTables=new Map();
 const resolve=(src,st)=>{
  if(!src)return {ready:false,id:''};if(src.kind==='bye')return {ready:true,id:'',bye:true};if(src.kind==='team')return {ready:!!src.teamId,id:src.teamId||''};
  if(src.kind==='slot'){const sl=st.slots.find(x=>x.id===src.slotId);if(!sl)return {ready:false,id:''};const from=slots.get(`${st.id}/${sl.id}`);const r=from?resolve(from,st):{ready:!!sl.teamId,id:sl.teamId||''};sl.resolvedTeamId=r.id;return r;}
  if(src.kind==='result'){compute(byId.get(src.matchId));return result(byId.get(src.matchId),src.result);}
  if(src.kind==='comparison'){
   const source=stageOf(s,src.stageId),c=source.comparators.find(c=>c.id===src.comparatorId),sources=comparatorSources(s,source),groups=new Set(comparatorInputs(source,c).map(key=>sources.find(x=>x.key===key)?.groupId));
   const cacheKey=`${source.id}/${c.id}`;if(!comparisonTables.has(cacheKey)){matchesOf(s,source.id).filter(m=>!m.custom&&groups.has(m.groupId)).forEach(compute);comparisonTables.set(cacheKey,comparatorTable(s,source,c));}const table=comparisonTables.get(cacheKey);return {ready:table.complete,id:table.complete?table.rows[src.rank-1]?.team.id||'':''};
  }
  if(src.kind==='rank'){
   const source=stageOf(s,src.stageId);if(source.type==='swiss'){computeSwiss(source);const rows=swissTable(s,source);const complete=rows.length===16&&rows.every(r=>r.won>=3||r.lost>=3);return {ready:complete,id:complete?rows[src.rank-1]?.team.id||'':''};}
   const gm=matchesOf(s,source.id).filter(m=>m.groupId===src.groupId&&!m.custom);gm.forEach(compute);const complete=gm.length>0&&gm.every(m=>m.status==='completed');const rows=groupTable(s,source,source.groups.find(g=>g.id===src.groupId));return {ready:complete,id:complete?rows[src.rank-1]?.team.id||'':''};
  }return {ready:false,id:''};
 };
 function assign(m,a,b){if(m.teamAId!==a.id||m.teamBId!==b.id){clearResult(m);if(s.selectedMatchId===m.id&&s.mvp)s.mvp={...s.mvp,teamId:'',playerId:'',rating:'',we:'',statline:'',note:''};}m.teamAId=a.id;m.teamBId=b.id;delete m.autoBye;
  if(a.ready&&b.ready&&(a.bye||b.bye)&&(a.id||b.id)){m.autoBye=true;m.status='completed';m.scoreA=0;m.scoreB=0;delete m.resultWarning;}
  else if(a.id&&b.id){if(a.id===b.id)throw Error(`${m.round}：连线导致同一队伍对阵自己`);if(m.status==='tbd')m.status='upcoming';R.normalizeMatch(m);}
  else m.status='tbd';
 }
 function compute(m){if(!m||done.has(m.id))return;if(doing.has(m.id))throw Error('赛程连线循环');const st=stageOf(s,m.stageId);if(st.type==='swiss'&&!m.custom){computeSwiss(st);return;}doing.add(m.id);const a=resolve(ins.get(`${m.id}/A`)||m.entryA,st),b=resolve(ins.get(`${m.id}/B`)||m.entryB,st);assign(m,a,b);done.add(m.id);doing.delete(m.id);}
 function computeSwiss(st){if(stageDone.has(st.id))return;stageDone.add(st.id);const ms=matchesOf(s,st.id).filter(m=>!m.custom),entrants=st.slots.map(sl=>resolve({kind:'slot',slotId:sl.id},st));
  for(const m of ms.filter(m=>m.swissRound===1)){assign(m,entrants[m.bracketIndex],entrants[m.bracketIndex+8]);done.add(m.id);}
  const available=entrants.every(x=>x.ready&&x.id);if(available&&new Set(entrants.map(x=>x.id)).size!==16)throw Error('瑞士轮参赛队伍重复');
  for(let round=2;round<=5;round++){
   const roundMs=ms.filter(m=>m.swissRound===round).sort((a,b)=>a.bracketIndex-b.bracketIndex),earlier=ms.filter(m=>m.swissRound<round),prior=ms.filter(m=>m.swissRound===round-1&&(m.teamAId||m.teamBId));
   const basis=JSON.stringify([entrants.map(x=>x.id),earlier.map(m=>[m.id,m.teamAId,m.teamBId,m.status,m.scoreA,m.scoreB])]);
   const complete=available&&prior.length&&prior.every(m=>result(m,'winner').ready);let pairs=[];
   if(complete){
    const partial={...s,matches:s.matches.filter(m=>m.stageId!==st.id||m.swissRound<round)},table=swissTable(partial,st),active=table.filter(r=>r.won<3&&r.lost<3);
    const pair=list=>{if(!list.length)return [];const[a,...rest]=list;for(const b of [...rest].sort((x,y)=>Math.abs(x.won-a.won)-Math.abs(y.won-a.won))){if(a.opponents.includes(b.team.id))continue;const tail=pair(rest.filter(x=>x!==b));if(tail)return [[a.team.id,b.team.id],...tail];}return null;};pairs=pair(active);if(!pairs)throw Error('瑞士轮无法配出无重复对阵');
   }
   for(let i=0;i<roundMs.length;i++){const m=roundMs[i];if(m.pairingBasis&&m.pairingBasis!==basis)clearResult(m);const p=pairs[i]||['',''];assign(m,{ready:!!p[0],id:p[0]},{ready:!!p[1],id:p[1]});m.pairingBasis=basis;m.inactive=!!complete&&!p[0];done.add(m.id);}
  }
 }
 for(const st of s.stages){for(const sl of st.slots)resolve({kind:'slot',slotId:sl.id},st);const ids=st.slots.map(sl=>sl.resolvedTeamId).filter(Boolean);if(new Set(ids).size!==ids.length)throw Error(`${st.name}：晋级路径使同一队伍重复入场`);for(const m of matchesOf(s,st.id))compute(m);}
 s.flowOutcomes=[];for(const st of s.stages)for(const out of outputs(s,st)){const to=st.routes[out.key];if(!to||!['end','eliminate'].includes(to.kind))continue;const resolved=resolve(routeSource(out.key,st),st);if(resolved.ready&&resolved.id)s.flowOutcomes.push({stageId:st.id,source:out.key,matchId:out.matchId||'',teamId:resolved.id,status:to.kind==='eliminate'?'淘汰':to.label});}
 renumber(s);return s;
}
function setRoute(s,stageId,key,to){const st=stageOf(s,stageId),m=s.matches.find(m=>key===win(m)||key===lose(m));if(m&&m.role&&m.role!=='normal')throw Error('决赛与季军赛的终结状态固定，请先改为普通对阵');if(to.kind==='match'){const dst=s.matches.find(x=>x.id===to.matchId),entry=dst?.[`entry${to.side}`],owner=dst&&stageOf(s,dst.stageId);if(entry?.kind==='slot'&&!owner.slots.find(sl=>sl.id===entry.slotId)?.teamId&&!indexes(s).slots.has(`${owner.id}/${entry.slotId}`))dst[`entry${to.side}`]=null;}st.routes[key]=to;assertValid(s);return s;}
function label(s,st,src){if(src?.kind==='comparison')return `${stageOf(s,src.stageId)?.comparators?.find(c=>c.id===src.comparatorId)?.name||'跨组比较器'} 第${src.rank}名`;if(!src)return '等待连线';if(src.kind==='bye')return '轮空';if(src.kind==='team')return s.teams.find(t=>t.id===src.teamId)?.name||'待定';if(src.kind==='slot'){const sl=st.slots.find(x=>x.id===src.slotId);return sl?.label||'位置已删除';}if(src.kind==='rank')return `${stageOf(s,src.stageId)?.name||''} / ${src.groupId==='swiss'?'':stageOf(s,src.stageId)?.groups.find(g=>g.id===src.groupId)?.name||''} 第${src.rank}名`;const m=s.matches.find(m=>m.id===src.matchId);return `${m?.round||''} ${m?shortId(m):''}${src.result==='winner'?'胜者':'败者'}`;}
function targetLabel(s,to){if(to?.kind==='comparator')return `${s.stages.flatMap(st=>st.comparators||[]).find(c=>c.id===to.comparatorId)?.name||'跨组比较器'} / 入场${to.position}`;if(!to||to.kind==='pending')return '待连接';if(to.kind==='eliminate')return '淘汰';if(to.kind==='end')return `终结 · ${to.label}`;if(to.kind==='slot')return `${stageOf(s,to.stageId)?.name} / ${stageOf(s,to.stageId)?.slots.find(sl=>sl.id===to.slotId)?.label} · ${slotMatches(s,to).map(m=>`${m.round} ${shortId(m)} ${['A','B'].filter(side=>m[`entry${side}`]?.slotId===to.slotId).join('/')}位`).join('、')||'无比赛'}`;const m=s.matches.find(m=>m.id===to.matchId);return `${m?.stage} / ${m?.round} ${m?shortId(m):''} · ${to.side}位`;}
function readiness(s){const notes=[];for(const st of s.stages||[])for(const c of st.comparators||[])comparatorInputs(st,c).forEach((key,i)=>{if(!key)notes.push(`${st.name} ${c.name}：入场${i+1}尚未选择小组名次`);});for(const st of s.stages||[]){const idx=indexes(s);for(const sl of st.slots)if(slotMatches(s,{stageId:st.id,slotId:sl.id}).length&&!sl.teamId&&!idx.slots.has(`${st.id}/${sl.id}`))notes.push(`${st.name} ${sl.label} 尚未选择队伍或连接来源`);for(const m of matchesOf(s,st.id))if(!isRoundRobin(st,m)&&(st.type!=='swiss'||m.custom))for(const side of ['A','B'])if(!m[`entry${side}`]&&!idx.ins.has(`${m.id}/${side}`))notes.push(`${st.name} ${m.round} ${shortId(m)} ${side}位尚未连接`);}return notes;}

function roleTerminals(role){return role==='final'?['冠军','亚军']:role==='thirdPlace'?['季军','殿军']:null;}
function setRole(s,matchId,role){const m=s.matches.find(m=>m.id===matchId);if(!m)throw Error('比赛不存在');const st=stageOf(s,m.stageId);if(isRoundRobin(st,m)||st.type==='swiss'&&!m.custom)throw Error('循环赛与瑞士轮的轮内比赛使用最终排名出口');if(!['normal','final','thirdPlace'].includes(role))throw Error('无效对阵类型');const was=m.role;m.role=role;const fixed=roleTerminals(role);if(fixed){st.routes[win(m)]=terminal(fixed[0]);st.routes[lose(m)]=terminal(fixed[1]);}else if(was&&was!=='normal'){st.routes[win(m)]=pending();st.routes[lose(m)]=pending();}return m;}
function slotMatches(s,to){return matchesOf(s,to.stageId).filter(m=>['A','B'].some(side=>m[`entry${side}`]?.kind==='slot'&&m[`entry${side}`].slotId===to.slotId));}
function normalize(s){if(!enabled(s))return s;for(const st of s.stages||[]){st.routes=st.routes||{};for(const [key,to] of Object.entries(st.routes)){if(to?.kind==='end'&&to.label==='晋级')st.routes[key]=terminal('Qualified');else if(to?.kind==='end'&&!TERMINALS.includes(to.label))st.routes[key]=pending();}for(const m of matchesOf(s,st.id))if(!m.role){const a=st.routes[win(m)],b=st.routes[lose(m)];m.role=a?.label==='冠军'&&b?.label==='亚军'?'final':a?.label==='季军'&&b?.label==='殿军'?'thirdPlace':'normal';}}s.flowLifecycle=s.flowLifecycle||{status:'draft'};return s;}
// Only configuration is signed: live results, output selection and resolved entrants do not invalidate activation.
function configuration(s){return JSON.stringify({stages:(s.stages||[]).map(st=>({...st,slots:st.slots.map(({resolvedTeamId,...sl})=>sl)})),matches:s.matches.map(m=>({id:m.id,stageId:m.stageId,round:m.round,role:m.role||'normal',bestOf:m.bestOf,groupId:m.groupId,custom:!!m.custom,swissRound:m.swissRound,bracketIndex:m.bracketIndex,entryA:m.entryA,entryB:m.entryB}))});}
function activationErrors(s){const structural=validate(s);if(structural.length)return structural;const errors=readiness(s);for(const st of s.stages||[])if(st.templateDraft)errors.push(`${st.name}：赛制参数草稿尚未应用，请应用模板后再启用`);for(const m of s.matches){if(!String(m.round||'').trim())errors.push(`${shortId(m)}：轮次名称不能为空`);if(m.entryA?.kind==='bye'&&m.entryB?.kind==='bye')errors.push(`${m.round}：不能两侧均轮空`);}if(!s.stages?.length||!s.matches.length)errors.push('尚未添加赛段或对阵');const memo=new Map(),visiting=new Set();
 const exits=m=>{const st=stageOf(s,m.stageId);return isRoundRobin(st,m)?outputs(s,st).filter(o=>o.key.startsWith(`rank:${m.groupId}:`)):st.type==='swiss'&&!m.custom?outputs(s,st).filter(o=>o.key.startsWith('rank:swiss:')):outputs(s,st).filter(o=>o.matchId===m.id);};
 function walk(st,out){const key=`${st.id}/${out.key}`;if(memo.has(key))return memo.get(key);if(visiting.has(key)){errors.push(`${st.name} ${out.label}：路径循环`);return false;}visiting.add(key);const to=st.routes[out.key];let ok=false;if(!to||to.kind==='pending')errors.push(`${st.name} ${out.label}：未设置去向`);else if(to.kind==='eliminate'||to.kind==='end'&&TERMINALS.includes(to.label))ok=true;else if(to.kind==='comparator'){ok=true;for(const exit of outputs(s,st).filter(o=>o.comparatorId===to.comparatorId))if(!walk(st,exit))ok=false;}else{const next=to.kind==='match'?s.matches.filter(m=>m.id===to.matchId):to.kind==='slot'?slotMatches(s,to):[];if(!next.length)errors.push(`${st.name} ${out.label}：目标没有后续比赛`);else{ok=true;for(const m of next)for(const exit of exits(m))if(!walk(stageOf(s,m.stageId),exit))ok=false;}}visiting.delete(key);memo.set(key,ok);return ok;}
 for(const st of s.stages||[])for(const out of outputs(s,st))walk(st,out);
 // Every occupied entry is a single competitor. Split sources in knockout modules would duplicate that team.
 for(const st of s.stages||[])for(const sl of st.slots){const consumers=slotMatches(s,{stageId:st.id,slotId:sl.id});if(consumers.length>1&&consumers.some(m=>!isRoundRobin(st,m)))errors.push(`${st.name} ${sl.label}：同一入场位置被多个对阵重复使用`);}
 return [...new Set(errors)];
}
function isActive(s){return s.flowLifecycle?.status==='active'&&s.flowLifecycle.configuration===configuration(s);}
function activate(s){const errors=activationErrors(s);if(errors.length)throw Error('赛事尚不能启用：'+errors.join('；'));s.flowLifecycle={status:'active',configuration:configuration(s),activatedAt:new Date().toISOString()};return s;}
function refreshLifecycle(s){if(!enabled(s))return s;if(s.flowLifecycle?.status==='active'&&!isActive(s))s.flowLifecycle={status:'draft'};if(isActive(s)){const errors=activationErrors(s);if(errors.length)throw Error('赛事启用校验失败：'+errors.join('；'));}return s;}
function enforceSave(previous,next,reason='auto'){if(!enabled(next))return next;refreshLifecycle(next);if(reason==='auto'||reason==='replace'){
 const before=new Map((previous.matches||[]).map(m=>[m.id,m]));
 const resultData=m=>JSON.stringify([m.scoreA,m.scoreB,m.mapScores,m.mapDetails,m.mvp,['live','completed'].includes(m.status)?m.status:'waiting']);
 // Team propagation can legitimately clear stale results. Reject newly entered/edited results in a draft.
 const meaningful=m=>['live','completed'].includes(m.status)||Number(m.scoreA)>0||Number(m.scoreB)>0||/^(W|F|WW|FF)$/i.test(String(m.scoreA))||/^(W|F|WW|FF)$/i.test(String(m.scoreB))||(m.mapScores||[]).some(R.validMap)||(m.mapDetails||[]).some(x=>x.teamA?.length||x.teamB?.length);
 const changed=next.matches.some(m=>{const old=before.get(m.id);return !m.autoBye&&meaningful(m)&&(!old||resultData(m)!==resultData(old));});
 if(changed&&!isActive(next))throw Error('请先在赛事设置中完成全部去向并“校验并启用”，再录入赛果');
 if(!isActive(next)&&((next.liveScene!==previous.liveScene&&!['blank','custom1','custom2'].includes(next.liveScene))||next.outputCycle?.enabled&&!previous.outputCycle?.enabled))throw Error('草稿赛事不能投入播出，请先校验并启用');
 }return next;}


function addTeam(s){const key=`team-${id()}`,number=s.teams.length+1,team={id:key,name:`新队伍 ${number}`,shortName:'NEW',color:'#668dc3',logoPrimary:'',logoSecondary:'',players:Array.from({length:7},(_,i)=>({id:`player_${number}_${i+1}`,role:['Rifler','AWPer','IGL','Entry','Support','Substitute','Substitute'][i],rating:1,avatar:'',steamId:'',starter:i<5}))};s.teams.push(team);return team;}
function teamUsage(s,key){return {stages:(s.stages||[]).filter(st=>st.slots.some(sl=>sl.teamId===key||sl.resolvedTeamId===key)||matchesOf(s,st.id).some(m=>m.entryA?.teamId===key||m.entryB?.teamId===key)),matches:s.matches.filter(m=>m.teamAId===key||m.teamBId===key)};}
function removeTeam(s,key){if(!s.teams.some(t=>t.id===key))throw Error('队伍不存在');s.teams=s.teams.filter(t=>t.id!==key);for(const st of s.stages||[]){for(const sl of st.slots){if(sl.teamId===key)sl.teamId='';if(sl.resolvedTeamId===key)sl.resolvedTeamId='';}for(const g of st.groups||[])if(g.rankOrder?.includes(key))delete g.rankOrder;}
 for(const m of [...s.matches,...(s.legacyFlowBackup?.matches||[])]){if(m.teamAId===key||m.teamBId===key)clearResult(m);for(const side of ['A','B']){if(m[`team${side}Id`]===key)m[`team${side}Id`]='';if(m[`entry${side}`]?.kind==='team'&&m[`entry${side}`].teamId===key)m[`entry${side}`]=null;}if(m.mvp?.teamId===key)delete m.mvp;}
 if(s.entrance?.overrides)delete s.entrance.overrides[key];if(s.mvp?.teamId===key)s.mvp={...s.mvp,teamId:'',playerId:'',rating:'',we:''};
 if(enabled(s)){reconcile(s);refreshLifecycle(s);}return s;}
return {comparatorRank,comparatorSources,comparatorInputs,addComparator,resizeComparator,removeComparator,setComparatorInput,comparatorTable,addTeam,removeTeam,teamUsage,TERMINALS,pending,roleTerminals,setRole,slotMatches,normalize,configuration,activationErrors,isActive,activate,refreshLifecycle,enforceSave,enabled,blank,createStage,resizeSlots,build,addStage,regenerate,removeStage,addMatch,removeMatch,renumber,outputs,validate,assertValid,reconcile,setRoute,indexes,dependencies,groupTable,swissTable,result,isRoundRobin,shortId,label,targetLabel,readiness,stageOf,matchesOf,routeSource,terminal,win,lose,rank};
});
