const {createTestState}=require('./fixtures/state.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {createIntegrationService}=require('../server/integration-service.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const free=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
test('managed VoiceBridge: collision, full settings, supervised restart, persistence, import and shutdown',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-vb-')),port=await free();
 const s=createIntegrationService({dataDir:dir});s.configure('http://127.0.0.1:17890',[17890,17891]);
 let blocker;
 try{
  await s.action('voicebridge','settings',{port,autoStart:true});
  blocker=net.createServer();await new Promise(r=>blocker.listen(port,'127.0.0.1',r));
  await assert.rejects(s.action('voicebridge','start'),/已被占用/);assert.equal(s.meta('voicebridge').phase,'error');
  await new Promise(r=>blocker.close(r));blocker=null;
  await s.action('voicebridge','start');assert.equal(s.meta('voicebridge').phase,'running');
  const base=s.meta('voicebridge').controlUrl.slice(0,-1);
  const page=await(await fetch(base+'/')).text();for(const marker of ['apiForm','installPlugin','tsConnection','cachePath','directorDelay'])assert.ok(page.includes(marker),marker);
  const post=(p,v)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(v)});
  assert.equal((await post('/api/settings/director',{directorDelaySeconds:17.5})).status,200);
  const settings=await(await fetch(base+'/api/settings/api')).json();assert.equal(settings.canRestart,true);
  await assert.rejects(s.action('voicebridge','settings',{port:port+1,autoStart:false}),/停止/);
  const generation=s.meta('voicebridge').generation;
  assert.equal((await post('/api/desktop/restart',{})).status,200);
  for(let i=0;i<200;i++){if(s.meta('voicebridge').generation>generation&&s.meta('voicebridge').phase==='running')break;await wait(100)}
  assert.ok(s.meta('voicebridge').generation>generation);
  assert.equal((await(await fetch(base+'/api/state')).json()).config.directorDelaySeconds,17.5);
  assert.equal((await post('/api/settings/director',{directorDelaySeconds:-1})).status,400);
  await s.action('voicebridge','stop');assert.equal(s.meta('voicebridge').phase,'stopped');
  const imported=path.join(dir,'legacy');fs.mkdirSync(imported);fs.writeFileSync(path.join(imported,'team-names.json'),JSON.stringify({'channel-alpha':'Alpha','channel-bravo':'Bravo'}));
  await s.action('voicebridge','import',{directory:imported});
  assert.ok(fs.readdirSync(path.join(dir,'integrations')).some(n=>n.startsWith('voicebridge.backup-')));
  assert.ok(fs.existsSync(path.join(s.meta('voicebridge').dataDir,'team-names.json')));
  await s.action('voicebridge','identity',{followMain:false,swapTeams:false});await s.action('voicebridge','start');assert.equal((await(await fetch(base+'/api/state')).json()).channels[0].name,'Alpha');await s.action('voicebridge','stop');
  const reload=createIntegrationService({dataDir:dir});assert.equal(reload.meta('voicebridge').port,port);assert.equal(reload.meta('voicebridge').autoStart,true);await reload.close();
 }finally{if(blocker)await new Promise(r=>blocker.close(r));await s.close();fs.rmSync(dir,{recursive:true,force:true})}
});
test('managed Replay: embedded origin, original control/output pages, persistent state, stdin shutdown',async t=>{
 const executable=process.env.SCOREDECK_TEST_REPLAY||path.resolve(__dirname,'../modules/replay',process.platform==='win32'?'ProjectReplay.exe':'ProjectReplay');
 if(!fs.existsSync(executable))return t.skip('Build the platform Replay binary first');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-rp-')),port=await free();
 const s=createIntegrationService({dataDir:dir,replayExecutable:executable});s.configure('http://127.0.0.1:17890',[17890]);
 try{
  await s.action('replay','settings',{port,autoStart:false});await s.action('replay','start');
  const base=s.meta('replay').controlUrl;
  const page=await fetch(base);assert.match(page.headers.get('content-security-policy'),/frame-ancestors http:\/\/127.0.0.1:17890 http:\/\/localhost:17890;/);
  const html=await page.text();for(const marker of ['settings-form','relay-panel','transition1','transition2','half-play','full-play','auto-full','custom-hud-dialog','demo-path'])assert.ok(html.includes(marker),marker);
  assert.equal((await fetch(base+'output.html')).status,200);
  assert.equal((await fetch(base+'api/config',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'})).status,403);
  const state=await(await fetch(base+'api/state')).json();assert.equal(state.version,'0.2.5');assert.equal(state.role,'director');
  await s.action('replay','stop');assert.equal(s.meta('replay').phase,'stopped');assert.ok(fs.existsSync(path.join(s.meta('replay').dataDir,'state.json')));
  const legacy=path.join(dir,'old-replay');fs.cpSync(s.meta('replay').dataDir,legacy,{recursive:true});
  const stored=JSON.parse(fs.readFileSync(path.join(legacy,'state.json'),'utf8'));stored.paths={check:path.join(legacy,'media','clip.mp4')};fs.writeFileSync(path.join(legacy,'state.json'),JSON.stringify(stored));
  await s.action('replay','import',{directory:legacy});
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.meta('replay').dataDir,'state.json'),'utf8')).paths.check,path.join(s.meta('replay').dataDir,'media','clip.mp4'));
  await s.action('replay','start');assert.equal(s.meta('replay').generation,2);
 }finally{await s.close();fs.rmSync(dir,{recursive:true,force:true})}
});

test('main match identities follow stages, swap channels and CT/T, clear missing teams and preserve manual settings',async t=>{
 const executable=process.env.SCOREDECK_TEST_REPLAY;
 if(!executable)return t.skip('Set SCOREDECK_TEST_REPLAY to a native Replay binary');
 const F=require('../server/tournament-flow.cjs'),V=require('../server/flow-display.cjs'),D=require('../server/default-state.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-identities-'));let state=createTestState();
 const a=F.addStage(state,'playoff',{name:'第一阶段',teamCount:4}),b=F.addStage(state,'playoff',{name:'第二阶段',teamCount:2});
 a.slots.forEach((s,i)=>s.teamId=state.teams[i].id);b.slots.forEach((s,i)=>s.teamId=state.teams[i+4].id);F.reconcile(state);V.selectStage(state,a.id);
 state.teams[0].name='复旦大学';state.teams[0].shortName='复旦';state.teams[0].logoPrimary=fs.readFileSync(path.join(__dirname,'fixtures/team-logo.webp.txt'),'utf8').trim();
 const service=createIntegrationService({dataDir:dir,getState:()=>state,replayExecutable:executable});service.configure('http://127.0.0.1:17890',[17890]);
 const get=async(id)=>await(await fetch(service.meta(id).controlUrl+'api/state')).json();
 const post=async(id,p,b)=>fetch(service.meta(id).controlUrl+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 async function until(fn){for(let i=0;i<80;i++){if(await fn())return;await wait(100);}assert.fail('identity sync timeout: '+JSON.stringify(service.all()));}
 try{
  for(const id of ['voicebridge','replay']){await service.action(id,'settings',{port:await free(),autoStart:false});await service.action(id,'start');assert.equal(service.meta(id).identity.syncError,'');}
  let vb=await get('voicebridge'),rp=await get('replay');assert.equal(vb.channels[0].name,'复旦大学');assert.equal(vb.channels[0].logo,state.teams[0].logoPrimary);assert.equal(rp.state.config.teams.ct.logo,state.teams[0].logoPrimary);assert.equal(rp.state.config.teams.scoredeck_managed,true);
  assert.equal((await post('voicebridge','api/desktop/teams',{'channel-alpha':'wrong','channel-bravo':'wrong'})).status,409);
  assert.equal((await post('voicebridge','api/scoredeck/teams',{managed:false})).status,403);
  await post('replay','api/teams',{ct:{name:'wrong',logo:''},t:{name:'wrong',logo:''},half_rounds:10,overtime_half_rounds:2});
  rp=await get('replay');assert.equal(rp.state.config.teams.ct.name,'复旦大学');assert.equal(rp.state.config.teams.half_rounds,10);
  for(const id of ['voicebridge','replay'])await service.action(id,'identity',{followMain:true,swapTeams:true});
  vb=await get('voicebridge');rp=await get('replay');assert.equal(vb.channels[1].name,'复旦大学');assert.equal(rp.state.config.teams.t.name,'复旦大学');assert.equal(rp.state.config.teams.overtime_half_rounds,2);
  V.selectStage(state,b.id);await until(async()=> (await get('replay')).state.config.teams.ct.name===state.teams[5].name);await until(async()=> (await get('voicebridge')).channels[0].name===state.teams[5].name);
  state.teams[5].name='实时改名';await until(async()=> (await get('voicebridge')).channels[0].name==='实时改名');
  for(const id of ['voicebridge','replay'])await service.action(id,'identity',{followMain:false,swapTeams:false});
  assert.equal((await post('voicebridge','api/desktop/teams',{'channel-alpha':'独立甲','channel-bravo':'独立乙'})).status,200);
  state.teams[5].name='不应覆盖';await wait(1300);assert.equal((await get('voicebridge')).channels[0].name,'独立甲');
  const empty=F.addStage(state,'custom',{name:'空赛段'});V.selectStage(state,empty.id);
  for(const id of ['voicebridge','replay'])await service.action(id,'identity',{followMain:true,swapTeams:false});
  assert.equal((await get('replay')).state.config.teams.ct.logo,'');assert.equal((await get('voicebridge')).channels[0].name,'待定队伍 A');
  await service.action('replay','restart');assert.equal((await get('replay')).state.config.teams.half_rounds,10);assert.equal(service.meta('replay').identity.syncError,'');
 }finally{await service.close();fs.rmSync(dir,{recursive:true,force:true});}
});
