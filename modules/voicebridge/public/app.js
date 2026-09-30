const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const tc=ms=>`${String(Math.floor(ms/60000)).padStart(2,'0')}:${((ms%60000)/1000).toFixed(1).padStart(4,'0')}`;
let state,filter='all',emotionFilter='all',previewId=0,demoRunning=false,reviewFilter='all',listsPaused=false,editing=null;
async function post(path,data={}){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const b=await r.json();if(!r.ok)throw new Error(b.error||r.status);return b;}
function error(e){$('warning').textContent=e.message;$('warning').classList.add('visible');}
function render(s){if(!state)$('directorDelay').value=s.config.directorDelaySeconds??0;state=s;$('directorDelaySaved').textContent=`已保存：${s.config.directorDelaySeconds??0} 秒`; const channels=s.channels.filter(c=>filter==='all'||c.id===filter),segments=channels.flatMap(c=>c.segments.filter(s=>s.eligible)),all=s.channels;
  $('channelCount').textContent=`${all.filter(c=>c.connectionStatus==='listening').length} / ${all.length}`;
  $('bridgeStatus').textContent=s.mode==='demo'?'演示模式 · 非真实语音':s.bridge.error||'真实采集模式';
  $('utteranceCount').textContent=channels.reduce((n,c)=>n+c.utterances.filter(u=>u.stable).length,0);
  $('segmentCount').textContent=segments.filter(s=>s.status==='committed').length;
  $('latency').textContent=Math.max(0,...channels.map(c=>c.analysis.latencyMs||0));
  $('analysisSource').textContent=channels.some(c=>c.analysis.source==='deepseek')?'DeepSeek 分段':'本地规则分段';$('modelName').textContent=s.config.model;
  $('bridgeDetail').textContent=`${s.mode==='demo'?'演示':'真实'}会话 ${s.sessionId.slice(0,8)} · ${s.bridge.audioPackets} 个 PCM 包 · ${s.capture.tracks.length} 条音轨 · ${(s.capture.bytes/1024/1024).toFixed(1)} MB · 丢弃 ${s.capture.dropped}`;
  $('asrStatus').textContent=s.asr.enabled?`${s.asr.provider==='aliyun'?'阿里云百炼':'OpenAI'} / ${s.asr.model} · 处理中 ${s.asr.running} · 排队 ${s.asr.queued} · 失败 ${s.asr.failed} · 已完成 ${s.asr.completed} · 积压 ${s.asr.backlogSeconds}s`:'尚未配置语音识别密钥：请在上方「API 配置」中填写密钥并重启服务，录音任务仍会保留';
  const vad=s.asr.vad;
  $('vadSummary').textContent=vad?`已接收 ${vad.receivedSeconds.toFixed(1)} 秒音频 · 已形成识别片段 ${vad.selectedSeconds.toFixed(1)} 秒 · 拦截短促声音 ${vad.rejectedBursts} 次（本次进程统计）`:'等待发声检测';
  $('vadSpeakers').innerHTML=(vad?.tracks||[]).filter(t=>filter==='all'||t.channelId===filter).map(t=>`<span class="vad-person ${t.state}">${esc(t.speakerName)} · ${esc(all.find(c=>c.id===t.channelId)?.name||t.channelId)} · ${{speaking:'正在说话',checking:'确认中',silent:'静音 / 暂无新语音'}[t.state]} · ${(t.lastSample/48000).toFixed(2)}s</span>`).join('')||'玩家首次收到音频后显示';
  $('obsStatus').textContent=`在线输出 ${s.obs.clients.length} · 绑定 ${s.obs.selected||'未绑定'}`;
  const targets=[...new Set(s.obs.outputs.map(o=>o.outputId))],previous=$('obsTarget').value;
  $('obsTarget').replaceChildren(...targets.map(id=>{const o=document.createElement('option');o.value=id;o.textContent=id+(s.obs.outputs.filter(x=>x.outputId===id).length>1?'（重名）':'');return o;}));
  $('obsTarget').value=targets.includes(previous)?previous:(targets.includes(s.obs.selected)?s.obs.selected:targets[0]||'');
  $('obsBinding').textContent=s.obs.selected?`已绑定 ${s.obs.selected}${s.obs.outputs.filter(o=>o.outputId===s.obs.selected).length===1?' · 在线':' · 离线或重名，禁止播出'}`:'请先绑定输出';
  $('livePartial').textContent=(s.asr.partials||[]).map(p=>`${p.speakerName}：${p.text}`).join(' ｜ ');
  $('asrStatus').textContent+=s.asr.streaming?` · 流式 ${s.asr.liveStreams} 路`:' · 分段识别';
  $('channelTabs').innerHTML=[{id:'all',name:'全部频道',shortName:'ALL',color:'#d4e5e5'},...all].map(c=>`<button class="channel-tab ${filter===c.id?'active':''}" data-channel="${esc(c.id)}" style="--channel:${esc(c.color)}">${c.logo?`<img class="channel-team-logo" src="${esc(c.logo)}" alt="">`:'<span class="channel-dot"></span>'}<span><strong>${esc(c.name)}</strong><small>${c.connectionStatus==='listening'?'已绑定':c.connectionStatus==='demo'?'演示':c.id==='all'?'双频道独立处理':'等待绑定'}</small></span></button>`).join('');
  const warning=[s.asr.lastError,...s.capture.errors,...channels.map(c=>c.analysis.warning)].filter(Boolean);$('warning').textContent=[...new Set(warning)].join(' ｜ ');$('warning').classList.toggle('visible',warning.length>0);
  const utterances=channels.flatMap(c=>c.utterances.map(u=>({...u,channel:c}))).sort((a,b)=>b.startMs-a.startMs || b.endMs-a.endMs).slice(0,150);
  if(!listsPaused)$('transcriptList').innerHTML=utterances.map(u=>`<article class="utterance"><span class="avatar">${esc(u.speakerName.slice(0,1))}</span><div><div class="utterance-meta"><strong>${esc(u.speakerName)}</strong><span>${esc(u.channel.shortName)} · ${tc(u.startMs)} ${u.stable?'':'· 识别中'}</span></div><p>${esc(u.text)}</p></div></article>`).join('')||'<div class="empty-state"><strong>等待语音输入</strong><p>绑定 TeamSpeak 后，玩家语音会自动识别。</p></div>';
  $('sessionTime').textContent=tc(Math.max(0,...utterances.map(u=>u.endMs)));
  if(!listsPaused)$('segmentList').innerHTML=segments.filter(s=>emotionFilter==='all'||s.category===emotionFilter).filter(s=>reviewFilter==='all'||(reviewFilter==='played'?!!s.playedAt:(s.reviewState||'pending')===reviewFilter)).sort((a,b)=>b.startMs-a.startMs || b.endMs-a.endMs).slice(0,100).map(s=>`<article data-played="${!!s.playedAt}" class="segment-card ${s.status}" style="--channel:${esc(s.channelColor)}"><div class="segment-topline"><span class="channel-label">${esc(s.channelName)}</span><span class="status">${s.status!=='committed'?'生成中':s.audioReady?'音频就绪':'音频生成失败'}</span></div><h2>${esc(s.title)}</h2><p class="review-badge">${({pending:"待播",favorite:"已收藏",played:"已播",ignored:"已忽略"})[s.reviewState||"pending"]} · ${((s.audioDurationMs||0)/1000).toFixed(1)}秒${s.playedAt?` · 已播${s.playCount||1}次`:""}${s.humanReviewed?" · 人工已审核":""}</p><p><b>${esc(({encouragement:"鼓励队友",opponent_taunt:"贬低敌方",morale:"提振士气",conflict:"内讧 / 压力队友"})[s.category]||"")}</b> · ${s.reviewRequired?"需预听":"模型高信心 · 建议预听"}</p><p>${esc(s.reason)}</p><p>${esc((state.channels.find(c=>c.id===s.channelId)?.utterances||[]).filter(u=>(s.evidenceIds||[]).includes(u.id)).map(u=>`${u.speakerName}：${u.text}`).join(" / "))}</p><p>频道全员同步混音 · ${s.category==='conflict'?'第二版标签：氛围对了':'标准标签'}</p><p>${esc(s.summary)}</p><div class="segment-meta">${tc(s.startMs)} — ${tc(s.endMs)} · ${esc(s.speakerNames.join(' / '))}</div>${s.audioError?`<p>${esc(s.audioError)}</p>`:''}<div class="card-actions"><button data-action="preview" data-channel="${esc(s.channelId)}" data-id="${esc(s.id)}" ${s.audioReady?'':'disabled'}>预听</button><button class="broadcast" data-action="broadcast" data-channel="${esc(s.channelId)}" data-id="${esc(s.id)}" ${s.audioReady?'':'disabled'}>播出至 OBS</button><button data-action="edit" data-channel="${esc(s.channelId)}" data-id="${esc(s.id)}" ${s.audioReady?"":"disabled"}>修剪 / 审核</button><button data-action="favorite" data-channel="${esc(s.channelId)}" data-id="${esc(s.id)}">${s.reviewState==="favorite"?"取消收藏":"收藏"}</button><button data-action="ignore" data-channel="${esc(s.channelId)}" data-id="${esc(s.id)}">${s.reviewState==="ignored"?"恢复待播":"忽略"}</button></div></article>`).join('')||'<div class="empty-state"><strong>暂无符合四类情绪的片段</strong><p>纯战术交流不入选；可以提交尾段完成筛选。</p></div>';
  const p=s.playback;$('nowPlaying').classList.toggle('active',!!p);$('nowPlaying').querySelector('.on-air').textContent=p?(p.status==='scheduled'?'WAITING':p.status==='playing'?'ON AIR':'LOADING'):'READY';$('nowTitle').textContent=p?.title||'等待导播选择段落';$('nowSummary').textContent=p?.summary||(s.lastPlayback?.status==='error'?s.lastPlayback.error:'预听与播出使用同一份片段音频');$('outputChannel').textContent=p?.channelName||'未选择频道';$('stopButton').textContent=p?.status==='scheduled'?'取消等待':'停止播出';renderCountdown();
}
$('channelTabs').onclick=e=>{const b=e.target.closest('[data-channel]');if(b){filter=b.dataset.channel;render(state);}};
$('segmentList').onclick=async e=>{const b=e.target.closest('[data-action]');if(!b)return;try{const s=state.channels.find(c=>c.id===b.dataset.channel)?.segments.find(s=>s.id===b.dataset.id);if(!s)return;
  if(b.dataset.action==='broadcast'){previewId++;$('previewAudio').pause();await post('/api/play',{channelId:s.channelId,segmentId:s.id});}
  else if(b.dataset.action==='edit'){editing={channelId:s.channelId,segmentId:s.id};$('clipTitle').value=s.title;$('clipStart').value=((s.clipStartMs??s.startMs)/1000).toFixed(2);$('clipEnd').value=((Math.min(state.mode==='live'?state.capture.latestMs:Infinity,(s.clipStartMs??s.startMs)+(s.audioDurationMs||s.endMs-s.startMs)))/1000).toFixed(2);$('clipCategory').value=s.category;$('clipRange').textContent=`原始交流 ${tc(s.startMs)} — ${tc(s.endMs)}`;$('clipMessage').textContent='';$('clipEditor').showModal();}
  else if(['favorite','ignore'].includes(b.dataset.action)){const target=b.dataset.action==='favorite'?'favorite':'ignored';await post('/api/segment/update',{channelId:s.channelId,segmentId:s.id,reviewState:s.reviewState===target?'pending':target});}
  else{const id=++previewId,a=$('previewAudio');a.pause();a.src=s.audioUrl;await a.play();if(id!==previewId)return;}
}catch(e){error(e);}};
$('stopButton').onclick=()=>{previewId++;$('previewAudio').pause();post('/api/stop').catch(error);};
$('resetButton').onclick=async()=>{try{demoRunning=false;previewId++;$('previewAudio').pause();await post('/api/reset',{mode:'live'});}catch(e){error(e);}};
$('finalizeButton').onclick=()=>post('/api/finalize',filter==='all'?{}:{channelId:filter}).catch(error);
$('retryButton').onclick=()=>post('/api/asr/retry').catch(error);
$('demoButton').onclick=async()=>{if(demoRunning)return;demoRunning=true;$('demoButton').disabled=true;try{const reset=await post('/api/reset',{mode:'demo'}),demo=await fetch('/api/demo').then(r=>r.json());const items=demo.channels.flatMap(c=>c.utterances.map(u=>({...u,channelId:c.id,sessionId:reset.sessionId,stable:true}))).sort((a,b)=>a.startMs-b.startMs);
  for(const u of items){if(!demoRunning)break;await post('/api/utterances',u);await new Promise(r=>setTimeout(r,100));}if(demoRunning)await post('/api/finalize');
}catch(e){error(e);}finally{demoRunning=false;$('demoButton').disabled=false;}};
const events=new EventSource('/events');events.addEventListener('state',e=>render(JSON.parse(e.data)));events.onerror=()=>{$('bridgeStatus').textContent='服务连接中断，正在重连…';};
fetch('/api/state').then(r=>r.json()).then(render).catch(error);

$('emotionFilter').onchange=e=>{emotionFilter=e.target.value;if(state)render(state);};

$('reviewFilter').onchange=e=>{reviewFilter=e.target.value;listsPaused=false;$('pauseLists').textContent='暂停列表更新';if(state)render(state);};
$('pauseLists').onclick=()=>{listsPaused=!listsPaused;$('pauseLists').textContent=listsPaused?'恢复最新内容':'暂停列表更新';if(!listsPaused&&state)render(state);};
$('bindObs').onclick=()=>post('/api/obs/bind',{outputId:$('obsTarget').value}).catch(error);
$('closeClip').onclick=()=> $('clipEditor').close();
$('extendBefore').onclick=()=>{$('clipStart').value=Math.max(0,Number($('clipStart').value)-1).toFixed(2);};
$('extendAfter').onclick=()=>{$('clipEnd').value=(Number($('clipEnd').value)+1).toFixed(2);};
async function saveClip(preview=false){if(!editing)return;$('saveClip').disabled=$('savePreviewClip').disabled=true;try{const result=await post('/api/segment/update',{...editing,title:$('clipTitle').value,category:$('clipCategory').value,trimStartMs:Math.round(Number($('clipStart').value)*1000),trimEndMs:Math.round(Number($('clipEnd').value)*1000)});$('clipMessage').textContent='已保存。后续预听和播出均使用修剪后的片段。';if(preview){previewId++;const audio=$('previewAudio');audio.pause();audio.src=result.segment.audioUrl;await audio.play();}}catch(e){$('clipMessage').textContent=e.message;}finally{$('saveClip').disabled=$('savePreviewClip').disabled=false;}}
$('clipForm').onsubmit=e=>{e.preventDefault();saveClip();};$('savePreviewClip').onclick=()=>saveClip(true);
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('stopButton').click();});
setInterval(()=>{if(state?.playback?.status==='playing')$('outputChannel').textContent=`${state.playback.channelName} · 剩余 ${Math.max(0,(state.playback.audioDurationMs-(Date.now()-state.playback.startedAt))/1000).toFixed(1)}秒`;},250);

function renderCountdown(){const p=state?.playback;if(p?.status==='scheduled')$('outputChannel').textContent=`${p.channelName} · 等待播出 ${Math.max(0,(p.scheduledAt-Date.now())/1000).toFixed(1)}秒`;}
setInterval(renderCountdown,100);
$('saveDirectorDelay').onclick=async()=>{try{const input=$('directorDelay');if(!input.value.trim()||!input.checkValidity())throw new Error('请输入 0 至 86400 秒的延迟');const value=Number(input.value);await post('/api/settings/director',{directorDelaySeconds:value});$('directorDelaySaved').textContent=`已保存：${value} 秒`;}catch(e){error(e);}};

fetch('/scoredeck/config').then(r=>r.json()).then(({origin})=>{if(!origin)return;const allowed=[origin,origin.replace('127.0.0.1','localhost')];window.addEventListener('message',e=>{if(e.source===parent&&allowed.includes(e.origin)&&e.data?.type==='scoredeck-open-settings'){for(const panel of document.querySelectorAll('details.setup-panel'))panel.open=true;$('apiPanel').scrollIntoView({behavior:'smooth',block:'start'});}});}).catch(()=>{});
