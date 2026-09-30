const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {createRadarService}=require('../server/radar-service.cjs');const {writeConfig}=require('../server/radar-setup.cjs');const {resolvePort}=require('../radarhud/ports.cjs');
test('reserved port stays available to another app; legacy overrides migrate and GSI receives on 31337',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-ports-')),old={hud:process.env.SCOREDECK_RADAR_PORT,gsi:process.env.SCOREDECK_GSI_PORT};
 const other=net.createServer(s=>s.end('other-app'));await new Promise((r,j)=>other.once('error',j).listen(23415,'127.0.0.1',r));
 process.env.SCOREDECK_RADAR_PORT='23415';process.env.SCOREDECK_GSI_PORT='23415';const service=createRadarService({dataDir:dir});
 try{
 assert.equal(service.meta().hudPort,23416);assert.equal(service.meta().gsiPort,31337);await service.start();assert.equal(service.meta().running,true,service.meta().error);
 assert.equal((await fetch(service.meta().outputUrl)).status,200);
 const res=await fetch(service.meta().gsiUrl,{method:'POST',body:JSON.stringify({auth:{token:'change-me'},provider:{timestamp:Date.now()/1000},map:{name:'de_dust2',round:0,phase:'live'}})});assert.equal(res.status,200);
 const received=await new Promise((r,j)=>{const s=net.connect(23415,'127.0.0.1');s.on('data',b=>r(b.toString()));s.on('error',j);});assert.equal(received,'other-app');
 const cfg=path.join(dir,'game/csgo/cfg');fs.mkdirSync(cfg,{recursive:true});const result=await writeConfig(cfg,{port:23415});assert.match(fs.readFileSync(result.path,'utf8'),/:31337\/gsi/);assert.doesNotMatch(fs.readFileSync(result.path,'utf8'),/:23415/);
 assert.equal(resolvePort(32345,31337),32345);
 }finally{await service.close();await new Promise(r=>other.close(r));for(const [key,value] of [['SCOREDECK_RADAR_PORT',old.hud],['SCOREDECK_GSI_PORT',old.gsi]])value===undefined?delete process.env[key]:process.env[key]=value;fs.rmSync(dir,{recursive:true,force:true});}
});
