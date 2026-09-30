const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {createBroadcastServer}=require('../server/broadcast-server.cjs');
const free=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
test('integrated launch, GSI ingestion, separate output, floors, old state, shutdown and port collision',async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'sd29-test-'));
 process.env.SCOREDECK_RADAR_PORT=String(await free());process.env.SCOREDECK_GSI_PORT=String(await free());
 const app=createBroadcastServer({dataDir:data,initialPort:await free(),initialCountdownPort:await free()});
 let blocker;
 try{
  const meta=await app.listen();assert.equal(meta.version,require('../package.json').version);assert.ok(meta.radar.running);assert.notEqual(meta.port,meta.radar.hudPort);
  const root=meta.localUrl,radar=meta.radar.controlUrl.replace(/\/$/,'');
  assert.equal((await fetch(root+'/api/health')).status,200);
  const cfg=path.join(data,'game','csgo','cfg');fs.mkdirSync(cfg,{recursive:true});
  assert.equal((await fetch(root+'/api/radar/setup',{method:'POST',body:'{}'})).status,401);
  const auth=await(await fetch(root+'/api/meta')).json();
  const setup=await fetch(root+'/api/radar/setup',{method:'POST',headers:{'Content-Type':'application/json','X-ScoreDeck-Key':auth.controlKey},body:JSON.stringify({directory:cfg})});
  assert.equal(setup.status,200);const installed=await setup.json();assert.equal(installed.ok,true);assert.ok(fs.readFileSync(installed.path,'utf8').includes(':'+meta.radar.gsiPort+'/gsi'));

  const state=await (await fetch(root+'/api/state')).json();assert.ok(state.teams);assert.ok(state.sponsors);
  assert.match(await (await fetch(root+'/assets/index-evagatfp.js')).text(),/sdRadarPanel/);
  assert.match(await (await fetch(meta.radar.outputUrl)).text(),/clean-output/);
  for(const layer of ['low','high','all']){
   assert.equal((await fetch(radar+'/api/display',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({layer,showPlayers:true})})).status,200);
   assert.equal((await (await fetch(radar+'/api/display')).json()).layer,layer);
   const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),2000);
   try{const events=await fetch(radar+'/events',{signal:abort.signal});const reader=events.body.getReader();let text='';while(!text.includes('data: '))text+=new TextDecoder().decode((await reader.read()).value);const frame=JSON.parse(text.split('data: ')[1].split('\n')[0]);assert.equal(frame.displaySettings.layer,layer);await reader.cancel()}finally{clearTimeout(timeout);abort.abort()}
  }
  assert.equal((await fetch(radar+'/api/display',{method:'POST',headers:{Origin:'http://other.test'},body:'{}'})).status,403);
  const packet={auth:{token:'change-me'},provider:{timestamp:Math.floor(Date.now()/1000)},map:{name:'de_nuke',round:0,phase:'live'},round:{phase:'live'},allplayers:{'1':{name:'CT-test',team:'CT',position:'0,0,-600',state:{health:100,equip_value:5000}}},allgrenades:{}};
  const response=await fetch(meta.radar.gsiUrl,{method:'POST',body:JSON.stringify(packet)});assert.equal(response.status,200);
  let hud;for(let i=0;i<20;i++){hud=await(await fetch(radar+'/api/state')).json();if(hud.players?.some(p=>p.id==='1'))break;await new Promise(r=>setTimeout(r,50));}assert.equal(hud.map.name,'de_nuke');assert.equal(hud.players[0].side,'CT');assert.equal(hud.players[0].layer,'low');
  await app.close();
  for(const port of [meta.port,meta.countdownPort,meta.radar.hudPort,meta.radar.gsiPort])await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>s.close(resolve))});
  blocker=net.createServer();await new Promise(r=>blocker.listen(meta.radar.hudPort,'127.0.0.1',r));
  const second=createBroadcastServer({dataDir:data,initialPort:await free(),initialCountdownPort:await free()});
  try{const m=await second.listen();assert.equal(m.radar.running,false);assert.match(m.radar.error,/占用/);assert.equal((await fetch(m.localUrl+'/api/health')).status,200)}finally{await second.close()}
 }finally{await app.close();if(blocker)await new Promise(r=>blocker.close(r));fs.rmSync(data,{recursive:true,force:true})}
});
