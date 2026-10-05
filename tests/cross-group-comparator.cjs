const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../server/tournament-flow.cjs'),D=require('../server/default-state.cjs');
const {createTestState}=require('./fixtures/state.cjs');
function fixture({size=2,format='round-robin',bestOf=1}={}){
 const s=createTestState(),st=F.addStage(s,'group',{groups:['A','B','C'].map(id=>({id,name:`${id}组`,size,format,bestOf,tieBreak:'head-to-head'}))});
 st.slots.forEach((sl,i)=>sl.teamId=s.teams[i].id);F.reconcile(s);
 const c=F.addComparator(s,st.id);F.resizeComparator(s,st.id,c.id,3);
 for(const [i,g] of st.groups.entries())F.setComparatorInput(s,st.id,c.id,i+1,F.comparatorSources(s,st).find(x=>x.groupId===g.id&&x.rank===1).key);
 for(const out of F.outputs(s,st))if(st.routes[out.key]?.kind==='pending')F.setRoute(s,st.id,out.key,F.terminal());
 F.setRoute(s,st.id,F.comparatorRank(c.id,1),F.terminal('Qualified'));
 F.activate(s);return {s,st,c};
}
function score(s,m,a,b){m.mapScores=[{map:'Mirage',a,b}];m.mapDetails=[];m.status='completed';m.scoreA=a>b?1:0;m.scoreB=b>a?1:0;F.reconcile(s);}
function finishGroups(s,st){for(const m of F.matchesOf(s,st.id))score(s,m,13,{A:5,B:1,C:8}[m.groupId]);}

test('cross-group ranks preserve original group statistics and finalize only after all source groups finish',()=>{
 const {s,st,c}=fixture();assert.equal(F.comparatorTable(s,st,c).complete,false);
 score(s,s.matches[0],13,5);assert.equal(s.flowOutcomes.filter(o=>o.source.startsWith('compare:')).length,0);
 finishGroups(s,st);const table=F.comparatorTable(s,st,c);assert.equal(table.complete,true);
 assert.deepEqual(table.rows.map(r=>[r.groupId,r.points,r.mapDiff,r.roundDiff]),[['B',3,1,12],['A',3,1,8],['C',3,1,5]]);
 for(const r of table.rows){const original=F.groupTable(s,st,st.groups.find(g=>g.id===r.groupId)).find(x=>x.team.id===r.team.id);for(const key of ['points','mapDiff','roundDiff','played'])assert.equal(r[key],original[key]);}
 const outcomes=s.flowOutcomes.filter(o=>o.source.startsWith('compare:'));assert.equal(outcomes.length,3);assert.equal(outcomes[0].teamId,table.rows[0].team.id);assert.deepEqual(outcomes.map(o=>o.status),['Qualified','淘汰','淘汰']);
 for(const r of table.rows)assert.equal(s.flowOutcomes.filter(o=>o.teamId===r.team.id).length,1);
});

test('per-rank terminal changes, configuration and results survive migration',()=>{
 const {s,st,c}=fixture();F.setRoute(s,st.id,F.comparatorRank(c.id,2),F.terminal('季军'));F.refreshLifecycle(s);assert.equal(F.isActive(s),false);F.activate(s);finishGroups(s,st);
 const saved=D.migrateState(JSON.parse(JSON.stringify(s))),restored=F.stageOf(saved,st.id);
 assert.deepEqual(restored.comparators,st.comparators);assert.deepEqual(F.comparatorTable(saved,restored,restored.comparators[0]),F.comparatorTable(s,st,c));assert.ok(saved.flowOutcomes.some(o=>o.status==='季军'));assert.equal(F.isActive(saved),true);
});

test('cross-group corrections invalidate downstream results and unfinished groups retract advancement',()=>{
 const {s,st,c}=fixture(),next=F.addStage(s,'playoff',{teamCount:2});
 F.setRoute(s,st.id,F.comparatorRank(c.id,1),{kind:'slot',stageId:next.id,slotId:next.slots[0].id});
 F.setRoute(s,st.id,F.comparatorRank(c.id,2),{kind:'slot',stageId:next.id,slotId:next.slots[1].id});F.activate(s);finishGroups(s,st);
 const final=F.matchesOf(s,next.id)[0];assert.ok(final.teamAId&&final.teamBId);final.scoreA=2;final.scoreB=0;final.mapScores=[];final.status='completed';F.reconcile(s);
 const original=final.teamAId;score(s,F.matchesOf(s,st.id).find(m=>m.groupId==='C'),13,0);assert.notEqual(final.teamAId,original);assert.equal(final.resultInvalidated,true);assert.notEqual(final.status,'completed');
 const unfinished=F.matchesOf(s,st.id).find(m=>m.groupId==='B');unfinished.status='upcoming';unfinished.scoreA=0;unfinished.scoreB=0;unfinished.mapScores=[];F.reconcile(s);assert.equal(final.teamAId,'');assert.equal(final.teamBId,'');assert.equal(final.status,'tbd');
});

test('counts resize, removed sources become pending and incomplete comparator blocks activation',()=>{
 const {s,st,c}=fixture();F.resizeComparator(s,st.id,c.id,4);assert.ok(F.activationErrors(s).some(x=>x.includes('入场4')));assert.equal(st.routes[F.comparatorRank(c.id,4)].kind,'pending');
 assert.throws(()=>F.resizeComparator(s,st.id,c.id,1));assert.throws(()=>F.resizeComparator(s,st.id,c.id,7));assert.throws(()=>F.resizeComparator(s,st.id,c.id,2.5));
 F.resizeComparator(s,st.id,c.id,2);assert.equal(st.routes[F.rank('C',1)].kind,'pending');assert.equal(st.routes[F.comparatorRank(c.id,3)],undefined);
 F.setRoute(s,st.id,F.rank('C',1),F.terminal());assert.deepEqual(F.activationErrors(s),[]);
 F.removeComparator(s,st.id,c.id);assert.equal(st.comparators.length,0);assert.equal(st.routes[F.rank('A',1)].kind,'pending');assert.ok(!F.outputs(s,st).some(o=>o.comparatorId));assert.deepEqual(F.validate(s),[]);
});

test('duplicate comparator inputs and chained or cyclic comparisons are rejected',()=>{
 const {s,st,c}=fixture();assert.throws(()=>F.setComparatorInput(s,st.id,c.id,2,F.rank('A',1)),/已有去向/);
 const second=F.addComparator(s,st.id);assert.throws(()=>F.setComparatorInput(s,st.id,second.id,1,F.rank('A',1)),/已有去向/);
 const duplicate=structuredClone(s);F.stageOf(duplicate,st.id).routes[F.rank('A',2)]={kind:'comparator',comparatorId:c.id,position:1};assert.ok(F.validate(duplicate).some(x=>x.includes('只能接收一个')));
 const cyclic=structuredClone(s);F.stageOf(cyclic,st.id).routes[F.comparatorRank(c.id,1)]={kind:'comparator',comparatorId:second.id,position:1};assert.ok(F.validate(cyclic).some(x=>x.includes('小组最终名次')));
});

test('template rebuild retains valid comparison configuration and removes inputs for deleted groups',()=>{
 const {s,st,c}=fixture();st.groups=st.groups.slice(0,2);F.regenerate(s,st.id);F.reconcile(s);
 assert.deepEqual(F.comparatorInputs(st,c),[F.rank('A',1),F.rank('B',1),'']);assert.equal(st.routes[F.comparatorRank(c.id,1)].label,'Qualified');assert.ok(F.activationErrors(s).some(x=>x.includes('入场3')));
});

test('GSL final places feed comparisons with their complete group stats',()=>{
 const {s,st,c}=fixture({size:4,format:'gsl'});let played=0;
 while(true){const m=s.matches.find(m=>m.teamAId&&m.teamBId&&m.status!=='completed');if(!m)break;score(s,m,13,played++%10);}
 assert.equal(played,15);const table=F.comparatorTable(s,st,c);assert.equal(table.complete,true);assert.equal(table.rows.length,3);
 for(const row of table.rows){assert.equal(row.played,2);assert.equal(row.points,6);assert.equal(row.mapDiff,2);assert.equal(row.team.id,F.result(s.matches.find(m=>F.shortId(m)===`${row.groupId}-GW`),'winner').id);}
});

test('template rebuild clears comparator destinations pointing to removed custom matches',()=>{
 const {s,st,c}=fixture(),extra=F.addMatch(s,st.id);
 F.setRoute(s,st.id,F.comparatorRank(c.id,1),{kind:'match',matchId:extra.id,side:'A'});
 F.regenerate(s,st.id);F.reconcile(s);assert.deepEqual(F.validate(s),[]);assert.equal(st.routes[F.comparatorRank(c.id,1)].kind,'pending');
});

test('BO2 draws and walkovers retain their group scoring; added matches do not affect comparisons',()=>{
 const {s,st,c}=fixture({bestOf:2});const ms=F.matchesOf(s,st.id);
 Object.assign(ms[0],{scoreA:1,scoreB:1,status:'completed',mapScores:[{a:13,b:0},{a:0,b:13}]});
 Object.assign(ms[1],{scoreA:'W',scoreB:'F',status:'completed',mapScores:[]});
 Object.assign(ms[2],{scoreA:2,scoreB:0,status:'completed',mapScores:[{a:13,b:11},{a:13,b:11}]});F.reconcile(s);
 const before=F.comparatorTable(s,st,c);assert.equal(before.complete,true);assert.deepEqual(before.rows.map(r=>[r.groupId,r.points,r.mapDiff,r.roundDiff]),[['C',3,2,4],['B',3,0,0],['A',1,0,0]]);
 const extra=F.addMatch(s,st.id);extra.entryA={kind:'team',teamId:st.slots[0].teamId};extra.entryB={kind:'team',teamId:st.slots[2].teamId};F.reconcile(s);extra.scoreA=2;extra.scoreB=0;extra.status='completed';extra.mapScores=[];F.reconcile(s);assert.deepEqual(F.comparatorTable(s,st,c),before);
});
