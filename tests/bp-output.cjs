const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const M=require('../server/match-data.cjs'),D=require('../server/default-state.cjs'),F=require('../server/tournament-flow.cjs'),V=require('../server/flow-display.cjs'),H=require('../server/highlights.cjs');
const make=(bo,first='A')=>{const m={bestOf:bo,teamAId:'a',teamBId:'b'},steps=M.template(bo,first).map((v,i)=>({...v,map:M.MAPS[i],...(['pick','decider'].includes(v.action)?{sidePicker:i%2?'A':'B',startSide:i%2?'T':'CT'}:{})}));M.applyBP(m,steps,first);return m;};
test('all BO and first-side variants persist opening sides only on played maps, atomic invalid saves',()=>{
 for(const bo of [1,2,3,5])for(const first of ['A','B']){
  const m=make(bo,first);assert.equal(m.bp.filter(v=>v.startSide).length,bo);assert.equal(m.bp.at(-1).action,bo===2?'unused':'decider');
  const before=structuredClone(m),bad=structuredClone(m.bp);bad.find(v=>v.action==='ban').sidePicker='A';bad.find(v=>v.action==='ban').startSide='CT';assert.throws(()=>M.applyBP(m,bad),/不能设置选边/);assert.deepEqual(m,before);
  const invalid=structuredClone(m.bp),pick=invalid.find(v=>v.startSide);pick.startSide='DEF';assert.throws(()=>M.applyBP(m,invalid),/选边/);assert.deepEqual(m,before);
  pick.startSide='CT';pick.sidePicker='';assert.throws(()=>M.applyBP(m,invalid),/选边队伍/);
  M.applyBP(m,m.bp,first==='A'?'B':'A');assert.deepEqual(m.bp.map(v=>[v.map,v.sidePicker,v.startSide]),before.bp.map(v=>[v.map,v.sidePicker,v.startSide]));
  m.teamAId='replacement';assert.equal(M.bpValid(m),false);
 }
});
test('changing maps drops old opening sides, fresh/legacy BP leaves undecided sides blank',()=>{
 const m=make(3),steps=M.template(3).map((v,i)=>({...v,map:M.MAPS[i]}));steps[2].map='vertigo';M.applyBP(m,steps);
 assert.equal(m.bp[2].sidePicker,undefined);assert.equal(m.bp[2].startSide,undefined);assert.equal(m.bp[3].startSide,'T');
 const legacy={bestOf:1};M.applyBP(legacy,M.template(1).map((v,i)=>({...v,map:M.MAPS[i]})));assert.equal(legacy.bp[6].startSide,undefined);
});
const element=(type,props,...children)=>typeof type==='function'?type({...props,children}):({type,props:props||{},children:children.flat(Infinity).filter(v=>v!=null&&v!==false)});
const ctx=vm.createContext({l:{createElement:element,Fragment:'fragment'},ScoreDeckFlow:F,ScoreDeckDisplay:V,sdFlowLogo:({team})=>({type:'logo',props:{id:team.id},children:[]})});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../ui/match-data.js'),'utf8')+'\nglobalThis.bpView=sdMapBP;',ctx);
const find=(n,fn)=>typeof n==='object'?[...(fn(n)?[n]:[]),...(n.children||[]).flatMap(x=>find(x,fn))]:[];
const text=n=>typeof n==='object'?(n.children||[]).map(text).join(' '):String(n);
test('actual output component renders seven ordered steps, opening CT/T and BO2 unused map; follows main match',()=>{
 for(const bo of [1,2,3,5]){
  const s=D.createDefaultState();s.tournament.formatId='single-elim-16'; // Legacy current-match selection.
  const m=make(bo,'B');m.id='chosen';s.matches=[m];s.selectedMatchId=m.id;s.teams=[{id:'a',name:'队伍甲',shortName:'AAA'},{id:'b',name:'队伍乙',shortName:'BBB'}];
  const view=ctx.bpView({state:s}),cards=find(view,n=>n.props?.className?.startsWith('sd-veto-card '));assert.equal(cards.length,7);
  assert.equal(cards[0].props.className,'sd-veto-card ban');assert.match(text(cards[0]),/BBB/);
  const played=cards.filter(c=>/ (pick|decider)$/.test(c.props.className));assert.equal(played.length,bo);
  played.forEach(c=>{assert.match(text(c),/AAA/);assert.match(text(c),/BBB/);assert.equal(find(c,n=>n.type==='b'&&n.props.className==='ct').length,1);assert.equal(find(c,n=>n.type==='b'&&n.props.className==='t').length,1);});
  assert.match(text(cards[6]),bo===2?/UNUSED/:/DECIDER/);
  s.matches.push({...make(1),id:'other'});s.selectedMatchId='other';assert.equal(find(ctx.bpView({state:s}),n=>n.props?.className==='sd-veto-card pick').length,0);
 }
});
test('flow output follows selected main match; participant changes clear BP; scene survives saved layouts',()=>{
 const s=D.createDefaultState(),st=F.addStage(s,'playoff',{teamCount:2});st.slots.forEach((v,i)=>v.teamId=s.teams[i].id);F.reconcile(s);F.activate(s);const m=F.matchesOf(s,st.id)[0];s.selectedStageId=st.id;s.selectedMatchId=m.id;
 M.applyBP(m,M.template(m.bestOf).map((v,i)=>({...v,map:M.MAPS[i],...(['pick','decider'].includes(v.action)?{sidePicker:'B',startSide:'CT'}:{})})));
 assert.match(text(ctx.bpView({state:s})),/CT/);assert.ok(M.stats(s).bp.some(v=>v.startSide==='CT'));
 const restored=D.migrateState(JSON.parse(JSON.stringify(s)));assert.equal(M.currentMatch(restored).bp.at(-1).startSide,'CT');
 st.slots[0].teamId=s.teams[2].id;F.reconcile(s);assert.equal(m.bp,undefined);
 s.outputCycle.nodes=[{id:'bp',scene:'mapBP',durationSeconds:10}];assert.equal(D.migrateState(s).outputCycle.nodes[0].scene,'mapBP');
 const layout=H.normalize();layout.half.elements=[{id:'bp',type:'scoredeck',scene:'mapBP'}];assert.equal(H.normalize(layout).half.elements[0].scene,'mapBP');
});
test('BP editor saves side picker/CT-T, preserves selections when first side changes and clears them on map replacement',async()=>{
 let slots=[],cursor=0,payload;ctx.l.useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];};ctx.l.useRef=initial=>{const i=cursor++;return slots[i]||=( {current:initial} );};ctx.l.useEffect=()=>{};ctx.sdFlowButton=props=>element('button',props,...props.children);ctx.SDClient={request:async(url,options)=>{assert.equal(url,'/api/match-bp');payload=JSON.parse(options.body);}};
 vm.runInContext('globalThis.bpEditor=sdMatchData;',ctx);
 const s=D.createDefaultState(),m={...make(3),id:'edit'};s.teams=[{id:'a',name:'队伍甲'},{id:'b',name:'队伍乙'}];
 let tree;const render=()=>{cursor=0;tree=ctx.bpEditor({state:s,match:m,commit(){}});};const select=label=>find(tree,n=>n.type==='select'&&n.props['aria-label']===label)[0];render();
 select('BP 3 选边队伍').props.onChange({target:{value:'A'}});render();select('BP 3 开局阵营').props.onChange({target:{value:'T'}});render();select('BP 先手方').props.onChange({target:{value:'B'}});render();
 assert.equal(select('BP 3 开局阵营').props.value,'T');assert.equal(select('BP 3 选边队伍').props.value,'A');
 await find(tree,n=>n.type==='button'&&text(n)==='保存 BP')[0].props.onClick();assert.equal(payload.steps[2].sidePicker,'A');assert.equal(payload.steps[2].startSide,'T');assert.equal(payload.firstSide,'B');assert.equal(payload.base.teamAId,'a');M.applyBP(structuredClone(m),JSON.parse(JSON.stringify(payload.steps)),payload.firstSide);
 select('BP 3').props.onChange({target:{value:'vertigo'}});render();assert.equal(select('BP 3 选边队伍').props.value,'');assert.equal(select('BP 3 开局阵营').props.value,'');
});

test('unfilled BP steps stay pending without completed-ban claims or invented opening sides',()=>{
 const s=D.createDefaultState();s.tournament.formatId='single-elim-16';
 const m={id:'pending',bestOf:3,teamAId:'a',teamBId:'b'};M.applyBP(m,M.template(3));s.matches=[m];s.selectedMatchId=m.id;
 const view=ctx.bpView({state:s});assert.equal(find(view,n=>n.props?.className?.endsWith(' pending')).length,7);
 assert.doesNotMatch(text(view),/已禁用|本场不进行|固定两张|等待确认选边|展示开局选边|最终决胜图/);
 assert.equal(find(view,n=>n.type==='b'&&['ct','t'].includes(n.props.className)).length,0);
 assert.equal(find(view,n=>n.type==='footer').length,0);
});
