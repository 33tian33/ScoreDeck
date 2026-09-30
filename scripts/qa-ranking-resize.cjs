const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict');
const {chromium}=require('playwright');const {createBroadcastServer}=require('../server/broadcast-server.cjs');
const free=()=>new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sd-ranking-'));process.env.SCOREDECK_RADAR_PORT=String(await free());process.env.SCOREDECK_GSI_PORT=String(await free());
 const app=createBroadcastServer({dataDir:temp,initialPort:await free(),initialCountdownPort:await free()});let browser;
 try{
 const meta=await app.listen(),base=meta.localUrl;
 browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE,args:JSON.parse(process.env.CHROME_ARGS||'["--no-sandbox"]')});
 const context=await browser.newContext(),control=await context.newPage(),live=await context.newPage();const errors=[];for(const p of [control,live])p.on('pageerror',e=>errors.push(e.message));
 await control.goto(base);await control.waitForFunction(()=>window.SDClient?.state?.teams.length);
 await control.evaluate(()=>SDClient.mutate(s=>{const teams=s.teams.slice(0,4);teams.forEach((t,i)=>{t.name=['Alpha','Beta','Gamma','Delta'][i];t.group='A';});s.teams=teams;const match=(a,b,ra,rb)=>({id:`rank-${a}-${b}`,group:'A',teamAId:teams[a].id,teamBId:teams[b].id,bestOf:1,status:'completed',scoreA:ra>rb?1:0,scoreB:rb>ra?1:0,mapScores:[{a:ra,b:rb,map:'de_dust2'}]});s.matches=[match(0,1,13,11),match(0,2,0,13),match(0,3,13,11),match(1,2,13,0),match(1,3,13,0),match(2,3,11,13)];s.tournament.groupTieBreak='round-diff';s.liveScene='standings';s.selectedGroup='A';return s;}));
 await live.goto(base+'/output/live');await live.locator('.standings-row:not(.heading)').first().waitFor();assert.match(await live.locator('.standings-row:not(.heading)').first().textContent(),/Beta/);
 await control.locator('.sidebar nav button').filter({hasText:'赛事设置'}).click();const select=control.getByLabel('小组同分排名规则',{exact:true});await select.waitFor();await select.selectOption('head-to-head');
 await live.waitForFunction(()=>document.querySelector('.standings-row:not(.heading)')?.textContent.includes('Alpha'));assert.equal((await fetch(base+'/api/state').then(r=>r.json())).tournament.groupTieBreak,'head-to-head');
 await control.reload();await control.locator('.sidebar nav button').filter({hasText:'赛事设置'}).click();assert.equal(await control.getByLabel('小组同分排名规则',{exact:true}).inputValue(),'head-to-head');
 await control.getByLabel('小组同分排名规则',{exact:true}).selectOption('round-diff');await live.waitForFunction(()=>document.querySelector('.standings-row:not(.heading)')?.textContent.includes('Beta'));
 await control.screenshot({path:path.join(__dirname,'../verification/ranking-settings-2.14.3.png'),fullPage:true});
 await control.evaluate(()=>SDClient.mutate(s=>{s.tournament.formatId='swiss-16';return s;}));await control.getByLabel('小组同分排名规则',{exact:true}).isDisabled().then(v=>assert.ok(v));
 const bar=await context.newPage();await bar.route('**/api/director/state',route=>route.fulfill({json:{tracker:{verified:true,fresh:true,controls:{xray:true,uiHidden:false},observed:{name:'Alpha'},counts:{flashbang:2,smoke:3,frag:1,firebomb:2},message:'优先选手最近 2 秒内投出的有效道具',cameras:{mapName:'de_anubis',mapLabel:'阿努比斯',mapEpoch:1,fresh:true,presets:['A 入口①','A 入口②','A 包点','中路俯视','B 入口','B 包点'].map((label,i)=>({id:'AN0'+(i+1),label}))}},voice:{sessionId:'qa',mode:'demo',delay:10,serverNow:Date.now(),channels:['以卵击石','Funtrue'].map((name,i)=>({name,segments:Array.from({length:8},(_,j)=>({id:`clip-${i}-${j}`,channelId:String(i),title:['一起进点，闪光好了！','先别着急，等队友补枪。','漂亮！稳住，我们能赢。'][j%3],startMs:Date.now()-j*10000,audioDurationMs:3800}))}))}}}));
 await bar.goto(base+'/director-bar.html');await bar.locator('.clip').first().waitFor();const checks=[];
 for(const [width,height] of [[800,161],[1100,181],[1366,200],[1920,240]]){
 await bar.setViewportSize({width,height});await bar.waitForTimeout(80);
 const m=await bar.evaluate(()=>({font:parseFloat(getComputedStyle(document.documentElement).fontSize),overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,gameOverflow:document.querySelector('.game').scrollHeight>document.querySelector('.game').clientHeight+1,hiddenButtons:[...document.querySelectorAll('.game button,header button,footer button,.clip:first-child button')].filter(b=>{const r=b.getBoundingClientRect();return r.left<0||r.right>innerWidth+1||r.top<0||r.bottom>innerHeight+1;}).map(b=>b.textContent),cardWidth:document.querySelector('.clip').getBoundingClientRect().width}));assert.equal(m.overflow,false);assert.equal(m.gameOverflow,false);assert.deepEqual(m.hiddenButtons,[]);checks.push({width,height,...m});await bar.screenshot({path:path.join(__dirname,`../verification/director-resize-${width}.png`)});
 }
 assert.ok(checks[3].font>checks[0].font*1.5);assert.ok(checks[3].cardWidth>checks[0].cardWidth*1.5);assert.deepEqual(errors,[]);
 const result={passed:true,checks,verified:['settings persists after reload','OBS ranking updates without visiting entrance','head-to-head and round-diff reverse tied teams','Swiss setting disabled','populated two-channel director layout scales']};fs.writeFileSync(path.join(__dirname,'../verification/ranking-resize-2.14.3.json'),JSON.stringify(result,null,2));console.log(result);
 }finally{await browser?.close();await app.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
