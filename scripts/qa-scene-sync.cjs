const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createBroadcastServer}=require('../server/broadcast-server.cjs');
const free=()=>new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
(async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'sd-scene-sync-'));
 process.env.SCOREDECK_RADAR_PORT=String(await free());process.env.SCOREDECK_GSI_PORT=String(await free());
 const app=createBroadcastServer({dataDir:data,initialPort:await free(),initialCountdownPort:await free()});let browser;
 try{
  const m=await app.listen();browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE,args:['--no-sandbox']});
  // All pages MUST share one context: separate contexts hide socket starvation.
  const context=await browser.newContext(),control=await context.newPage(),live=await context.newPage(),auto=await context.newPage();
  const errors=[],streams=[];
  context.on('request',r=>{if(new URL(r.url()).pathname==='/api/events')streams.push(r.url());});
  for(const p of [control,live,auto])p.on('pageerror',e=>errors.push(e.message));
  await control.goto(m.localUrl);await live.goto(m.localUrl+'/output/live');await auto.goto(m.localUrl+'/output/halftime-auto');
  await control.locator('.scene-card').first().waitFor();
  await control.waitForTimeout(1500);
  assert.equal(await control.evaluate(async()=>(await fetch('/api/state',{signal:AbortSignal.timeout(1500)})).status),200);
  await control.evaluate(()=>SDClient.mutate(s=>{const match={id:'sync-test',teamAId:s.teams[0].id,teamBId:s.teams[1].id,group:s.teams[0].group,round:1,bestOf:3,status:'scheduled',scoreA:0,scoreB:0};s.matches.push(match);s.selectedMatchId=match.id;return s;}));
  const take=async(label,scene,selector)=>{
   await control.locator('.scene-card').filter({hasText:label}).click();
   await control.getByRole('button',{name:'推送播出 →',exact:true}).click();
   await control.waitForFunction(scene=>SDClient.pending===0&&SDClient.state.liveScene===scene,scene,{timeout:2500});
   await live.waitForFunction(scene=>SDClient.state.liveScene===scene,scene,{timeout:2500});
   if(selector)await live.locator(selector).waitFor({state:'visible',timeout:2500});
  };
  for(let i=0;i<3;i++){
   await take('小组积分','standings','.standings-scene');
   await take('完整赛程','bracket','.bracket-scene');
   await take('未来赛程','schedule','.schedule-scene');
   await take('对阵前瞻','prematch','.prematch-scene');
  }
  await take('入场动画','entrance','#sd-entrance-output');
  await take('小组积分','standings','.standings-scene');
  await live.locator('#sd-entrance-output').waitFor({state:'detached'});
  assert.equal(await control.locator('.scene-card').filter({hasText:'中场休息'}).count(),0);
  await control.locator('.sidebar nav button').filter({hasText:'入场动画'}).click();
  await control.locator('#sd-entrance-start').waitFor();
  await control.locator('.sidebar nav button').filter({hasText:'直播控制'}).click();
  await take('未来赛程','schedule','.schedule-scene');
  assert.equal(streams.length,3,'Only three top-level pages should own SSE connections');
  assert.deepEqual(errors,[]);
  console.log('PASS: shared Chromium context, 3 top-level pages, nested halftime/previews, 15 scene takes, entrance interruption, independent halftime, tab remount, actual output DOM, no reload required, exactly 3 SSE connections, no browser errors.');
 }finally{await browser?.close();await app.close();fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
