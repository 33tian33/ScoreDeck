const {test}=require('node:test');
const assert=require('node:assert/strict');
const D=require('../server/default-state.cjs');
const F=require('../server/tournament-flow.cjs');

test('fresh and incomplete states start with one Test team and an unapplied custom tournament',()=>{
  for(const s of [D.createDefaultState(),D.migrateState(null),D.migrateState({})]){
    assert.equal(s.tournament.name,'TestTournament');
    assert.equal(s.tournament.formatId,'flow');
    assert.deepEqual(s.teams.map(t=>t.name),['Test']);
    assert.equal(s.teams[0].group,undefined);
    assert.deepEqual(s.stages,[]);
    assert.deepEqual(s.matches,[]);
    assert.equal(s.selectedMatchId,'');
    assert.equal(s.selectedGroup,'');
    assert.deepEqual(s.focus.groups.selected,[]);
    assert.equal(F.isActive(s),false);
    assert.equal(s.mvp.playerId,'');
  }
});

test('new defaults preserve saved custom names, teams, and activated schedules',()=>{
  const s=D.createDefaultState();s.tournament.name='Saved tournament';s.teams[0].name='Saved team';
  F.addTeam(s);const st=F.addStage(s,'playoff',{teamCount:2});
  st.slots.forEach((slot,i)=>slot.teamId=s.teams[i].id);F.reconcile(s);F.activate(s);
  const restored=D.migrateState(JSON.parse(JSON.stringify(s)));
  assert.equal(restored.tournament.name,'Saved tournament');
  assert.equal(restored.teams[0].name,'Saved team');
  assert.equal(restored.teams.length,2);
  assert.equal(F.isActive(restored),true);
  assert.deepEqual(restored.stages,s.stages);
  assert.equal(D.migrateState({...D.createDefaultState(),teams:[]}).teams.length,0);
});
