const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createBroadcastServer}=require('../server/broadcast-server.cjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const free=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>p<10000||p===10080?free().then(resolve):resolve(p));});});
(async()=>{
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(root,'verification/web-sync-job-'));
 const {sample,png}=require('../tests/fixtures/web-sync.cjs'),raw=sample();
 raw.schools[0].emblem='/assets/schools/fudan.png';
 for(let i=0;i<152;i++)raw.players.push({id:300+i,team_id:1,nickname:'QA'+i,avatar:'/assets/qa'+i+'.png',role:'替补'});
 let release,reads=0,starts=0;const gate=new Promise(resolve=>release=resolve),attempts=new Map();
 process.env.SCOREDECK_RADAR_PORT=String(await free());process.env.SCOREDECK_GSI_PORT=String(await free());
 const app=createBroadcastServer({dataDir:dir,initialPort:await free(),initialCountdownPort:await free(),webSyncOptions:{retryDelay:()=>10,fetchImpl:async(url,options)=>{
  if(url.endsWith('/api/state')){reads++;return new Response(JSON.stringify(raw));}
  await gate;await pause(25);const attempt=(attempts.get(url)||0)+1;attempts.set(url,attempt);
  if(url.endsWith('/assets/schools/fudan.png')&&attempt===1)return new Response('temporarily unavailable',{status:503});
  if(options.headers['If-None-Match']==='v1')return new Response(null,{status:304});
  return new Response(png,{headers:{etag:'v1'}});
 }}});let browser;
 try{
  const meta=await app.listen(),base=meta.localUrl;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});const page=await browser.newPage({viewport:{width:1680,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/web-sync/start',async route=>{starts++;const response=await route.fetch();if(starts===1)await route.abort('failed');else await route.fulfill({response});});
  const status=()=>fetch(base+'/api/web-sync').then(r=>r.json());
  await page.goto(base);await page.getByRole('button',{name:'归档与恢复',exact:true}).click();
  await page.getByRole('button',{name:'开始同步',exact:true}).click();
  await page.waitForResponse(r=>r.url().endsWith('/api/web-sync/start')&&r.status()===202);assert.equal(starts,2,'one click retries the lost start reply automatically');
  const first=(await status()).job.id;
  await page.getByRole('button',{name:'队伍管理',exact:true}).click();
  await page.getByRole('button',{name:'归档与恢复',exact:true}).click();await page.getByRole('button',{name:'同步处理中…',exact:true}).waitFor();
  await page.reload();await page.getByRole('button',{name:'归档与恢复',exact:true}).click();
  await page.getByRole('button',{name:'同步处理中…',exact:true}).waitFor();assert.equal((await status()).job.id,first);assert.equal(reads,1);assert.equal(starts,2);
  await page.screenshot({path:path.join(root,'verification/web-sync-job-progress.png')});release();
  await page.getByText(/同步完成。同步前备份/).waitFor({timeout:30000});
  let result=await status();assert.equal(result.job.phase,'completed');assert.equal(result.progress.failed,0);assert.equal(result.progress.retries,1);assert.equal(result.progress.completed,result.progress.total);
  const state=await fetch(base+'/api/state').then(r=>r.json());assert.equal(state.teams.filter(t=>t.webSync).length,raw.teams.length);
  await page.getByRole('button',{name:'开始同步',exact:true}).click();
  for(let i=0;i<100;i++){result=await status();if(result.job.id!==first&&!result.busy)break;await pause(50);}
  assert.notEqual(result.job.id,first);assert.equal(result.job.phase,'completed');assert.equal(result.progress.downloaded,0);assert.equal(result.progress.reused,result.progress.total);assert.equal(reads,2);assert.equal(starts,3);
  await page.getByText(new RegExp('复用 '+result.progress.total+' · 下载 0')).waitFor();await page.screenshot({path:path.join(root,'verification/web-sync-job-completed.png')});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,oneClick:true,lostStartReplyRecovered:true,navigationAndReloadPreserveJob:true,coldAutomaticRetries:1,warm:result.progress,reads,starts,errors}));
 }finally{release();await browser?.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
