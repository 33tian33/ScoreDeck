import test from 'node:test';import assert from 'node:assert/strict';
import {SpeechGate} from '../lib/speech-gate.mjs';
import {AsrPipeline} from '../lib/asr.mjs';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
function frame(ms,amplitude=0,id='p1',duration=20){const n=duration*48,pcm=Buffer.alloc(n*2);for(let i=0;i<n;i++)pcm.writeInt16LE(Math.round(amplitude*Math.sin(i*.13)),i*2);return {trackId:id,channelId:'alpha',speakerId:id,speakerName:id,startSample:ms*48,endSample:(ms+duration)*48,pcm};}
function feed(g,start,end,amp,id='p1'){let out=[];for(let ms=start;ms<end;ms+=20)out.push(...g.ingest(frame(ms,amp,id)));return out;}
test('long silence, low noise and isolated clicks create zero ASR spans',()=>{let now=0;const g=new SpeechGate({now:()=>now});assert.deepEqual(feed(g,0,10000,0),[]);assert.deepEqual(feed(g,10000,12000,70),[]);g.ingest(frame(12000,20000));assert.deepEqual(feed(g,12020,14000,0),[]);now=1000;assert.deepEqual(g.flushIdle(),[]);assert.equal(g.selectedSamples,0);assert.equal(g.rejectedBursts,1);});
test('DC-offset-only audio is not speech',()=>{const g=new SpeechGate();const f=frame(0,0,'p1',500);for(let i=0;i<f.pcm.length;i+=2)f.pcm.writeInt16LE(10000,i);assert.deepEqual(g.ingest(f),[]);assert.deepEqual(g.flush(),[]);});
test('silence is never compressed: separated speech retains absolute session time',()=>{const g=new SpeechGate();feed(g,0,10000,0);feed(g,10000,10400,5000);const first=feed(g,10400,11200,0);feed(g,11200,30000,0);feed(g,30000,30400,5000);const second=feed(g,30400,31200,0);assert.equal(first.length,1);assert.equal(second.length,1);assert.equal(first[0].startSample,9800*48);assert.equal(first[0].endSample,10500*48);assert.equal(second[0].startSample,29800*48);assert.equal(second[0].endSample,30500*48);});
test('five overlapping players preserve identical absolute start and independent states',()=>{const g=new SpeechGate();for(let i=0;i<5;i++)feed(g,20000,20300,5000,'p'+i);assert.equal(g.status().tracks.filter(t=>t.state==='speaking').length,5);const spans=g.flush();assert.equal(spans.length,5);assert.ok(spans.every(s=>s.startSample===19800*48&&s.endSample===20300*48));assert.equal(new Set(spans.map(s=>s.speakerId)).size,5);});
test('continuous speech chunks have no overlaps and retain a short continuation tail',()=>{const g=new SpeechGate({chunkSeconds:1});const spans=feed(g,0,2100,5000);spans.push(...g.flush());assert.equal(spans.length,3);assert.equal(spans[2].endSample,2100*48);assert.equal(spans[0].endSample,spans[1].startSample);assert.equal(spans[1].endSample,spans[2].startSample);});
test('missing packets use wall-clock timeout without inventing captured tail audio',()=>{let now=0;const g=new SpeechGate({now:()=>now});feed(g,5000,5300,5000);now=700;const spans=g.flushIdle();assert.equal(spans.length,1);assert.equal(spans[0].endSample,5300*48);assert.equal(g.active.size,0);});
test('candidate watermark precedes confirmation to prevent premature commitment',()=>{const g=new SpeechGate();g.ingest(frame(10000,5000));assert.equal(g.active.get('p1').startSample,9800*48);assert.equal(g.active.get('p1').confirmed,false);});
test('pipeline uploads only accepted spans and maps API offsets onto session time',async t=>{
 const root=await mkdtemp(join(tmpdir(),'vad-pipeline-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0;const readRanges=[],utterances=[];
 const store={root,sessionId:'test',saveManifest:async()=>{},readTrack:async(id,start,end)=>{readRanges.push([start,end]);return Buffer.alloc(Math.round((end-start)*48)*2);}};
 const pipeline=new AsrPipeline(store,async u=>utterances.push(...u),{provider:'openai',apiKey:'mock',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({segments:[{text:'加油',start:.2,end:.4}]})};}});t.after(()=>pipeline.close());
 for(let ms=0;ms<10000;ms+=20)pipeline.ingest(frame(ms));pipeline.ingest(frame(10000,10000));for(let ms=10020;ms<12000;ms+=20)pipeline.ingest(frame(ms));await pipeline.flush();assert.equal(calls,0);assert.equal(readRanges.length,0);
 for(let ms=30000;ms<30400;ms+=20)pipeline.ingest(frame(ms,5000));for(let ms=30400;ms<31200;ms+=20)pipeline.ingest(frame(ms));await pipeline.flush();
 for(let i=0;i<200&&!utterances.length;i++)await new Promise(r=>setTimeout(r,10));assert.equal(calls,1);assert.deepEqual(readRanges,[[29800,30500]]);assert.equal(utterances[0].startMs,30000);assert.equal(utterances[0].endMs,30200);
});

import {CaptureStore} from '../lib/capture-store.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
test('sample-index reads preserve exact PCM bytes at fractional-millisecond offsets',async t=>{
 const root=await mkdtemp(join(tmpdir(),'sample-exact-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=new CaptureStore(root);await store.init();
 store.tracks.set('t',{id:'t',queue:Promise.resolve()});await mkdir(join(store.root,'t'));const pcm=Buffer.alloc(100*2);for(let i=0;i<100;i++)pcm.writeInt16LE(i,i*2);await writeFile(join(store.root,'t','0.pcm'),pcm);
 const result=await store.readTrackSamples('t',17,43);assert.equal(result.length,52);assert.equal(result.readInt16LE(0),17);assert.equal(result.readInt16LE(50),42);await assert.rejects(store.readTrackSamples('t',17.5,43),/invalid_sample/);
});
