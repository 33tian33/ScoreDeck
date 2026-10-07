'use strict';
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {EventEmitter} = require('node:events');
const {performance} = require('node:perf_hooks');
const {MAP_CAMERAS,normalizeCameraMap} = require('./camera-presets.cjs');
// RadarHUD heartbeat is one second, including paused demos/freeze time.
const MAP_STALE_MS = 3000;
const TYPES = {flashbang:'闪光弹', smoke:'烟雾弹', frag:'手雷', firebomb:'燃烧弹'};
const DEFAULTS = {port:2121, protocol:'text', version:212, freeMode:6, eyeMode:1, distance:220, height:120, fps:60, smoothingMs:90, cameraRevision:2, staleMs:600, maxSeconds:12, holdMs:350};
const vec = v => Array.isArray(v) && v.length===3 && v.every(Number.isFinite);
const norm = v => {const n=Math.hypot(...v);return n>0.01?v.map(x=>x/n):null;};
function kind(value) {
  const s=String(value||'').toLowerCase().replace(/^weapon_/,'').replace(/_projectile$/,'');
  return ({flashbang:'flashbang',flash:'flashbang',smoke:'smoke',smokegrenade:'smoke',frag:'frag',hegrenade:'frag',he:'frag',firebomb:'firebomb',molotov:'firebomb',incgrenade:'firebomb',incendiary:'firebomb',inferno:'firebomb'})[s]||null;
}
function active(g) {
  if(!kind(g.type)||!vec(g.position)||/expired|extinguish|destroyed/i.test(String(g.state||'')))return false;
  // The latest GSI collection is authoritative: smoke and inferno remain valid while present.
  if(kind(g.type)==='smoke'||g.type==='inferno'||g.flames?.length)return true;
  return !(Number.isFinite(g.effect_time)&&g.effect_time>0)&&!/detonat|explod/i.test(String(g.state||''));
}
function packet(command, version=212) {
  const body=Buffer.from(command+'\0','utf8'); const h=Buffer.alloc(12);
  h.write('CMND');h.writeUInt32BE(version<<16,4);h.writeUInt16BE(12+body.length,8);
  return Buffer.concat([h,body]);
}
class ConsoleLink extends EventEmitter {
  constructor(){super();this.socket=null;this.ready=false;this.connected=false;this.error='';this.pending=null;this.config={...DEFAULTS};this.lines='';this.buffer=Buffer.alloc(0);}
  close(){this.pending=null;this.ready=false;this.connected=false;if(this.socket){const s=this.socket;this.socket=null;s.destroy();}this.emit('offline');}
  async connect(config){
    this.close();this.config={...config};this.error='';this.lines='';this.buffer=Buffer.alloc(0);
    const s=net.createConnection({host:'127.0.0.1',port:config.port});this.socket=s;s.setNoDelay(true);
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=e=>{if(settled)return;settled=true;clearTimeout(timer);this.off('verified',verified);if(e){this.error=e.message;this.close();reject(e);}else resolve();};
      const verified=()=>finish();this.once('verified',verified);
      const timer=setTimeout(()=>finish(new Error('连接或命令回显超时；请检查 CS2 控制端口、协议及 Workshop Tools 启动状态')),3500);
      s.on('connect',()=>{if(this.socket!==s)return;this.connected=true;this.probe='SD_TRACK_'+crypto.randomBytes(10).toString('hex');this.write('echo '+this.probe,true);});
      s.on('data',data=>{if(this.socket!==s)return;try{this.receive(data);}catch(e){finish(e);if(settled){this.error=e.message;this.close();}}});
      s.on('error',e=>{if(this.socket!==s)return;this.error=e.message;finish(e);if(this.socket===s)this.close();});
      s.on('close',()=>{if(this.socket!==s)return;this.socket=null;this.connected=false;this.ready=false;this.pending=null;finish(new Error('CS2 控制连接已断开'));this.emit('offline');});
      s.on('drain',()=>{if(this.socket===s && this.pending){const c=this.pending;this.pending=null;this.write(c);}});
    });
  }
  receive(data){
    if(this.config.protocol==='text'){this.consume(data.toString('utf8'));return;}
    this.buffer=Buffer.concat([this.buffer,data]);
    while(this.buffer.length>=12){
      const n=this.buffer.readUInt16BE(8);if(n<12)throw new Error('VConsole 帧无效，请检查协议');
      if(this.buffer.length<n)break;
      const frame=this.buffer.subarray(0,n);this.buffer=this.buffer.subarray(n);
      if(frame.toString('ascii',0,4)==='PRNT' && n>=40)this.consume(frame.subarray(40).toString('utf8').replace(/\0/g,'\n')+'\n');
    }
    if(this.buffer.length>65536)throw new Error('控制通道数据异常');
  }
  consume(text){
    this.lines=(this.lines+text).slice(-16384);const lines=this.lines.split(/\r?\n/);this.lines=lines.pop();
    for(const line of lines){
      this.emit('line',line);
      if(line.trim()===this.probe){this.ready=true;this.emit('verified');}
      if(/unknown command|not allowed|cannot execute|can't (?:use|execute)|cheat.*(enabled|disabled)|requires? sv_cheats|version mismatch/i.test(line))this.emit('commandError',line.slice(0,250));
    }
  }
  write(command,probe=false){
    if(!this.socket || !this.connected || (!probe&&!this.ready))throw new Error('CS2 控制通道未通过回显测试');
    if(command.length>1500 || /[\r\n\0]/.test(command))throw new Error('无效控制命令');
    this.socket.write(this.config.protocol==='text'?command+'\n':packet(command,this.config.version));
  }
  camera(command){if(this.socket?.writableNeedDrain){this.pending=command;return;}this.write(command);}
  clearCamera(){this.pending=null;}
}
class GameControls {
  constructor(link){this.link=link;this.values={xray:null,ui:null,deathnotices:null};this.pending=null;this.busy=false;this.error='';
    link.on('line',line=>{const p=this.pending;if(!p)return;const m=/^\s*"?(spec_show_xray|cl_draw_only_deathnotices|cl_drawhud_force_deathnotices)"?\s*(?:=|:)\s*"?(true|false|-1|[01])(?:"|\s|$)/i.exec(line);
      if(m){const key=m[1]==='spec_show_xray'?'xray':m[1]==='cl_draw_only_deathnotices'?'ui':'deathnotices';p.values[key]=key==='deathnotices'?Number(m[2]):['1','true'].includes(m[2].toLowerCase());}
      if(line.trim()===p.marker){this.values=p.values;p.finish();}
    });
    link.on('commandError',line=>this.pending?.finish(Error('CS2 拒绝命令：'+line)));
    link.on('offline',()=>{this.values={xray:null,ui:null,deathnotices:null};this.pending?.finish(Error('CS2 连接断开'));});
  }
  status(){return {...this.values,uiHidden:this.values.ui,busy:this.busy||!!this.pending,error:this.error};}
  exchange(commands){if(!this.link.ready)return Promise.reject(Error('请先连接 CS2'));if(this.pending)return Promise.reject(Error('正在等待游戏确认'));
    return new Promise((resolve,reject)=>{const marker='SD_CTRL_'+crypto.randomBytes(12).toString('hex');
      const finish=e=>{if(this.pending?.marker!==marker)return;clearTimeout(timer);this.pending=null;if(e){this.values={xray:null,ui:null,deathnotices:null};this.error=e.message;reject(e);}else{this.error='';resolve();}};
      const timer=setTimeout(()=>finish(Error('CS2 未确认命令，结果未知，请在游戏中检查')),3000);
      this.pending={marker,values:{xray:null,ui:null,deathnotices:null},finish};
      try{for(const c of [...commands,'spec_show_xray','cl_draw_only_deathnotices','cl_drawhud_force_deathnotices','echo '+marker])this.link.write(c);}catch(e){finish(e);}
    });
  }
  async toggle(key){if(!['xray','ui'].includes(key))throw Error('无效游戏控制项');if(this.busy||this.pending)throw Error('正在等待游戏确认');this.busy=true;
    try{await this.exchange([]);if(this.values[key]===null)throw Error('未读到游戏状态，未发送切换命令');const next=!this.values[key];
      await this.exchange(key==='xray'?['spec_show_xray '+Number(next)]:['cl_draw_only_deathnotices '+Number(next),'cl_drawhud_force_deathnotices '+(next?-1:0)]);
      if(this.values[key]!==next||(key==='ui'&&this.values.deathnotices!==(next?-1:0)))throw Error('游戏未确认预期状态，请在 CS2 中检查');
    }finally{this.busy=false;}
  }
}
class GrenadeTracker {
  constructor({link=new ConsoleLink(),clock=()=>performance.now(),configPath=null,timers=true}={}){
    this.link=link;this.controls=new GameControls(link);this.clock=clock;this.configPath=configPath;this.config={...DEFAULTS};this.records=new Map();this.lastAt=null;this.state=null;this.context=null;this.session=null;this.message='等待本机 GOTV GSI';this.lastCommand='';this.leaseUntil=0;this.mapEpoch=0;this.cameraSelection=null;this.returnSelection=null;this.pendingReturn=null;this.sampleSerial=0;
    try{if(configPath)this.configure(JSON.parse(fs.readFileSync(configPath,'utf8')),false);}catch{}
    link.on('offline',()=>{this.stop('控制连接已断开',false);this.cameraSelection=null;this.pendingReturn=null;});
    link.on('commandError',message=>{this.stop('CS2 拒绝命令：'+message,false);this.cameraSelection=null;this.pendingReturn=null;this.message='CS2 拒绝命令：'+message;});
    if(timers){this.timer=setInterval(()=>this.tick(),1000/120);this.timer.unref();}
  }
  configure(input,save=true){
    if(this.session)throw new Error('请先停止追踪再修改设置');
    const c={...this.config};
    input={...input};
    if(!save && input.cameraRevision!==2){
      if(input.eyeMode===4)input.eyeMode=1;
      if(input.distance===100)input.distance=220;
      if(input.height===45)input.height=120;
      if(input.fps===30)input.fps=60;
    }
    c.cameraRevision=2;
    const ranges={port:[1,65535],version:[210,212],freeMode:[1,6],eyeMode:[1,6],distance:[20,600],height:[0,320],fps:[10,60],smoothingMs:[20,250],staleMs:[200,2000],maxSeconds:[2,20],holdMs:[0,1200]};
    for(const [key,[min,max]] of Object.entries(ranges))if(key in input){const n=Number(input[key]);if(!Number.isInteger(n)||n<min||n>max)throw new Error('参数无效：'+key);c[key]=n;}
    if('protocol' in input){if(!['vconsole','text'].includes(input.protocol))throw new Error('协议无效');c.protocol=input.protocol;}
    if(save && this.configPath){fs.mkdirSync(path.dirname(this.configPath),{recursive:true});fs.writeFileSync(this.configPath+'.tmp',JSON.stringify(c,null,2));fs.renameSync(this.configPath+'.tmp',this.configPath);}
    if(['port','protocol','version'].some(k=>c[k]!==this.config[k]))this.link.close();
    this.config=c;return c;
  }
  ingest(state,now=this.clock()){
    const cameraMap=s=>s?.player?.activity==='menu'?'':normalizeCameraMap(s?.map?.name);
    if(cameraMap(state)!==cameraMap(this.state)||this.lastAt===null||now-this.lastAt>MAP_STALE_MS){this.mapEpoch++;this.cameraSelection=null;this.returnSelection=null;this.pendingReturn=null;}
    const context=String(state.map?.name)+'/'+String(state.map?.round)+'/'+String(state.timeline?.round_id||'');
    const reset=this.lastAt===null || now-this.lastAt>MAP_STALE_MS || context!==this.context;
    if(reset){if(this.session)this.stop('数据重新同步，追踪已取消',false);this.records.clear();if(context!==this.context){this.returnSelection=null;this.pendingReturn=null;}}
    this.context=context;this.lastAt=now;this.state=state;this.sampleSerial++;
    this.updateReturn(now);
    const next=new Map();
    for(const input of state.grenades||[]){
      const g={...input};
      if(g.type==='inferno'&&g.flames?.length){const points=g.flames.filter(vec);if(points.length)g.position=[0,1,2].map(i=>points.reduce((sum,p)=>sum+p[i],0)/points.length);}
      if(!active(g))continue;
      const id=String(g.entity_id),old=this.records.get(id);
      const same=old && old.owner===g.owner && old.type===g.type;
      // firstSeen is local GOTV receipt time. Baseline objects deliberately have unknown birth time.
      const record={...g,id,firstSeen:same?old.firstSeen:reset?null:now,samples:same?old.samples+1:1,at:now,history:same?old.history.slice(-11):[]};
      record.velocity=vec(g.velocity)?g.velocity:(same&&now>old.at?g.position.map((x,i)=>(x-old.position[i])*1000/(now-old.at)):null);
      record.history.push({at:now,position:g.position.slice()});
      next.set(id,record);
    }
    this.records=next;
    if(this.session){
      if(state.round?.phase==='over'||state.map?.phase==='gameover'){this.stop('回合结束',true);return;}
      const r=next.get(this.session.id);
      if(!r){
        const previous=this.lastTarget;
        // Fire projectile and inferno may have different entity IDs. Continue only a nearby effect from the same owner.
        const effect=this.session.kind==='firebomb'&&previous?[...next.values()].filter(g=>g.type==='inferno'&&g.owner!=null&&String(g.owner)===String(this.session.owner)&&g.position.reduce((n,v,i)=>n+(v-previous.position[i])**2,0)<512**2).sort((a,b)=>a.position.reduce((n,v,i)=>n+(v-previous.position[i])**2,0)-b.position.reduce((n,v,i)=>n+(v-previous.position[i])**2,0))[0]:null;
        if(effect){delete this.session.endingAt;this.session.id=effect.id;this.message='继续追踪蔓延中的火';}
        else if(!this.session.endingAt){this.session.endingAt=now+this.config.holdMs;this.message='道具已消失，准备返回；可重新选择附近有效道具';}
      }
      if(r&&this.session.endingAt)delete this.session.endingAt;
      this.lastTarget=next.get(this.session.id)||this.lastTarget;
      if(r && (r.owner!==this.session.owner || kind(r.type)!==this.session.kind))this.stop('道具标识已变化',true);
    }
  }
  observed(){
    if(!this.state || !this.fresh())return null;
    const p=this.state.player;
    if(!p?.steamid || p.activity!=='playing')return null;
    return (this.state.players||[]).find(x=>String(x.entity_id)===String(p.steamid)&&vec(x.position)&&Number(x.state?.health)>0)||null;
  }
  fresh(){return this.lastAt!==null && this.clock()-this.lastAt<=MAP_STALE_MS;}
  motionFresh(){return this.lastAt!==null && this.clock()-this.lastAt<=this.config.staleMs;}
  cameraStatus(){
    const fresh=this.lastAt!==null && this.clock()-this.lastAt<=MAP_STALE_MS;
    const mapName=fresh && this.state?.player?.activity!=='menu'?normalizeCameraMap(this.state?.map?.name):'';
    const data=Object.hasOwn(MAP_CAMERAS,mapName)?MAP_CAMERAS[mapName]:null;
    return {mapName,mapLabel:data?.label||'',mapEpoch:this.mapEpoch,fresh,
      presets:data?data.presets.map(({id,label})=>({id,label})):[],
      lastSentId:mapName&&this.link.ready?this.cameraSelection?.id||null:null,
      canReturn:!!(mapName&&this.link.ready&&(this.cameraSelection?.returnId||this.returnSelection?.returnId))};
  }
  goCamera(input){
    const current=this.cameraStatus();
    if(!current.fresh||!current.mapName)throw Error('等待有效的 GSI 地图信息');
    if(input.mapName!==current.mapName||input.mapEpoch!==current.mapEpoch)throw Error('地图已变化，请使用当前地图的机位按钮');
    const preset=Object.hasOwn(MAP_CAMERAS,current.mapName)?MAP_CAMERAS[current.mapName].presets.find(p=>p.id===input.id):null;
    if(!preset)throw Error('当前地图没有这个机位');
    if(!this.link.ready)throw Error('请先连接 CS2 并通过命令回显测试');
    const player=(this.state.players||[]).find(p=>String(p.entity_id)===String(this.state.player?.steamid)&&Number(p.state?.health)>0);
    const previous=this.session||this.cameraSelection||this.returnSelection;
    const returnTarget=previous?.returnId?{returnId:previous.returnId,returnName:previous.returnName}:player?{returnId:player.entity_id,returnName:player.name}:{};
    // Stop the timer and discard any queued utility camera before the static command.
    this.pendingReturn=null;this.stop('已切换固定机位',false);this.cameraSelection=null;
    // spec_goto selects the camera itself (as in CSDM's CS2 camera actions).
    // Avoid an extra spectator-mode transition before positioning. Live GOTV
    // behavior still needs verification against the user's running CS2 build.
    const command='spec_autodirector 0; spec_goto '+preset.pose.join(' ');
    this.link.write(command);this.lastCommand=command;
    this.cameraSelection={id:preset.id,...returnTarget};
    this.message='已发送机位：'+current.mapLabel+' · '+preset.label;
  }
  returnCamera(){
    if(this.pendingReturn){this.cancelReturn();return;}
    if(this.session){this.stop('手动停止',true);return;}
    const selection=this.cameraSelection||this.returnSelection;
    this.cameraSelection=null;this.link.clearCamera();
    if(selection)this.restorePlayer(selection);
  }
  cancelReturn(){
    this.pendingReturn=null;this.link.clearCamera();
    this.message='已取消自动返回；镜头由导播手动控制';
  }
  restorePlayer(selection){
    this.pendingReturn=null;this.returnSelection=selection;
    const current=this.cameraStatus();
    if(!this.link.ready||!current.fresh||!current.mapName){this.message='无法返回：控制连接或 GSI 已断开';return;}
    const player=(this.state.players||[]).find(p=>String(p.entity_id)===String(selection.returnId)&&Number(p.state?.health)>0);
    if(!player){this.returnSelection=null;this.message='原选手已阵亡或离开，请手动选择观战选手';return;}
    // HUD observer_slot is NOT the entity slot accepted by spec_player.
    // CS2 requires spec_mode 1 BEFORE selecting a player (CSDM JSON actions).
    const name=String(player.name||'');
    const safe=name.length>0&&name.length<128&&!/[";\\\r\n\0]/.test(name)&&!/^\d+$/.test(name)&&!(this.state.players||[]).some(p=>String(p.entity_id)!==String(player.entity_id)&&String(p.name||'').toLowerCase().includes(name.toLowerCase()));
    if(!safe){this.message='无法直接返回：原选手名称无法唯一、安全地定位，请手动选择观战选手';return;}
    const command='spec_autodirector 0; spec_mode '+this.config.eyeMode+'; spec_player "'+name+'"';
    try{
      this.link.clearCamera();this.link.write(command);this.lastCommand=command;
      this.pendingReturn={...selection,returnName:name,started:this.clock(),serial:this.sampleSerial};
      this.message='已发送返回 '+name+' 的指令，等待 GSI 目标确认';
    }catch(e){this.message='返回失败：'+e.message;}
  }
  updateReturn(now=this.clock()){
    const r=this.pendingReturn;if(!r)return;
    if(!this.link.ready||!this.fresh()||now-r.started>4500){this.pendingReturn=null;this.message='返回未获确认，可点返回重试或手动选择选手';return;}
    if(this.sampleSerial<=r.serial)return;
    if(String(this.state.player?.steamid)===String(r.returnId)){
      this.pendingReturn=null;this.returnSelection=null;this.message='GSI 目标身份匹配：'+r.returnName+'；第一人称视角请在游戏中确认';return;
    }
    const alive=(this.state.players||[]).some(p=>String(p.entity_id)===String(r.returnId)&&Number(p.state?.health)>0);
    if(!alive){this.pendingReturn=null;this.returnSelection=null;this.message='原选手已阵亡或离开，请手动选择观战选手';return;}
    // GSI only confirms the direct selection; never cycle through other players.
  }
  select(type,player,now=this.clock()){
    const candidates=[...this.records.values()].filter(g=>kind(g.type)===type);
    const age=g=>Number.isFinite(g.lifetime)&&g.lifetime>=0?g.lifetime*1000+Math.max(0,now-g.at):g.firstSeen!==null?now-g.firstSeen:Infinity;
    const own=candidates.filter(g=>String(g.owner)===String(player.entity_id)&&age(g)<=2000);
    own.sort((a,b)=>age(a)-age(b) || a.id.localeCompare(b.id));
    if(own.length)return {target:own[0],reason:'当前选手最近 2 秒投出'};
    const d=g=>g.position.reduce((n,x,i)=>n+(x-player.position[i])**2,0);
    candidates.sort((a,b)=>d(a)-d(b)||age(a)-age(b)||a.id.localeCompare(b.id));
    return candidates.length?{target:candidates[0],reason:'距离当前选手最近'}:null;
  }
  heartbeat(){this.leaseUntil=this.clock()+2500;}
  start(type){
    if(!TYPES[type])throw new Error('请选择闪、烟、雷或火');
    if(this.session)throw new Error('已有追踪目标，请先停止／返回');
    if(!this.fresh())throw new Error('GSI 数据未连接或已过期');
    const player=this.observed();if(!player)throw new Error('请先观战一名存活选手');
    if(this.state.round?.phase==='over'||this.state.map?.phase==='gameover')throw new Error('回合已结束');
    const chosen=this.select(type,player);if(!chosen)throw new Error('暂无可追踪的'+TYPES[type]);
    if(!this.link.ready)throw new Error('请先连接 CS2 并通过命令回显测试');
    this.cameraSelection=null;this.pendingReturn=null;this.returnSelection=null;this.heartbeat();this.lastTarget=chosen.target;this.lastSend=0;this.lastCamera=null;
    const g=chosen.target;
    this.session={id:g.id,kind:type,owner:g.owner,returnId:player.entity_id,returnName:player.name,started:this.clock(),reason:chosen.reason,direction:norm([g.velocity?.[0]||0,g.velocity?.[1]||0,0])||norm([g.position[0]-player.position[0],g.position[1]-player.position[1],0])||[1,0,0]};
    try{this.link.clearCamera();this.link.write('spec_autodirector 0');this.message='追踪'+TYPES[type]+' · '+chosen.reason;this.tick(true);}catch(e){this.session=null;throw e;}
    return this.status();
  }
  tick(force=false){
    const now=this.clock();this.updateReturn(now);const s=this.session;if(!s)return;
    if(!this.link.ready){this.stop('控制连接已断开',false);return;}
    if(now>this.leaseUntil){this.stop('控制面板失联，已停止追踪',true);return;}
    if(!this.fresh()){this.stop('GSI 断流，已停止追踪',false);return;}
    if(now-s.started>this.config.maxSeconds*1000){this.stop('追踪达到时限',true);return;}
    if(s.endingAt){if(now>=s.endingAt)this.stop('追踪结束',true);return;}
    // Keep the connection/session alive across the 1s GSI heartbeat, but freeze old motion samples.
    if(!this.motionFresh()){this.link.clearCamera();return;}
    const interval=1000/this.config.fps;
    if(!force && now-this.lastSend<interval-1)return;
    const g=this.records.get(s.id);if(!g)return;
    const dt=this.lastCamera?Math.min(100,Math.max(1,now-this.lastSend)):interval;
    this.lastSend=now;
    // Render a short buffered timeline, filling GSI gaps without a staircase.
    const at=now-60,history=g.history||[];
    let target=g.position.slice();
    for(let i=1;i<history.length;i++){
      const a=history[i-1],b=history[i];
      if(at>=a.at&&at<=b.at&&b.at>a.at){const f=(at-a.at)/(b.at-a.at);target=a.position.map((v,j)=>v+(b.position[j]-v)*f);break;}
    }
    const effect=g.type==='inferno'||g.flames?.length||Number(g.effect_time)>0;
    if(history.length&&at<history[0].at)target=history[0].position.slice();
    if(at>g.at&&vec(g.velocity)&&!effect){const ahead=Math.min(80,at-g.at)/1000;target=g.position.map((v,i)=>v+Math.max(-2500,Math.min(2500,g.velocity[i]))*ahead);}
    const velocity=vec(g.velocity)?[g.velocity[0],g.velocity[1],0]:null;
    // Keep the camera above the grenade even when its trajectory climbs steeply.
    if(velocity&&Math.hypot(...velocity)>30&&!effect){
      const wanted=Math.atan2(velocity[1],velocity[0]),previous=Math.atan2(s.direction[1],s.direction[0]);
      const diff=Math.atan2(Math.sin(wanted-previous),Math.cos(wanted-previous));
      const angle=previous+Math.max(-Math.PI*dt/1000,Math.min(Math.PI*dt/1000,diff));
      s.direction=[Math.cos(angle),Math.sin(angle),0];
    }
    let pos=target.map((v,i)=>v-s.direction[i]*this.config.distance+(i===2?this.config.height:0));
    const alpha=1-Math.exp(-dt/this.config.smoothingMs);
    if(this.lastCamera)pos=pos.map((v,i)=>this.lastCamera[i]+(v-this.lastCamera[i])*alpha);
    const delta=target.map((v,i)=>v-pos[i]);let yaw=Math.atan2(delta[1],delta[0])*180/Math.PI;
    let pitch=-Math.atan2(delta[2],Math.hypot(delta[0],delta[1]))*180/Math.PI;
    if(this.lastCamera&&this.lastAngles){
      yaw=this.lastAngles[1]+Math.atan2(Math.sin((yaw-this.lastAngles[1])*Math.PI/180),Math.cos((yaw-this.lastAngles[1])*Math.PI/180))*180/Math.PI*alpha;
      pitch=this.lastAngles[0]+(pitch-this.lastAngles[0])*alpha;
    }
    this.lastAngles=[pitch,yaw];
    if(![...pos,pitch,yaw].every(Number.isFinite)){this.stop('道具坐标异常',false);return;}
    this.lastCamera=pos;this.lastCommand='spec_goto '+[...pos,pitch,yaw].map(v=>v.toFixed(2)).join(' ');
    try{this.link.camera(this.lastCommand);}catch(e){this.stop(e.message,false);}
  }
  stop(reason='已停止追踪',restore=true){
    const s=this.session;this.session=null;this.link.clearCamera();
    if(!s)return;
    this.message=reason;
    this.returnSelection={returnId:s.returnId,returnName:s.returnName};
    if(restore){this.restorePlayer(this.returnSelection);this.message=reason+"；"+this.message;}
  }

  status(){const p=this.observed();return {returning:!!this.pendingReturn,cameras:this.cameraStatus(),controls:this.controls.status(),config:this.config,connected:this.link.connected,verified:this.link.ready,error:this.link.error, fresh:this.fresh(),observed:p?{id:p.entity_id,name:p.name}:null,active:this.session?{...this.session,typeName:TYPES[this.session.kind]}:null,message:this.message,lastCommand:this.lastCommand,counts:Object.fromEntries(Object.keys(TYPES).map(k=>[k,this.fresh()?[...this.records.values()].filter(g=>kind(g.type)===k).length:0]))};}
  dispose(){this.stop('程序退出',true);clearInterval(this.timer);this.link.close();}
}
function trackerRoutes(tracker){
  const key=crypto.randomBytes(24).toString('hex');
  return async(req,res,url)=>{
    if(!url.pathname.startsWith('/api/tracker'))return false;
    const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){send(403,{error:'镜头控制仅限本机'});return true;}
    if(!['127.0.0.1','localhost','[::1]'].includes(new URL('http://'+req.headers.host).hostname)){send(403,{error:'Host 不允许'});return true;}
    if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`){send(403,{error:'来源不允许'});return true;}
    if(req.method==='GET'&&url.pathname==='/api/tracker'){send(200,{...tracker.status(),key});return true;}
    if(req.method!=='POST'){send(405,{error:'不支持此操作'});return true;}
    if(req.headers['x-tracker-key']!==key){send(403,{error:'控制凭据已失效，请刷新页面'});return true;}
    try{
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw new Error('请求过大');}
      const input=raw?JSON.parse(raw):{};
      switch(url.pathname){
        case '/api/tracker/toggle': await tracker.controls.toggle(input.key);break;
        case '/api/tracker/refresh-controls': await tracker.controls.exchange([]);break;
        case '/api/tracker/config': tracker.configure(input);break;
        case '/api/tracker/connect': await tracker.link.connect(tracker.config);await tracker.controls.exchange([]);tracker.message='命令回显通过；镜头效果请在 GOTV 中确认';break;
        case '/api/tracker/disconnect': tracker.stop('已断开',true);tracker.link.close();break;
        case '/api/tracker/start': tracker.start(input.type);break;
        case '/api/tracker/camera': tracker.goCamera(input);break;
        case '/api/tracker/stop': tracker.returnCamera();break;
        case '/api/tracker/cancel-return': tracker.cancelReturn();break;
        case '/api/tracker/heartbeat':tracker.heartbeat();break;
        default:send(404,{error:'未知操作'});return true;
      }
      send(200,tracker.status());
    }catch(e){send(400,{...tracker.status(),error:e.message});}
    return true;
  };
}
module.exports={GameControls,GrenadeTracker,ConsoleLink,trackerRoutes,kind,active,packet,TYPES};
