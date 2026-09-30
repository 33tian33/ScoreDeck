const sdMaps=['dust2','mirage','inferno','nuke','ancient','anubis','overpass','train','vertigo'];
const sdMapKey=v=>String(v||'').toLowerCase().replace(/^.*\//,'').replace(/^de_/,'').replace(/[^a-z0-9]/g,'').replace(/^dustii$/,'dust2');
const sdBPTemplate=(bo,first='A')=>({1:['A:ban','B:ban','A:ban','B:ban','A:ban','B:ban',':decider'],2:['A:ban','B:ban','A:ban','B:ban','A:pick','B:pick',':unused'],3:['A:ban','B:ban','A:pick','B:pick','A:ban','B:ban',':decider'],5:['A:ban','B:ban','A:pick','B:pick','A:pick','B:pick',':decider']}[bo]||[]).map(x=>{const [team,action]=x.split(':');return {team:first==='B'&&team?(team==='A'?'B':'A'):team,action,map:''};});
const sdBPValid=m=>!!m&&m.bpBestOf===m?.bestOf&&(!m.bpTeams||JSON.stringify(m.bpTeams)===JSON.stringify([m.teamAId||'',m.teamBId||'']));
const sdBPBase=m=>({bestOf:m.bestOf,bp:m.bp||[],bpFirstSide:m.bpFirstSide||'A',teamAId:m.teamAId,teamBId:m.teamBId});
const sdBPInitial=m=>sdBPValid(m)&&Array.isArray(m.bp)?m.bp:sdBPTemplate(m.bestOf,m.bpFirstSide||'A');
function sdMatchData({state,match:m,commit}){
 const h=l.createElement,[first,setFirst]=l.useState(m.bpFirstSide||'A'),[steps,setSteps]=l.useState(()=>sdBPInitial(m)),[dirty,setDirty]=l.useState(false),[message,setMessage]=l.useState(''),[gsi,setGsi]=l.useState(null),base=l.useRef(sdBPBase(m));
 l.useEffect(()=>{if(!dirty){setFirst(m.bpFirstSide||'A');setSteps(sdBPInitial(m));base.current=sdBPBase(m);}},[m.id,m.bestOf,m.bpFirstSide,m.teamAId,m.teamBId,JSON.stringify(m.bp),dirty]);
 const save=async()=>{try{await SDClient.request('/api/match-bp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({matchId:m.id,steps,firstSide:first,base:base.current})});setDirty(false);setMessage('BP 与开局选边已保存，导播输出已同步');}catch(e){setMessage(e.message);}};
 const update=fn=>Promise.resolve(commit(s=>{fn(s.matches.find(x=>x.id===m.id));return s;})).catch(e=>setMessage(e.message));
 const options=sdBPTemplate(m.bestOf,m.bpFirstSide||'A'),bpCards=(steps||options).map((s,i)=>h('label',{key:i},
  h('span',null,`${i+1} · ${s.team?state.teams.find(t=>t.id===m['team'+s.team+'Id'])?.shortName||s.team:'自动'} ${s.action.toUpperCase()}`),
  s.map&&h('img',{src:'/assets/maps/'+sdMapKey(s.map)+'.svg',alt:s.map}),
  h('select',{'aria-label':`BP ${i+1}`,value:s.map,onChange:e=>{setDirty(true);setSteps(old=>old.map((v,j)=>j===i?{...v,map:e.target.value,sidePicker:'',startSide:''}:v));}},
   h('option',{value:''},'选择地图'),...sdMaps.map(k=>h('option',{value:k,key:k,disabled:steps.some((v,j)=>j!==i&&sdMapKey(v.map)===k)},k.toUpperCase())))));
 const teamName=side=>state.teams.find(t=>t.id===m['team'+side+'Id'])?.name||('队伍 '+side);
 const sideRows=(steps||options).map((v,i)=>{
  if(!['pick','decider'].includes(v.action))return null;
  const editSide=(key,value)=>{setDirty(true);setSteps(old=>old.map((x,j)=>j===i?{...x,[key]:value,...(key==='sidePicker'?{startSide:''}:{})}:x));};
  const a=v.sidePicker&&v.startSide?(v.sidePicker==='A'?v.startSide:v.startSide==='CT'?'T':'CT'):'';
  return h('div',{key:i,className:'sd-side-row'},h('b',null,`${v.map?.toUpperCase()||'待选地图'} · ${v.action.toUpperCase()}`),
   h('label',null,'选边队伍',h('select',{'aria-label':`BP ${i+1} 选边队伍`,disabled:!v.map,value:v.sidePicker||'',onChange:e=>editSide('sidePicker',e.target.value)},h('option',{value:''},'待定'),...['A','B'].map(side=>h('option',{key:side,value:side},teamName(side))))),
   h('label',null,'所选开局阵营',h('select',{'aria-label':`BP ${i+1} 开局阵营`,disabled:!v.map||!v.sidePicker,value:v.startSide||'',onChange:e=>editSide('startSide',e.target.value)},h('option',{value:''},'待定'),h('option',{value:'CT'},'CT · 防守方'),h('option',{value:'T'},'T · 进攻方'))),
   h('small',null,a?`${teamName('A')}：${a} / ${teamName('B')}：${a==='CT'?'T':'CT'}`:'等待人工确认选边'));
 });
 let bindings=null;
 if(gsi){
  if(gsi.matchId!==m.id)bindings=h('p',null,'请先将本场设为主对阵，再读取 GSI。');
  else if(!gsi.players.length)bindings=h('p',null,'尚未收到观察者 GSI 的选手数据。');
  else bindings=gsi.players.map(p=>{
   const opts=['A','B'].flatMap(side=>(state.teams.find(t=>t.id===m['team'+side+'Id'])?.players||[]).map(v=>h('option',{key:side+v.id,disabled:!!v.steamId&&v.steamId!==p.id,value:JSON.stringify({side,playerId:v.id})},`${side} · ${v.id}`)));
   const bind=e=>{const v=e.target.value;update(x=>{x.gsiBindings||={};if(v){const binding=JSON.parse(v);for(const [id,b]of Object.entries(x.gsiBindings))if(id!==p.id&&b.side===binding.side&&b.playerId===binding.playerId)delete x.gsiBindings[id];x.gsiBindings[p.id]={...binding,source:'manual'};}else delete x.gsiBindings[p.id];delete x.gsiFingerprint;});};
   return h('label',{key:p.id},h('span',null,`${p.name} · ${p.side} · ${p.id}`),h('select',{value:m.gsiBindings?.[p.id]?JSON.stringify({side:m.gsiBindings[p.id].side,playerId:m.gsiBindings[p.id].playerId}):'',onChange:bind},h('option',{value:''},'自动匹配：Steam64 优先 / 昵称兜底'),...opts));
  });
 }
 return h('details',{className:'sd-match-data'},
  h('summary',null,`地图 BP · BO${m.bestOf} / GSI 当图数据`),
  h('p',null,'7 图池模板自动跟随 BO。手动选图并保存；空白步骤可稍后继续录入。BO2 为固定两图，最后一张不使用。'),
  h('div',{className:'sf-actions sd-bp-order'},h('label',null,'BP 先手方',h('select',{'aria-label':'BP 先手方',value:first,onChange:e=>{const side=e.target.value;setFirst(side);setDirty(true);setSteps(old=>sdBPTemplate(m.bestOf,side).map((v,i)=>({...v,map:old?.[i]?.map||'',sidePicker:old?.[i]?.sidePicker||'',startSide:old?.[i]?.startSide||''})));}},...['A','B'].map(side=>h('option',{key:side,value:side},`${side} · ${state.teams.find(t=>t.id===m['team'+side+'Id'])?.name||'待定队伍'}`)))),h('span',null,`后手方：${state.teams.find(t=>t.id===m['team'+(first==='A'?'B':'A')+'Id'])?.name||'待定队伍'}`)),
  h('small',null,'更换先手方会交换所有禁选步骤的队伍归属，保留已输入的地图。点击“保存 BP”生效。'),
  h('div',{className:'sd-bp-grid'},...bpCards),
  h('div',{className:'sd-side-settings'},h('b',null,'逐图开局选边'),h('small',null,'记录选边队伍与其选择的 CT/T，另一队自动取相反阵营。DECIDER 的选边结果同样手工录入；中场换边不会改写此记录。'),...sideRows),
  h('div',{className:'sf-actions'},h(sdFlowButton,{primary:true,onClick:save,disabled:!dirty},'保存 BP'),
   h('label',null,h('input',{type:'checkbox',checked:m.gsiEnabled!==false,onChange:e=>update(x=>x.gsiEnabled=e.target.checked)}),'GSI 自动填写逐图 KDA'),
   h(sdFlowButton,{onClick:async()=>{try{setGsi(await(await fetch('/api/match-data')).json());}catch(e){setMessage(e.message);}}},'读取 GSI 选手 / 绑定')),
  h('small',null,m.gsiUpdatedAt?`最近采集 ${new Date(m.gsiUpdatedAt).toLocaleTimeString()} · 地图 ${(m.currentMapIndex||0)+1} · 换边后按选手身份追踪`:'将本场设为主对阵，接入观察者 GSI；选手同名会自动匹配，也可手动绑定 SteamID。'),
  bindings&&h('div',{className:'sd-bindings'},bindings),h(sdStoredStats,{state,match:m}),message&&h('p',{role:'status'},message));
}

function sdStoredStats({state,match:m}){
 const h=l.createElement;
 return h('div',{className:'sd-data-summary'},...(m.mapDetails||[]).slice(0,m.bestOf).map((d,i)=>{
  const tables=['A','B'].map(side=>{
   const rows=(d['team'+side]||[]).filter(p=>p.starter).map(p=>h('tr',{key:p.playerId},...[p.playerId,p.kills??'—',p.deaths??'—',p.assists??'—',p.adr??'—'].map((v,j)=>h('td',{key:j},v))));
   return h('div',{key:side},h('b',null,state.teams.find(t=>t.id===m['team'+side+'Id'])?.name||side),h('table',null,h('thead',null,h('tr',null,...['选手','K','D','A','ADR'].map(t=>h('th',{key:t},t)))),h('tbody',null,...rows)));
  });
  return h('details',{key:i},h('summary',null,`${d.map||'MAP '+(i+1)} · ${d.a??'—'} : ${d.b??'—'}`),...tables);
 }));
}
function sdMapStats({state}){
 const h=l.createElement,m=ScoreDeckFlow.enabled(state)?ScoreDeckDisplay.primary(state):state.matches.find(m=>m.id===state.selectedMatchId),index=Math.max(0,Math.min((m?.bestOf||1)-1,Number(state.statsMapIndex??m?.currentMapIndex)||0)),d=m?.mapDetails?.[index]||{},map=m?.mapScores?.[index]||{},teams=['A','B'].map(side=>state.teams.find(t=>t.id===m?.['team'+side+'Id'])||{}),name=d.map||map.map||'MAP',score=[d.a??map.a??'—',d.b??map.b??'—'];
 const table=(side,i)=>{const rows=(d['team'+side]||teams[i].players?.map((p,j)=>({playerId:p.id,starter:p.starter??j<5}))||[]).filter(p=>p.starter).slice(0,5),cols=i?['PLAYER','K','D','A','ADR']:['K','D','A','ADR','PLAYER'];return h('section',{className:'sd-stats-team'},h(sdFlowLogo,{team:teams[i]}),h('h2',null,teams[i].name||'等待队伍'),h('table',null,h('thead',null,h('tr',null,...cols.map(v=>h('th',{key:v},v)))),h('tbody',null,...rows.map(p=>{const stat=[p.kills??'—',p.deaths??'—',p.assists??'—',Number.isFinite(p.adr)?Math.round(p.adr):'—'],values=i?[p.playerId,...stat]:[...stat,p.playerId];return h('tr',{key:p.playerId},...values.map((v,j)=>h('td',{key:j},v)));}))),!rows.length&&h('p',null,'等待选手数据'));};
 return h('section',{className:'scene sd-map-stats',style:{backgroundImage:`linear-gradient(110deg,rgba(8,19,102,.9),rgba(8,12,36,.91)),url('/assets/maps/${sdMapKey(name)}.png')`}},h('header',null,h('span',null,state.tournament.name),h('small',null,'MAP '+(index+1)+' / '+(m?.bestOf||1)+' · '+(m?.gsiPhase==='gameover'?'FINAL':'MATCH STATS'))),h('h1',null,name.replace(/^de_/,'').toUpperCase()),h('div',{className:'sd-stats-score'},h('b',{className:Number(score[0])>Number(score[1])?'winner':''},score[0]),h('span',null,'—'),h('b',{className:Number(score[1])>Number(score[0])?'winner':''},score[1])),h('div',{className:'sd-stats-tables'},table('A',0),table('B',1)),h('footer',null,h('span',null,m?.round||'当图战绩'),h('span',null,'K 击杀 · D 死亡 · A 助攻 · ADR 无有效数据时显示 —')));
}

function sdStatsControls({state,commit}){const h=l.createElement,m=ScoreDeckFlow.enabled(state)?ScoreDeckDisplay.primary(state):state.matches.find(m=>m.id===state.selectedMatchId);return h('div',{className:'sfd-controls'},h(sdFlowSelect,{label:'当图战绩 · 展示地图',value:state.statsMapIndex==null?'':String(state.statsMapIndex),options:[['','跟随 GSI 当前地图'],...Array.from({length:m?.bestOf||1},(_,i)=>[String(i),`地图 ${i+1} · ${m?.mapScores?.[i]?.map||'待定'}`])],onChange:v=>commit(s=>{s.statsMapIndex=v===''?null:Number(v);return s;})}),h('a',{href:'/highlights',target:'_blank',rel:'noopener',className:'button secondary'},'编辑半场 / 全场精选画面'));}

function sdMapBP({state}){
 const h=l.createElement,m=ScoreDeckFlow.enabled(state)?ScoreDeckDisplay.primary(state):state.matches.find(x=>x.id===state.selectedMatchId)||state.matches[0];
 const team=side=>state.teams.find(t=>t.id===m?.['team'+side+'Id'])||{},name=side=>team(side).shortName||team(side).name||('队伍 '+side);
 const steps=m?sdBPInitial(m):[],first=m?.bpFirstSide||'A';let mapNumber=0;
 const cards=steps.map((v,i)=>{
  const played=['pick','decider'].includes(v.action),number=played?++mapNumber:null,a=v.sidePicker&&v.startSide?(v.sidePicker==='A'?v.startSide:v.startSide==='CT'?'T':'CT'):'';
  return h('article',{key:i,className:'sd-veto-card '+v.action+(v.map?'':' pending')},
   h('div',{className:'sd-veto-step'},h('span',null,String(i+1).padStart(2,'0')),h('b',null,v.action==='unused'?'UNUSED':v.action.toUpperCase())),
   h('div',{className:'sd-veto-owner'},v.team&&team(v.team).logoPrimary&&h(sdFlowLogo,{team:team(v.team)}),v.team&&h('span',{title:team(v.team).name},name(v.team))),
   h('div',{className:'sd-veto-art',style:v.map?{backgroundImage:`linear-gradient(0deg,#101721,transparent 85%),url('/assets/maps/${sdMapKey(v.map)}.png')`}:{}},h('h2',null,v.map?(v.map==='dust2'?'DUST II':v.map.toUpperCase()):'待选地图')),
   played&&h('div',{className:'sd-veto-result'},h('span',{className:'sd-veto-mapno'},`MAP ${number}`),
    h('div',{className:'sd-veto-sides'},...['A','B'].map(side=>{const start=a?(side==='A'?a:a==='CT'?'T':'CT'):'';return h('div',{key:side},h('span',{title:team(side).name},name(side)),h('b',{className:start.toLowerCase()},start||'—'));}))));
 });
 const heading=side=>h('div',{className:'sd-veto-team'},team(side).logoPrimary&&h(sdFlowLogo,{team:team(side)}),h('div',null,h('strong',null,team(side).name||('待定队伍 '+side)),h('small',null,first===side?'BP 先手':'BP 后手')));
 return h('section',{className:'scene sd-bp-scene'},h('header',null,h('span',null,state.tournament.name),h('span',null,`${m?.round||'当前对阵'} · BO${m?.bestOf||'—'}`)),
  h('div',{className:'sd-veto-heading'},heading('A'),h('div',{className:'sd-veto-title'},h('h1',null,'MAP VETO')),heading('B')),
  m?h('div',{className:'sd-veto-cards'},...cards):h('p',{className:'sd-veto-empty'},'暂无对阵'));
}
