const {test}=require('node:test'),assert=require('node:assert/strict'),M=require('../server/match-data.cjs'),H=require('../server/highlights.cjs'),D=require('../server/default-state.cjs'),F=require('../server/tournament-flow.cjs');
function fixture(){const s=D.createDefaultState(),st=F.addStage(s,'playoff',{teamCount:2});st.slots.forEach((sl,i)=>sl.teamId=s.teams[i].id);F.reconcile(s);F.activate(s);s.selectedStageId=st.id;s.selectedMatchId=F.matchesOf(s,st.id)[0].id;const m=M.currentMatch(s);m.status='live';const g={connected:true,sourceAgeMs:12,map:{name:'de_anubis',phase:'live',teamCT:{score:4},teamT:{score:2}},allplayers:{}};for(let i=0;i<2;i++)s.teams[i].players.slice(0,5).forEach((p,j)=>g.allplayers['steam'+i+j]={name:p.id,team:i?'T':'CT',match_stats:{kills:10+j,deaths:2,assists:3}});return {s,m,g};}
test('GSI tracks player identities across side swap and preserves each map on restart',()=>{const {s,m,g}=fixture();assert.ok(M.ingest(s,g));assert.equal(m.mapDetails[0].teamA[0].kills,10);assert.equal(m.mapDetails[0].teamA[0].adr,null);assert.equal(m.mapScores[0].a,4);assert.equal(M.ingest(s,g),false);for(const p of Object.values(g.allplayers))p.team=p.team==='CT'?'T':'CT';g.map.teamT.score=9;g.map.teamCT.score=6;assert.ok(M.ingest(s,g));assert.equal(m.mapScores[0].a,9);assert.equal(m.mapScores[0].b,6);g.map.name='de_nuke';g.map.teamT.score=1;g.map.teamCT.score=0;assert.ok(M.ingest(s,g));assert.equal(m.currentMapIndex,1);assert.equal(m.mapDetails[0].a,9);assert.equal(m.mapDetails[1].a,1);const restored=D.migrateState(JSON.parse(JSON.stringify(s)));assert.equal(M.currentMatch(restored).mapDetails[0].teamA[0].kills,10);assert.equal(M.currentMatch(restored).mapDetails[0].teamA[0].adr,null);g.sourceAgeMs=20000;assert.equal(M.ingest(s,g),false);});
test('GSI refuses unknown or ambiguous teams; explicit steam binding resolves it',()=>{const {s,m,g}=fixture();for(const p of Object.values(g.allplayers))p.name='unmatched';assert.equal(M.ingest(s,g),false);m.gsiBindings={steam00:{side:'A',playerId:s.teams[0].players[0].id},steam10:{side:'B',playerId:s.teams[1].players[0].id}};assert.ok(M.ingest(s,g));m.gsiEnabled=false;g.map.teamCT.score++;assert.equal(M.ingest(s,g),false);});
test('BP templates select exactly BO1/2/3/5 maps; duplicate and scored-map replacement rejected',()=>{for(const bo of [1,2,3,5]){const m={bestOf:bo},bp=M.template(bo).map((v,i)=>({...v,map:M.MAPS[i]}));M.applyBP(m,bp);assert.equal(m.mapScores.length,bo);assert.equal(m.bpBestOf,bo);assert.equal(m.mapScores[0].a,null);assert.throws(()=>M.applyBP(m,bp.map(v=>({...v,map:'nuke'}))),/重复/);const next=structuredClone(bp);const picked=next.findIndex(v=>['pick','decider'].includes(v.action));m.mapScores[0].a=13;m.mapScores[0].b=8;next[picked].map='vertigo';assert.throws(()=>M.applyBP(m,next),/已有比分/);}});
test('highlight layouts independent, empty allowed, dimensions clamped and unknown source rejected',()=>{const h=H.normalize();h.half.elements=[];h.full.elements[0].x=9000;const v=H.normalize(h);assert.equal(v.half.elements.length,0);assert.ok(v.full.elements.length>0);assert.equal(v.full.elements[0].x,1920);assert.throws(()=>H.normalize({...h,full:{...h.full,elements:[{type:'image',source:'javascript:alert(1)'}]}}));const {s,m,g}=fixture();M.ingest(s,g);assert.equal(H.resolve(s,require('../server/halftime.cjs').normalize()).nameA,s.teams[0].name);});

test('BP first side swaps all ownership for every BO without changing maps or scores',()=>{
 for(const bo of [1,2,3,5]){
  const m={bestOf:bo},a=M.template(bo).map((v,i)=>({...v,map:M.MAPS[i]}));
  M.applyBP(m,a);assert.equal(m.bpFirstSide,'A');
  m.mapScores[0].a=13;m.mapScores[0].b=11;const scores=structuredClone(m.mapScores);
  M.applyBP(m,a,'B');assert.equal(m.bpFirstSide,'B');
  assert.deepEqual(m.bp.map(v=>v.map),a.map(v=>v.map));assert.deepEqual(m.mapScores,scores);
  assert.deepEqual(m.bp.map(v=>v.team),a.map(v=>v.team?(v.team==='A'?'B':'A'):''));
  assert.deepEqual(m.bp.map(v=>v.action),a.map(v=>v.action));
  assert.equal(m.bp[6].team,'');
  M.applyBP(m,m.bp);assert.equal(m.bpFirstSide,'B');
  M.applyBP(m,m.bp,'A');assert.deepEqual(m.bp,a);assert.deepEqual(m.mapScores,scores);
  assert.throws(()=>M.applyBP(m,m.bp,'CT'),/先手方/);
 }
 const {s,m}=fixture();M.applyBP(m,M.template(m.bestOf),'B');
 assert.equal(M.currentMatch(D.migrateState(JSON.parse(JSON.stringify(s)))).bpFirstSide,'B');
});

test('BP cannot relabel existing player statistics even after round scores are cleared',()=>{
 const m={bestOf:3},steps=M.template(3).map((v,i)=>({...v,map:M.MAPS[i]}));M.applyBP(m,steps);
 m.mapDetails=[{map:m.mapScores[0].map,a:null,b:null,teamA:[{playerId:'A1',starter:true,kills:0,deaths:2,assists:1}],teamB:[]}];
 const before=structuredClone(m),changed=structuredClone(steps);changed[2].map='vertigo';
 assert.throws(()=>M.applyBP(m,changed),/已有选手数据/);assert.deepEqual(m,before);
 M.applyBP(m,steps,'B');assert.deepEqual(m.mapDetails,before.mapDetails);
 m.mapDetails[0].teamA=[];M.applyBP(m,changed);assert.equal(m.mapDetails[0].map,'de_vertigo');
});

test('GSI never fills pending map slots with banned, unused, missing or unsupported maps',()=>{
 const {s,m,g}=fixture(),steps=M.template(m.bestOf);steps[0].map='anubis';M.applyBP(m,steps);
 const before=structuredClone(m);assert.equal(M.ingest(s,g),false);assert.deepEqual(m,before);
 for(const name of ['',undefined,'workshop_unknown']){g.map.name=name;assert.equal(M.ingest(s,g),false);assert.deepEqual(m,before);}
 g.map.name='de_nuke';assert.equal(M.ingest(s,g),true);assert.equal(m.mapScores[0].map,'de_nuke');
 const f=fixture();f.m.bestOf=2;const bo2=M.template(2);bo2[6].map='anubis';M.applyBP(f.m,bo2);
 assert.equal(M.ingest(f.s,f.g),false);
});
