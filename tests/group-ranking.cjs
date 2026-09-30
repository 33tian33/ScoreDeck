const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const rules=require('../server/scoredeck-rules.cjs');
const {createDefaultState,migrateState}=require('../server/default-state.cjs');
const fixture=()=>({tournament:{groupTieBreak:'head-to-head'},teams:['A','B','C','D'].map(id=>({id,name:id,group:'A'})),matches:[]});
const match=(a,b,ra,rb)=>({group:'A',teamAId:a,teamBId:b,bestOf:1,status:'completed',scoreA:ra>rb?1:0,scoreB:rb>ra?1:0,mapScores:[{a:ra,b:rb}]});
test('head-to-head and round difference give different correct ranks; global rounds precede maps',()=>{
 const s=fixture();s.matches=[match('A','B',13,11),match('A','C',0,13),match('A','D',13,11),match('B','C',13,0),match('B','D',13,0),match('C','D',13,0)];
 // A/B/C all have six points. Cyclic mini league -> fallback round difference.
 assert.deepEqual(rules.standings(s,'A').map(x=>x.team.id),['B','C','A','D']);
 s.matches[5]=match('C','D',11,13); // A and B tied at 6, A won their direct match.
 assert.equal(rules.standings(s,'A')[0].team.id,'A');
 s.tournament.groupTieBreak='round-diff';assert.equal(rules.standings(s,'A')[0].team.id,'B');
 const migrated=migrateState({...createDefaultState(),tournament:{...createDefaultState().tournament,groupTieBreak:'head-to-head'}});
 assert.equal(migrated.tournament.groupTieBreak,'head-to-head');
 assert.equal(migrateState({...migrated,tournament:{...migrated.tournament,groupTieBreak:'invalid'}}).tournament.groupTieBreak,'round-diff');
});
test('BO2 draws, walkovers, unfinished meetings and bracket games',()=>{
 const s=fixture();s.matches=[{...match('A','B',13,0),bestOf:2,scoreA:1,scoreB:1,mapScores:[{a:13,b:0},{a:0,b:13}]}, {...match('C','D',13,0),scoreA:'W',scoreB:'F',mapScores:[]}, {...match('A','C',13,0),status:'live'}, {...match('A','D',13,0),bracketRound:'SF'}];
 const rows=rules.standings(s,'A');assert.equal(rows[0].team.id,'C');assert.equal(rows.find(x=>x.team.id==='A').points,1);assert.equal(rows.find(x=>x.team.id==='B').points,1);assert.equal(rows.find(x=>x.team.id==='A').played,1);
});
test('three-team mini league resolves by mutual results without comparator cycles',()=>{
 const s=fixture();s.matches=[match('A','B',13,11),match('A','C',13,11),match('B','C',13,11)];
 const rows=s.teams.slice(0,3).map(team=>({team,points:9,roundDiff:team.id==='C'?100:0,mapDiff:0}));
 for(const order of [rows,rows.slice().reverse(),[rows[1],rows[2],rows[0]]])assert.deepEqual(rules.rankGroup(s,'A',order).map(x=>x.team.id),['A','B','C']);
});
test('browser and server share identical rule source; cross-group ranking never invents head-to-head',()=>{
 assert.equal(fs.readFileSync(path.join(__dirname,'../dist/assets/scoredeck-rules.js'),'utf8'),fs.readFileSync(path.join(__dirname,'../server/scoredeck-rules.cjs'),'utf8'));
 assert.ok(rules.compareCrossGroup({points:3,roundDiff:20,mapDiff:1,team:{name:'A'}},{points:3,roundDiff:10,mapDiff:9,team:{name:'B'}})<0);
});
