const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createBroadcastServer}=require('../server/broadcast-server.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(root,'verification/web-sync-browser-'));
 fs.cpSync(path.join(root,'verification/web-sync-data'),data,{recursive:true});
 const free=()=>new Promise(resolve=>{const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
 const app=createBroadcastServer({dataDir:data,initialPort:await free(),initialCountdownPort:await free()});let browser;
 try{
  const meta=await app.listen();browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
  const page=await browser.newPage({viewport:{width:1680,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(meta.localUrl);await page.getByRole('button',{name:'归档与恢复',exact:true}).click();
  await page.getByText('48 支队伍 · 210 位选手 · 104 场比赛 · 3 个赛段 · 4 个赞助商',{exact:true}).waitFor();
  await page.screenshot({path:path.join(root,'verification/qa-web-sync.png')});
  await page.getByRole('button',{name:'队伍管理',exact:true}).click();await page.waitForTimeout(500);
  await page.screenshot({path:path.join(root,'verification/qa-web-teams.png')});
  await page.getByRole('button',{name:'赛程与赛果',exact:true}).click();await page.waitForTimeout(500);
  await page.screenshot({path:path.join(root,'verification/qa-web-schedule.png')});
  const state=await(await fetch(meta.localUrl+'/api/state')).json();
  assert.equal(state.teams.filter(t=>t.webSync).length,48);assert.equal(state.teams.filter(t=>t.webSync).reduce((n,t)=>n+t.players.length,0),210);assert.equal(state.matches.filter(m=>m.webSync).length,104);
  const refs=new Set();const walk=v=>{if(typeof v==='string'&&v.startsWith('/media/web-'))refs.add(v);else if(v&&typeof v==='object')for(const x of Object.values(v))walk(x);};walk(state.webSync.snapshot);
  for(const ref of refs)assert.equal((await fetch(meta.localUrl+ref)).status,200,ref);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,teams:48,players:210,matches:104,offlineImages:refs.size,errors}));
 }finally{await browser?.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
