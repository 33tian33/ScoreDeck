import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolvePublic} from '../lib/static.mjs';
import {fallbackSegments} from '../lib/segmenter.mjs';
import {ChannelEngine} from '../lib/channel-engine.mjs';
import {CaptureStore} from '../lib/capture-store.mjs';
import {transcribe} from '../lib/asr.mjs';
import {wav} from '../lib/audio.mjs';
test('Windows resources allowed; sibling traversal denied',()=>{
 assert.equal(resolvePublic('G:\\Project\\public','app.js',path.win32),'G:\\Project\\public\\app.js');
 assert.equal(resolvePublic('G:\\Project\\public','..\\private\\key',path.win32),null);
 assert.equal(resolvePublic('/app/public','../public-secret/key'),null);
});
test('overlapping speakers preserve longest end and avoid false silence boundary',()=>{
 const s=fallbackSegments([{id:'a',speakerName:'A',text:'a',startMs:0,endMs:8000},{id:'b',speakerName:'B',text:'b',startMs:1000,endMs:2000},{id:'c',speakerName:'C',text:'c',startMs:5000,endMs:6000}],{final:true});
 assert.equal(s.length,1);assert.equal(s[0].endMs,8000);
});
test('stable correction replaces interim; committed segment ID remains immutable',async()=>{
 const c={id:'alpha',utterances:[],segments:[]};const e=new ChannelEngine(c,async()=>({audioUrl:'/clip',audioDurationMs:1000}));
 const u={id:'1',speakerName:'A',text:'interim',startMs:0,endMs:1000,stable:false};await e.add([u]);assert.equal(c.segments.length,0);
 await e.add([{...u,text:'final',stable:true,revision:1}]);await e.analyze(true);const id=c.segments[0].id;
 await e.add([{...u,id:'2',startMs:4000,endMs:5000,stable:true}]);assert.equal(c.segments[0].id,id);assert.equal(c.utterances[0].text,'final');
});
test('stale asynchronous model response cannot overwrite a newer utterance revision',async()=>{
 let release;const wait=new Promise(r=>release=r);let entered;const started=new Promise(r=>entered=r);
 const c={id:'a',utterances:[],segments:[]};const e=new ChannelEngine(c,async()=>({audioUrl:'/clip'}),{provider:'openai',apiKey:'mock',fetchImpl:async()=>{entered();await wait;return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({segments:[{start_utterance_id:'u',end_utterance_id:'u',title:'old'}]})}}]})};}});
 await e.add([{id:'u',speakerName:'A',text:'first',startMs:0,endMs:1000,stable:true}]);const first=e.analyze(true);await started;
 const next=e.add([{id:'u',speakerName:'A',text:'second',startMs:0,endMs:2000,stable:true,revision:2}]);release();await Promise.all([first,next]);assert.equal(c.segments[0].endMs,2000);assert.notEqual(c.segments[0].title,'old');
});
test('ASR uses multipart WAV, segment timestamps, and rejects timestamps-free response',async()=>{
 let called=false;const result=await transcribe(wav(Buffer.alloc(960)),{provider:'openai',apiKey:'mock',fetchImpl:async(url,init)=>{called=true;assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');assert.equal(init.body.get('model'),'whisper-1');assert.equal(init.body.get('response_format'),'verbose_json');assert.equal(init.body.get('timestamp_granularities[]'),'segment');return {ok:true,json:async()=>({segments:[{text:'进攻 A 点',start:0,end:.01}]})};}});assert.ok(called);assert.equal(result[0].text,'进攻 A 点');
 await assert.rejects(transcribe(Buffer.alloc(1),{provider:'openai',apiKey:'mock',fetchImpl:async()=>({ok:true,json:async()=>({text:'no timestamps'})})}),/segments/);
});
test('capture isolates sessions, speakers, channels, and limits mixed peaks',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'v04-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const a=new CaptureStore(root);await a.init();const pcm=Buffer.alloc(960*2);for(let i=0;i<960;i++)pcm.writeInt16LE(24000,i*2);
 const frame={connectionHandlerId:1n,sourceId:'one',channelId:'channel-alpha',clientId:1,sequence:1n,sampleRate:48000,channels:1,sampleCount:960,ptsSamples:0n,pcm};
 a.ingest(frame,{stableId:'A'});a.ingest({...frame,clientId:2,sequence:2n},{stableId:'B'});a.ingest({...frame,channelId:'channel-bravo',clientId:3,sequence:3n,pcm:Buffer.alloc(1920)},{stableId:'C'});
 const alpha=await a.mix('channel-alpha',0,50),bravo=await a.mix('channel-bravo',0,50);assert.ok(alpha.subarray(44).some(b=>b!==0));assert.ok(bravo.subarray(44).every(b=>b===0));
 for(let i=44;i<alpha.length;i+=2)assert.ok(Math.abs(alpha.readInt16LE(i))<=30000);
 const b=new CaptureStore(root);await b.init();assert.notEqual(a.root,b.root);await a.close();await b.close();assert.equal(a.pending.size,0);
});
test('unrecognized earlier speech prevents premature segment commitment',async()=>{
 const c={id:'alpha',utterances:[],segments:[]};let watermark=500;
 const e=new ChannelEngine(c,async()=>({audioUrl:'/clip'}),{commitBefore:()=>watermark});
 await e.add([{id:'u',speakerName:'A',text:'a',startMs:0,endMs:1000,stable:true}]);await e.analyze(true);assert.equal(c.segments[0].status,'open');
 watermark=Infinity;await e.analyze(true);assert.equal(c.segments[0].status,'committed');
});
test('PCM storage budget stops additional capture without overwriting existing bytes',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'v04-quota-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=new CaptureStore(root,{maxBytes:1});await store.init();
 const result=store.ingest({pcm:Buffer.alloc(4),channelId:'a',connectionHandlerId:1n,clientId:1,sequence:1n,sampleRate:48000,channels:1,sampleCount:2,ptsSamples:0n});assert.equal(result,null);assert.equal(store.dropped,1);assert.equal(store.bytes,0);await store.close();
});
