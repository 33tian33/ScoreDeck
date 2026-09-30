import {RATE} from './audio.mjs';
const samples=ms=>Math.round(ms*RATE/1000);
// All boundaries are absolute session samples. Never compact or concatenate gaps.
export class SpeechGate {
 constructor({threshold=.008,minSpeechMs=120,preRollMs=200,silenceMs=600,postRollMs=100,chunkSeconds=4,now=Date.now,onProgress=()=>{}}={}){
  this.onProgress=onProgress;this.threshold=threshold;this.minSpeech=samples(minSpeechMs);this.preRoll=samples(preRollMs);this.silence=samples(silenceMs);this.postRoll=samples(postRollMs);this.chunk=samples(chunkSeconds*1000);this.now=now;this.active=new Map();this.tracks=new Map();this.receivedSamples=0;this.selectedSamples=0;this.rejectedBursts=0;
 }
 track(frame){let t=this.tracks.get(frame.trackId);if(!t){t={trackId:frame.trackId,channelId:frame.channelId,speakerId:frame.speakerId,speakerName:frame.speakerName,noise:this.threshold/4,lastEnd:0,emittedEnd:0,continuation:false,lastAt:0,level:0};this.tracks.set(frame.trackId,t);}t.speakerName=frame.speakerName;return t;}
 ingest(frame){const out=[],t=this.track(frame);const now=this.now();t.lastAt=now;
  for(let offset=0;offset<frame.pcm.length/2;offset+=960){
   const count=Math.min(960,frame.pcm.length/2-offset),start=frame.startSample+offset,end=start+count;
   if(end<=t.lastEnd)continue;
   let c=this.active.get(frame.trackId);
   if(c&&start-c.lastVoiceEnd>=this.silence){this.finish(frame.trackId,out);c=null;}
   if(c&&!c.confirmed&&start-c.lastVoiceEnd>=samples(60)){this.finish(frame.trackId,out);c=null;}
   let sum=0,squared=0;for(let i=offset;i<offset+count;i++){const v=frame.pcm.readInt16LE(i*2)/32768;sum+=v;squared+=v*v;}
   const rms=Math.sqrt(Math.max(0,squared/count-(sum/count)**2));t.level=rms;
   const continuation=t.continuation&&start-t.emittedEnd<this.silence;
   const threshold=Math.max(this.threshold,t.noise*2.5);
   const voiced=rms>=(c?.confirmed||continuation?threshold*.65:threshold);
   this.receivedSamples+=count;t.lastEnd=Math.max(t.lastEnd,end);
   if(!voiced){if(!c)t.noise=.98*t.noise+.02*Math.min(rms,this.threshold);continue;}
   if(!c){c={trackId:frame.trackId,channelId:frame.channelId,speakerId:frame.speakerId,speakerName:frame.speakerName,startSample:Math.max(0,start-this.preRoll,t.emittedEnd),endSample:end,lastVoiceEnd:end,lastAt:now,voicedSamples:0,confirmed:continuation};this.active.set(frame.trackId,c);}
   c.voicedSamples+=count;c.confirmed ||= c.voicedSamples>=this.minSpeech;c.endSample=end;c.lastVoiceEnd=end;c.lastAt=now;
   if(c.confirmed)this.onProgress({...c});
   if(c.confirmed&&end-c.startSample>=this.chunk){this.finish(frame.trackId,out,true);}
  }
  return out;
 }
 finish(id,out=[],continuation=false){const c=this.active.get(id);if(!c)return out;this.active.delete(id);const t=this.tracks.get(id);
  if(!c.confirmed){this.rejectedBursts++;t.continuation=false;return out;}
  const end=continuation?c.lastVoiceEnd:Math.min(t.lastEnd,c.lastVoiceEnd+this.postRoll);
  const span={trackId:c.trackId,channelId:c.channelId,speakerId:c.speakerId,speakerName:c.speakerName,startSample:c.startSample,endSample:end};
  if(end>span.startSample){out.push(span);this.selectedSamples+=end-span.startSample;t.emittedEnd=end;}
  t.continuation=continuation;return out;
 }
 flushIdle(){const out=[];for(const [id,c]of this.active)if(this.now()-c.lastAt>=this.silence/RATE*1000)this.finish(id,out);return out;}
 flush(){const out=[];for(const id of [...this.active.keys()])this.finish(id,out);return out;}
 status(){const now=this.now();return {receivedSeconds:this.receivedSamples/RATE,selectedSeconds:this.selectedSamples/RATE,rejectedBursts:this.rejectedBursts,tracks:[...this.tracks.values()].map(t=>{const c=this.active.get(t.trackId);return {trackId:t.trackId,channelId:t.channelId,speakerId:t.speakerId,speakerName:t.speakerName,state:c?.confirmed&&now-c.lastAt<this.silence/RATE*1000?'speaking':c?'checking':'silent',rms:t.level,lastAudioAt:t.lastAt,lastSample:t.lastEnd};})};}
}
