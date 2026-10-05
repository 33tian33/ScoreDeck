const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict');
const {createRadarService}=require('../server/radar-service.cjs');
const {createIntegrationService}=require('../server/integration-service.cjs');
const free=()=>new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-replay-cache-ui-'));
  process.env.SCOREDECK_RADAR_PORT=String(await free());process.env.SCOREDECK_GSI_PORT=String(await free());
  const radar=createRadarService({dataDir:dir}),replay=createIntegrationService({dataDir:dir});
  replay.configure('http://127.0.0.1:17890',[17890]);let browser;
  try {
    await radar.start();assert.equal(radar.meta().running,true,radar.meta().error);
    await replay.action('replay','settings',{port:await free(),autoStart:false});await replay.action('replay','start');
    browser=await chromium.launch({channel:'msedge',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(radar.meta().controlUrl);
    await page.locator('#clear-cache').waitFor({state:'visible'});
    await page.locator('#clear-cache').click();
    await page.waitForFunction(()=>document.querySelector('#cache-status').textContent.includes('缓存已清除'));
    await page.screenshot({path:path.resolve('verification/radar-cache-2.18.7.png'),fullPage:true});
    await page.goto(radar.meta().outputUrl);assert.equal(await page.locator('#clear-cache').isVisible(),false);
    await page.goto(replay.meta('replay').controlUrl);
    await page.waitForFunction(()=>document.querySelector('.version').textContent==='0.2.6');
    assert.equal(await page.locator('#auto-full').isChecked(),true);
    assert.equal(await page.locator('#auto-half-collect').isChecked(),true);
    assert.equal(await page.locator('#full-play').isVisible(),true);
    assert.equal(await page.locator('#team-ct-name').isDisabled(),true);
    await page.locator('#settings-btn').click();
    await page.locator('#settings').waitFor({state:'visible'});
    assert.equal(await page.locator('[name="relay_token"]').count(),0);
    assert.equal(await page.locator('[name="relay_group"]').count(),1);
    await page.locator('[data-close="settings"]').first().click();
    await page.screenshot({path:path.resolve('verification/replay-0.2.6-scoredeck.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: Radar clear button and output isolation; Replay 0.2.6 console, full highlights, managed teams, group-code settings; no browser errors.');
  } finally {await browser?.close();await replay.close();await radar.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
