import { mkdir, open, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicJson } from './atomic-json.mjs';
import { RATE, mono48, wav } from './audio.mjs';
const CHUNK = RATE * 10;
export class CaptureStore {
  constructor(root, {sessionId = randomUUID(), maxBytes = 8 * 1024 ** 3} = {}) {
    this.sessionId=sessionId; this.root=join(root,sessionId); this.sources=new Map(); this.tracks=new Map(); this.origin=performance.now(); this.wallOrigin=Date.now();
    this.pending=new Set(); this.bytes=0; this.maxBytes=maxBytes; this.dropped=0; this.errors=[]; this.latestMs=0;
  }
  async init({resume=false}={}) {
    await mkdir(this.root,{recursive:true});
    if(resume){const saved=JSON.parse(await readFile(join(this.root,'session.json'),'utf8'));if(saved.sessionId!==this.sessionId)throw new Error('invalid_session_manifest');
      for(const t of saved.tracks||[])this.tracks.set(t.key,{...t,queue:Promise.resolve()});
      this.bytes=saved.bytes||0;this.latestMs=Math.max(0,...[...this.tracks.values()].map(t=>t.endSample/RATE*1000));this.wallOrigin=Number.isFinite(saved.wallOrigin)?saved.wallOrigin:Date.now()-this.latestMs-1000;this.origin=performance.now()-(Date.now()-this.wallOrigin);
    }
    await this.saveManifest();
  }
  async saveManifest() { await atomicJson(join(this.root,'session.json'),{sessionId:this.sessionId,wallOrigin:this.wallOrigin,bytes:this.bytes,format:'s16le',sampleRate:RATE,chunkSeconds:10,tracks:[...this.tracks.values()].map(({queue,...t})=>t)}); }
  ingest(frame,speaker) {
    if(this.bytes + frame.pcm.length > this.maxBytes || this.pending.size>=512) { this.dropped++; return null; }
    const sourceKey=frame.captureSourceId || frame.sourceId || `${frame.connectionHandlerId}:${frame.flags || 0}`;
    const rawMs=Number(frame.ptsSamples)*1000/frame.sampleRate;
    if(!Number.isFinite(rawMs)||rawMs<0||rawMs>365*86400000) throw new Error('invalid_pts');
    let source=this.sources.get(sourceKey);
    if(!source) { source={offset:performance.now()-this.origin-rawMs}; this.sources.set(sourceKey,source); }
    const startSample=Math.max(0,Math.round((rawMs+source.offset)*RATE/1000));
    const stableId=speaker?.stableId || `client-${frame.clientId}`;
    const key=[frame.channelId,sourceKey,frame.connectionHandlerId,frame.clientId,stableId].join(':');
    let t=this.tracks.get(key);
    if(!t) { t={id:createHash('sha256').update(key).digest('hex').slice(0,24),key,channelId:frame.channelId,speakerId:stableId,speakerName:speaker?.name || `TS ${frame.clientId}`,chunks:[],endSample:0,lastSequence:null,duplicates:0,queue:Promise.resolve()};this.tracks.set(key,t); }
    if(t.lastSequence!==null && frame.sequence<=BigInt(t.lastSequence)) {t.duplicates++;return null;}
    t.lastSequence=String(frame.sequence);
    const pcm=mono48(frame); if(this.bytes+pcm.length>this.maxBytes){this.dropped++;return null;} const endSample=startSample+pcm.length/2;
    t.endSample=Math.max(t.endSample,endSample);t.speakerName=speaker?.name || t.speakerName;this.latestMs=Math.max(this.latestMs,endSample/RATE*1000);this.bytes+=pcm.length;
    const job=t.queue.then(async()=>{
      const dir=join(this.root,t.id);await mkdir(dir,{recursive:true});
      for(let pos=0;pos<pcm.length/2;) { const abs=startSample+pos, chunk=Math.floor(abs/CHUNK), offset=abs%CHUNK, count=Math.min(pcm.length/2-pos,CHUNK-offset);
        const path=join(dir,`${chunk}.pcm`);let fd;try{fd=await open(path,'r+');}catch(e){if(e.code!=='ENOENT')throw e;fd=await open(path,'w+');}
        try {let done=0;while(done<count*2){const r=await fd.write(pcm,pos*2+done,count*2-done,offset*2+done);if(!r.bytesWritten)throw new Error('short_write');done+=r.bytesWritten;}}finally{await fd.close();}
        if(!t.chunks.includes(chunk))t.chunks.push(chunk);pos+=count;
      }
    });
    t.queue=job.catch(e=>{t.writeError=e.message;this.errors=[e.message,...this.errors].slice(0,10);});this.pending.add(t.queue);
    // Capture the promise itself: later frames replace t.queue.
    const pending=t.queue;pending.finally(()=>this.pending.delete(pending));
    return {trackId:t.id,channelId:t.channelId,speakerId:t.speakerId,speakerName:t.speakerName,startSample,endSample,pcm};
  }
  async readTrack(id,startMs,endMs) {
    return this.readTrackSamples(id,Math.max(0,Math.floor(startMs*RATE/1000)),Math.ceil(endMs*RATE/1000));
  }
  async readTrackSamples(id,start,end) {
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0)throw new Error('invalid_sample_range');
    const t=[...this.tracks.values()].find(x=>x.id===id);if(!t)throw new Error('track_not_found');await t.queue;if(t.writeError)throw new Error(t.writeError);
    if(end<=start || end-start>RATE*120)throw new Error('invalid_clip_duration');
    const out=Buffer.alloc((end-start)*2);
    for(let pos=start;pos<end;) {const chunk=Math.floor(pos/CHUNK),off=pos%CHUNK,count=Math.min(end-pos,CHUNK-off);
      try {const b=await readFile(join(this.root,t.id,`${chunk}.pcm`));b.copy(out,(pos-start)*2,Math.min(b.length,off*2),Math.min(b.length,(off+count)*2));}catch(e){if(e.code!=='ENOENT')throw e;}pos+=count;
    }return out;
  }
  async mix(channelId,startMs,endMs) {
    const tracks=[...this.tracks.values()].filter(t=>t.channelId===channelId);if(!tracks.length)throw new Error('no_real_audio');
    const n=Math.ceil(endMs*RATE/1000)-Math.max(0,Math.floor(startMs*RATE/1000));if(n<=0||n>RATE*120)throw new Error('invalid_clip_duration');
    const sum=new Float32Array(n);
    for(const t of tracks){const b=await this.readTrack(t.id,startMs,endMs);for(let i=0;i<n;i++)sum[i]+=b.readInt16LE(i*2);}
    let peak=1;for(const x of sum)peak=Math.max(peak,Math.abs(x));const gain=Math.min(1,30000/peak);const out=Buffer.alloc(n*2);
    for(let i=0;i<n;i++)out.writeInt16LE(Math.round(sum[i]*gain),i*2);return wav(out);
  }
  status(){return {sessionId:this.sessionId,bytes:this.bytes,pendingWrites:this.pending.size,dropped:this.dropped,errors:this.errors,latestMs:this.latestMs,tracks:[...this.tracks.values()].map(t=>({trackId:t.id,channelId:t.channelId,speakerId:t.speakerId,speakerName:t.speakerName,endMs:t.endSample/RATE*1000,duplicates:t.duplicates}))};}
  async close(){await Promise.all([...this.pending]);await this.saveManifest();}
}
