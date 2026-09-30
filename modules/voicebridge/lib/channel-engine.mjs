import { randomUUID } from 'node:crypto';
import { segmentConversation, fallbackSegments } from './segmenter.mjs';
export class ChannelEngine {
  constructor(channel,makeClip,options={}){this.channel=channel;this.makeClip=makeClip;this.options=options;this.version=0;this.queue=Promise.resolve();this.closed=false;this.lastInputAt=0;}
  add(items){for(const item of items){const old=this.channel.utterances.findIndex(u=>u.id===item.id);if(old>=0){const previous=this.channel.utterances[old];if(this.channel.segments.some(s=>s.status==='committed'&&s.utteranceIds.includes(item.id)))continue;if((item.revision??0)<(previous.revision??0)||previous.stable&&!item.stable)continue;this.channel.utterances[old]=item;}else this.channel.utterances.push(item);}
    this.channel.utterances.sort((a,b)=>a.startMs-b.startMs);this.version++;this.lastInputAt=Date.now();return this.analyze(false);
  }
  analyze(final=false){const task=this.queue.catch(()=>{}).then(()=>this.process(final));this.queue=task;return task;}
  async process(final){if(this.closed)return;const version=this.version;
    const committed=this.channel.segments.filter(s=>s.status==='committed'),used=new Set(committed.flatMap(s=>s.utteranceIds));
    const tail=this.channel.utterances.filter(u=>u.stable&&!used.has(u.id));if(!tail.length)return;
    // Analyze only a bounded oldest window. The next pass processes the remainder.
    const window=tail.slice(0,60);const force=final||tail.length>60;
    const groups=fallbackSegments(window,{final:force});
    const useAI=force||groups.length>1;
    const context=this.channel.utterances.filter(u=>used.has(u.id)&&u.endMs>=window[0].startMs-15000).slice(-40);
    const result=await segmentConversation(window,{...this.options,context,apiKey:useAI?this.options.apiKey:'',final:force});
    if(this.closed||version!==this.version)return;
    const next=[];
    for(const s of result.segments){const segment={...s,id:`seg_${s.startUtteranceId.replace(/[^A-Za-z0-9_-]/g,'_')}_${randomUUID().slice(0,8)}`,channelId:this.channel.id,channelName:this.channel.name,channelColor:this.channel.color};
      if(s.status==='committed' && s.endMs >= (this.options.commitBefore?.() ?? Infinity)) segment.status='open';
      if(segment.status==='committed'&&segment.eligible){try{Object.assign(segment,await this.makeClip(segment));segment.audioReady=true;}catch(e){segment.audioReady=false;segment.audioError=e.message;}}
      next.push(segment);
    }
    if(this.closed||version!==this.version)return;
    this.channel.segments=[...committed,...next];this.channel.analysis={source:result.source,latencyMs:result.latencyMs,warning:result.warning,updatedAt:Date.now()};
    this.options.onChange?.();if(tail.length>60 && next.some(s=>s.status==='committed'))return this.process(final);
  }
  async retryClips(){for(const s of this.channel.segments)if(s.status==='committed'&&s.eligible&&!s.audioReady){try{Object.assign(s,await this.makeClip(s));s.audioReady=true;delete s.audioError;}catch(e){s.audioError=e.message;}}}
  close(){this.closed=true;this.version++;}
}
