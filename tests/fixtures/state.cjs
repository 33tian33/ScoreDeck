const {createDefaultState}=require('../../server/default-state.cjs');

// Tournament tests supply their own entrants; production starts with one Test team.
function createTestState(count=48){
  const state=createDefaultState(),base=state.teams[0];
  state.teams=Array.from({length:count},(_,i)=>({
    ...structuredClone(base),id:`team-${String(i+1).padStart(2,'0')}`,
    name:`Team ${i+1}`,shortName:`T${i+1}`,group:String.fromCharCode(65+Math.floor(i/4)),
    players:base.players.map((p,j)=>({...p,id:`player_${i+1}_${j+1}`})),
  }));
  return state;
}
module.exports={createTestState};
