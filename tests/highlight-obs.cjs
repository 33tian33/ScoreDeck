'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createController}=require('../server/highlight-obs.cjs');
const {createAutomation}=require('../server/halftime-auto.cjs');
const half=require('../server/halftime.cjs');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd-obs-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let scene='游戏',time=1000,online=true,items=[{id:'clip1',duration:3},{id:'clip2',duration:4}],scenes=['游戏','ScoreDeck 精选','ScoreDeck 直播控制','广告'];const switches=[];
 const args={dir,now:()=>time,getItems:async()=>items,hasReplay:()=>true,open:async()=>{
  if(!online)throw Error('offline');return {close(){},async call(kind,data){if(kind==='GetSceneList')return {scenes:scenes.map(sceneName=>({sceneName})),currentProgramSceneName:scene};if(kind==='GetCurrentProgramScene')return {currentProgramSceneName:scene};if(kind==='SetCurrentProgramScene'){assert.ok(scenes.includes(data.sceneName));scene=data.sceneName;switches.push(scene);return {};}}};
 }};
 const c=createController(args);const clientId='output-client-0001';
 return {c,args,dir,clientId,switches,get scene(){return scene;},set scene(v){scene=v;},set online(v){online=v;},set items(v){items=v;},set scenes(v){scenes=v;},advance(ms){time+=ms;},async start(mode='half',id='session-1'){await c.configure({enabled:true});await c.begin(id,mode);await c.tick(id);await c.signal({id,clientId,action:'ready'});}};
}
test('half restores captured scene, full restores configured live scene; completion is owned and idempotent',async t=>{
 const f=fixture(t);await f.start();assert.equal(f.scene,'ScoreDeck 精选');assert.equal(f.c.meta().run.returnScene,'游戏');
 assert.deepEqual(await f.c.signal({id:'old',clientId:f.clientId,action:'ended'}),{accepted:false});
 assert.deepEqual(await f.c.signal({id:'session-1',clientId:'preview-client-0002',action:'ended'}),{accepted:false});
 const event=await f.c.signal({id:'session-1',clientId:f.clientId,action:'ended'});assert.equal(event.finish,'ended');
 await Promise.all([f.c.end('session-1','ended'),f.c.end('session-1','round-13-110')]);assert.equal(f.scene,'游戏');assert.equal(f.switches.length,2);
 await f.start('full','session-2');await f.c.end('session-2','ended');assert.equal(f.scene,'ScoreDeck 直播控制');
});
test('readiness, immutable playlist, scene validation, manual take-over, unavailable output',async t=>{
 const f=fixture(t);await f.c.configure({enabled:true});await f.c.begin('one','half');assert.equal(f.scene,'游戏');
 assert.equal((await f.c.signal({id:'one',clientId:f.clientId,action:'ready'})).accepted,false);
 await f.c.tick('one');assert.match(f.c.meta().run.waitMessage,/已找到 2 段/);f.items=[{id:'new',duration:8}];await f.c.tick('one');assert.equal(f.c.meta().run.items[0].id,'clip1');
 f.scenes=['游戏'];await assert.rejects(f.c.signal({id:'one',clientId:f.clientId,action:'ready'}),/缺少场景/);assert.equal(f.scene,'游戏');
 f.scenes=['游戏','ScoreDeck 精选','ScoreDeck 直播控制','广告'];await f.c.signal({id:'one',clientId:f.clientId,action:'ready'});
 f.scene='广告';assert.equal(await f.c.tick('one'),'manual-scene');await f.c.end('one','manual-scene');assert.equal(f.scene,'广告');
 f.scene='游戏';await f.start();f.advance(16000);assert.equal(await f.c.tick('session-1'),'output-lost');await f.c.end('session-1','output-lost');assert.equal(f.scene,'游戏');
});
test('empty playlist does not switch; errors retain return ownership and restart recovers',async t=>{
 const f=fixture(t);await f.c.configure({enabled:true,password:'secret'});assert.equal(JSON.stringify(f.c.meta()).includes('secret'),false);
 f.items=[];await f.c.begin('empty','half');await f.c.tick('empty');assert.match(f.c.meta().run.waitMessage,/半场精选当前为 0 段/);f.advance(46000);assert.equal(await f.c.tick('empty'),'prepare-timeout');assert.match(f.c.meta().error,/片单为空/);assert.equal(f.scene,'游戏');await f.c.end('empty');
 f.items=[{id:'clip',duration:5}];await f.start();f.online=false;await assert.rejects(f.c.end('session-1','ended'),/offline/);assert.equal(f.c.meta().run.status,'returning');assert.equal(f.scene,'ScoreDeck 精选');
 const restored=createController(f.args);f.online=true;await restored.tick('session-1');assert.equal(f.scene,'游戏');assert.equal(restored.meta().run,null);
});
test('GSI round 13 deadline ignores freeze, >110, timeout, stale/missing time, other rounds; manual show also returns',async t=>{
 const f=fixture(t);let state={liveScene:'prematch',halftime:half.normalize()},packet={connected:true,sourceAgeMs:0,phase:'freezetime',phaseEndsIn:110,map:{name:'de_nuke',phase:'live',round:12,teamCT:{score:7},teamT:{score:5}}};
 const a=createAutomation({file:path.join(f.dir,'auto.json'),getState:()=>state,commit:s=>state=s,readGSI:async()=>packet,onShow:(id,mode)=>f.c.begin(id,mode),onHide:(id,reason)=>f.c.end(id,reason),onTick:id=>f.c.tick(id)});t.after(()=>a.close());
 await f.c.configure({enabled:true});await a.show();const id=a.meta().sessionId;await a.tick();await f.c.signal({id,clientId:f.clientId,action:'ready'});
 const unchanged=async()=>{await a.tick();assert.equal(a.meta().active,true);assert.equal(f.scene,'ScoreDeck 精选');};
 await unchanged();packet.phase='live';packet.phaseEndsIn=111;await unchanged();packet.phase='timeout_ct';packet.phaseEndsIn=109;await unchanged();packet.phase='live';packet.sourceAgeMs=10001;await unchanged();packet.sourceAgeMs=0;packet.phaseEndsIn=null;await unchanged();packet.phaseEndsIn=109;packet.map.round=11;await unchanged();packet.map.round=12;await a.tick();assert.equal(a.meta().active,false);assert.equal(f.scene,'游戏');
 await a.show(packet,'full');await a.tick();assert.equal(a.meta().active,true);packet.map.name='de_mirage';packet.map.phase='warmup';packet.map.round=0;await a.tick();assert.equal(a.meta().active,true,'full OBS playlist survives a map change');await a.hide();
});
