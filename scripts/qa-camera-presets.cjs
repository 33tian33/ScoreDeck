const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createBroadcastServer}=require('../server/broadcast-server.cjs');
const {MAP_CAMERAS}=require('../radarhud/camera-presets.cjs');
const free=()=>new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sd-cameras-')),sockets=new Set(),commands=[];
 const values={spec_show_xray:0,cl_draw_only_deathnotices:0,cl_drawhud_force_deathnotices:0};let connections=0;
 const consoleServer=net.createServer(s=>{connections++;sockets.add(s);s.on('close',()=>sockets.delete(s));let buf='';s.on('data',d=>{buf+=d;const lines=buf.split('\n');buf=lines.pop();for(const line of lines){commands.push(line);for(const cmd of line.split(';').map(s=>s.trim())){if(cmd.startsWith('echo ')){s.write(cmd.slice(5)+'\n');continue;}const [k,v]=cmd.split(' ');if(k in values){if(v!==undefined)values[k]=Number(v);else s.write('"'+k+'" = "'+values[k]+'"\n');}}}});});
 await new Promise(r=>consoleServer.listen(0,'127.0.0.1',r));
 process.env.SCOREDECK_RADAR_PORT=String(await free());process.env.SCOREDECK_GSI_PORT=String(await free());
 const app=createBroadcastServer({dataDir:temp,initialPort:await free(),initialCountdownPort:await free()});
 let browser,page,pump,map='de_dust2',grenades={},inMenu=false;const steamid='76561198000000001',errors=[];
 try{
  const meta=await app.listen(),base=meta.localUrl,credentials=await fetch(base+'/api/meta').then(r=>r.json());
  const auth={'Content-Type':'application/json','X-ScoreDeck-Key':credentials.controlKey,'X-ScoreDeck-Epoch':credentials.serverEpoch,'X-ScoreDeck-Control-Epoch':credentials.controlEpoch};
  const action=async(name,body={})=>{const r=await fetch(base+'/api/director/tracker/'+name,{method:'POST',headers:auth,body:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
  const post=()=>fetch('http://127.0.0.1:'+process.env.SCOREDECK_GSI_PORT+'/gsi',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({auth:{token:'change-me'},provider:{timestamp:Date.now()/1000},map:{name:map,phase:'live',round:1},round:{phase:'live'},player:{steamid,name:'选手甲',activity:inMenu?'menu':'playing'},allplayers:{[steamid]:{name:'选手甲',team:'CT',observer_slot:2,position:'0,0,0',state:{health:100}}},allgrenades:grenades})});
  browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||chromium.executablePath(),args:process.env.CHROME_ARGS?JSON.parse(process.env.CHROME_ARGS):['--no-sandbox']});page=await browser.newPage({viewport:{width:1366,height:420}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/director-bar.html');await page.waitForFunction(()=>document.querySelector('#voice-status').textContent!=='正在连接控制台…');assert.equal(await page.locator('[data-camera-id]').count(),0);
  await action('config',{port:consoleServer.address().port,protocol:'text'});await action('connect');
  await post();pump=setInterval(()=>post().catch(()=>{}),100);
  const waitMap=async(name,count)=>{map=name;await post();await page.waitForFunction(({count,name})=>document.querySelectorAll('[data-camera-id]').length===count&&document.querySelector('#camera-map').title===name,{count,name},{timeout:8000});};
  let clicked=0;
  for(const [name,data] of Object.entries(MAP_CAMERAS)){
   await waitMap(name,data.presets.length);
   assert.deepEqual(await page.locator('[data-camera-id]').allTextContents(),data.presets.map(p=>p.label));
   for(const p of data.presets){
    const start=commands.length;await page.locator(`[data-camera-id="${p.id}"]`).click();
    await page.waitForFunction(id=>document.querySelector(`[data-camera-id="${id}"]`)?.getAttribute('aria-pressed')==='true',p.id);
    assert.ok(commands.slice(start).includes('spec_autodirector 0; spec_mode 6; spec_goto '+p.pose.join(' ')),p.id);clicked++;
   }
  }
  // The UI cannot send a previous map's key after the GSI has switched.
  await waitMap('de_dust2',5);const status=await fetch(base+'/api/director/state').then(r=>r.json()),before=commands.filter(c=>c.includes('spec_goto')).length;
  map='de_mirage';await post();const r=await fetch(base+'/api/director/tracker/camera',{method:'POST',headers:auth,body:JSON.stringify({id:'D01',mapName:'de_dust2',mapEpoch:status.tracker.cameras.mapEpoch})});assert.equal(r.status,409);assert.equal(commands.filter(c=>c.includes('spec_goto')).length,before);
  await waitMap('de_mirage',3);grenades={smoke:{type:'smoke',owner:steamid,position:'100,0,50',velocity:'100,0,0',lifetime:'0.1'}};await post();await action('start',{type:'smoke'});
  await page.locator('[data-camera-id="M02"]').click();await page.waitForFunction(()=>document.querySelector('[data-camera-id="M02"]')?.getAttribute('aria-pressed')==='true');
  const after=commands.filter(c=>c.includes('spec_goto')).length;await page.waitForTimeout(200);assert.equal(commands.filter(c=>c.includes('spec_goto')).length,after);await page.locator('#return').click();
  await page.waitForFunction(()=>document.querySelector('#track-status').textContent.includes('返回'));
  assert.ok(commands.includes('spec_autodirector 0; spec_mode 1; spec_player "选手甲"'));grenades={};
  await waitMap('de_anubis',6);
  const checks=[];fs.mkdirSync(path.join(__dirname,'../verification'),{recursive:true});
  for(const [width,height] of [[880,300],[980,340],[1366,420],[1920,600]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(100);
   const layout=await page.evaluate(()=>{const root=document.querySelector('.game'),buttons=[...document.querySelectorAll('[data-camera-id]')];return {scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,gameHeight:root.clientHeight,gameScroll:root.scrollHeight,buttons:buttons.map(b=>({text:b.textContent,width:b.clientWidth,scroll:b.scrollWidth,bottom:b.getBoundingClientRect().bottom})),footerTop:document.querySelector('footer').getBoundingClientRect().top};});
   assert.ok(layout.scrollWidth<=width);assert.ok(layout.gameScroll<=layout.gameHeight+1,'game panel must fit '+width);assert.ok(layout.buttons.every(b=>b.scroll<=b.width+1&&b.bottom<layout.footerTop));checks.push({width,height,...layout});
   await page.screenshot({path:path.join(__dirname,`../verification/camera-presets-${width}.png`)});
  }
  inMenu=true;await post();await page.waitForFunction(()=>document.querySelectorAll('[data-camera-id]').length===0);inMenu=false;
  await waitMap('de_train',0);await waitMap('de_dust2',5);
  clearInterval(pump);pump=null;await page.waitForFunction(()=>document.querySelectorAll('[data-camera-id]').length===0,null,{timeout:6500});
  await post();pump=setInterval(()=>post().catch(()=>{}),100);await page.waitForFunction(()=>document.querySelectorAll('[data-camera-id]').length===5);
  await action('disconnect');await page.waitForFunction(()=>[...document.querySelectorAll('[data-camera-id]')].every(b=>b.disabled));
  assert.equal(connections,1);assert.deepEqual(errors,[]);assert.equal(clicked,36);
  const result={passed:true,clicked,connections,checks,errors,verified:['real GSI -> RadarHUD -> director proxy -> Chinese buttons -> TCP commands','eight map transitions','old map rejected','utility timer cancelled','return to player','unknown map','menu','GSI timeout and recovery','disconnected buttons disabled']};
  fs.writeFileSync(path.join(__dirname,'../verification/camera-presets-browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }catch(e){if(page){await page.screenshot({path:path.join(__dirname,'../verification/camera-debug.png')}).catch(()=>{});console.log(await page.evaluate(()=>[...document.querySelector('.game').children].map(e=>({tag:e.className,rect:e.getBoundingClientRect().toJSON(),display:getComputedStyle(e).display}))).catch(()=>{}));}throw e;
 }finally{clearInterval(pump);await browser?.close();await app.close();for(const s of sockets)s.destroy();await new Promise(r=>consoleServer.close(r));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
