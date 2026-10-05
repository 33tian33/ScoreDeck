'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createBroadcastServer}=require('../server/broadcast-server.cjs');
const {createController}=require('../server/highlight-obs.cjs');
const {WebSocketServer}=require('../modules/voicebridge/lib/vendor/ws');
const free=()=>new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-obs-browser-'));let browser,app,ws;
 try{
  process.env.SCOREDECK_RADAR_PORT=String(await free());process.env.SCOREDECK_GSI_PORT=String(await free());
  app=createBroadcastServer({dataDir:dir,initialPort:await free(),initialCountdownPort:await free()});const {localUrl:root}=await app.listen();
  ws=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>ws.on('listening',r));let scene='游戏';const switches=[];
  ws.on('connection',s=>{s.send(JSON.stringify({op:0,d:{}}));s.on('message',bytes=>{const {op,d}=JSON.parse(bytes);if(op===1)s.send(JSON.stringify({op:2,d:{}}));else if(op===6){let data={};if(d.requestType==='GetSceneList')data={currentProgramSceneName:scene,scenes:['游戏','ScoreDeck 精选','ScoreDeck 直播控制','广告'].map(sceneName=>({sceneName}))};if(d.requestType==='GetCurrentProgramScene')data={currentProgramSceneName:scene};if(d.requestType==='SetCurrentProgramScene'){scene=d.requestData.sceneName;switches.push(scene);}s.send(JSON.stringify({op:7,d:{requestId:d.requestId,requestStatus:{result:true},responseData:data}}));}});});
  browser=await chromium.launch({headless:true,...(process.env.QA_BROWSER?{executablePath:process.env.QA_BROWSER}:{}),args:['--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(root+'/halftime');await page.waitForFunction(()=>window.SDClient?.state);
  const captureClipboard=()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedOBSURL=value;}}});
  await page.evaluate(captureClipboard);await page.locator('#copy-auto').click();assert.equal(new URL(await page.evaluate(()=>window.copiedOBSURL)).searchParams.get('obs'),'1');
  const editor=await browser.newPage();await editor.goto(root+'/highlights');await editor.evaluate(captureClipboard);await editor.locator('#copy').click();assert.equal(new URL(await editor.evaluate(()=>window.copiedOBSURL)).searchParams.get('obs'),'1');await editor.close();
  await page.locator('#obs-url').fill('ws://127.0.0.1:'+ws.address().port);await page.locator('#obs-enabled').check();await page.locator('#obs-test').click();await page.waitForFunction(()=>document.querySelector('#obs-result').textContent.includes('两个目标场景均已找到'));
  assert.equal(await page.locator('#obs-highlights .obs-guide li').count(),14);
  assert.equal(await page.evaluate(()=>document.querySelector('main').lastElementChild.id),'obs-highlights');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  fs.mkdirSync(path.join(__dirname,'../verification'),{recursive:true});await page.locator('#obs-highlights').screenshot({path:path.join(__dirname,'../verification/obs-highlights-guide.png')});
  await page.setViewportSize({width:480,height:850});assert.equal(await page.locator('#obs-highlights').evaluate(el=>el.scrollWidth>el.clientWidth),false);await page.setViewportSize({width:1280,height:900});
  // Produce a real short clip in the browser, then exercise both renderers and both modes.
  const base64=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const ctx=c.getContext('2d'),chunks=[],r=new MediaRecorder(c.captureStream(25),{mimeType:'video/webm;codecs=vp8'});r.ondataavailable=e=>chunks.push(e.data);const stopped=new Promise(resolve=>r.onstop=resolve);r.start();for(let i=0;i<20;i++){ctx.fillStyle=i%2?'#407060':'#253550';ctx.fillRect(0,0,320,180);await new Promise(r=>setTimeout(r,40));}r.stop();await stopped;return new Promise(resolve=>{const f=new FileReader();f.onload=()=>resolve(f.result.split(',')[1]);f.readAsDataURL(new Blob(chunks,{type:'video/webm'}));});});
  const media=Buffer.from(base64,'base64'),baseline=await(await fetch(root+'/api/halftime')).json();let modern=false,active=false,currentId='',completed=0;
  const layouts=structuredClone(baseline.layouts);for(const mode of ['half','full'])layouts[mode].elements=layouts[mode].elements.filter(e=>e.type==='replay').map(e=>({...e,muted:true,loop:true}));
  const config={...baseline.config,left:{...baseline.config.left,muted:true},right:{...baseline.config.right,type:'none'}};
  const controller=createController({dir:path.join(dir,'browser'),getItems:async()=>[{id:'one',duration:.8},{id:'two',duration:.8}],hasReplay:()=>true,getPlayback:()=>({customLayout:modern,layouts,config})});
  fs.mkdirSync(path.join(dir,'browser'));await controller.configure({enabled:true,url:'ws://127.0.0.1:'+ws.address().port});
  const output=await browser.newPage({viewport:{width:960,height:540}});output.on('pageerror',e=>errors.push(e.message));
  await output.route('**/api/halftime',async route=>{await controller.tick(active?currentId:null);await route.fulfill({json:{...baseline,customLayout:modern,layouts,config,mode:controller.meta().run?.mode||'half',auto:{...baseline.auto,active},obs:controller.meta(),serverTime:Date.now()}});});
  await output.route('**/api/halftime/replay?*',route=>route.fulfill({json:{items:controller.meta().run?.items||[]}}));
  await output.route('**/api/halftime/replay/media/*',route=>route.fulfill({status:200,contentType:'video/webm',body:media}));
  await output.route('**/api/highlights/playback',async route=>{const b=route.request().postDataJSON(),result=await controller.signal(b);if(result.finish){await controller.end(b.id,result.finish);active=false;completed++;}await route.fulfill({json:result});});
  for(const [index,mode,isModern]of [[1,'half',false],[2,'half',true],[3,'full',true]]){
   scene='游戏';modern=isModern;currentId='browser-session-'+index;await controller.begin(currentId,mode);active=true;await controller.tick(currentId);
   await output.goto(root+'/output/halftime-auto?obs=1');await output.waitForFunction(()=>document.querySelector('video[src]')?.readyState>=2);
   const deadline=Date.now()+18000;while(completed<index&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
   assert.equal(completed,index,'playlist must actually end');assert.equal(scene,mode==='half'?'游戏':'ScoreDeck 直播控制');
  }
  // Preview with obs=1 must never claim the scene or complete the run.
  scene='游戏';currentId='preview-session';active=true;await controller.begin(currentId,'half');await controller.tick(currentId);await output.goto(root+'/output/halftime-auto?obs=1&preview=1');await new Promise(r=>setTimeout(r,2000));assert.equal(scene,'游戏');await controller.end(currentId);active=false;
  assert.deepEqual(errors,[]);assert.equal(switches.length,6);
  console.log('PASS: OBS settings save/test, guide at bottom, narrow layout, real video completion in legacy half + custom half + full, correct return scenes, preview isolation.');
 }finally{await browser?.close();await app?.close();if(ws){for(const s of ws.clients)s.terminate();await new Promise(r=>ws.close(r));}fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
