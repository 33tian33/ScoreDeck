const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const app=require('../server/broadcast-server.cjs').createBroadcastServer({dataDir:require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(),'sd-browser-'))});const meta=await app.listen();
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1680,height:1100}});const errors=[],assetErrors=[];
 page.on('response',r=>{if(r.url().includes('/native-modules/')&&/\.(css|woff2?)(\?|$)/.test(r.url())&&r.status()>=400)assetErrors.push(r.status()+' '+r.url());});
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try{
  await page.goto(meta.localUrl);await page.waitForTimeout(500);await page.getByRole('button',{name:'Replay 回放'}).click();
  const replay=page.locator('[data-module="replay"]');await replay.getByRole('button',{name:'启动 Replay',exact:true}).click();
  const rf=replay.locator('[data-native-module="replay"]');await rf.locator('#settings-btn').waitFor({timeout:30000});
  await rf.locator('#settings-btn').click();await rf.locator('#config-fields').waitFor({state:'visible'});
  console.log('Replay settings inputs',await rf.locator('#config-fields input').count());
  await rf.locator('[data-close="settings"]').first().click();
  await rf.locator('#search').fill('keep-me');
  await page.screenshot({path:'verification/qa-replay.png'});
  await page.getByRole('button',{name:'VoiceBridge 语音'}).click();
  const voice=page.locator('[data-module="voicebridge"]');await voice.getByRole('button',{name:'启动 VoiceBridge',exact:true}).click();
  const vf=voice.locator('[data-native-module="voicebridge"]');await vf.locator('#apiForm').waitFor({timeout:30000});
  await vf.locator('#apiMessage').filter({hasText:'已读取当前配置'}).waitFor();await vf.locator('#apiWorkspace').fill('draft-not-saved');
  await page.screenshot({path:'verification/qa-voicebridge.png'});
  await page.getByRole('button',{name:'Replay 回放'}).click();assert.equal(await rf.locator('#search').inputValue(),'keep-me');
  await page.getByRole('button',{name:'VoiceBridge 语音'}).click();assert.equal(await vf.locator('#apiWorkspace').inputValue(),'draft-not-saved');
  await vf.locator('#directorDelay').fill('12.5');await vf.locator('#saveDirectorDelay').click();
  await vf.locator('#restartService').click();
  await page.waitForTimeout(4500);assert.equal(await vf.locator('#directorDelay').inputValue(),'12.5');
  await vf.locator('#monitorStart').click();await vf.locator('#monitorStatus').filter({hasText:'等待该频道语音'}).waitFor();await vf.locator('#monitorStop').click();
  await voice.getByRole('button',{name:'专注模式',exact:true}).click();await page.screenshot({path:'verification/qa-voicebridge-focus.png'});await voice.getByRole('button',{name:'退出专注模式',exact:true}).click();
  assert.equal(await replay.locator('iframe,webview').count(),0);assert.equal(await voice.locator('iframe,webview').count(),0);assert.ok(page.frames().every(frame=>!frame.url().includes('/native-modules/')));await voice.getByRole('button',{name:'停止服务',exact:true}).click();await vf.waitFor({state:'detached'});await page.waitForTimeout(250);assert.deepEqual(assetErrors,[]);assert.deepEqual(errors,[]);console.log('PASS: native DOM controls without nested browsing contexts, settings, persistent tabs, inner restart, saved delay, focus mode; no JavaScript errors');
 }finally{await browser.close();await app.close();}
})().catch(e=>{console.error(e);process.exit(1)});
