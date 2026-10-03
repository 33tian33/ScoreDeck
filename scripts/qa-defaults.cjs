const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),os=require('node:os');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createBroadcastServer}=require('../server/broadcast-server.cjs');
const free=()=>new Promise(resolve=>{const server=net.createServer().listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});

(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-defaults-'));
  process.env.SCOREDECK_RADAR_PORT=String(await free());process.env.SCOREDECK_GSI_PORT=String(await free());
  const app=createBroadcastServer({dataDir,initialPort:await free(),initialCountdownPort:await free()});let browser;
  try{
    const meta=await app.listen();browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE,headless:true});
    const page=await browser.newPage({viewport:{width:1460,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(meta.localUrl);await page.waitForFunction(()=>window.SDClient?.state);
    const nav=page.locator('.sidebar nav'),schedule=nav.getByRole('button',{name:'赛程与赛果',exact:true});
    assert.equal(await schedule.isDisabled(),true);
    assert.deepEqual(await page.evaluate(()=>({name:SDClient.state.tournament.name,teams:SDClient.state.teams.map(t=>t.name)})),{name:'TestTournament',teams:['Test']});
    await nav.getByRole('button',{name:'队伍管理',exact:true}).click();
    assert.equal(await page.getByLabel('队名',{exact:true}).inputValue(),'Test');
    assert.equal(await page.locator('.group-switcher').count(),0);
    const search=nav.getByRole('searchbox');await search.fill('赛程');await search.press('Enter');
    assert.equal(await page.getByLabel('队名',{exact:true}).inputValue(),'Test','search must not bypass the disabled navigation');
    await search.fill('');await nav.getByRole('button',{name:'赛事设置',exact:true}).click();
    await page.screenshot({path:path.resolve('verification/defaults-draft.png'),fullPage:true});
    await page.evaluate(()=>SDClient.mutate(s=>{ScoreDeckFlow.addTeam(s);const st=ScoreDeckFlow.addStage(s,'playoff',{teamCount:2});st.slots.forEach((slot,i)=>slot.teamId=s.teams[i].id);ScoreDeckFlow.reconcile(s);return s;}));
    assert.equal(await schedule.isDisabled(),true,'configured draft stays locked');
    await page.getByRole('button',{name:'校验并启用',exact:true}).click();
    await page.waitForFunction(()=>ScoreDeckFlow.isActive(SDClient.state));
    assert.equal(await schedule.isEnabled(),true);await schedule.click();
    await page.getByRole('button',{name:'录入比分 / 数据',exact:true}).waitFor();
    await page.reload();await page.waitForFunction(()=>window.SDClient?.state);
    assert.equal(await schedule.isEnabled(),true,'activation survives restart of the page');
    await schedule.click();
    await page.evaluate(()=>SDClient.mutate(s=>{s.stages[0].name='Changed draft';return s;}));
    await page.waitForFunction(()=>!ScoreDeckFlow.isActive(SDClient.state));
    assert.equal(await schedule.isDisabled(),true);
    await page.getByRole('button',{name:'校验并启用',exact:true}).waitFor();
    assert.deepEqual(errors,[]);console.log('PASS: defaults, no legacy groups, locked mouse/keyboard navigation, activation, reload and draft invalidation');
  }finally{await browser?.close();await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
