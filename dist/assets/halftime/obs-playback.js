(()=>{'use strict';
const params=new URLSearchParams(location.search);
const output=location.pathname==='/output/halftime-auto'&&params.get('obs')==='1'&&!params.has('preview');
const clientId=typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join(''),players=new Map();
let run=null,expected=0,pending=false,lastSignal=0,failed=false;
async function signal(action){
 if(!run||pending)return;
 pending=true;lastSignal=Date.now();const id=run.id;
 try{const result=await SDClient.request('/api/highlights/playback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,clientId,action})});if(action==='ready'&&result.accepted&&run?.id===id){run.status='playing';run.startedAt=result.startedAt;}}catch{}finally{pending=false;}
}
function prepare(snapshot){
 if(!output)return snapshot;
 let next=snapshot.obs?.run;
 // A poll started before the ready acknowledgement must not pause a playing clip.
 if(next?.id===run?.id&&run?.status==='playing'&&next?.status==='preparing')next={...next,status:run.status,startedAt:run.startedAt};
 if(next?.id!==run?.id){for(const p of players.values())p.video.pause();players.clear();failed=false;}
 run=next||null;
 if(!run)return snapshot;
 const s={...snapshot,...run.playback,mode:run.mode};
 expected=s.customLayout||s.mode==='full'?s.layouts[s.mode].elements.filter(e=>e.type==='replay').length:[s.config.left,s.config.right].filter(e=>e.type==='replay').length;
 s.config={...s.config,clock:snapshot.config.clock,media:{status:run.status==='playing'?'running':'paused',offsetMs:0,startAt:run.startedAt}};
 return s;
}
function replay(slot,key,speed){
 if(!output||!run)return false;
 const video=slot.video;
 let p=players.get(key);
 if(!p||p.video!==video){p={video,index:0,loaded:'',done:false};players.set(key,p);}
 const clip=run.items[p.index];
 if(!clip){video.pause();return true;}
 video.loop=false;video.playbackRate=speed;
 if(p.loaded!==clip.id){p.loaded=clip.id;video.src='/api/halftime/replay/media/'+encodeURIComponent(clip.id)+'?mode='+run.mode;video.load();}
 video.style.visibility='visible';if(slot.empty)slot.empty.hidden=true;
 if(run.status!=='playing'){video.pause();return true;}
 if(video.error){failed=true;return true;}
 if(video.ended){
  if(p.index+1<run.items.length){p.index++;p.loaded='';}
  else p.done=true;
 }else if(!p.done&&video.paused)video.play().catch(()=>{failed=true;});
 return true;
}
setInterval(()=>{
 if(!output||!run||pending||Date.now()-lastSignal<1000)return;
 const all=players.size===expected&&expected>0;
 if(run.status==='preparing'&&run.ready&&all&&[...players.values()].every(p=>p.video.readyState>=2&&!p.video.error))void signal('ready');
 else if(run.status==='playing')void signal(failed?'error':all&&[...players.values()].every(p=>p.done)?'ended':'heartbeat');
},250);
window.SDObsPlayback={prepare,replay};
})();
