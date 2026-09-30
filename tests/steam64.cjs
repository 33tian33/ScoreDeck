const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const R=require('../server/scoredeck-rules.cjs'),D=require('../server/default-state.cjs'),F=require('../server/tournament-flow.cjs'),M=require('../server/match-data.cjs');
const ID='76561198000000001',OTHER='76561198000000003';
function fixture(){const s=D.createDefaultState(),st=F.addStage(s,'playoff',{teamCount:2});st.slots.forEach((v,i)=>v.teamId=s.teams[i].id);F.reconcile(s);F.activate(s);s.selectedStageId=st.id;s.selectedMatchId=F.matchesOf(s,st.id)[0].id;const m=M.currentMatch(s);m.status='live';const g={connected:true,sourceAgeMs:10,map:{name:'de_anubis',phase:'live',teamCT:{score:4},teamT:{score:2}},allplayers:{[ID]:{name:'changed A',team:'CT',match_stats:{kills:12,deaths:3,assists:4}},[OTHER]:{name:'changed B',team:'T',match_stats:{kills:8,deaths:6,assists:2}}}};R.setPlayerSteamId(s,s.teams[0].id,0,ID);R.setPlayerSteamId(s,s.teams[1].id,0,OTHER);return {s,m,g};}
test('Steam64 stays a precise string across migration and rejects numeric, malformed and duplicate values',()=>{
 const s=D.createDefaultState(),a=s.teams[0].id;R.setPlayerSteamId(s,a,0,' ７６５６１１９８００００００００１ ');assert.equal(s.teams[0].players[0].steamId,ID);
 const restored=D.migrateState(JSON.parse(JSON.stringify(s)));assert.equal(restored.teams[0].players[0].steamId,ID);
 for(const bad of [Number(ID),'7.6561198e16','123',ID+'0','00000000000000000'])assert.throws(()=>R.setPlayerSteamId(s,a,0,bad),/Steam64/);
 assert.throws(()=>R.setPlayerSteamId(s,s.teams[1].id,1,ID),/已由/);assert.equal(s.teams[1].players[1].steamId,'');
 s.teams[1].players[1].steamId=ID;assert.throws(()=>R.validateSteamIds(s),/重复/);
 R.setPlayerSteamId(s,a,0,'');assert.equal(s.teams[0].players[0].steamId,'');
});
test('explicit Steam64 wins over stale manual and same-name matches; identities survive CT/T swap and rename',()=>{
 const {s,m,g}=fixture();g.allplayers[ID].name=s.teams[1].players[1].id;
 m.gsiBindings={[ID]:{side:'B',playerId:s.teams[1].players[1].id}};
 assert.equal(M.ingest(s,g),true);assert.equal(m.gsiBindings[ID].source,'steam64');assert.equal(m.mapDetails[0].teamA[0].kills,12);assert.equal(m.mapDetails[0].teamB[1].kills,null);
 R.renamePlayer(s,s.teams[0].id,0,'新昵称');assert.equal(m.gsiBindings[ID].playerId,'新昵称');
 g.allplayers[ID].team='T';g.allplayers[OTHER].team='CT';g.map.teamT.score=8;g.map.teamCT.score=6;
 assert.equal(M.ingest(s,g),true);assert.equal(m.mapScores[0].a,8);assert.equal(m.mapDetails[0].teamA[0].steamId,ID);
});
test('configured players never accept an impostor nickname or conflicting manual binding',()=>{
 const {s,m,g}=fixture();delete g.allplayers[ID];const impostor='76561198000000009';g.allplayers[impostor]={name:s.teams[0].players[0].id,team:'CT',match_stats:{kills:99}};
 m.gsiBindings||={};m.gsiBindings[impostor]={side:'A',playerId:s.teams[0].players[0].id};assert.equal(M.ingest(s,g),false);assert.equal(m.gsiBindings[impostor],undefined);
 R.setPlayerSteamId(s,s.teams[0].id,0,'');assert.equal(M.ingest(s,g),true);assert.equal(m.mapDetails[0].teamA[0].kills,99);
});
test('editing the ID invalidates cached bindings while retaining historical scores',()=>{
 const {s,m,g}=fixture();M.ingest(s,g);const before=structuredClone(m.mapDetails);
 R.setPlayerSteamId(s,s.teams[0].id,0,'76561198000000007');assert.equal(m.gsiBindings[ID],undefined);assert.equal(m.gsiFingerprint,undefined);assert.deepEqual(m.mapDetails,before);
 g.allplayers[ID].name=s.teams[0].players[0].id;assert.equal(M.ingest(s,g),false);
});
test('duplicate roster IDs and multiple nickname accounts remain unbound',()=>{
 const {s,m,g}=fixture();s.teams[0].players[1].steamId=ID;assert.equal(M.ingest(s,g),false);assert.equal(m.gsiBindings[ID],undefined);
 s.teams[0].players[1].steamId='';s.teams[0].players[0].steamId='';g.allplayers[ID].name=s.teams[0].players[0].id;g.allplayers.extra=structuredClone(g.allplayers[ID]);
 assert.equal(M.ingest(s,g),false);assert.equal(m.gsiBindings[ID],undefined);assert.equal(m.gsiBindings.extra,undefined);
});
function fieldHarness(props){let cursor=0;const slots=[],effects=[];const l={createElement:(type,props,...children)=>({type,props,children}),useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=v;}];},useRef:initial=>{const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect:(fn,deps)=>{const i=cursor++;if(!slots[i]||deps.some((v,j)=>v!==slots[i][j])){slots[i]=deps;effects.push(fn);}}};const ctx=vm.createContext({l});vm.runInContext(fs.readFileSync(path.join(__dirname,'../ui/text-field.js'),'utf8'),ctx);return ()=>{cursor=0;const result=ctx.sdSteamIdField(props);while(effects.length)effects.shift()();return result;};}
test('Steam64 field buffers partial input, saves on Enter/blur and shows duplicate errors',()=>{
 const s=D.createDefaultState(),saved=[];const props={value:'',label:'ID',validate:v=>R.checkPlayerSteamId(s,s.teams[0].id,0,v),onSave:v=>saved.push(v)},render=fieldHarness(props);
 let field=render().children[1];field.props.onFocus();field.props.onChange({currentTarget:{value:'7656'}});field=render().children[1];assert.deepEqual(saved,[]);field.props.onBlur();assert.match(render().children[2].children[0],/17 位/);
 field.props.onChange({currentTarget:{value:ID}});field=render().children[1];field.props.onKeyDown({key:'Enter',preventDefault(){}});field.props.onBlur();assert.deepEqual(saved,[ID]);
 s.teams[1].players[0].steamId=OTHER;field.props.onChange({currentTarget:{value:OTHER}});field=render().children[1];field.props.onBlur();assert.match(render().children[2].children[0],/已由/);assert.deepEqual(saved,[ID]);
});

test('HTTP save rejects numeric/duplicate Steam64 and preserves exact IDs through restart and archive',async()=>{
 const os=require('node:os'),net=require('node:net'),{createBroadcastServer}=require('../server/broadcast-server.cjs'),archive=require('../server/archive.cjs');
 const free=()=>new Promise(resolve=>{const server=net.createServer().listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-steam64-'));process.env.SCOREDECK_RADAR_PORT=String(await free());process.env.SCOREDECK_GSI_PORT=String(await free());
 let app=createBroadcastServer({dataDir:dir,initialPort:await free(),initialCountdownPort:await free()});
 try{
  const meta=await app.listen(),root=meta.localUrl,auth=await fetch(root+'/api/meta').then(r=>r.json());
  const headers={'Content-Type':'application/json','X-ScoreDeck-Key':auth.controlKey,'X-ScoreDeck-Epoch':auth.serverEpoch,'X-ScoreDeck-Control-Epoch':auth.controlEpoch};
  const get=()=>fetch(root+'/api/state').then(r=>r.json());
  const put=s=>fetch(root+'/api/state',{method:'PUT',headers,body:JSON.stringify({...s,expectedRevision:s.revision})});
  let s=await get();s.teams[0].players[0].steamId=ID;let response=await put(s);assert.equal(response.status,200);s=await response.json();assert.equal(s.teams[0].players[0].steamId,ID);
  for(const value of [Number(ID),'765']){const bad=structuredClone(s);bad.teams[1].players[0].steamId=value;assert.equal((await put(bad)).status,400);}
  const duplicate=structuredClone(s);duplicate.teams[1].players[0].steamId=ID;assert.equal((await put(duplicate)).status,400);assert.equal((await get()).revision,s.revision);
  const data=Buffer.from(await fetch(root+'/api/archive').then(r=>r.arrayBuffer()));const archived=JSON.parse(archive.unpack(data).get('broadcast-state.json'));assert.equal(archived.teams[0].players[0].steamId,ID);
  await app.close();app=createBroadcastServer({dataDir:dir,initialPort:await free(),initialCountdownPort:await free()});const restarted=await app.listen();const actual=await fetch(restarted.localUrl+'/api/state').then(r=>r.json());assert.equal(actual.teams[0].players[0].steamId,ID);
 }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
