const $=id=>document.getElementById(id);
let inventory,monitor,ctx,anchor=null,active=false,liveState,teamNamesLoaded=false,selectedDevice='';
const report=text=>$('desktopMessage').textContent=text;
async function api(path,data){const r=await fetch('/api/desktop/'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const v=await r.json();if(!r.ok)throw new Error(v.error);return v;}
async function action(button,fn){button.disabled=true;try{await fn();}catch(e){report(e.message);}finally{button.disabled=false;}}
async function loadSettings(){const v=await api('settings');$('cachePath').value=v.pending?.path||v.runtime;$('cacheGB').value=v.pending?.maxGB??v.maxGB;$('cacheCurrent').textContent=`当前目录：${v.runtime} · 单会话PCM额度 ${v.maxGB} GiB`;$('pluginPath').value=v.pluginDirectory;$('restartService').disabled=!v.canRestart;
 if(!v.windows){for(const id of ['installPlugin','refreshConnections','applyBinding','removeBinding','muteTS','unmuteTS','volumeStatus','keepMuted'])$(id).disabled=true;report('Windows插件与混合器功能需在Windows运行；缓存设置仍可使用。');}else await refresh();}
function options(select,rows,label,value){const old=select.value;select.replaceChildren(...rows.map(row=>{const o=document.createElement('option');o.value=value(row);o.textContent=label(row);return o;}));if([...select.options].some(o=>o.value===old))select.value=old;}
function renderChannels(){const conn=inventory?.connections.find(c=>c.handler===$('tsConnection').value);options($('tsChannel'),conn?.channels||[],c=>`${c.name} [${c.id}]`,c=>c.id);if(conn?.currentChannel)$('tsChannel').value=conn.currentChannel;$('bindingStatus').textContent=conn?`当前频道 ${conn.currentChannel} · ${conn.binding||'尚未绑定'}`:'请在TS3连接服务器后刷新';}
async function refresh(){inventory=await api('connections');options($('tsConnection'),inventory.connections,c=>`${c.name||'服务器'} · 标签页 ${c.handler} · ${c.binding||'未绑定'}`,c=>c.handler);renderChannels();if(!inventory.connected)report(inventory.message);}
$('saveTeamNames').onclick=e=>action(e.currentTarget,async()=>{await api('teams',{'channel-alpha':$('teamAlphaName').value,'channel-bravo':$('teamBravoName').value});report('队名已保存，OBS标签与频道列表已更新。');});
$('saveCache').onclick=e=>action(e.currentTarget,async()=>{await api('settings',{path:$('cachePath').value,maxGB:Number($('cacheGB').value)});report('已保存。点击重启服务生效；旧目录数据保留，不会自动搬迁。');});
$('restartService').onclick=e=>action(e.currentTarget,async()=>{stopMonitor();await api('restart',{});report('服务正在重启，稍后页面会刷新…');setTimeout(()=>location.reload(),2500);});
$('installPlugin').onclick=e=>action(e.currentTarget,async()=>{const r=await api('install',{directory:$('pluginPath').value});report(r.message);});
$('refreshConnections').onclick=e=>action(e.currentTarget,refresh);
$('tsConnection').onchange=renderChannels;
for(const [id,operation] of [['applyBinding','bind'],['removeBinding','unbind']])$(id).onclick=e=>action(e.currentTarget,async()=>{report('等待插件确认…');const r=await api('bind',{operation,handler:$('tsConnection').value,channel:$('tsChannel').value,group:$('teamBinding').value,password:$('channelPassword').value});$('channelPassword').value='';report(r.message);await refresh();});
for(const [id,op] of [['muteTS','mute'],['unmuteTS','unmute'],['volumeStatus','status']])$(id).onclick=e=>action(e.currentTarget,async()=>{const v=await api('volume',{action:op});$('volumeState').textContent=`TS3音频会话：${v.sessions} 个；已静音 ${v.muted} 个`;report(op==='status'?'已读取Windows混合器状态':'Windows混合器已确认操作。浏览器试听独立于TS3静音。');});
function monitorSpeakers(){const previous=$('monitorSpeaker').value;const channel=$('monitorChannel').value;const speakers=(liveState?.capture.tracks||[]).filter(s=>s.channelId===channel).map(s=>({stableId:s.speakerId,name:s.speakerName}));const unique=[...new Map(speakers.map(s=>[s.stableId,s])).values()];options($('monitorSpeaker'),[{stableId:'',name:'全员同步监听'},...unique],s=>s.name,s=>s.stableId);if(active&&previous!==$('monitorSpeaker').value)stopMonitor();}
function stopMonitor(){active=false;monitor?.close();monitor=null;ctx?.close();ctx=null;anchor=null;$('monitorStatus').textContent='监听已停止';}
function selectionChanged(){if(active)stopMonitor();monitorSpeakers();}
$('monitorChannel').onchange=selectionChanged;$('monitorSpeaker').onchange=()=>{if(active)stopMonitor();};
$('monitorStart').onclick=e=>action(e.currentTarget,async()=>{
 stopMonitor();ctx=new AudioContext({sampleRate:48000});if(selectedDevice){if(!ctx.setSinkId)throw new Error('当前浏览器不支持独立监听设备');await ctx.setSinkId(selectedDevice);}await ctx.resume();active=true;
 monitor=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/monitor`);
 const socket=monitor;socket.onopen=()=>{socket.send(JSON.stringify({channelId:$('monitorChannel').value,speakerId:$('monitorSpeaker').value}));$('monitorStatus').textContent='等待该频道语音…';};
 socket.onmessage=e=>{if(socket!==monitor||!active||!ctx)return;const data=JSON.parse(e.data);const bin=atob(data.pcm),samples=bin.length/2;const audio=ctx.createBuffer(1,samples,48000),out=audio.getChannelData(0);
 for(let i=0;i<samples;i++){let x=bin.charCodeAt(i*2)|(bin.charCodeAt(i*2+1)<<8);if(x&32768)x-=65536;out[i]=x/32768;}
 if(anchor===null||Math.abs(anchor+data.start-ctx.currentTime)>.8)anchor=ctx.currentTime+.15-data.start;
 const at=anchor+data.start;if(at+audio.duration<ctx.currentTime)return;
 const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=audio;gain.gain.value=Number($('monitorVolume').value)/100*.5;source.connect(gain).connect(ctx.destination);source.start(Math.max(ctx.currentTime,at));$('monitorStatus').textContent='正在监听 · 不改变录音及OBS播出';};
 socket.onclose=()=>{if(socket===monitor){stopMonitor();$('monitorStatus').textContent='监听连接已关闭，请重新开始';}};
 socket.onerror=()=>report('实时监听连接失败');
});
$('monitorStop').onclick=stopMonitor;
const events=new EventSource('/events');events.addEventListener('state',e=>{liveState=JSON.parse(e.data);const audio=liveState.audioControl;if(audio){$('keepMuted').checked=audio.keepMuted;$('volumeState').textContent=audio.message||`TS3音频会话 ${audio.sessions??0} 个 · 已静音 ${audio.muted??0} 个${audio.checkedAt?' · '+new Date(audio.checkedAt).toLocaleTimeString():''}`;}for(const id of ['teamAlphaName','teamBravoName','saveTeamNames'])$(id).disabled=!!liveState.scoredeckManaged;$('saveTeamNames').textContent=liveState.scoredeckManaged?'跟随 ScoreDeck 主赛':'保存队名';if(!teamNamesLoaded||liveState.scoredeckManaged){$('teamAlphaName').value=liveState.channels.find(c=>c.id==='channel-alpha')?.name||'';$('teamBravoName').value=liveState.channels.find(c=>c.id==='channel-bravo')?.name||'';teamNamesLoaded=true;}for(const option of $('teamBinding').options){option.textContent=liveState.channels.find(c=>c.id===option.value)?.name||option.value;}options($('monitorChannel'),liveState.channels,c=>c.name,c=>c.id);monitorSpeakers();});
window.addEventListener('pagehide',()=>{stopMonitor();events.close();});
loadSettings().catch(e=>report(e.message));

$('keepMuted').onchange=e=>action(e.currentTarget,async()=>{const v=await api('keep-muted',{enabled:e.target.checked});report(v.message||'自动保持静音设置已保存。取消勾选仅停止自动检查静音；取消静音按钮可恢复声音。');});
async function useDevice(id){if(!('setSinkId' in HTMLMediaElement.prototype)||!('setSinkId' in AudioContext.prototype))throw new Error('此浏览器不支持分别选择预听与监听输出，请通过Windows混合器设置浏览器输出');
 await $('previewAudio').setSinkId(id);try{if(ctx)await ctx.setSinkId(id);}catch(e){await $('previewAudio').setSinkId(selectedDevice);throw e;}selectedDevice=id;$('audioDevice').value=id;$('audioDeviceStatus').textContent=id?'独立输出已选定，请先预听确认耳机':'使用系统默认输出';}
$('chooseAudioDevice').onclick=e=>action(e.currentTarget,async()=>{if(!navigator.mediaDevices?.selectAudioOutput)throw new Error('浏览器未提供设备授权选择器，请通过Windows混合器指定浏览器的耳机输出');const device=await navigator.mediaDevices.selectAudioOutput();const o=document.createElement('option');o.value=device.deviceId;o.textContent=device.label||'已授权输出';if(![...$('audioDevice').options].some(x=>x.value===o.value))$('audioDevice').append(o);await useDevice(device.deviceId);});
$('audioDevice').onchange=e=>useDevice(e.target.value).catch(err=>{$('audioDevice').value=selectedDevice;report(err.message);});
async function loadDevices(){if(!navigator.mediaDevices?.enumerateDevices)return;const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audiooutput'&&d.deviceId&&d.deviceId!=='default');for(const d of devices)if(![...$('audioDevice').options].some(o=>o.value===d.deviceId)){const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||'音频输出';$('audioDevice').append(o);}if(selectedDevice&&!devices.some(d=>d.deviceId===selectedDevice)){stopMonitor();$('previewAudio').pause();$('audioDeviceStatus').textContent='指定设备已断开，预听及监听已停止，请重新选择';}}
navigator.mediaDevices?.addEventListener('devicechange',()=>loadDevices().catch(e=>report(e.message)));loadDevices().catch(()=>{});
