const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context=vm.createContext({ScoreDeckRules:require('../server/scoredeck-rules.cjs')});
vm.runInContext(fs.readFileSync(require.resolve('../ui/result-export.js'),'utf8'),context);
test('completion filters include all three states',()=>{
 for(const status of ['completed','live','upcoming','tbd']){
  assert.equal(context.sdResultVisible({status},'all'),true);
  assert.equal(context.sdResultVisible({status},'completed'),status==='completed');
  assert.equal(context.sdResultVisible({status},'hide'),status!=='completed');
 }
});
test('export maps exclude unplayed decider and preserve original map numbers',()=>{
 const match={status:'completed',bestOf:3,scoreA:2,scoreB:0,mapScores:[{map:'nuke',a:13,b:5},{map:'mirage',a:13,b:9},{map:'inferno',a:null,b:null}]};
 assert.deepEqual(Array.from(context.sdResultMaps(match),m=>m.index),[0,1]);
 assert.equal(context.sdResultMaps({...match,status:'live'}).length,0);
 assert.equal(context.sdResultMaps({...match,autoBye:true}).length,0);
 assert.equal(context.sdResultMaps({...match,mapScores:[],scoreA:'W',scoreB:'F'}).length,0);
 assert.equal(context.sdResultMaps({...match,mapScores:[]}).length,2);
});
test('per-map roster and GSI stats override team defaults; absent stats and rating are zero',()=>{
 const state={teams:[{id:'a',name:'Alpha',players:[{id:'one',starter:true,rating:1.7},{id:'bench',starter:false,avatar:'avatar.png'}]},{id:'b',players:[{id:'two',starter:true,rating:1.5}]}]};
 const match={teamAId:'a',teamBId:'b',scoreA:2,scoreB:0};
 const map={index:0,map:'nuke',detail:{teamA:[{playerId:'one',starter:false},{playerId:'bench',starter:true,kills:21,deaths:10,assists:7,rating:1.23}]}};
 const result=context.sdResultModel(state,match,map);
 assert.equal(result.teams[0].players.length,1);
 assert.equal(result.teams[0].players[0].id,'bench');
 assert.equal(result.teams[0].players[0].kills,21);
 assert.equal(result.teams[0].players[0].rating,1.23);
 assert.equal(result.teams[0].players[0].avatar,'avatar.png');
 assert.equal(result.teams[1].players[0].kills,0);
 assert.equal(result.teams[1].players[0].rating,0);
});
