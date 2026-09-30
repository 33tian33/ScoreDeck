const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {MAP_CAMERAS}=require('../radarhud/camera-presets.cjs');
const {GrenadeTracker}=require('../radarhud/grenade-tracker.cjs');
class Link extends EventEmitter {
 constructor(){super();this.ready=true;this.connected=true;this.commands=[];this.pending=null;}
 write(command){this.commands.push(command);}camera(command){this.write(command);}
 clearCamera(){this.pending=null;}close(){this.ready=false;this.emit('offline');}
}
function setup(){
 let time=1000;const link=new Link(),tracker=new GrenadeTracker({link,clock:()=>time,timers:false});
 const player={entity_id:'76561198000000001',name:'选手甲',observer_slot:2,position:[0,0,0],state:{health:100}};
 const ingest=(map='de_dust2',extra={})=>tracker.ingest({map:{name:map,round:1,phase:'live'},round:{phase:'live'},player:{steamid:player.entity_id,activity:'playing'},players:[player],grenades:[],...extra});
 const click=id=>{const c=tracker.cameraStatus();tracker.goCamera({id,mapName:c.mapName,mapEpoch:c.mapEpoch});};
 return {link,tracker,player,ingest,click,advance:ms=>time+=ms};
}
test('exact user selection: 8 maps and 36 Chinese-labelled finite camera poses',()=>{
 const ids={de_dust2:'D01 D04 D05 D07 D21',de_mirage:'M02 M03 M05',de_inferno:'I01 I02 I03 I06 I08',de_nuke:'N01 N02 N03 N04 N05',de_ancient:'AC01 AC03 AC06 AC07',de_anubis:'AN01 AN02 AN03 AN04 AN05 AN06',de_overpass:'O01 O02 O07 O08',de_cache:'C01 C04 C06 C07'};
 assert.deepEqual(Object.keys(MAP_CAMERAS),Object.keys(ids));let count=0;
 for(const [map,expected] of Object.entries(ids)){
  assert.equal(MAP_CAMERAS[map].presets.map(p=>p.id).join(' '),expected);
  const t=setup();t.ingest(map);assert.equal(t.tracker.cameraStatus().presets.length,expected.split(' ').length);
  for(const p of MAP_CAMERAS[map].presets){count++;assert.match(p.label,/[\u4e00-\u9fff]/);assert.equal(p.pose.length,5);assert.ok(p.pose.every(Number.isFinite));t.click(p.id);assert.equal(t.link.commands.at(-1),'spec_autodirector 0; spec_mode 6; spec_goto '+p.pose.join(' '));}
 }
 assert.equal(count,36);
 assert.deepEqual(MAP_CAMERAS.de_dust2.presets.at(-1).pose,[-410.5,1170.8,247.2,39.6,65]);
 assert.deepEqual(MAP_CAMERAS.de_cache.presets[0].pose,[-390.3,2260.2,2072.8,38.1,-55.8]);
});
test('map normalization, unknown maps, menus and stale GSI never expose stale buttons',()=>{
 const t=setup();assert.equal(t.tracker.cameraStatus().presets.length,0);
 t.ingest('workshop/123/DE_ANUBIS.bsp');assert.equal(t.tracker.cameraStatus().presets.length,6);
 t.ingest('maps\\de_dust2.vpk');assert.equal(t.tracker.cameraStatus().mapName,'de_dust2');
 t.advance(1100);assert.equal(t.tracker.fresh(),true);assert.equal(t.tracker.motionFresh(),false);assert.equal(t.tracker.cameraStatus().presets.length,5);t.click('D01');
 t.advance(1901);assert.equal(t.tracker.cameraStatus().presets.length,0);assert.throws(()=>t.click('D01'),/GSI/);
 t.ingest('de_train');assert.equal(t.tracker.cameraStatus().presets.length,0);assert.throws(()=>t.click('D01'),/没有/);
 t.ingest('de_dust2',{player:{activity:'menu'}});assert.equal(t.tracker.cameraStatus().presets.length,0);
});
test('queued old-map clicks and forged IDs are rejected without writing to the console',()=>{
 const t=setup();t.ingest();const old=t.tracker.cameraStatus();
 t.ingest('de_mirage');assert.throws(()=>t.tracker.goCamera({id:'D01',mapName:old.mapName,mapEpoch:old.mapEpoch}),/地图已变化/);
 t.ingest('de_dust2');assert.throws(()=>t.tracker.goCamera({id:'D01',mapName:old.mapName,mapEpoch:old.mapEpoch}),/地图已变化/);
 assert.throws(()=>t.click('D01;quit'),/没有/);assert.throws(()=>t.click('M02'),/没有/);
 t.link.ready=false;assert.throws(()=>t.click('D01'),/连接 CS2/);assert.deepEqual(t.link.commands,[]);
});
test('static camera cancels utility frames and retains original return target',()=>{
 const t=setup();t.ingest();t.advance(50);t.ingest('de_dust2',{grenades:[{entity_id:'g',type:'smoke',owner:t.player.entity_id,position:[100,0,50],velocity:[100,0,0],lifetime:0.1}]});
 t.tracker.start('smoke');assert.ok(t.tracker.session);t.link.pending='spec_goto 0 0 0 0 0';
 t.click('D05');assert.equal(t.tracker.session,null);assert.equal(t.link.pending,null);
 const n=t.link.commands.length;t.advance(50);t.tracker.tick(true);assert.equal(t.link.commands.length,n);
 t.click('D07');assert.equal(t.tracker.cameraStatus().canReturn,true);t.tracker.returnCamera();
 assert.equal(t.link.commands.at(-1),'spec_autodirector 0; spec_mode 1; spec_player "选手甲"');assert.equal(t.tracker.cameraStatus().lastSentId,null);
 t.tracker.returnCamera();assert.equal(t.link.commands.length,n+2);
});
test('dead return player, map change and stale state do not send an arbitrary return',()=>{
 for(const mode of ['dead','map','stale','offline']){
  const t=setup();t.ingest();t.click('D04');const n=t.link.commands.length;
  if(mode==='dead')t.player.state.health=0;
  if(mode==='map')t.ingest('de_mirage');
  if(mode==='stale')t.advance(3001);
  if(mode==='offline')t.link.close();
  t.tracker.returnCamera();assert.equal(t.link.commands.length,n,mode);
 }
});
test('static cameras work without a living observed player, and errors clear last selection',()=>{
 const t=setup();t.ingest('de_nuke',{player:null,players:[]});t.click('N05');
 assert.equal(t.tracker.cameraStatus().canReturn,false);assert.equal(t.tracker.cameraStatus().lastSentId,'N05');
 t.link.emit('commandError','unknown command');assert.equal(t.tracker.cameraStatus().lastSentId,null);assert.match(t.tracker.message,/拒绝/);
});
