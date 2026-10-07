const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../server/match-data.cjs'),D=require('../server/default-state.cjs'),F=require('../server/tournament-flow.cjs'),{createTestState}=require('./fixtures/state.cjs');
function fixture(bo=3){
 const s=createTestState(),stage=F.addStage(s,'group',{teamCount:2,groups:[{id:'g1',name:'A',size:2,format:'round-robin',bestOf:bo}]});stage.slots.forEach((slot,i)=>slot.teamId=s.teams[i].id);F.reconcile(s);F.activate(s);s.selectedStageId=stage.id;s.selectedMatchId=F.matchesOf(s,stage.id)[0].id;
 const m=M.currentMatch(s);m.bestOf=bo;m.status='live';
 const g={connected:true,sourceAgeMs:0,map:{name:'de_anubis',phase:'gameover',teamCT:{score:13},teamT:{score:7}},allplayers:{}};
 for(let i=0;i<2;i++)s.teams[i].players.slice(0,5).forEach((p,j)=>g.allplayers[`s${i}${j}`]={name:s.teams[i].name+' '+p.id,team:i?'T':'CT',match_stats:{kills:20+j,deaths:7,assists:3,adr:85+j}});
 return {s,m,g};
}
function draft(s,m){return Array.from({length:5},(_,i)=>{const d=m.mapDetails?.[i]||{};return {map:d.map||m.mapScores[i].map,a:d.a??null,b:d.b??null,...Object.fromEntries(['teamA','teamB'].map((side,j)=>[side,s.teams[j].players.map((p,k)=>({playerId:p.id,starter:p.starter??k<5,kills:null,deaths:null,assists:null,rating:null,...d[side]?.find(x=>x.playerId===p.id)}))]))};});}
function save(s,m,details,base){return M.saveResult(s,{matchId:m.id,teamAId:m.teamAId,teamBId:m.teamBId,bestOf:m.bestOf,mapDetails:details,...(base?{baseMapDetails:base}:{})});}
test('gameover infers exactly one unknown starter per team and records evidence per map',()=>{
 const {s,m,g}=fixture();g.allplayers.s04.name='Team 1 unknown A';g.allplayers.s14.name='Team 2 unknown B';
 g.map.phase='live';assert.ok(M.ingest(s,g));assert.equal(m.mapDetails[0].teamA[4].kills,null);
 g.map.phase='gameover';assert.ok(M.ingest(s,g));
 for(const side of ['teamA','teamB'])assert.equal(m.mapDetails[0][side][4].kills,24);
 assert.equal(m.mapDetails[0].gsiNotices.filter(x=>x.type==='inferred').length,2);assert.equal(m.gsiBindings.s04.source,'elimination');
 assert.equal(M.ingest(s,g),false);
 const restored=M.currentMatch(D.migrateState(JSON.parse(JSON.stringify(s))));assert.equal(restored.mapDetails[0].gsiNotices[0].playerId,s.teams[0].players[4].id);
});
test('multiple unmatched IDs clear previous automatic values and stay blank through reload and editor',()=>{
 const {s,m,g}=fixture();g.map.phase='live';M.ingest(s,g);g.map.phase='gameover';g.allplayers.s03.name='Team 1 mystery 3';g.allplayers.s04.name='Team 1 mystery 4';M.ingest(s,g);
 assert.equal(m.mapDetails[0].teamA[3].kills,null);assert.equal(m.mapDetails[0].teamA[4].adr,null);
 assert.deepEqual(m.mapDetails[0].gsiNotices.map(x=>[x.id,x.kills]),[['s03',23],['s04',24]]);
 const restored=D.migrateState(JSON.parse(JSON.stringify(s))),mr=M.currentMatch(restored);assert.equal(mr.mapDetails[0].teamA[3].kills,null);
 const ui=fs.readFileSync(require.resolve('../ui/main-runtime.js'),'utf8'),ctx=vm.createContext({v:(s,id)=>s.teams.find(t=>t.id===id),b:Number});vm.runInContext(ui.slice(ui.indexOf('function x(e, t, n)'),ui.indexOf('function te(e, t)')),ctx);
 assert.equal(ctx.ee(restored,mr)[0].teamA[3].kills,null);
});
test('one team may infer while the other retains two unresolved players',()=>{
 const {s,m,g}=fixture();for(const id of ['s04','s13','s14'])g.allplayers[id].name='unknown';M.ingest(s,g);
 assert.equal(m.mapDetails[0].teamA[4].kills,24);assert.equal(m.mapDetails[0].teamB[3].kills,null);assert.equal(m.mapDetails[0].gsiNotices.length,3);
});
test('team prefix can identify sides even when every nickname is unknown',()=>{
 const {s,m,g}=fixture();for(const p of Object.values(g.allplayers))p.name=(p.team==='CT'?'Team 1':'Team 2')+' unknown';
 assert.ok(M.ingest(s,g));assert.equal(m.mapDetails[0].gsiNotices.length,10);assert.equal(m.mapDetails[0].teamA[0].kills,null);
});
test('elimination refuses incomplete packets, conflicting Steam IDs and a possible substitute',()=>{
 for(const mode of ['incomplete','steam','substitute']){
  const {s,m,g}=fixture();g.allplayers.s04.name='unknown';
  if(mode==='incomplete')delete g.allplayers.s03;
  if(mode==='steam')s.teams[0].players[4].steamId='76561198000000001';
  if(mode==='substitute')g.allplayers.s03.name=s.teams[0].name+' '+s.teams[0].players[5].id;
  M.ingest(s,g);assert.equal(m.mapDetails[0].teamA[4].kills,null,mode);assert.equal(m.mapDetails[0].gsiNotices.some(x=>x.type==='inferred'),false,mode);
 }
});
test('per-map starters take precedence over changed team defaults during elimination',()=>{
 const {s,m,g}=fixture();m.mapDetails=draft(s,m);m.mapDetails[0].teamA[4].starter=false;m.mapDetails[0].teamA[5].starter=true;g.allplayers.s04.name='unknown';
 M.ingest(s,g);assert.equal(m.mapDetails[0].teamA[5].kills,24);assert.equal(m.mapDetails[0].teamA[4].kills,null);
});
test('final map survives warmup/live reset, duplicate end packets and partial disconnect snapshots',()=>{
 const {s,m,g}=fixture();M.ingest(s,g);const end=structuredClone(m.mapDetails[0]);assert.equal(M.ingest(s,g),false);
 delete g.allplayers.s04;assert.equal(M.ingest(s,g),false);
 for(const phase of ['warmup','live','intermission']){g.map.phase=phase;g.map.teamCT.score=0;assert.equal(M.ingest(s,g),false);}
 assert.deepEqual(m.mapDetails[0],end);
});
test('all BO formats retain separate results, side identities, warnings and display phases',()=>{
 for(const bo of [1,2,3,5]){
  const {s,m,g}=fixture(bo),maps=['anubis','nuke','mirage','inferno','ancient'];
  for(let i=0;i<bo;i++){
   g.map.name='de_'+maps[i];g.map.teamCT.score=i%2?7:13;g.map.teamT.score=i%2?13:7;
   // Alternating winners keeps every map valid until the last map.
   assert.ok(M.ingest(s,g),`BO${bo} map ${i+1}`);assert.equal(m.currentMapIndex,i);assert.equal(m.mapDetails[i].map,g.map.name);
  }
  const snapshot=structuredClone(m.mapDetails);g.map.name='de_anubis';assert.equal(M.ingest(s,g),false);assert.deepEqual(m.mapDetails,snapshot);
  s.statsMapIndex=0;assert.equal(M.stats(s).phase,'gameover');
 }
});
test('map-specific manual authority survives re-enable and does not disable later maps',()=>{
 const {s,m,g}=fixture();M.ingest(s,g);const base=draft(s,m),edited=structuredClone(base);edited[0].teamA[0].kills=99;save(s,m,edited,base);
 assert.equal(m.mapDetails[0].manualLocked,true);assert.notEqual(m.gsiEnabled,false);m.gsiEnabled=true;assert.equal(M.ingest(s,g),false);
 g.map.name='de_nuke';g.map.teamCT.score=7;g.map.teamT.score=13;assert.ok(M.ingest(s,g));assert.equal(m.mapDetails[0].teamA[0].kills,99);assert.equal(m.mapDetails[1].teamA[0].kills,20);
});
test('saving an older modal preserves newly completed maps and does not lock blank future maps',()=>{
 const {s,m,g}=fixture();M.ingest(s,g);const base=draft(s,m),edited=structuredClone(base);edited[0].teamA[0].kills=88;
 g.map.name='de_nuke';g.map.teamCT.score=7;g.map.teamT.score=13;M.ingest(s,g);const second=structuredClone(m.mapDetails[1]);
 save(s,m,edited,base);assert.deepEqual(m.mapDetails[1],second);assert.equal(m.mapDetails[2].manualLocked,undefined);
 g.map.name='de_mirage';assert.ok(M.ingest(s,g));assert.equal(m.mapDetails[2].teamA[0].kills,20);
});
test('manual clearing remains authoritative and duplicate maps or invalid stats reject atomically',()=>{
 const {s,m,g}=fixture();M.ingest(s,g);const base=draft(s,m),edited=structuredClone(base);edited[0].a=null;edited[0].b=null;edited[0].teamA[0].kills=null;save(s,m,edited,base);assert.equal(M.ingest(s,g),false);
 for(const mode of ['duplicate','fraction','negative','player']){
  const bad=draft(s,m);if(mode==='duplicate')bad[1].map=bad[0].map;if(mode==='fraction')bad[0].teamA[0].kills=1.5;if(mode==='negative')bad[0].teamA[0].adr=-1;if(mode==='player')bad[0].teamA[1].playerId=bad[0].teamA[0].playerId;
  const before=structuredClone(m);assert.throws(()=>save(s,m,bad,draft(s,m)));assert.deepEqual(m,before);
 }
});
test('a clinched series cannot ingest an unused additional map',()=>{
 const {s,m,g}=fixture();M.ingest(s,g);g.map.name='de_nuke';M.ingest(s,g);g.map.name='de_mirage';assert.equal(M.ingest(s,g),false);assert.equal(m.mapScores[2].a,null);
});
test('GSI notices render only in management and broadcast contains no data hints',()=>{
 const {s,m,g}=fixture();g.allplayers.s04.name='unknown';M.ingest(s,g);
 const l={createElement:(type,props,...children)=>({type,props,children})},ctx=vm.createContext({l,ScoreDeckFlow:{enabled:()=>false},sdFlowLogo:()=>null});vm.runInContext(fs.readFileSync(require.resolve('../ui/match-data.js'),'utf8'),ctx);
 const notice=JSON.stringify(ctx.sdGsiNotices({state:s,match:m}));assert.match(notice,/排除法/);assert.match(notice,/unknown/);
 const output=JSON.stringify(ctx.sdMapStats({state:s}));assert.doesNotMatch(output,/排除法|unknown|提示|等待选手|等待队伍|无有效数据/);
});
