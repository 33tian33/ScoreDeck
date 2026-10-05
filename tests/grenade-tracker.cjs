const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const net=require('node:net');
const {GrenadeTracker,ConsoleLink,active,kind,packet}=require('../radarhud/grenade-tracker.cjs');
class Fake extends EventEmitter {constructor(){super();this.ready=true;this.connected=true;this.commands=[];}write(s){this.commands.push(s);}camera(s){this.write(s);}clearCamera(){}close(){this.ready=false;this.emit('offline');}}
function setup(){let now=1000;const link=new Fake();const tracker=new GrenadeTracker({link,clock:()=>now,timers:false});const players=[{entity_id:'76561198000000001',name:'Alpha',observer_slot:1,position:[0,0,0],state:{health:100}},{entity_id:'76561198000000002',name:'Beta',observer_slot:2,position:[20,0,0],state:{health:100}}];const data=gs=>({map:{name:'de_nuke',round:1,phase:'live'},round:{phase:'live'},player:{steamid:players[0].entity_id,activity:'playing'},players,grenades:gs});return {tracker,link,players,step(ms,gs){now+=ms;tracker.ingest(data(gs));},now:()=>now,advance(ms){now+=ms;},data};}
const grenade=(id,type,owner='76561198000000002',position=[10,0,0],extra={})=>({entity_id:id,type,owner,position,velocity:[100,0,0],effect_time:null,...extra});
test('four independent types prioritize observed player, then nearest in 3D',()=>{
 for(const type of ['flashbang','smoke','frag','firebomb']){const t=setup();t.step(0,[]);const a=grenade('own',type,t.players[0].entity_id,[900,0,0]),b=grenade('near',type);t.step(50,[a,b,grenade('other','decoy',null,[0,0,0])]);assert.equal(t.tracker.select(type,t.players[0]).target.id,'own');assert.match(t.tracker.select(type,t.players[0]).reason,/2 秒/);
 for(let i=0;i<5;i++)t.step(450,[a,b]);assert.equal(t.tracker.select(type,t.players[0]).target.id,'near');}
});
test('2 second inclusive boundary and latest own throw',()=>{const t=setup();t.step(0,[]);const a=grenade('a','smoke',t.players[0].entity_id),b=grenade('b','smoke',t.players[0].entity_id);t.step(50,[a]);t.step(50,[a,b]);assert.equal(t.tracker.select('smoke',t.players[0]).target.id,'b');for(let i=0;i<4;i++)t.step(500,[a,b]);assert.match(t.tracker.select('smoke',t.players[0]).reason,/2 秒/);t.step(1,[a,b]);assert.match(t.tracker.select('smoke',t.players[0]).reason,/最近$/);});
test('baseline and reconnect never assign false recent throw timestamps',()=>{const t=setup();const own=grenade('own','smoke',t.players[0].entity_id,[900,0,0]),near=grenade('near','smoke');t.step(0,[own,near]);assert.equal(t.tracker.select('smoke',t.players[0]).target.id,'near');t.step(800,[own,near]);assert.equal(t.tracker.records.get('own').firstSeen,null);});
test('live smoke and inferno remain selectable; spent HE and invalid positions do not',()=>{const t=setup();t.step(0,[]);t.step(50,[grenade('upper','smoke',null,[0,0,400]),grenade('samefloor','smoke',null,[30,0,0]),grenade('live-smoke','smoke',null,[1,0,0],{effect_time:5,state:'smoking'})]);assert.equal(t.tracker.select('smoke',t.players[0]).target.id,'live-smoke');assert.equal(kind('weapon_molotov'),'firebomb');assert.equal(kind('incgrenade_projectile'),'firebomb');assert.equal(active(grenade('fire','inferno')),true);assert.equal(active(grenade('boom','frag',null,[0,0,0],{state:'exploded'})),false);assert.equal(active(grenade('bad','frag',null,[NaN,0,0])),false);assert.equal(active(grenade('gone','smoke',null,[0,0,0],{state:'expired'})),false);});
test('locks target, emits finite camera commands, ends and sends return only once',()=>{const t=setup();t.step(0,[]);const g=grenade('1','flashbang');t.step(50,[g]);t.tracker.start('flashbang');assert.ok(t.link.commands.some(s=>s.startsWith('spec_goto ')));t.step(50,[g,grenade('2','flashbang',t.players[0].entity_id)]);assert.equal(t.tracker.session.id,'1');t.step(50,[]);t.advance(351);t.tracker.tick();assert.equal(t.tracker.session,null);assert.equal(t.link.commands.filter(s=>s.includes('; spec_player ')).length,1);t.tracker.tick();assert.equal(t.link.commands.filter(s=>s.includes('; spec_player ')).length,1);});
test('no target / no player / unverified channel cause no camera mutation',()=>{const t=setup();t.step(0,[]);assert.throws(()=>t.tracker.start('frag'),/暂无/);t.step(50,[grenade('1','frag')]);t.tracker.state.player=null;assert.throws(()=>t.tracker.start('frag'),/观战/);assert.equal(t.link.commands.length,0);t.step(50,[grenade('1','frag')]);t.link.ready=false;assert.throws(()=>t.tracker.start('frag'),/回显/);assert.equal(t.link.commands.length,0);});
test('stale input, round change, and disconnect cancel without stale return',()=>{for(const method of ['stale','round','offline']){const t=setup();t.step(0,[]);const g=grenade('1','frag');t.step(50,[g]);t.tracker.start('frag');const before=t.link.commands.length;if(method==='stale'){t.advance(3001);t.tracker.tick();}if(method==='round'){const d=t.data([g]);d.map.round=2;t.tracker.ingest(d);}if(method==='offline')t.link.close();assert.equal(t.tracker.session,null);assert.equal(t.link.commands.length,before);}});
test('dead original player does not cause random return and panel lease expires',()=>{const t=setup();t.step(0,[]);const g=grenade('1','firebomb');t.step(50,[g]);t.tracker.start('firebomb');t.players[0].state.health=0;t.tracker.stop();assert.ok(!t.link.commands.some(s=>s.includes('; spec_player ')));t.players[0].state.health=100;t.tracker.start('firebomb');for(let i=0;i<6;i++)t.step(500,[g]);t.tracker.tick();assert.equal(t.tracker.session,null);assert.match(t.tracker.message,/面板失联/);});
test('VConsole packet layout and fragmented PRNT echo verify real socket',async()=>{
 const link=new ConsoleLink();let sock;const received=[];let buffer=Buffer.alloc(0);
 const server=net.createServer(s=>{sock=s;s.on('data',d=>{buffer=Buffer.concat([buffer,d]);while(buffer.length>=12){const n=buffer.readUInt16BE(8);if(buffer.length<n)break;const f=buffer.subarray(0,n);buffer=buffer.subarray(n);assert.equal(f.toString('ascii',0,4),'CMND');assert.equal(f.readUInt32BE(4),0x00D40000);const cmd=f.subarray(12,-1).toString();received.push(cmd);if(cmd.startsWith('echo ')){const body=Buffer.concat([Buffer.alloc(28),Buffer.from(cmd.slice(5)+'\n\0')]);const h=Buffer.alloc(12);h.write('PRNT');h.writeUInt16BE(12+body.length,8);const out=Buffer.concat([h,body]);s.write(out.subarray(0,7));setTimeout(()=>s.write(out.subarray(7)),10);}}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await link.connect({port:server.address().port,protocol:'vconsole',version:212});assert.equal(link.ready,true);link.camera('spec_goto 1 2 3 4 5');await new Promise(r=>setTimeout(r,30));assert.ok(received.includes('spec_goto 1 2 3 4 5'));}finally{link.close();sock?.destroy();await new Promise(r=>server.close(r));}
 assert.equal(packet('echo test').readUInt16BE(8),22);
});
test('TCP alone or an echoed command line does not count as successful execution',()=>{const l=new ConsoleLink();l.probe='SD_TRACK_TEST';l.consume('echo SD_TRACK_TEST\n');assert.equal(l.ready,false);l.consume('SD_TRACK_TEST\n');assert.equal(l.ready,true);});
test('GOTV lifetime orders simultaneous arrivals and excludes an old delayed own throw',()=>{const t=setup();t.step(0,[]);const id=t.players[0].entity_id;t.step(50,[grenade('a','smoke',id,[900,0,0],{lifetime:0.9}),grenade('b','smoke',id,[800,0,0],{lifetime:0.1})]);assert.equal(t.tracker.select('smoke',t.players[0]).target.id,'b');t.step(50,[grenade('a','smoke',id,[900,0,0],{lifetime:3}),grenade('other','smoke')]);assert.equal(t.tracker.select('smoke',t.players[0]).target.id,'other');});

test('disappeared recent own utility is never selected, fallback is nearest alive same type',()=>{
 for(const type of ['flashbang','smoke','frag','firebomb']){const t=setup();t.step(0,[]);const own=grenade('own',type,t.players[0].entity_id,[1000,0,0]),near=grenade('near',type,null,[40,0,0]),far=grenade('far',type,null,[90,0,0]);t.step(50,[own,near,far]);assert.equal(t.tracker.select(type,t.players[0]).target.id,'own');t.step(50,[near,far]);assert.equal(t.tracker.select(type,t.players[0]).target.id,'near');assert.equal(t.tracker.records.has('own'),false);}
});
test('active smoke older than 2 seconds remains a nearby fallback',()=>{const t=setup();t.step(0,[]);t.step(50,[grenade('smoke','smoke',null,[10,0,0],{effect_time:8,lifetime:10,state:'smoking'})]);assert.equal(t.tracker.select('smoke',t.players[0]).target.id,'smoke');});
test('nearest fallback breaks equal distance ties with latest birth',()=>{const t=setup();t.step(0,[]);t.step(50,[grenade('older','frag',null,[10,0,0],{lifetime:1}),grenade('newer','frag',null,[-10,0,0],{lifetime:0.1})]);assert.equal(t.tracker.select('frag',t.players[0]).target.id,'newer');});
test('fire transition follows same-owner inferno after one missing packet, centroid is camera target',()=>{const t=setup();t.step(0,[]);const g=grenade('bottle','firebomb',t.players[0].entity_id,[100,0,0]);t.step(50,[g]);t.tracker.start('firebomb');t.step(50,[]);assert.ok(t.tracker.session.endingAt);t.step(50,[grenade('zone','inferno',t.players[0].entity_id,null,{flames:[[100,0,0],[120,0,0]],effect_time:1})]);assert.equal(t.tracker.session.id,'zone');assert.equal(t.tracker.session.endingAt,undefined);assert.deepEqual(t.tracker.records.get('zone').position,[110,0,0]);t.tracker.tick(true);assert.ok(t.link.commands.at(-1).startsWith('spec_goto'));});
test('stale state exposes no valid candidate counts',()=>{const t=setup();t.step(0,[grenade('a','frag')]);t.advance(3001);assert.equal(t.tracker.status().counts.frag,0);assert.throws(()=>t.tracker.start('frag'),/过期/);});
test('shared text console verifies xray and UI including killfeed without a second socket',async()=>{
 const {GameControls}=require('../radarhud/grenade-tracker.cjs');let connections=0;const values={spec_show_xray:0,cl_draw_only_deathnotices:0,cl_drawhud_force_deathnotices:0};let socket;
 const server=net.createServer(s=>{connections++;socket=s;let buf='';s.on('data',data=>{buf+=data;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(line.startsWith('echo '))s.write(line+'\n'+line.slice(5)+'\n');else{const [key,value]=line.split(' ');if(key in values){if(value!==undefined)values[key]=Number(value);else s.write('"'+key+'" = "'+values[key]+'"\n');}}}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const link=new ConsoleLink(),controls=new GameControls(link);
 try{await link.connect({port:server.address().port,protocol:'text',version:212});await controls.exchange([]);assert.equal(controls.values.xray,false);await controls.toggle('xray');assert.equal(controls.values.xray,true);link.camera('spec_goto 1 2 3 4 5');await controls.toggle('ui');assert.equal(controls.values.ui,true);assert.equal(controls.values.deathnotices,-1);await controls.toggle('ui');assert.equal(controls.values.deathnotices,0);assert.equal(connections,1);}finally{link.close();socket?.destroy();await new Promise(r=>server.close(r));}
});
test('return uses name after first-person mode, works without HUD slot and confirms later GSI',()=>{
 const t=setup();delete t.players[0].observer_slot;t.step(0,[]);t.step(50,[grenade('1','frag')]);t.tracker.start('frag');t.tracker.returnCamera();
 assert.equal(t.link.commands.at(-1),'spec_autodirector 0; spec_mode 1; spec_player "Alpha"');assert.equal(t.tracker.status().returning,true);
 t.step(50,[]);assert.equal(t.tracker.status().returning,false);assert.match(t.tracker.message,/GSI 目标身份匹配：Alpha.*第一人称视角请在游戏中确认/);
});
test('unsafe or ambiguous names never cycle or select another player',()=>{
 for(const name of ['bad";quit','Beta','Bet','123','']){
 const t=setup();t.players[0].name=name;t.step(0,[]);t.step(50,[grenade('1','frag')]);t.tracker.start('frag');const before=t.link.commands.length;t.tracker.returnCamera();
 assert.equal(t.link.commands.length,before);assert.match(t.tracker.message,/无法直接返回/);
 const d=t.data([]);d.player.steamid=t.players[1].entity_id;
 for(let i=0;i<8;i++){t.advance(310);t.tracker.ingest(d);}
 assert.equal(t.tracker.pendingReturn,null);assert.equal(t.link.commands.length,before);
 const c=t.tracker.cameraStatus();t.tracker.goCamera({id:'N01',mapName:c.mapName,mapEpoch:c.mapEpoch});const n=t.link.commands.length;t.advance(310);t.tracker.ingest(d);t.tracker.tick();assert.equal(t.link.commands.length,n);
 }
});
test('delayed or missing GSI confirmation never cycles away from the direct return target',()=>{
 for(const confirmed of [true,false]){
 const t=setup();t.step(0,[]);t.step(50,[grenade('1','frag')]);t.tracker.start('frag');t.tracker.returnCamera();const n=t.link.commands.length;
 const d=t.data([]);d.player.steamid=t.players[1].entity_id;
 for(let i=0;i<12;i++){t.advance(350);t.tracker.ingest(d);t.tracker.tick();}
 assert.equal(t.link.commands.length,n);assert.ok(t.tracker.pendingReturn);
 t.advance(confirmed?250:350);if(confirmed)d.player.steamid=t.players[0].entity_id;
 t.tracker.ingest(d);assert.equal(t.tracker.pendingReturn,null);assert.equal(t.link.commands.length,n);
 assert.match(t.tracker.message,confirmed?/GSI 目标身份匹配：Alpha/:/未获确认/);
 }
});
test('return timeout does not falsely claim success, map change cancels retries',()=>{
 const t=setup();t.step(0,[]);t.step(50,[grenade('1','frag')]);t.tracker.start('frag');t.tracker.stop();t.advance(3001);t.tracker.tick();assert.equal(t.tracker.pendingReturn,null);assert.match(t.tracker.message,/未获确认/);
 t.step(0,[]);const c=t.tracker.cameraStatus();t.tracker.goCamera({id:'N01',mapName:c.mapName,mapEpoch:c.mapEpoch});t.tracker.returnCamera();const n=t.link.commands.length;const d=t.data([]);d.map.name='de_dust2';t.advance(50);t.tracker.ingest(d);t.advance(400);t.tracker.tick();assert.equal(t.link.commands.length,n);
});
test('camera stays horizontally behind and above on steep throws, fills frames and limits bounce yaw',()=>{
 const t=setup();t.step(0,[]);let g=grenade('1','frag',t.players[0].entity_id,[100,0,100],{velocity:[100,0,900]});t.step(50,[g]);t.tracker.start('frag');
 const pose=()=>t.link.commands.at(-1).split(' ').slice(1).map(Number);let p=pose();assert.equal(p[0],-120);assert.equal(p[2],220);
 const frames=[];for(let i=1;i<=20;i++){t.advance(17);if(i%3===0){g={...g,position:[100+i*1.7,0,100+i*15.3]};t.tracker.ingest(t.data([g]));}t.tracker.tick();frames.push(pose());}
 assert.ok(frames.every(x=>x.every(Number.isFinite)));assert.ok(new Set(frames.map(x=>x[0])).size>15);assert.ok(frames.every((x,i)=>i===0||Math.abs(x[0]-frames[i-1][0])<10));
 const old=t.tracker.session.direction.slice();g={...g,velocity:[-100,0,0]};t.step(17,[g]);t.tracker.tick();assert.ok(t.tracker.session.direction[0]>.9,'bounce must not snap 180 degrees');
});

test('1s heartbeat gaps retain tracking; stale motion freezes and real disconnect stops',()=>{
 const t=setup(),g=grenade('steady','smoke',t.players[0].entity_id,[100,0,0],{effect_time:2,state:'smoking'});
 t.step(0,[]);t.step(50,[g]);t.tracker.start('smoke');
 for(let i=0;i<4;i++){
  const commands=t.link.commands.length;t.advance(601);t.tracker.heartbeat();t.tracker.tick();
  assert.ok(t.tracker.session);assert.equal(t.tracker.status().fresh,true);assert.equal(t.link.commands.length,commands);
  t.step(399,[g]);t.tracker.tick();assert.equal(t.tracker.session.id,'steady');assert.ok(t.link.commands.length>commands);
 }
 t.advance(3001);t.tracker.heartbeat();t.tracker.tick();assert.equal(t.tracker.session,null);assert.match(t.tracker.message,/GSI 断流/);
});
test('repeat return cancels retries and explicit cancel is idempotent',()=>{
 for(const explicit of [false,true]){
  const t=setup();t.step(0,[]);t.step(50,[grenade('1','frag')]);t.tracker.start('frag');t.tracker.returnCamera();
  assert.ok(t.tracker.pendingReturn);const n=t.link.commands.length;
  if(explicit){t.tracker.cancelReturn();t.tracker.cancelReturn();}else t.tracker.returnCamera();
  assert.equal(t.tracker.pendingReturn,null);assert.equal(t.tracker.status().returning,false);
  const d=t.data([]);d.player.steamid=t.players[1].entity_id;
  for(let i=0;i<12;i++){t.advance(310);t.tracker.ingest(d);t.tracker.tick();}
  assert.equal(t.link.commands.length,n);assert.match(t.tracker.message,/已取消自动返回/);
 }
});
