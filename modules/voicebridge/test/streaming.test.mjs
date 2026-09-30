import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocketServer} from '../lib/vendor/ws/wrapper.mjs';
import {AsrPipeline} from '../lib/asr.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<250;i++){if(fn())return;await wait(20);}throw new Error('condition timed out');}
function frame(ms,id){const pcm=Buffer.alloc(1920);for(let i=0;i<960;i++)pcm.writeInt16LE(Math.round(5000*Math.sin(i*.1)),i*2);return {trackId:id,channelId:id==='p0'?'alpha':'bravo',speakerId:id,speakerName:id,startSample:ms*48,endSample:(ms+20)*48,pcm};}
test('ten live tracks upload before speech ends, preserve time, and recover a failed socket',async t=>{
 const root=await mkdtemp(join(tmpdir(),'vb-stream-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let binaryBytes=0,connections=0,finishes=0;const server=http.createServer(),wss=new WebSocketServer({server});
 wss.on('connection',ws=>{const index=connections++;let id,bytes=0;ws.on('message',(data,binary)=>{if(binary){bytes+=data.length;binaryBytes+=data.length;return;}const m=JSON.parse(data);id=m.header.task_id;
  if(m.header.action==='run-task'){assert.equal(m.payload.parameters.vocabulary_id,'vocab-test');if(index===0){ws.close();return;}ws.send(JSON.stringify({header:{task_id:id,event:'task-started'}}));ws.send(JSON.stringify({header:{task_id:id,event:'result-generated'},payload:{output:{sentence:{sentence_end:false,text:'临时加油'}}}}));}
  else {assert.ok(bytes>0);finishes++;ws.send(JSON.stringify({header:{task_id:id,event:'result-generated'},payload:{output:{sentence:{sentence_end:true,text:'加油',begin_time:200,end_time:300}}}}));ws.send(JSON.stringify({header:{task_id:id,event:'task-finished'}}));}
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{for(const ws of wss.clients)ws.terminate();wss.close();server.close();});
 const utterances=[],store={root,sessionId:'test',saveManifest:async()=>{},readTrackSamples:async(id,start,end)=>Buffer.alloc((end-start)*2,1)};
 const p=new AsrPipeline(store,async items=>utterances.push(...items),{provider:'aliyun',apiKey:'mock',wsUrl:`ws://127.0.0.1:${server.address().port}`,vocabularyId:'vocab-test',streamConcurrency:10});t.after(()=>p.close());
 for(let ms=10000;ms<10300;ms+=20){for(let i=0;i<10;i++)p.ingest(frame(ms,'p'+i));await wait(5);}
 await until(()=>binaryBytes>0&&connections===10);assert.equal(finishes,0,'audio sent before finish/flush');assert.ok(p.status().partials.length>0);
 await p.flush();await until(()=>utterances.length===9);const retry=p.jobs.find(j=>j.status==='queued');assert.ok(retry);retry.nextAt=0;p.pump();await until(()=>utterances.length===10);
 assert.equal(new Set(utterances.map(u=>u.speakerId)).size,10);assert.ok(utterances.every(u=>u.startMs===10000&&u.endMs===10100));assert.equal(connections,11);assert.equal(p.status().liveStreams,0);
});
test('failed tasks do not block channels; more than 200 tasks persist and recover',async t=>{
 const root=await mkdtemp(join(tmpdir(),'vb-spool-'));t.after(()=>rm(root,{recursive:true,force:true}));const store={root,sessionId:'test',saveManifest:async()=>{},readTrackSamples:async()=>Buffer.alloc(960)};
 const p=new AsrPipeline(store,async()=>{},{provider:'openai'});const span={trackId:'p',channelId:'alpha',speakerId:'p',speakerName:'P',startSample:0,endSample:480};
 for(let i=0;i<205;i++)p.enqueue({...span,startSample:i*480,endSample:(i+1)*480});await p.flush();assert.equal(p.jobs.length,205);p.jobs[0].status='failed';await p.save(p.jobs[0]);
 for(const j of p.jobs)j.status='failed';assert.equal(p.hasPending('alpha'),false);assert.equal(p.watermark('alpha'),Infinity);assert.equal(p.hasPending('bravo'),false);await p.close();
 const recovered=new AsrPipeline(store,async()=>{},{provider:'openai'});await recovered.recover();assert.equal(recovered.jobs.length,205);assert.equal(recovered.status().failed,1);await recovered.close();
});
