import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {WebSocket,WebSocketServer} from '../lib/vendor/ws/wrapper.mjs';
import dgram from 'node:dgram';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=12000){const deadline=Date.now()+ms;let last;while(Date.now()<deadline){try{const value=await fn();if(value)return value;}catch(e){last=e;}await sleep(50);}throw last||new Error('timeout');}
async function freePort(){const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
for(const provider of ['openai','aliyun']) test(`${provider}: 10 speakers → retrying ASR → WAV → OBS → restart recovery`, {timeout:30000},async t=>{
 const runtime=await mkdtemp(join(tmpdir(),'director-int-'));t.after(()=>rm(runtime,{recursive:true,force:true}));
 let requests=0;const api=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks);requests++;assert.ok(raw.includes(Buffer.from('RIFF')));assert.ok(raw.includes(Buffer.from('whisper-1')));
  if(requests===1){res.writeHead(429);res.end('{}');return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({segments:[{text:'加油，我们能赢',start:0,end:.4,no_speech_prob:.01}]}));
 });
 const wss=new WebSocketServer({noServer:true});
 api.on('upgrade',(req,socket,head)=>{
   requests++;
   if(requests===1){socket.end('HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');return;}
   wss.handleUpgrade(req,socket,head,ws=>{
     let id,total=0;
     ws.on('message',(data,binary)=>{
       if(binary){total+=data.length;return;}
       const m=JSON.parse(data);id=m.header.task_id;
       if(m.header.action==='run-task'){assert.equal(m.payload.model,'paraformer-realtime-v2');ws.send(JSON.stringify({header:{task_id:id,event:'task-started'}}));}
       if(m.header.action==='finish-task'){assert.ok(total>0);ws.send(JSON.stringify({header:{task_id:id,event:'result-generated'},payload:{output:{sentence:{sentence_end:true,text:'加油，我们能赢',begin_time:0,end_time:400}}}}));ws.send(JSON.stringify({header:{task_id:id,event:'task-finished'}}));}
     });
   });
 });
 t.after(()=>{for(const ws of wss.clients)ws.terminate();wss.close();});
 await new Promise(r=>api.listen(0,'127.0.0.1',r));t.after(()=>api.close());
 const port=await freePort(),udp=await freePort();let child,logs='';
 function launch(useKey=true){child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,RUNTIME_DIR:runtime,PORT:String(port),PCM_BRIDGE_PORT:String(udp),ASR_PROVIDER:provider,ASR_MODEL:provider==='aliyun'?'paraformer-realtime-v2':'whisper-1',ASR_WS_URL:`ws://127.0.0.1:${api.address().port}`,DASHSCOPE_API_KEY:useKey?'test-key':'',OPENAI_API_KEY:useKey?'test-key':'',ASR_BASE_URL:`http://127.0.0.1:${api.address().port}`,DEEPSEEK_API_KEY:''},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);}
 t.after(()=>child?.kill('SIGKILL'));
 async function req(path,body){const r=await fetch(`http://127.0.0.1:${port}${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {r,b:await r.json()};}
 launch(false);await until(async()=>{const {r}=await req('/healthz');return r.ok;});

 const monitorAll=new WebSocket(`ws://127.0.0.1:${port}/monitor`,{origin:`http://127.0.0.1:${port}`});
 const monitorOne=new WebSocket(`ws://127.0.0.1:${port}/monitor`,{origin:`http://127.0.0.1:${port}`});
 t.after(()=>{monitorAll.terminate();monitorOne.terminate();});
 const allFrames=[],oneFrames=[];monitorAll.on('message',b=>allFrames.push(JSON.parse(b)));monitorOne.on('message',b=>oneFrames.push(JSON.parse(b)));
 await Promise.all([monitorAll,monitorOne].map(ws=>new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);})));monitorAll.send(JSON.stringify({channelId:'channel-alpha'}));monitorOne.send(JSON.stringify({channelId:'channel-bravo',speakerId:'uid-1-3'}));await sleep(30);
 const hostile=new WebSocket(`ws://127.0.0.1:${port}/monitor`,{origin:'http://evil.invalid'});await new Promise((r,j)=>{hostile.on('error',r);hostile.on('open',()=>j(new Error('cross-origin accepted')));});
 const settings=await req('/api/desktop/settings');assert.equal(settings.b.runtime,runtime);
 const sender=dgram.createSocket('udp4');t.after(()=>sender.close());const send=b=>new Promise((resolve,reject)=>sender.send(b,udp,'127.0.0.1',e=>e?reject(e):resolve()));
 for(let ch=0;ch<2;ch++){
  const channelId=ch?'channel-bravo':'channel-alpha';await send(Buffer.from('TSVJ'+JSON.stringify({type:'binding',connectionHandlerId:String(ch+1),channelId,active:true})));
  for(let player=1;player<=5;player++)await send(Buffer.from('TSVJ'+JSON.stringify({type:'speaker',connectionHandlerId:String(ch+1),clientId:player,channelId,stableId:`uid-${ch}-${player}`,name:`player-${ch}-${player}`})));
 }
 let sequence=0n;
 for(let f=0;f<25;f++){
  for(let ch=0;ch<2;ch++)for(let player=1;player<=5;player++){
   const b=Buffer.alloc(88+960*2);b.write('TSVB');b.writeUInt16LE(1,4);b.writeUInt16LE(1,6);b.writeUInt16LE(88,8);b.writeBigUInt64LE(++sequence,12);b.writeBigUInt64LE(BigInt(ch+1),20);b.writeUInt16LE(player,28);b.writeUInt16LE(1,30);b.writeUInt32LE(48000,32);b.writeUInt32LE(960,36);b.writeBigUInt64LE(BigInt(f*960),40);b.writeUInt32LE(1920,48);b.writeUInt32LE(1234,52);b.write(ch?'channel-bravo':'channel-alpha',56);
   for(let i=0;i<960;i++)b.writeInt16LE(Math.round(5000*Math.sin(i*.1+player)),88+i*2);await send(b);
  }await sleep(20);
 }
 await until(()=>allFrames.length===125&&oneFrames.length===25);
 assert.equal(new Set(allFrames.map(f=>f.speakerId)).size,5);assert.ok(allFrames.every(f=>f.speakerId.startsWith('uid-0-')));assert.ok(oneFrames.every(f=>f.speakerId==='uid-1-3'&&Buffer.from(f.pcm,'base64').length===1920));monitorAll.close();monitorOne.close();
 await until(async()=>{const {b}=await req('/api/state');return b.asr.queued===10;});
 const queuedStop=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await queuedStop;launch(true);await until(async()=>{const {r}=await req('/healthz');return r.ok;});
 const ready=await until(async()=>{const {b}=await req('/api/state');return b.asr.completed===10?b:null;},15000);assert.equal(ready.capture.tracks.length,10);assert.equal(ready.capture.dropped,0);assert.ok(requests>=11);
 let result=await req('/api/finalize',{});assert.equal(result.r.status,200,JSON.stringify(result.b));
 const {b:state}=await req('/api/state');assert.equal(state.channels[0].utterances.length,5);assert.equal(state.channels[1].utterances.length,5);
 for(const channel of state.channels){assert.ok(channel.segments.every(s=>s.audioReady));const s=channel.segments[0];assert.ok(s.audioUrl.startsWith('/clips/'));const wave=await fetch(`http://127.0.0.1:${port}${s.audioUrl}`);const bytes=Buffer.from(await wave.arrayBuffer());assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.ok(bytes.subarray(44).some(v=>v!==0));const range=await fetch(`http://127.0.0.1:${port}${s.audioUrl}`,{headers:{Range:'bytes=0-43'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,44);}
 const s=state.channels[0].segments[0];assert.equal((await req('/api/play',{channelId:'channel-alpha',segmentId:s.id})).r.status,409);
 await req('/api/obs/heartbeat',{clientId:'test-obs'});assert.equal((await req('/api/play',{channelId:'channel-alpha',segmentId:s.id})).r.status,409);await req('/api/obs/bind',{outputId:'program'});const {b:play}=await req('/api/play',{channelId:'channel-alpha',segmentId:s.id});assert.equal(play.status,'loading');
 await req('/api/obs/ack',{clientId:'wrong',playbackId:play.id,status:'started'});assert.equal((await req('/api/state')).b.playback.status,'loading');
 await req('/api/obs/ack',{clientId:'test-obs',playbackId:play.id,status:'started'});assert.equal((await req('/api/state')).b.playback.status,'playing');
 await req('/api/obs/ack',{clientId:'test-obs',playbackId:play.id,status:'ended'});assert.equal((await req('/api/state')).b.playback,null);
 const played=(await req('/api/state')).b.channels[0].segments[0];assert.equal(played.playCount,1);assert.equal(played.reviewState,'played');
 const edit=await req('/api/segment/update',{channelId:'channel-alpha',segmentId:s.id,trimStartMs:0,trimEndMs:200,title:'人工修剪',category:'morale',reviewState:'favorite'});assert.equal(edit.r.status,200,JSON.stringify(edit.b));assert.equal(edit.b.segment.audioDurationMs,200);assert.equal(edit.b.segment.humanReviewed,true);
 assert.equal((await req('/api/segment/update',{channelId:'channel-alpha',segmentId:s.id,trimStartMs:0,trimEndMs:999999})).r.status,400);

 // Delay is measured from the selected audio start, not the button press.
 const selection={channelId:'channel-alpha',segmentId:s.id};
 assert.equal((await req('/api/settings/director',{directorDelaySeconds:-1})).r.status,400);
 assert.equal((await req('/api/settings/director',{directorDelaySeconds:'20'})).r.status,400);
 const probe=(await req('/api/play',selection)).b;
 assert.equal(probe.status,'loading');assert.equal(probe.sourceStartedAt,play.sourceStartedAt-s.startMs);
 await req('/api/stop',{});
 const schedule=async(wait)=>{await req('/api/obs/heartbeat',{clientId:'test-obs'});await req('/api/settings/director',{directorDelaySeconds:(Date.now()-probe.sourceStartedAt+wait)/1000});return (await req('/api/play',selection)).b;};
 const pending=await schedule(800);assert.equal(pending.status,'scheduled');assert.equal(pending.issuedAt,null);
 assert.equal((await req('/api/play',selection)).r.status,409);
 await req('/api/obs/ack',{clientId:'test-obs',playbackId:pending.id,status:'started'});
 assert.equal((await req('/api/state')).b.playback.status,'scheduled');
 await req('/api/settings/director',{directorDelaySeconds:0});
 assert.equal((await req('/api/state')).b.playback.scheduledAt,pending.scheduledAt);
 await sleep(900);const dispatched=(await req('/api/state')).b.playback;
 assert.equal(dispatched.status,'loading');assert.ok(dispatched.issuedAt>=pending.scheduledAt);
 await req('/api/stop',{});
 await schedule(300);await req('/api/stop',{});await sleep(400);assert.equal((await req('/api/state')).b.playback,null);
 await req('/api/settings/director',{directorDelaySeconds:0.01});assert.equal((await req('/api/play',selection)).b.status,'loading');await req('/api/stop',{});
 const blocked=await schedule(300);
 await req('/api/obs/heartbeat',{clientId:'duplicate-obs'});assert.equal((await req('/api/play',{channelId:'channel-alpha',segmentId:s.id})).r.status,409);
 await sleep(400);assert.equal((await req('/api/state')).b.playback,null);assert.equal((await req('/api/state')).b.lastPlayback.status,'error');
 await req('/api/settings/director',{directorDelaySeconds:20});
 const stopped=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await stopped;launch();await until(async()=>{const {r}=await req('/healthz');return r.ok;});const restored=(await req('/api/state')).b;assert.equal(restored.config.directorDelaySeconds,20);assert.equal(restored.sessionId,state.sessionId);assert.equal(restored.channels[0].segments[0].id,s.id);assert.equal(restored.channels[0].utterances.length,5);assert.equal(restored.obs.selected,'program');assert.equal(restored.channels[0].segments[0].title,'人工修剪');assert.equal(restored.channels[0].segments[0].reviewState,'favorite');
 const old=restored.sessionId;const reset=await req('/api/reset',{});assert.notEqual(reset.b.sessionId,old);assert.equal((await req('/api/utterances',{sessionId:old,channelId:'channel-alpha',id:'stale',speakerId:'a',speakerName:'a',text:'stale',startMs:0,endMs:100})).r.status,400);
 assert.ok(!logs.includes('Unhandled'));const end=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await end;
});
