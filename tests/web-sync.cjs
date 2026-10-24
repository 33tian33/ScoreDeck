'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {mapState,createWebSync,definitions,publicIP}=require('../server/web-sync.cjs'),{createDefaultState,migrateState}=require('../server/default-state.cjs'),flow=require('../server/tournament-flow.cjs');
const {png,sample}=require('./fixtures/web-sync.cjs');

test('website maps playable teams, BP, per-map stats, schedule, sponsors and idempotent IDs',()=>{const raw=sample(),local=createDefaultState(),s=mapState(raw,local),m=s.matches[0];assert.equal(m.bestOf,2);assert.equal(m.scoreA,1);assert.equal(m.scoreB,1);assert.equal(m.mapDetails[0].teamA[0].rating,1.41);assert.equal(m.bp[0].sidePicker,'B');assert.equal(m.mapScores[0].map,'de_dust2');assert.equal(m.date,'2026-10-17');assert.equal(m.time,'19:00');assert.equal(m.mvp.playerId,'选手甲');assert.equal(s.teams[0].id,local.teams[0].id);assert.equal(s.sponsors.slots[0].name,'Sponsor');const again=mapState(raw,s);assert.equal(again.teams.length,s.teams.length);assert.equal(again.matches.length,1);assert.deepEqual(raw,sample());});
test('migrate/reconcile/activate preserves imported score and official snapshot rankings',()=>{const s=migrateState(mapState(sample(),createDefaultState()));flow.reconcile(s);flow.activate(s);assert.equal(s.matches[0].status,'completed');assert.equal(s.teams.filter(t=>t.webSync).reduce((n,t)=>n+t.players.length,0),2);assert.equal(s.matches[0].mapDetails[0].teamA[0].kills,21);const st=s.stages[0],rows=flow.groupTable(s,st,st.groups[0]);assert.equal(rows[0].team.name,'队乙');assert.equal(rows[0].points,1);});
test('worldcup custom pairing and official third source preserved without dynamic replacement',()=>{const raw=sample();raw.flow.active.stages.push({id:'knockout',type:'playoff',name:'淘汰赛',teamCount:4,bo:3,bracket:'worldcup2026',roundPairs:[[[1,0]]],slots:[{kind:'rank',stageId:'groups',group:0,rank:1},{kind:'worldcupThird',stageId:'groups',comparatorId:'third',winnerGroup:'A'},{kind:'team',teamId:1},{kind:'empty'}]});raw.matches.push({id:8,team_a:2,team_b:1,bo:3,status:'scheduled',stage:'playoff',round_name:'半决赛',time:'',flow_key:'knockout:r1:0',maps:[],bp:[],stats:[],bp_config:{}});const s=mapState(raw,createDefaultState()),st=s.stages[1];assert.equal(st.slots[1].webSyncSource.kind,'worldcupThird');assert.equal(st.slots[1].webSyncTeamId,s.matches[1].teamBId);const defs=definitions(raw.flow.active);assert.equal(defs.find(x=>x.key==='knockout:r2:0').a.matchKey,'knockout:r1:1');});
test('sync downloads all images once, retains exact original snapshot and backup',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-web-sync-'));let state=createDefaultState(),calls=[];try{const raw=sample(),service=createWebSync({dataDir:dir,getState:()=>state,fetchImpl:async(url,opts)=>{calls.push([url,opts]);return new Response(url.endsWith('/api/state')?JSON.stringify(raw):png);}});const preview=await service.preview();const result=await service.sync(preview.token,next=>state=next);assert.equal(calls.length,5);assert.ok(calls.every(x=>!x[1].method));assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,state.webSync.sourceArchive))),raw);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,result.backup))).teams[0].id,'team-01');assert.match(state.teams[1].logoPrimary,/^\/media\/web-/);assert.ok(fs.existsSync(path.join(dir,state.teams[1].logoPrimary)));assert.equal(state.webSync.snapshot.schools[0].emblem,state.teams[1].logoSecondary);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('stale preview and failed media never commit partial tournament',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-web-sync-'));let state=createDefaultState(),commits=0;try{const service=createWebSync({dataDir:dir,getState:()=>state,fetchImpl:async url=>new Response(url.endsWith('/api/state')?JSON.stringify(sample()):'not an image')});let p=await service.preview();state.revision++;await assert.rejects(service.sync(p.token,()=>commits++),/本地数据已变化/);p=await service.preview();await assert.rejects(service.sync(p.token,()=>commits++),/图片内容无效/);assert.equal(commits,0);assert.equal(state.matches.length,0);await assert.rejects(service.preview('http://127.0.0.1'),/仅允许/);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('remote image guard rejects private addresses',()=>{for(const ip of ['127.0.0.1','10.1.1.1','192.168.1.1','169.254.1.1','::1','fc00::1','::ffff:127.0.0.1'])assert.equal(publicIP(ip),false);assert.equal(publicIP('8.8.8.8'),true);});

test('hashed website media is reused across restarts and aliases, and corrupt files are repaired',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-media-cache-'));let state=createDefaultState(),downloads=0;const raw=sample(),digest=require('node:crypto').createHash('sha256').update(png).digest('hex');
 raw.schools[0].emblem=raw.teams[0].logo=raw.players[0].avatar=raw.sponsors[0].image='/media/'+digest+'.png';
 const make=()=>createWebSync({dataDir:dir,getState:()=>state,fetchImpl:async url=>{if(url.endsWith('/api/state'))return new Response(JSON.stringify(raw));downloads++;return new Response(png);}});
 const sync=async()=>{const service=make(),p=await service.preview();await service.sync(p.token,next=>state=next);return service;};
 try{await sync();assert.equal(downloads,1);raw.sponsors[0].image='https://www.hushang985.online/media/'+digest+'.png';let service=await sync();assert.equal(downloads,1);assert.equal(service.status().progress.downloaded,0);assert.ok(service.status().progress.reused>=1);
 const file=path.join(dir,state.teams.find(t=>t.webSync).logoPrimary);fs.writeFileSync(file,'corrupt');await sync();assert.ok(downloads>1);assert.deepEqual(fs.readFileSync(file),png);
 const before=downloads;fs.unlinkSync(file);await sync();assert.ok(downloads>before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('mutable media uses persisted conditional requests and downloads new versions',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-media-validation-'));let state=createDefaultState(),downloads=0,version='one',conditions=0;const raw=sample();
 raw.schools[0].emblem=raw.teams[0].logo=raw.players[0].avatar=raw.sponsors[0].image='/assets/same.png';
 const sync=async()=>{const service=createWebSync({dataDir:dir,getState:()=>state,fetchImpl:async(url,options)=>{if(url.endsWith('/api/state'))return new Response(JSON.stringify(raw));if(options.headers['If-None-Match']===version){conditions++;return new Response(null,{status:304});}downloads++;return new Response(version==='one'?png:Buffer.concat([png,Buffer.from('updated')]),{headers:{etag:version,'last-modified':'Sat, 17 Oct 2026 08:00:00 GMT'}});}});const p=await service.preview();await service.sync(p.token,next=>state=next);};
 try{await sync();const old=state.teams.find(t=>t.webSync).logoPrimary;await sync();assert.equal(downloads,1);assert.equal(conditions,1);version='two';await sync();assert.equal(downloads,2);assert.notEqual(state.teams.find(t=>t.webSync).logoPrimary,old);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<500;i++){if(check())return;await pause(5);}assert.fail('sync did not reach expected state');}
test('one start automatically previews, retries temporary failures, deduplicates requests and preserves unrelated edits',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-sync-job-'));let state=createDefaultState(),commits=0,reads=0;const calls=new Map();let release;
 const gate=new Promise(resolve=>release=resolve),service=createWebSync({dataDir:dir,getState:()=>state,retryDelay:()=>0,fetchImpl:async(url)=>{
  const n=(calls.get(url)||0)+1;calls.set(url,n);
  if(url.endsWith('/api/state')){reads++;return new Response(n===1?'temporary':JSON.stringify(sample()),{status:n===1?503:200});}
  await gate;if(n===1)return new Response('temporary',{status:503});if(n===2)throw new TypeError('fetch failed');return new Response(png);
 }});
 try{
  const commit=next=>{commits++;state=next;return state;},first=service.start({requestId:'click-once'},commit);
  assert.equal(first.busy,true);assert.equal(service.start({requestId:'double-click'},commit).job.id,first.job.id);
  await until(()=>service.status().progress.active===4);
  assert.equal(service.status().progress.completed,0);
  state.revision++;state.theme.custom='kept';state.teams[0].name='保留本地队伍';state.selectedMatchId='local-selection';release();
  await until(()=>!service.status().busy);const status=service.status();assert.equal(status.job.phase,'completed',status.lastError);assert.equal(commits,1);assert.equal(reads,2);assert.equal(status.progress.retries,9);assert.equal(status.progress.completed,4);assert.equal(status.progress.active,0);
  assert.equal(state.theme.custom,'kept');assert.equal(state.teams[0].name,'保留本地队伍');assert.equal(state.selectedMatchId,'local-selection');
  assert.equal(service.start({requestId:'click-once'},commit).job.phase,'completed');assert.equal(commits,1);assert.equal(reads,2);
 }finally{release();await service.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('a permanent image failure does not stop other downloads; checkpoints survive restart and only missing bytes download again',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-sync-checkpoint-')),raw=sample();let state=createDefaultState(),bad=true,active=0,peak=0,downloaded=0,commits=0;const counts=new Map();
 for(let i=0;i<20;i++)raw.players.push({id:100+i,team_id:1,nickname:'P'+i,avatar:'/assets/p'+i+'.png',role:'替补'});
 const options={dataDir:dir,getState:()=>state,retryDelay:()=>0,fetchImpl:async(url,opts)=>{
  if(url.endsWith('/api/state'))return new Response(JSON.stringify(raw));counts.set(url,(counts.get(url)||0)+1);active++;peak=Math.max(peak,active);await pause(5);active--;
  if(bad&&url.endsWith('/school.png'))return new Response('missing',{status:404});if(opts.headers['If-None-Match']==='v1')return new Response(null,{status:304});downloaded++;return new Response(png,{headers:{etag:'v1'}});
 }};
 let service=createWebSync(options);
 try{
  service.start({requestId:'first'},next=>{commits++;state=next;});await until(()=>!service.status().busy);
  assert.equal(service.status().job.phase,'failed');assert.equal(commits,0);assert.equal(peak,8);assert.equal(service.status().progress.completed,23);assert.equal(service.status().progress.failed,1);assert.equal(counts.get('https://hushang985.online/assets/school.png'),1);
  await service.close();assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(dir,'web-sync/media-cache.json'))).entries).length,23);
  const before=downloaded;bad=false;service=createWebSync(options);service.start({requestId:'second'},next=>{commits++;state=next;});await until(()=>!service.status().busy);
  assert.equal(service.status().job.phase,'completed',service.status().lastError);assert.equal(downloaded-before,1);assert.equal(service.status().progress.reused,23);assert.equal(commits,1);
 }finally{await service.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('background sync rejects edits to imported records and never partially commits',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-sync-conflict-'));let state=mapState(sample(),createDefaultState()),commits=0,release;const gate=new Promise(resolve=>release=resolve);
 const service=createWebSync({dataDir:dir,getState:()=>state,fetchImpl:async(url)=>{if(url.endsWith('/api/state'))return new Response(JSON.stringify(sample()));await gate;return new Response(png);}});
 try{service.start({requestId:'conflict'},()=>commits++);await until(()=>service.status().progress.total>0);state.teams.find(x=>x.webSync).name='下载期间的手动修改';state.revision++;release();await until(()=>!service.status().busy);assert.equal(commits,0);assert.equal(service.status().job.phase,'failed');assert.match(service.status().lastError,/本地赛事数据已变化/);assert.equal(state.teams.find(x=>x.webSync).name,'下载期间的手动修改');}
 finally{release();await service.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('closing the service cancels background downloads without committing later',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-sync-close-'));let state=createDefaultState(),commits=0,aborted=0;
 const service=createWebSync({dataDir:dir,getState:()=>state,fetchImpl:async(url,opts)=>{if(url.endsWith('/api/state'))return new Response(JSON.stringify(sample()));await new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>{aborted++;reject(opts.signal.reason);},{once:true}));}});
 try{service.start({requestId:'close'},()=>commits++);await until(()=>service.status().progress.total>0);await service.close();assert.equal(commits,0);assert.equal(aborted,4);assert.equal(service.status().busy,false);assert.equal(service.status().job.phase,'failed');}
 finally{await service.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('image headers and body may outlast the metadata deadline without restarting the download',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-sync-stream-'));let state=createDefaultState(),downloads=0;
 const raw=sample();raw.schools[0].emblem=raw.teams[0].logo=raw.players[0].avatar=raw.sponsors[0].image='/slow.png';
 const service=createWebSync({dataDir:dir,getState:()=>state,requestTimeoutMs:20,imageTimeoutMs:500,fetchImpl:async(url,options)=>{
  if(url.endsWith('/api/state'))return new Response(JSON.stringify(raw));downloads++;
  await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(options.signal.reason);};const timer=setTimeout(()=>{options.signal.removeEventListener('abort',abort);resolve();},50);options.signal.addEventListener('abort',abort,{once:true});});
  return new Response(new ReadableStream({start(controller){let offset=0;const abort=()=>{clearInterval(timer);controller.error(options.signal.reason);};const timer=setInterval(()=>{controller.enqueue(png.subarray(offset,offset+8));offset+=8;if(offset>=png.length){clearInterval(timer);options.signal.removeEventListener('abort',abort);controller.close();}},10);options.signal.addEventListener('abort',abort,{once:true});}}));
 }});
 try{service.start({requestId:'slow-body'},next=>state=next);await until(()=>!service.status().busy);assert.equal(service.status().job.phase,'completed',service.status().lastError);assert.equal(downloads,1);assert.equal(service.status().progress.retries,0);}
 finally{await service.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('website canonical redirect is resolved once and media goes directly to its final host',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-sync-redirect-'));let state=createDefaultState();const calls=[];
 const service=createWebSync({dataDir:dir,getState:()=>state,fetchImpl:async(url)=>{
  calls.push(url);if(url==='https://hushang985.online/api/state')return new Response(null,{status:301,headers:{location:'https://www.hushang985.online/api/state'}});
  return new Response(url.endsWith('/api/state')?JSON.stringify(sample()):png);
 }});
 try{service.start({requestId:'redirect'},next=>state=next);await until(()=>!service.status().busy);assert.equal(service.status().job.phase,'completed',service.status().lastError);assert.equal(calls.length,6);assert.ok(calls.slice(2).every(url=>url.startsWith('https://www.hushang985.online/')));assert.equal(state.webSync.source,'https://hushang985.online');}
 finally{await service.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('HTTP background sync responds before images finish, rejoins duplicates and fences a later handoff',async()=>{
 const net=require('node:net'),{createBroadcastServer}=require('../server/broadcast-server.cjs');
 const free=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>p<10000||p===10080?free().then(resolve):resolve(p));});});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-sync-http-'));let release;const gate=new Promise(resolve=>release=resolve);
 process.env.SCOREDECK_RADAR_PORT=String(await free());process.env.SCOREDECK_GSI_PORT=String(await free());
 const app=createBroadcastServer({dataDir:dir,initialPort:await free(),initialCountdownPort:await free(),webSyncOptions:{fetchImpl:async(url)=>{if(url.endsWith('/api/state'))return new Response(JSON.stringify(sample()));await gate;return new Response(png);}}});
 try{
  const meta=await app.listen(),base=meta.localUrl,auth=await fetch(base+'/api/meta').then(r=>r.json()),headers={'Content-Type':'application/json','X-ScoreDeck-Key':auth.controlKey,'X-ScoreDeck-Epoch':auth.serverEpoch,'X-ScoreDeck-Control-Epoch':auth.controlEpoch};
  const post=(body,h=headers)=>fetch(base+'/api/web-sync/start',{method:'POST',headers:h,body:JSON.stringify(body),signal:AbortSignal.timeout(2000)});
  assert.equal((await post({requestId:'bad'},{...headers,'X-ScoreDeck-Key':'wrong'})).status,401);
  assert.equal((await post({requestId:'bad'},{...headers,'X-ScoreDeck-Epoch':'old'})).status,409);
  const response=await post({requestId:'once'});assert.equal(response.status,202);const first=await response.json();assert.equal(first.busy,true);
  const duplicate=await post({requestId:'twice'});assert.equal(duplicate.status,202);assert.equal((await duplicate.json()).job.id,first.job.id);
  const before=await fetch(base+'/api/state').then(r=>r.json());assert.equal(before.webSync,undefined);
  const handoff=await fetch(base+'/api/handoff',{method:'POST',headers,body:'{}'});assert.equal(handoff.status,200);release();
  let status;for(let i=0;i<100;i++){status=await fetch(base+'/api/web-sync').then(r=>r.json());if(!status.busy)break;await pause(10);}
  assert.equal(status.busy,false);assert.equal(status.job.phase,'failed');assert.match(status.job.error,/授权已变化/);assert.equal((await fetch(base+'/api/state').then(r=>r.json())).webSync,undefined);
 }finally{release();await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});

 test('metadata and image requests default to a 3.5 minute deadline',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-sync-timeout-'));let state=createDefaultState();const deadlines=[];
 const original=AbortSignal.timeout.bind(AbortSignal);t.mock.method(AbortSignal,'timeout',ms=>{deadlines.push(ms);return original(ms);});
 const service=createWebSync({dataDir:dir,getState:()=>state,fetchImpl:async url=>new Response(url.endsWith('/api/state')?JSON.stringify(sample()):png)});
 try{const preview=await service.preview();await service.sync(preview.token,next=>state=next);assert.equal(deadlines.length,5);assert.ok(deadlines.every(ms=>ms===210000));}
 finally{await service.close();fs.rmSync(dir,{recursive:true,force:true});}
});
