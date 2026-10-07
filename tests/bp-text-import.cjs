const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../server/match-data.cjs');
const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('ui/match-data.js','utf8')+';globalThis.parse=sdParseBPText',ctx);
const state={teams:[{id:'a',name:'控大喷菇队'},{id:'b',name:'屈原派队'}]},match=()=>({bestOf:1,teamAId:'a',teamBId:'b'});
const input=`控大喷菇队 去除了(BAN) 阿努比斯(de_anubis)
控大喷菇队 去除了(BAN) 核子危机(de_nuke)
屈原派队 去除了(BAN) 炼狱小镇(de_inferno)
屈原派队 去除了(BAN) 炙热沙城Ⅱ(de_dust2)
屈原派队 去除了(BAN) 远古遗迹(de_ancient)
控大喷菇队 去除了(BAN) 死城之谜(de_cache)
系统 自动选择了(PICK) 荒漠迷城(de_mirage) 屈原派队 自动选择了(PICK) CT 阵营`;
const parse=(text=input,s=state,m=match())=>JSON.parse(JSON.stringify(ctx.parse(text,s,m)));
test('provided BO1 text preserves A A B B B A bans and system map with B CT',()=>{
 const p=parse(input.replaceAll(' ','\u00a0')),m=match();M.applyBP(m,p.steps,p.firstSide,true);
 assert.deepEqual(m.bp.map(v=>v.team),['A','A','B','B','B','A','']);assert.equal(m.bp.at(-1).action,'decider');assert.equal(m.bp.at(-1).sidePicker,'B');assert.equal(m.bp.at(-1).startSide,'CT');assert.equal(m.mapScores[0].map,'de_mirage');assert.equal(m.bpOrder,'imported');
 const restored=JSON.parse(JSON.stringify(m));M.applyBP(restored,restored.bp,restored.bpFirstSide,true);assert.deepEqual(restored,m);
});
test('team identity follows match IDs, not text position; side line and fullwidth syntax supported',()=>{
 const m={...match(),teamAId:'b',teamBId:'a'},p=parse(input.replace(' 屈原派队 自动选择了(PICK) CT 阵营','\n屈原派队 自动选择了（PICK） T 阵营'),state,m);
 M.applyBP(m,p.steps,p.firstSide,true);assert.equal(m.bpFirstSide,'B');assert.equal(m.bp.at(-1).sidePicker,'A');assert.equal(m.bp.at(-1).startSide,'T');
});
test('unknown/ambiguous teams, duplicate maps, bad actions and orphan sides reject',()=>{
 for(const text of [input.replaceAll('屈原派队','错误队'),input.replace('de_cache','de_anubis'),input.replace('去除了(BAN)','去除了(PICK)'),input.replace(' CT 阵营',' DEF 阵营'),'屈原派队 自动选择了(PICK) CT 阵营\n'+input,input+'\n屈原派队 自动选择了(PICK) T 阵营',input.split('\n').slice(1).join('\n')])assert.throws(()=>parse(text));
 assert.throws(()=>parse(input,{teams:[state.teams[0],{id:'b',name:'控大喷菇队'}]}));
});
test('BO3 retains pick ownership independently of side-picker; server rejects tampered payload atomically',()=>{
 const text=`控大喷菇队 去除了(BAN) (de_anubis)\n屈原派队 去除了(BAN) (de_nuke)\n控大喷菇队 选择了(PICK) (de_mirage) 屈原派队 选择了(PICK) CT 阵营\n屈原派队 选择了(PICK) (de_inferno) 控大喷菇队 选择了(PICK) T 阵营\n屈原派队 去除了(BAN) (de_dust2)\n控大喷菇队 去除了(BAN) (de_cache)\n系统 自动选择了(PICK) (de_ancient)`;
 const m={...match(),bestOf:3},p=parse(text,state,m);M.applyBP(m,p.steps,p.firstSide,true);assert.equal(m.bp[2].team,'A');assert.equal(m.bp[2].sidePicker,'B');assert.equal(m.bp[3].team,'B');assert.equal(m.bp[3].startSide,'T');assert.equal(m.bp.at(-1).startSide,undefined);
 const before=structuredClone(m);for(const change of [s=>s[0].team='C',s=>s[0].action='pick',s=>s[0].sidePicker='A',s=>s[0].map=s[1].map]){const steps=structuredClone(p.steps);change(steps);assert.throws(()=>M.applyBP(m,steps,p.firstSide,true));assert.deepEqual(m,before);}
});
test('BP editor parses into preview, saves explicit order, and keeps previous draft on parse error',async()=>{
 const c=vm.createContext({structuredClone});let slots=[],cursor=0,payload;
 const h=(type,props,...children)=>typeof type==='function'?type({...props,children}):({type,props:props||{},children:children.flat(Infinity).filter(x=>x!=null&&x!==false)});
 c.l={createElement:h,useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef:init=>{const i=cursor++;return slots[i]||={current:init};},useEffect:()=>{}};
 c.sdFlowButton=p=>h('button',p,...p.children);c.SDClient={request:async(url,o)=>{payload=JSON.parse(o.body);}};
 vm.runInContext(fs.readFileSync('ui/match-data.js','utf8')+';globalThis.editor=sdMatchData',c);
 const m={...match(),id:'m'};let tree;const render=()=>{cursor=0;tree=c.editor({state,match:m,commit(){}});};
 const find=(n,fn)=>typeof n==='object'?[...(fn(n)?[n]:[]),...(n.children||[]).flatMap(v=>find(v,fn))]:[];
 const text=n=>typeof n==='object'?(n.children||[]).map(text).join(''):String(n);
 const button=name=>find(tree,n=>n.type==='button'&&text(n)===name)[0];
 render();find(tree,n=>n.type==='textarea')[0].props.onChange({target:{value:input}});render();button('解析并填入 BP').props.onClick();render();assert.match(text(tree),/已解析/);assert.match(text(tree),/控大喷菇队：T \/ 屈原派队：CT/);
 await button('保存 BP').props.onClick();assert.equal(payload.preserveOrder,true);M.applyBP(m,payload.steps,payload.firstSide,payload.preserveOrder);assert.equal(m.bp[1].team,'A');
 const before=JSON.stringify(payload.steps);find(tree,n=>n.type==='textarea')[0].props.onChange({target:{value:'wrong'}});render();button('解析并填入 BP').props.onClick();render();await button('保存 BP').props.onClick();assert.equal(JSON.stringify(payload.steps),before);
});
