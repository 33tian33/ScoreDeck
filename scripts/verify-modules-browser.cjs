const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const app=require('../server/broadcast-server.cjs').createBroadcastServer({dataDir:require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(),'sd-browser-'))});const meta=await app.listen();
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1680,height:1100}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try{
  await page.goto(meta.localUrl);await page.getByRole('button',{name:'Replay 回放'}).click();
  const replay=page.locator('[data-module="replay"]');await replay.getByRole('button',{name:'启动 Replay',exact:true}).click();
  const rf=page.frameLocator('iframe[title="Replay 回放完整控制台"]');await rf.locator('#settings-btn').waitFor({timeout:30000});
  await rf.locator('#settings-btn').click();await rf.locator('#config-fields').waitFor({state:'visible'});
  console.log('Replay settings inputs',await rf.locator('#config-fields input').count());
  await rf.locator('[data-close="settings"]').first().click();
  await rf.locator('#search').fill('keep-me');
  await page.screenshot({path:'qa-replay.png'});
  await page.getByRole('button',{name:'VoiceBridge 语音'}).click();
  const voice=page.locator('[data-module="voicebridge"]');await voice.getByRole('button',{name:'启动 VoiceBridge',exact:true}).click();
  const vf=page.frameLocator('iframe[title="VoiceBridge 语音完整控制台"]');await vf.locator('#apiForm').waitFor({timeout:30000});
  await vf.locator('#apiWorkspace').fill('draft-not-saved');
  await page.screenshot({path:'qa-voicebridge.png'});
  await page.getByRole('button',{name:'Replay 回放'}).click();assert.equal(await rf.locator('#search').inputValue(),'keep-me');
  await page.getByRole('button',{name:'VoiceBridge 语音'}).click();assert.equal(await vf.locator('#apiWorkspace').inputValue(),'draft-not-saved');
  await vf.locator('#directorDelay').fill('12.5');await vf.locator('#saveDirectorDelay').click();
  await vf.locator('#restartService').click();
  await page.waitForTimeout(4500);assert.equal(await vf.locator('#directorDelay').inputValue(),'12.5');
  await voice.getByRole('button',{name:'专注模式',exact:true}).click();await page.screenshot({path:'qa-voicebridge-focus.png'});await voice.getByRole('button',{name:'退出专注模式',exact:true}).click();
  assert.deepEqual(errors,[]);console.log('PASS: complete embedded pages, settings, persistent tabs, inner restart, saved delay, focus mode; no JavaScript errors');
 }finally{await browser.close();await app.close();}
})().catch(e=>{console.error(e);process.exit(1)});
