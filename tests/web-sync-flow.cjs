const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../server/tournament-flow.cjs'),D=require('../server/default-state.cjs');
const {createTestState}=require('./fixtures/state.cjs');
test('website snapshots retain assigned teams and completed matches through reconcile and reload',()=>{
 const s=createTestState(),st=F.addStage(s,'playoff',{id:'website',teamCount:2});
 const m=s.matches[0];st.webSync={mode:'snapshot',source:'https://hushang985.online'};
 st.slots.forEach((sl,i)=>{sl.teamId='';sl.webSyncTeamId=s.teams[i].id;sl.webSyncSource={kind:'worldcupThird',slot:i};});
 Object.assign(m,{teamAId:s.teams[0].id,teamBId:s.teams[1].id,status:'completed',scoreA:2,scoreB:0,mapScores:[{map:'de_nuke',a:13,b:5},{map:'de_mirage',a:13,b:6}],bp:[{map:'nuke',team:'A',action:'pick'}]});
 const before=structuredClone(m);F.reconcile(s);assert.deepEqual(m,before);F.activate(s);
 const reload=D.migrateState(s);F.reconcile(reload);assert.equal(reload.matches[0].teamAId,before.teamAId);assert.equal(reload.matches[0].status,'completed');assert.deepEqual(reload.matches[0].bp,before.bp);assert.ok(F.isActive(reload));
});
test('website standings use website scoring and current local team presentation',()=>{
 const s=createTestState(),st=F.addStage(s,'group');const g=st.groups[0];
 st.webSync={mode:'snapshot',tables:[{groupId:g.id,rows:[{team:s.teams[0],points:17,won:3}]}],comparisons:[{comparatorId:'thirds',complete:false,rows:[{team:s.teams[0],points:17}]}]};
 s.teams[0]={...s.teams[0],name:'本地显示名称'};
 assert.equal(F.groupTable(s,st,g)[0].points,17);assert.equal(F.groupTable(s,st,g)[0].team.name,'本地显示名称');assert.equal(F.comparatorTable(s,st,{id:'thirds'}).complete,false);
});
test('migration retains every imported sponsor and its identity',()=>{
 const s=createTestState();s.sponsors={enabled:true,slots:Array.from({length:9},(_,i)=>({id:i,name:'赞助商 '+i,logoImage:'/media/s'+i+'.png',fit:'fill',webSync:{source:'website'}}))};
 const reload=D.migrateState(s);assert.equal(reload.sponsors.slots.length,9);assert.deepEqual(reload.sponsors.slots,s.sponsors.slots);
});
test('imported rosters keep their exact size without invented substitutes or truncation',()=>{
 const s=createTestState();s.teams=s.teams.slice(0,3).map((team,i)=>({...team,webSync:{mode:'snapshot'},players:Array.from({length:[0,3,9][i]},(_,j)=>({id:'p'+j,starter:j<5}))}));
 const reload=D.migrateState(s);assert.deepEqual(reload.teams.map(t=>t.players.length),[0,3,9]);assert.equal(reload.teams[2].players[8].id,'p8');
});
