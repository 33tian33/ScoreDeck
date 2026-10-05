const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {createIntegrationService}=require('../server/integration-service.cjs');
const free=()=>new Promise(resolve=>{const server=net.createServer().listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});

test('Replay gold defaults persist, fill legacy empty slots, and preserve custom transitions',async t=>{
  const executable=process.env.SCOREDECK_TEST_REPLAY||path.resolve(__dirname,'../modules/replay',process.platform==='win32'?'ProjectReplay.exe':'ProjectReplay');
  if(!fs.existsSync(executable))return t.skip('Build the platform Replay binary first');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-replay-default-'));
  const service=createIntegrationService({dataDir:dir,replayExecutable:executable});
  service.configure('http://127.0.0.1:17890',[17890]);
  const gold=fs.readFileSync(path.resolve(__dirname,'../modules/replay/assets/Replay-gold.mp4'));
  try{
    await service.action('replay','settings',{port:await free(),autoStart:false});
    await service.action('replay','start');
    const base=service.meta('replay').controlUrl;
    const output=async()=>(await(await fetch(base+'api/state')).json()).state.output;
    const initial=await output();
    const media=path.join(service.meta('replay').dataDir,'media');
    for(const slot of [1,2]){
      assert.ok(initial['transition'+slot]);
      assert.deepEqual(fs.readFileSync(path.join(media,initial['transition'+slot])),gold);
    }
    const files=fs.readdirSync(media).sort();
    await service.action('replay','restart');
    assert.deepEqual(await output(),initial);
    assert.deepEqual(fs.readdirSync(media).sort(),files,'restart must not reimport defaults');

    const custom=Buffer.from('custom transition bytes');
    const uploaded=await fetch(base+'api/output/transition/1?name=custom.mp4',{method:'POST',body:custom});
    assert.equal(uploaded.status,200);
    const {id}=await uploaded.json();
    await service.action('replay','stop');
    const stateFile=path.join(service.meta('replay').dataDir,'state.json');
    const stored=JSON.parse(fs.readFileSync(stateFile,'utf8'));
    stored.state.output.transition2='';
    fs.writeFileSync(stateFile,JSON.stringify(stored));
    await service.action('replay','start');
    const migrated=await output();
    assert.equal(migrated.transition1,id,'custom intro must survive migration');
    assert.deepEqual(fs.readFileSync(path.join(media,id)),custom);
    assert.ok(migrated.transition2,'legacy empty outro gets the default');
    assert.deepEqual(fs.readFileSync(path.join(media,migrated.transition2)),gold);
    await service.action('replay','restart');
    assert.deepEqual(await output(),migrated);
  }finally{
    await service.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
