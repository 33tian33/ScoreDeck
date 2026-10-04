const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const {CachePolicy, MAX_CACHE_AGE_MS} = require('../cache-policy.cjs');
const free = () => new Promise(resolve => { const s=net.createServer(); s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));}); });
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
function seed(root, name, createdAt) {
  const dir=path.join(root,'match_'+name);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'cache-age.json'),JSON.stringify({createdAt}));
  fs.writeFileSync(path.join(dir,'raw.ndjson'),'cached\n');return dir;
}

test('cache deadline is creation based, cleans offline caches and preserves settings',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'radar-age-'));
  let now=Date.now(),timer,scheduled;
  const old=seed(root,'old',now-MAX_CACHE_AGE_MS),fresh=seed(root,'fresh',now-1000);
  const active=seed(root,'active',now-2000);
  fs.writeFileSync(path.join(root,'display-settings.json'),'settings');
  fs.writeFileSync(path.join(root,'tracker-settings.json'),'tracker');
  const policy=new CachePolicy({rootDir:root,activeDir:active,clock:()=>now,
    schedule:(fn,ms)=>{timer=fn;scheduled=ms;return 1},cancel:()=>{}});
  try {
    await policy.ensure();
    assert.equal(fs.existsSync(old),false);assert.equal(fs.existsSync(fresh),true);
    assert.equal(scheduled,MAX_CACHE_AGE_MS-2000);
    // Continued writes do not extend the deadline.
    fs.appendFileSync(path.join(active,'raw.ndjson'),'recent\n');
    now+=MAX_CACHE_AGE_MS-2001;await policy.ensure();assert.equal(fs.existsSync(path.join(active,'raw.ndjson')),true);
    now++;await timer();
    assert.equal(fs.existsSync(path.join(active,'raw.ndjson')),false);
    assert.equal(fs.existsSync(path.join(fresh,'raw.ndjson')),true);
    await Promise.all([policy.ensure(true),policy.ensure(true)]);
    assert.equal(fs.existsSync(fresh),false);
    assert.equal(fs.readFileSync(path.join(root,'display-settings.json'),'utf8'),'settings');
    assert.equal(fs.readFileSync(path.join(root,'tracker-settings.json'),'utf8'),'tracker');
  } finally {await policy.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('restart retains the original expiry and expires caches before use after sleep',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'radar-restart-'));
  let now=Date.now();const active=seed(root,'active',now-MAX_CACHE_AGE_MS+100);
  const options={rootDir:root,activeDir:active,clock:()=>now,schedule:()=>1,cancel:()=>{}};
  let policy=new CachePolicy(options);
  try {
    await policy.ensure();await policy.close();now+=100;
    policy=new CachePolicy(options);await policy.ensure();
    assert.equal(fs.existsSync(path.join(active,'raw.ndjson')),false);
    fs.writeFileSync(path.join(active,'raw.ndjson'),'new');
    now+=MAX_CACHE_AGE_MS;await policy.ensure();
    assert.equal(fs.existsSync(path.join(active,'raw.ndjson')),false);
  } finally {await policy.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('live cache clear closes Windows writers, resets replay and continues receiving GSI',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'radar-live-cache-'));
  const backendPath=path.resolve(__dirname,'../backend.cjs');
  const env={...process.env,RADAR_HUD_PUBLIC_DIR:path.resolve(__dirname,'../public'),GSI_TEMP_DIR:root};
  const ctx=vm.createContext({require:require('node:module').createRequire(backendPath),process:{...process,env},
    console,URL,Buffer,structuredClone,queueMicrotask,setTimeout,clearTimeout,setInterval,clearInterval});
  vm.runInContext(fs.readFileSync(backendPath,'utf8').split('// installer/sea-entry.cjs')[0]+
    '\ninit_frame_cache(); init_gsi_pipeline(); init_hud_server(); init_trajectory();'+
    '\nglobalThis.classes={FrameCache,GsiPipeline,HudServer,UtilityTrajectoryStore,createCachePolicy};',ctx);
  const {FrameCache,GsiPipeline,HudServer,UtilityTrajectoryStore,createCachePolicy}=ctx.classes;
  const frameCache=new FrameCache({rootDir:root,matchId:'live',flushFrames:1});
  const trajectoryStore=new UtilityTrajectoryStore();
  const hud=new HudServer({host:'127.0.0.1',port:await free(),frameCache,trajectoryStore});
  const pipeline=new GsiPipeline({recorder:{tempDir:root,matchId:'live',token:'test'},frameCache,
    onFrame:frame=>{trajectoryStore.update(frame);hud.updateFrame(frame)}});
  let now=Date.now(),timer;
  const policy=createCachePolicy({tempDir:root,frameCache,pipeline,trajectoryStore,hud,clock:()=>now,
    schedule:fn=>{timer=fn;return 1},cancel:()=>{}});
  ctx.testPolicy=policy;vm.runInContext('cachePolicy = globalThis.testPolicy',ctx);
  try {
    await policy.ensure();await pipeline.start({host:'127.0.0.1',port:await free()});await hud.start();
    const base='http://127.0.0.1:'+hud.address.port;
    const packet=()=>fetch('http://127.0.0.1:'+pipeline.recorder.address.port+'/gsi',{method:'POST',body:JSON.stringify({
      auth:{token:'test'},map:{name:'de_mirage',round:0,phase:'live'},round:{phase:'live'},
      allgrenades:{g1:{type:'smoke',position:'0,0,0',velocity:'1,0,0'}}})});
    const clear=headers=>fetch(base+'/api/cache/clear',{method:'POST',headers});
    assert.equal((await packet()).status,200);await pause(100);
    await frameCache.flush();assert.ok(fs.statSync(path.join(frameCache.matchDir,'raw.ndjson')).size>0);
    assert.ok(trajectoryStore.trajectories.size>0);
    Object.assign(hud.displaySettings,{replay:true,playing:true,offset:500,layer:'low',fade:8});
    assert.equal((await clear({})).status,403);
    assert.equal((await clear({'X-Radar-Cache':'clear',Origin:'https://unrelated.example'})).status,403);
    assert.equal((await fetch(base+'/api/cache/clear')).status,405);
    const cleared = await clear({'X-Radar-Cache':'clear'});
    assert.equal(cleared.status,200,await cleared.text());
    assert.equal(trajectoryStore.trajectories.size,0);
    assert.equal((await frameCache.listRounds()).length,0);
    assert.equal(pipeline.synchronizer.lastSample,null);
    assert.equal(hud.displaySettings.playing,false);assert.equal(hud.displaySettings.replay,false);
    assert.equal(hud.displaySettings.layer,'low');assert.equal(hud.displaySettings.fade,8);
    // The old synchronizer must not recreate deleted frames in the absence of GSI.
    await pause(80);assert.equal((await frameCache.listRounds()).length,0);
    assert.equal((await packet()).status,200);await pause(100);
    assert.ok(trajectoryStore.trajectories.size>0);
    now+=MAX_CACHE_AGE_MS;await timer();
    assert.equal(trajectoryStore.trajectories.size,0);assert.equal(hud.latestFrame,null);
    // Concurrent clear requests must serialize while new packets remain usable.
    const requests=await Promise.all([clear({'X-Radar-Cache':'clear'}),packet(),clear({'X-Radar-Cache':'clear'})]);
    for(const response of requests)assert.equal(response.status,200);
    assert.equal((await packet()).status,200);await pause(100);
    assert.ok(hud.latestFrame);
  } finally {await policy.close();await pipeline.stop();await hud.stop();fs.rmSync(root,{recursive:true,force:true});}
});
