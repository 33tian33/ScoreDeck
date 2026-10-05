const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createIntegrationService}=require('../server/integration-service.cjs');
const {createBroadcastServer}=require('../server/broadcast-server.cjs');
const free=()=>new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
(async()=>{
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(root,'verification/director-replay-'));
 const seed=createIntegrationService({dataDir:dir});seed.configure('http://127.0.0.1:17890',[17890]);
 await seed.action('replay','settings',{port:await free(),autoStart:true});
 try{await seed.action('replay','start');}finally{await seed.close();}
 const data=path.join(dir,'integrations/replay'),file=path.join(data,'state.json'),disk=JSON.parse(fs.readFileSync(file));
 const c=disk.state.config;
 disk.state.jobs=[{id:'qa-job',match:c.match,map:c.map,epoch:c.epoch,status:'READY',events:[]}];
 disk.state.artifacts=[{id:'qa-latest',job_id:'qa-job',round:3,name:'最新击杀',player:'Player A',duration:2,created:2},{id:'qa-older',job_id:'qa-job',round:3,name:'较早片段',duration:2,created:1}];
 disk.state.queue=['qa-older','qa-latest'];disk.paths={};
 for(const clip of disk.state.artifacts){const dest=path.join(data,'media',clip.id+'.mp4');fs.copyFileSync(path.join(root,'modules/replay-source/internal/replay/demo.mp4'),dest);disk.paths[clip.id]=dest;}
 fs.writeFileSync(file,JSON.stringify(disk));
 process.env.SCOREDECK_RADAR_PORT=String(await free());process.env.SCOREDECK_GSI_PORT=String(await free());
 const app=createBroadcastServer({dataDir:dir,initialPort:await free(),initialCountdownPort:await free()});let browser;
 try{
  const meta=await app.listen(),base=meta.localUrl,modules=await(await fetch(base+'/api/integrations')).json(),replayBase=modules.replay.controlUrl;
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1100,height:180}}),output=await browser.newPage(),errors=[],plays=[];
  page.on('pageerror',e=>errors.push(e.message));output.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/director/replay/play'))plays.push(r.postDataJSON());});
  await output.goto(replayBase+'output.html');
  await page.goto(base+'/director-bar.html');
  await page.waitForFunction(()=>!document.querySelector('#replay-play').disabled&&document.querySelector('#replay-video').readyState>=2);
  const range=await fetch(base+'/api/director/replay/media/qa-latest',{headers:{Range:'bytes=0-99'}});
  assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,100);
  for(const rate of [.25,.5,1])await page.locator(`[data-replay-rate="${rate}"]`).click();
  assert.equal(plays.length,0,'rate buttons must not start playback');
  assert.equal(await page.locator('#replay-video').evaluate(v=>v.paused),true);
  await page.locator('[data-replay-rate="0.25"]').click();await page.locator('#replay-play').click();
  await output.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>!v.paused&&v.src.includes('qa-latest')&&v.playbackRate===.25));
  assert.deepEqual(plays,[{id:'qa-latest',rate:.25}]);
  await page.locator('[data-replay-rate="0.5"]').click();
  assert.equal(plays.length,1);assert.equal(await page.locator('#replay-video').evaluate(v=>v.paused),true);
  assert.equal(await output.evaluate(()=>[...document.querySelectorAll('video')].find(v=>!v.paused).playbackRate),.25,'selection must not change active output');
  await output.waitForFunction(()=>[...document.querySelectorAll('video')].every(v=>v.paused&&v.style.display==='none'),null,{timeout:25000});
  await page.waitForFunction(()=>!document.querySelector('#replay-play').disabled);
  await page.locator('#replay-play').click();
  await output.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>!v.paused&&v.src.includes('qa-latest')&&v.playbackRate===.5));
  assert.equal(plays.length,2);
  await output.waitForFunction(()=>[...document.querySelectorAll('video')].every(v=>v.paused&&v.style.display==='none'),null,{timeout:25000});
  const response=await fetch(replayBase+'api/output/play',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'round',round:3})});assert.equal(response.status,200);
  await output.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>!v.paused&&v.src.includes('qa-older')&&v.playbackRate===1));
  await fetch(replayBase+'api/output/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  // Add representative voice cards for layout inspection without needing audio capture.
  await page.route('**/api/director/state',async route=>{const res=await route.fetch(),state=await res.json();state.voiceError='';state.voice={sessionId:'qa',delay:3,serverNow:Date.now(),channels:[0,1].map(i=>({name:i?'Team Bravo':'Team Alpha',segments:[0,1].map(n=>({id:'voice-'+i+'-'+n,channelId:'channel-'+i,startMs:32000,audioDurationMs:2400,title:n?'准备下一轮进攻':'集合，准备进攻 A 点',audioUrl:''}))}))};await route.fulfill({response:res,json:state});});
  await page.waitForFunction(()=>document.querySelectorAll('.voice .clip').length===4);
  for(const [width,height] of [[800,160],[1100,180],[1920,260]]){
   await page.setViewportSize({width,height});
   const boxes=await page.evaluate(()=>Object.fromEntries(['.game','.replay-panel','.voice','.replay-preview','.replay-rates'].map(sel=>{const r=document.querySelector(sel).getBoundingClientRect();return [sel,{x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom}];})));
   assert.ok(Math.abs(boxes['.replay-panel'].x+boxes['.replay-panel'].w/2-width/2)<2,'Replay centered');
   assert.ok(boxes['.replay-preview'].h>30&&boxes['.replay-rates'].bottom<=height,'preview and rates visible');
   await page.screenshot({path:path.join(root,`verification/director-replay-${width}.png`)});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: latest clip preview, Range proxy, inert rate selection, native 0.25x/0.5x output, normal replay 1x, three window sizes, no browser errors');
 }finally{await browser?.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
