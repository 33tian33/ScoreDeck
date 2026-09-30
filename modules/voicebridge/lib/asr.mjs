import { mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson } from './atomic-json.mjs';
import { RATE, wav } from './audio.mjs';
import {openAliyunStream} from './aliyun-stream.mjs';
import { SpeechGate } from './speech-gate.mjs';
import { transcribeAliyun } from './aliyun-asr.mjs';

export async function transcribe(wave, options = {}) {
  const provider = options.provider || 'aliyun';
  if (provider === 'aliyun') return transcribeAliyun(wave, options);
  if (provider === 'openai') return transcribeOpenAI(wave, options);
  throw new Error('不支持的 ASR_PROVIDER：' + provider);
}

async function transcribeOpenAI(wave,{apiKey,baseUrl='https://api.openai.com/v1',model='whisper-1',language='zh',timeoutMs=30000,fetchImpl=fetch}={}) {
  if(!apiKey)throw new Error('未配置 OPENAI_API_KEY');
  const form=new FormData();form.append('file',new Blob([wave],{type:'audio/wav'}),'speech.wav');form.append('model',model);form.append('language',language);form.append('response_format','verbose_json');form.append('timestamp_granularities[]','segment');
  const response=await fetchImpl(`${baseUrl.replace(/\/$/,'')}/audio/transcriptions`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`},body:form,signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok){const error=new Error(`ASR HTTP ${response.status}`);error.retryable=response.status===429||response.status>=500;throw error;}
  const result=await response.json();if(!Array.isArray(result.segments))throw new Error('ASR 未返回带时间码的 segments；请使用 whisper-1 兼容接口');
  return result.segments.filter(s=>typeof s.text==='string'&&s.text.trim()&&Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start&&(s.no_speech_prob??0)<0.85);
}
export class AsrPipeline {
  constructor(store,onUtterances,options={}) {
    this.store=store;this.onUtterances=onUtterances;this.options=options;this.live=new Map();this.partials=new Map();this.lastChannel=null;this.lastLatencyMs=0;this.gate=new SpeechGate({...options,onProgress:c=>this.progress(c)});this.active=this.gate.active;this.jobs=[];this.creating=new Set();this.running=0;this.closed=false;this.completed=0;this.skipped=0;this.lastError=null;this.spool=join(store.root,'asr');
    this.timer=setInterval(()=>{this.flushIdle();this.pump();},200);this.timer.unref();
  }
  async recover() {
    await mkdir(this.spool,{recursive:true});
    for(const file of await readdir(this.spool)) {
      if(!file.endsWith('.json'))continue;
      let j;try{j=JSON.parse(await readFile(join(this.spool,file),'utf8'));}catch{this.lastError='跳过损坏的识别任务：'+file;continue;}
      if(j.sessionId!==this.store.sessionId)continue;
      if(j.status==='done') {if(j.utterances?.length)await this.onUtterances(j.utterances);continue;}
      j.status=j.status==='failed'?'failed':'queued';j.attempts=0;j.nextAt=0;this.jobs.push(j);
    }
    this.jobs.sort((a,b)=>a.startMs-b.startMs);this.pump();
  }
  progress(c){
    if(this.closed||!this.options.apiKey||this.options.provider!=='aliyun'||this.options.streaming===false)return;
    const key=`${c.trackId}:${c.startSample}`;let live=this.live.get(key);
    if(!live){if(this.live.size+this.running>=(this.options.streamConcurrency??10))return;
      try{const stream=openAliyunStream({...this.options,onPartial:text=>{this.partials.set(key,{speakerName:c.speakerName,channelId:c.channelId,text});this.options.onChange?.();}});
        live={stream,end:c.startSample,queue:Promise.resolve(),outcome:stream.result.then(result=>({result}),error=>({error}))};this.live.set(key,live);
      }catch(e){this.lastError=e.message;return;}
    }
    if(c.lastVoiceEnd-live.end>=4800)this.sendLive(live,c,c.lastVoiceEnd);
  }
  sendLive(live,c,end){if(end<=live.end)return;const start=live.end;live.end=end;
    live.queue=live.queue.then(async()=>{const pcm=await this.store.readTrackSamples(c.trackId,start,end);live.stream.write(pcm);}).catch(e=>{live.error=e;live.stream.abort();});
  }
  async finishLive(live,c,job){try{job.attempts++;await this.save(job);this.sendLive(live,c,c.endSample);await live.queue;live.stream.finish();const outcome=await live.outcome;if(live.error||outcome.error)throw live.error||outcome.error;await this.completeJob(job,outcome.result);}catch(e){await this.failJob(job,e);}}
  ingest(frame) {if(this.closed||!frame)return;for(const span of this.gate.ingest(frame))this.enqueue(span);}
  flushIdle(){const before=this.active.size;for(const span of this.gate.flushIdle())this.enqueue(span);if(this.active.size!==before)this.options.onChange?.();}
  enqueue(c){
    const task=this.create(c).catch(e=>{this.lastError=e.message;const key=`${c.trackId}:${c.startSample}`;this.live.get(key)?.stream.abort();this.live.delete(key);});task.span=c;this.creating.add(task);task.finally(()=>this.creating.delete(task));
  }
  async create(c){const id=randomUUID(), startMs=c.startSample/RATE*1000,endMs=c.endSample/RATE*1000;
    const job={id,sessionId:this.store.sessionId,channelId:c.channelId,trackId:c.trackId,speakerId:c.speakerId,speakerName:c.speakerName,startMs,endMs,startSample:c.startSample,endSample:c.endSample,timebase:'session-48000-contiguous',attempts:0,status:'queued',createdAt:Date.now(),nextAt:0};
    const pcm=this.store.readTrackSamples?await this.store.readTrackSamples(c.trackId,c.startSample,c.endSample):await this.store.readTrack(c.trackId,startMs,endMs);await mkdir(this.spool,{recursive:true});await writeFile(join(this.spool,`${id}.wav`),wav(pcm));await this.store.saveManifest();await this.save(job);this.jobs.push(job);const key=`${c.trackId}:${c.startSample}`,live=this.live.get(key);
    if(live){job.status='running';this.running++;this.finishLive(live,c,job).finally(()=>{this.live.delete(key);this.partials.delete(key);this.running--;this.pump();this.options.onChange?.();});}else this.pump();
  }
  async save(j){await atomicJson(join(this.spool,`${j.id}.json`),j);}
  pump(){if(this.closed||!this.options.apiKey)return;
    while(this.jobs.filter(j=>j.status==='running').length<(this.options.concurrency??4)){const ready=this.jobs.filter(j=>j.status==='queued'&&j.nextAt<=Date.now());const job=ready.find(j=>j.channelId!==this.lastChannel)||ready[0];if(!job)break;this.lastChannel=job.channelId;job.status='running';this.running++;this.run(job).finally(()=>{this.running--;this.pump();});}
  }
  async run(job){try{
    job.attempts++;await this.save(job);const result=await transcribe(await readFile(join(this.spool,`${job.id}.wav`)),this.options);await this.completeJob(job,result);
  }catch(e){await this.failJob(job,e);}}
  async completeJob(job,result){
    const items=result.map((s,i)=>({id:`asr_${job.id}_${i}`,sessionId:job.sessionId,channelId:job.channelId,speakerId:job.speakerId,speakerName:job.speakerName,text:s.text.trim(),startMs:Math.max(job.startMs,Math.min(job.endMs,job.startMs+s.start*1000)),endMs:Math.min(job.endMs,job.startMs+s.end*1000),stable:true,revision:1})).filter(x=>x.endMs>x.startMs);
    job.status='done';job.utterances=items;await this.save(job);if(!this.closed)await this.onUtterances(items);this.completed++;this.jobs=this.jobs.filter(j=>j!==job);await rm(join(this.spool,`${job.id}.wav`),{force:true});

    this.lastLatencyMs=Math.max(0,Date.now()-job.createdAt);this.options.onChange?.();
  }
  async failJob(job,e){job.error=e.message;this.lastError=e.message;job.status=e.retryable!==false&&job.attempts<3?'queued':'failed';job.nextAt=Date.now()+1000*2**job.attempts;await this.save(job).catch(()=>{});this.options.onChange?.();}
  async retry(){for(const j of this.jobs)if(j.status==='failed'){j.status='queued';j.attempts=0;j.nextAt=0;j.background=true;await this.save(j);}this.lastError=null;this.pump();this.options.onChange?.();}
  watermark(channelId){return Math.min(Infinity,...[...this.creating].filter(t=>t.span.channelId===channelId).map(t=>t.span.startSample/RATE*1000),...[...this.active.values()].filter(j=>j.channelId===channelId).map(j=>j.startSample/RATE*1000),...this.jobs.filter(j=>j.channelId===channelId && !j.background && ['queued','running'].includes(j.status)).map(j=>j.startMs));}
  hasPending(channelId){return [...this.active.values()].some(j=>j.channelId===channelId)||[...this.creating].some(t=>t.span.channelId===channelId)||this.jobs.some(j=>j.channelId===channelId&&!j.background&&['queued','running'].includes(j.status));}
  status(){return {streaming:this.options.streaming!==false&&this.options.provider==='aliyun',liveStreams:this.live.size,partials:[...this.partials.values()],lastLatencyMs:this.lastLatencyMs,vad:this.gate.status(),enabled:!!this.options.apiKey,provider:this.options.provider||'aliyun',model:this.options.model||'paraformer-realtime-v2',running:this.running,queued:this.jobs.filter(j=>j.status==='queued').length,failed:this.jobs.filter(j=>j.status==='failed').length,completed:this.completed,skipped:this.skipped,lastError:this.lastError,backlogSeconds:this.jobs.some(j=>['queued','running'].includes(j.status))?Math.round((Date.now()-Math.min(...this.jobs.filter(j=>['queued','running'].includes(j.status)).map(j=>j.createdAt)))/1000):0};}
  async flush(){for(const span of this.gate.flush())this.enqueue(span);await Promise.all([...this.creating]);}
  async close(){await this.flush();this.closed=true;clearInterval(this.timer);for(const live of this.live.values())live.stream.abort();while(this.running)await new Promise(r=>setTimeout(r,30));}
}
