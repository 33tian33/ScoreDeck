const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{createBroadcastServer}=require('../server/broadcast-server.cjs'),{createTestState}=require('../tests/fixtures/state.cjs'),F=require('../server/tournament-flow.cjs');
const free=()=>new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
(async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-result-export-')),state=createTestState(),stage=F.addStage(state,'playoff',{teamCount:2});
 stage.slots.forEach((slot,i)=>slot.teamId=state.teams[i].id);F.reconcile(state);F.activate(state);
 const match=F.matchesOf(state,stage.id)[0];Object.assign(match,{bestOf:3,status:'completed',scoreA:2,scoreB:0,mapScores:[{map:'de_nuke',a:13,b:7},{map:'de_mirage',a:13,b:9},{map:'de_inferno',a:null,b:null}],mapDetails:[{map:'de_nuke',a:13,b:7,teamA:[{playerId:state.teams[0].players[0].id,starter:true,kills:24,deaths:10,assists:6,rating:1.42}],teamB:[]}]});
 state.selectedStageId=stage.id;state.selectedMatchId=match.id;
 fs.writeFileSync(path.join(dataDir,'broadcast-state.json'),JSON.stringify(state));
 process.env.SCOREDECK_RADAR_PORT=String(await free());process.env.SCOREDECK_GSI_PORT=String(await free());
 const app=createBroadcastServer({dataDir,initialPort:await free(),initialCountdownPort:await free()});let browser;
 try{
  const meta=await app.listen();browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(meta.localUrl);await page.waitForFunction(()=>window.SDClient?.state);
  await page.locator('.sidebar nav').getByRole('button',{name:'赛程与赛果',exact:true}).click();
  const filter=page.getByLabel('完成状态',{exact:true});await filter.selectOption('hide');assert.equal(await page.getByRole('button',{name:'导出图1_de_nuke',exact:true}).count(),0);
  await filter.selectOption('completed');await page.getByRole('button',{name:'导出图1_de_nuke',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/^导出图/}).count(),2);
  await filter.selectOption('all');assert.equal(await page.getByRole('button',{name:/^导出图/}).count(),2);
  // Populate images through the application's normal state mutation, using an actual PNG.
  await page.evaluate(()=>SDClient.mutate(s=>{const c=document.createElement('canvas');c.width=64;c.height=64;const x=c.getContext('2d');x.fillStyle='#3c92e8';x.fillRect(0,0,64,64);const png=c.toDataURL();s.teams.forEach(t=>{t.logoPrimary=png;t.players.forEach(p=>p.avatar=png);});return s;}));
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'导出图1_de_nuke',exact:true}).click();const download=await downloading;
  assert.match(download.suggestedFilename(),/_图1_de_nuke\.json$/);const output=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  assert.equal(Object.keys(output).at(-1),'mapResultImage');assert.equal(output.map.name,'de_nuke');assert.deepEqual(output.map.score,{a:13,b:7});assert.deepEqual(output.seriesScore,{a:2,b:0});
  assert.equal(output.teams[0].players[0].kills,24);assert.equal(output.teams[0].players[0].rating,1.42);assert.equal(output.teams[1].players[0].rating,0);
  assert.match(output.teams[0].logo,/^data:image\/png;base64,/);assert.match(output.teams[0].players[0].avatar,/^data:image\/png;base64,/);
  const png=Buffer.from(output.mapResultImage.data.split(',')[1],'base64');assert.equal(png.readUInt32BE(16),1600);assert.ok(png.readUInt32BE(20)>=820);
  fs.mkdirSync('verification',{recursive:true});fs.writeFileSync('verification/result-export.png',png);
  await page.getByRole('button',{name:'导出图2_de_mirage',exact:true}).waitFor();const secondDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出图2_de_mirage',exact:true}).click();const second=JSON.parse(fs.readFileSync(await(await secondDownload).path(),'utf8'));assert.equal(second.map.name,'de_mirage');assert.equal(second.teams[0].players[0].kills,0);
  assert.deepEqual(errors,[]);console.log('PASS: all filters, played maps, JSON downloads, per-map stats, embedded assets and final report image');
 }finally{await browser?.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
