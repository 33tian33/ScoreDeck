(()=>{'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];let meta,state,busy=false,polling=false,session=null,noticeTimer,previewId='',downId=null;
const audio=$('#preview');
let replayRate=1,replayPreviewId='',replayDownId=null;
function renderReplay(){
 const r=state?.replay,clip=r?.clip,video=$('#replay-video'),button=$('#replay-play');
 const id=clip?.id||'';
 if(id!==replayPreviewId){
  replayPreviewId=id;video.pause();
  if(id)video.src='/api/director/replay/media/'+encodeURIComponent(id);else video.removeAttribute('src');
  video.load();
 }
 $('#replay-empty').hidden=!!clip;
 $('#replay-empty').textContent=state?.replayError||'等待最新视频';
 $('#replay-status').textContent=state?.replayError||(!r?'等待 Replay':!clip?'暂无视频':r.busy?'正在播出':!r.connected?'输出未连接':'R'+clip.round+' · '+(clip.player||clip.name||'最新视频'));
 button.disabled=busy||!clip||!r?.connected||r?.busy;
 button.title=clip?`${clip.name||clip.player||'最新 Replay'} · 点击以 ${replayRate} 倍速播出`:'等待最新视频';
 $$('[data-replay-rate]').forEach(b=>{const selected=Number(b.dataset.replayRate)===replayRate;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
}
$$('[data-replay-rate]').forEach(b=>b.onclick=()=>{replayRate=Number(b.dataset.replayRate);renderReplay();});
$('#replay-play').addEventListener('pointerdown',()=>{replayDownId=replayPreviewId;});
$('#replay-play').onclick=e=>{
 if(!state?.replay?.clip||busy||(e.detail!==0&&replayDownId!==replayPreviewId))return;
 const id=replayPreviewId,rate=replayRate;replayDownId=null;
 void act(()=>request('replay/play',{id,rate}));
};
function scalePanel(){document.documentElement.style.fontSize=(12*Math.max(.7,Math.min(2.5,innerWidth/1100,innerHeight/180)))+'px';}
window.addEventListener('resize',scalePanel);scalePanel();
async function request(path,body){if(body!==undefined&&!meta)meta=await (await fetch('/api/meta')).json();const r=await fetch('/api/director/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(meta?{'X-ScoreDeck-Key':meta.controlKey,'X-ScoreDeck-Epoch':meta.serverEpoch,'X-ScoreDeck-Control-Epoch':meta.controlEpoch}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(6500)});const d=await r.json();if(!r.ok){if([401,409].includes(r.status)&&/授权/.test(d.error||''))meta=null;throw Error(d.error||'请求失败');}return d;}
function tell(text){$('#notice').textContent=text;$('#notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#notice').hidden=true,7000);}
function stopPreview(){audio.pause();audio.removeAttribute('src');audio.load();previewId='';}
async function act(fn){if(busy)return;busy=true;render();try{await fn();}catch(e){tell(e.message);}finally{busy=false;await poll();}}
let trackerRevision=0,trackerPending=0,leaseActive=false;
const tracker=async(action,body={})=>{
 if(['heartbeat','refresh-controls'].includes(action))return request('tracker/'+action,body);
 const revision=++trackerRevision,previousLease=leaseActive;trackerPending++;
 if(action==='start')leaseActive=true;
 if(['stop','cancel-return','camera','disconnect'].includes(action))leaseActive=false;
 try{const result=await request('tracker/'+action,body);if(revision===trackerRevision){state={...state,tracker:result};leaseActive=!!result.active;render();}return result;}
 catch(e){if(revision===trackerRevision)leaseActive=previousLease;throw e;}finally{trackerPending--;}
};
function clipTime(ms){const seconds=Math.floor(Math.max(0,Number(ms)||0)/1000);return '会话 '+[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');}
function render(){if(!state)return;const t=state.tracker||{},v=state.voice,c=t.controls||{};
renderReplay();
$('#connection').textContent=t.verified?'CS2 已连接':'未连接 CS2';$('#connection').classList.toggle('online',!!t.verified);
for(const [key,value] of [['xray',c.xray],['ui',c.uiHidden]]){const button=$('#'+key);button.querySelector('b').textContent=value==null?'未知':key==='ui'?(value?'隐藏含击杀提示':'完整'):(value?'开':'关');button.disabled=busy||!t.verified||c.busy;button.classList.toggle('active',value===true);}
$('#connect').textContent=t.verified?'已连接':'连接 CS2';$('#connect').disabled=busy||!!t.active||!!t.verified;
$('#control-status').textContent=c.error||t.error||'';
if(session!==v?.sessionId){stopPreview();session=v?.sessionId;$$('.clips').forEach(e=>{e.replaceChildren();e.scrollLeft=0;});}
for(let i=0;i<2;i++)lane(i,v?.channels?.[i]);
$('#start-voice').hidden=!!v;$('#start-voice').disabled=busy;$('#voice-stop').disabled=busy||!v;$('#preview-stop').disabled=!previewId;
let status=state.voiceError||'VoiceBridge 等待片段';
if(v){const p=v.playback,selected=v.obs?.selected,outputs=v.obs?.outputs?.filter(o=>o.outputId===selected)||[];
status=p?(p.status==='scheduled'?'等待播出 '+Math.max(0,(p.scheduledAt-v.serverNow)/1000).toFixed(1)+'s':p.status==='playing'?'● 正在播出':'正在加载')+' · '+p.channelName+' · '+p.title:`${v.mode==='demo'?'演示模式 · ':''}导播延迟 ${v.delay}s · OBS ${selected&&outputs.length===1?'已绑定在线输出':'未绑定唯一在线输出'} · 预听请使用耳机`;
if(v.lastPlayback?.status==='error'&&!p)status='播出失败 · '+v.lastPlayback.error;}
$('#voice-status').textContent=status;
}
function lane(index,c){const root=$(`[data-lane="${index}"]`),strip=root.querySelector('.clips'),clips=c?.segments||[];root.querySelector('strong').textContent=c?.name||(index?'队伍 B':'队伍 A');root.querySelector('.lane-head small').textContent=clips.length+' 条';
const scrolled=strip.scrollLeft>4,anchor=scrolled?[...strip.children].find(e=>e.offsetLeft+e.offsetWidth>strip.scrollLeft+strip.offsetLeft):null,anchorId=anchor?.dataset.id,anchorOffset=anchor?anchor.offsetLeft-strip.offsetLeft-strip.scrollLeft:0;
const existing=new Map([...strip.querySelectorAll('.clip')].map(e=>[e.dataset.id,e]));strip.querySelector('.empty')?.remove();
for(const clip of clips){let el=existing.get(clip.id);if(!el){el=document.createElement('article');el.className='clip';el.dataset.id=clip.id;el.innerHTML='<small></small><strong></strong><div class="clip-actions"><button data-clip-action="preview">预听</button><button data-clip-action="push">推送 ↗</button></div>';}
el._clip=clip;el.querySelector('small').textContent=clipTime(clip.startMs)+' · '+(clip.audioDurationMs/1000).toFixed(1)+'s'+(clip.reviewRequired?' · 需预听':'');el.querySelector('strong').textContent=clip.title;el.title=clip.summary||clip.title;el.classList.toggle('selected',previewId===clip.id);el.querySelector('[data-clip-action="preview"]').textContent=previewId===clip.id?'停止预听':'预听';el.querySelectorAll('button').forEach(b=>b.disabled=busy||(b.dataset.clipAction==='push'&&!!state.voice?.playback));strip.append(el);existing.delete(clip.id);}
for(const e of existing.values())e.remove();if(!clips.length){const e=document.createElement('p');e.className='empty';e.textContent=state.voice?'等待符合条件的音频片段…':'启动 VoiceBridge，等待音频片段';strip.append(e);}
if(scrolled&&anchorId){const e=[...strip.children].find(e=>e.dataset.id===anchorId);if(e)strip.scrollLeft=e.offsetLeft-strip.offsetLeft-anchorOffset;}else if(!scrolled)strip.scrollLeft=0;
}
async function poll(){if(polling)return;polling=true;const revision=trackerRevision;try{const next=await request('state');if(revision!==trackerRevision||trackerPending)return;state=next;leaseActive=!!state.tracker?.active;render();}catch(e){if(revision!==trackerRevision||trackerPending)return;leaseActive=false;state=null;stopPreview();renderReplay();$$('.game button,#connect,.clip button').forEach(b=>b.disabled=true);$('#connection').textContent='服务已断开';$('#voice-status').textContent=e.message;}finally{polling=false;}}
$$('[data-toggle]').forEach(b=>b.onclick=()=>act(()=>tracker('toggle',{key:b.dataset.toggle})));
$('#connect').onclick=()=>act(()=>tracker('connect'));
$$('[data-window]').forEach(b=>b.onclick=()=>act(async()=>{if(b.dataset.window==='close'){await tracker('stop').catch(()=>{});stopPreview();}try{await request('window',{action:b.dataset.window});}catch(e){if(b.dataset.window==='settings')window.open('/director-settings.html');else if(b.dataset.window==='dashboard')window.open('/');else throw e;}}));
$('#start-voice').onclick=()=>act(()=>request('voice/start',{}));$('#preview-stop').onclick=()=>{stopPreview();render();};$('#voice-stop').onclick=()=>act(async()=>{stopPreview();await request('voice/stop',{});});
$$('[data-latest]').forEach(b=>b.onclick=()=>{b.closest('.lane').querySelector('.clips').scrollLeft=0;});
document.addEventListener('pointerdown',e=>{const b=e.target.closest('[data-clip-action]');downId=b?b.closest('.clip').dataset.id+':'+b.dataset.clipAction:null;});
document.addEventListener('click',e=>{const b=e.target.closest('[data-clip-action]');if(!b)return;const el=b.closest('.clip'),clip=el._clip;if(e.detail!==0&&downId!==clip.id+':'+b.dataset.clipAction)return;downId=null;act(async()=>{if(b.dataset.clipAction==='push'){stopPreview();await request('voice/play',{channelId:clip.channelId,segmentId:clip.id});}else if(previewId===clip.id)stopPreview();else{stopPreview();if(!/^\/clips\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.wav$/.test(clip.audioUrl))throw Error('音频地址无效');audio.src='/api/director'+clip.audioUrl;await audio.play();previewId=clip.id;}});});
audio.onended=()=>{previewId='';render();};audio.onerror=()=>{previewId='';tell('预听失败，音频可能已过期');render();};
let heartBusy=false;setInterval(async()=>{if(heartBusy||!leaseActive)return;heartBusy=true;try{await tracker('heartbeat');}catch{}finally{heartBusy=false;}},700);
// Poll cached service state only; CS2 control queries run in response to clicks.
setInterval(()=>void poll(),500);
window.addEventListener('pagehide',()=>{stopPreview();if(meta&&state?.tracker?.active)fetch('/api/director/tracker/stop',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','X-ScoreDeck-Key':meta.controlKey,'X-ScoreDeck-Epoch':meta.serverEpoch,'X-ScoreDeck-Control-Epoch':meta.controlEpoch},body:'{}'}).catch(()=>{});});
void poll();})();
