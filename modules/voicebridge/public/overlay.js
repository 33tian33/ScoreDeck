const $=id=>document.getElementById(id),audio=$('audio'),card=$('overlay');
const outputId=new URLSearchParams(location.search).get('output')||'program';
const clientId=crypto.randomUUID();let active=null,generation=0,motion=null,visible=false;
async function post(path,data){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw new Error(`HTTP ${r.status}`);}
const ack=(p,status,error='')=>post('/api/obs/ack',{clientId,playbackId:p.id,status,error}).catch(()=>{});
function teamName(value){const el=$('channelName');el.textContent=value;el.style.fontSize='30px';const c=document.createElement('canvas').getContext('2d');c.font=`700 30px ${getComputedStyle(el).fontFamily}`;const width=c.measureText(value).width;el.style.fontSize=`${Math.min(30,Math.max(10,30*($('channelLogo').hidden?288:238)/Math.max(1,width)))}px`;}
function reveal(){motion?.cancel();visible=true;card.style.visibility='visible';card.setAttribute('aria-hidden','false');motion=card.animate([{transform:'translateX(440px)',opacity:0},{transform:'translateX(0)',opacity:1}],{duration:480,easing:'cubic-bezier(.16,1,.3,1)',fill:'forwards'});}
function hide(immediate=false){if(!visible&&!motion)return;const style=getComputedStyle(card);const start={transform:style.transform,opacity:style.opacity};motion?.cancel();visible=false;card.setAttribute('aria-hidden','true');if(immediate){card.style.visibility='hidden';motion=null;return;}
 const animation=card.animate([start,{transform:'translateX(440px)',opacity:0}],{duration:360,easing:'cubic-bezier(.55,0,1,.45)',fill:'forwards'});motion=animation;animation.onfinish=()=>{if(motion===animation){card.style.visibility='hidden';animation.cancel();motion=null;}};
}
function stop(immediate=false){generation++;audio.pause();active=null;audio.removeAttribute('src');audio.load();hide(immediate);}
async function play(p){if(p.targetClientId!==clientId)return;stop(true);active=p;const token=generation;card.classList.toggle('is-conflict',p.category==='conflict');$('channelLogo').hidden=!p.channelLogo;$('channelLogo').src=p.channelLogo||'';teamName(p.channelName||'');audio.src=p.audioUrl;
 try{await audio.play();if(token!==generation)return;reveal();await ack(p,'started');}catch(e){if(token!==generation)return;await ack(p,'error',e.message);stop();}
}
audio.addEventListener('ended',()=>{if(active)ack(active,'ended');stop();});
audio.addEventListener('error',()=>{if(active){ack(active,'error','音频加载失败');stop();}});
const events=new EventSource('/events');events.addEventListener('playback',e=>play(JSON.parse(e.data)));events.addEventListener('stop',()=>stop());
events.addEventListener('state',e=>{const s=JSON.parse(e.data);if(active&&s.playback?.id!==active.id)stop();else if(active&&s.playback?.channelName!==active.channelName){active={...active,channelName:s.playback.channelName};teamName(active.channelName);}});events.onerror=()=>stop();
function heartbeat(){post('/api/obs/heartbeat',{clientId,outputId}).catch(()=>stop());}heartbeat();setInterval(heartbeat,2000);

document.fonts.ready.then(()=>{if(active)teamName(active.channelName||'');});
