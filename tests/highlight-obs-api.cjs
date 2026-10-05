'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {createBroadcastServer}=require('../server/broadcast-server.cjs');
const free=()=>new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
test('OBS configuration and playback APIs require authorization; no password leaks; clean shutdown clears pending session',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-obs-api-'));
 process.env.SCOREDECK_RADAR_PORT=String(await free());process.env.SCOREDECK_GSI_PORT=String(await free());
 const app=createBroadcastServer({dataDir:dir,initialPort:await free(),initialCountdownPort:await free()});let closed=false;
 try{
  const {localUrl:root}=await app.listen(),meta=await(await fetch(root+'/api/meta')).json();
  const headers={'Content-Type':'application/json','X-ScoreDeck-Key':meta.controlKey,'X-ScoreDeck-Epoch':meta.serverEpoch,'X-ScoreDeck-Control-Epoch':meta.controlEpoch};
  const get=async url=>(await fetch(root+url)).json(),post=(url,body,h=headers)=>fetch(root+url,{method:'POST',headers:h,body:JSON.stringify(body)});
  assert.equal((await post('/api/highlights/obs',{action:'settings',settings:{enabled:true}},{})).status,401);
  assert.equal((await post('/api/highlights/playback',{action:'ended'},{})).status,401);
  assert.equal((await post('/api/highlights/obs',{action:'settings',settings:{enabled:true}},{...headers,'X-ScoreDeck-Epoch':'old'})).status,400);
  assert.equal((await post('/api/highlights/obs',{action:'settings',settings:{url:'https://example.com'}})).status,400);
  const response=await post('/api/highlights/obs',{action:'settings',settings:{enabled:true,password:'private-obs-secret'}});assert.equal(response.status,200);assert.equal((await response.json()).config.hasPassword,true);
  for(const url of ['/api/highlights/obs','/api/halftime','/api/highlights'])assert.equal(JSON.stringify(await get(url)).includes('private-obs-secret'),false);
  let snap=await get('/api/halftime');assert.equal((await post('/api/halftime/program',{action:'show',mode:'half',expectedRevision:snap.config.revision})).status,200);
  snap=await get('/api/halftime');assert.equal(snap.obs.run.status,'preparing');assert.equal((await post('/api/highlights/obs',{action:'settings',settings:{enabled:false}})).status,400);
  assert.equal((await post('/api/halftime',{action:'pause-media',expectedRevision:snap.config.revision})).status,400);
  const stale=await post('/api/highlights/playback',{action:'ended',id:'old-session',clientId:'some-output-client'});assert.equal((await stale.json()).accepted,false);assert.equal((await get('/api/halftime')).auto.active,true);
  await app.close();closed=true;assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'halftime-auto-state.json'))).active,false);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'highlight-obs-session.json'))),null);
 }finally{if(!closed)await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
