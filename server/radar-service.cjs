const { fork } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const {HUD_PORT,GSI_PORT,resolvePort}=require('../radarhud/ports.cjs');
function createRadarService({dataDir}) {
  const root=path.join(__dirname,'..','radarhud');
  const hudPort=resolvePort(process.env.SCOREDECK_RADAR_PORT,HUD_PORT);
  const gsiPort=resolvePort(process.env.SCOREDECK_GSI_PORT,GSI_PORT);
  let child=null, running=false, error='', log=null;
  const meta=()=>({running,error,hudPort,gsiPort,controlUrl:`http://127.0.0.1:${hudPort}/`,outputUrl:`http://127.0.0.1:${hudPort}/output`,gsiUrl:`http://127.0.0.1:${gsiPort}/gsi`,version:'0.3.11'});
  async function start() {
    if(child)return;
    if(![hudPort,gsiPort].every(p=>Number.isInteger(p)&&p>0&&p<65536)||hudPort===gsiPort){error='RadarHUD 端口配置无效，请使用两个不同的 1–65535 端口。';return;}
    const dir=path.join(dataDir,'radarhud');fs.mkdirSync(dir,{recursive:true});
    log=fs.createWriteStream(path.join(dir,'service.log'),{flags:'a'});
    let recent='';
    try {
      child=fork(path.join(root,'backend.cjs'),[],{cwd:root,execArgv:[],windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',RADAR_HUD_OPEN_BROWSER:'0',RADAR_HUD_PUBLIC_DIR:path.join(root,'public'),HUD_HOST:'127.0.0.1',HUD_PORT:String(hudPort),GSI_HOST:'127.0.0.1',GSI_PORT:String(gsiPort),GSI_TEMP_DIR:dir}});
      const proc=child;
      for(const stream of [proc.stdout,proc.stderr])stream.on('data',chunk=>{recent=(recent+chunk.toString()).slice(-3000);log?.write(chunk)});
      proc.on('exit',(code)=>{running=false;if(child===proc)child=null;if(code&&!error)error='RadarHUD 服务已退出，请查看 radarhud/service.log 并重启 ScoreDeck。';});
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>finish(new Error('启动超时')),15000);
        const finish=(err)=>{clearTimeout(timer);proc.off('message',ready);proc.off('error',failed);proc.off('exit',exited);err?reject(err):resolve()};
        const ready=m=>{if(m?.type==='ready'){running=true;finish()}};
        const failed=e=>finish(e),exited=code=>finish(new Error('退出码 '+code));
        proc.on('message',ready);proc.once('error',failed);proc.once('exit',exited);
      });
    } catch(e) {
      error=recent.includes('EADDRINUSE')?`RadarHUD 启动失败：端口 ${hudPort} 或 ${gsiPort} 已被占用。请关闭独立 RadarHUD 或占用程序后重启 ScoreDeck。`:'RadarHUD 启动失败：'+e.message+'。详情见 radarhud/service.log。';
      await close();
    }
  }
  async function close() {
    const proc=child;child=null;running=false;
    if(proc&&proc.exitCode===null&&proc.signalCode===null)await new Promise(resolve=>{
      const timer=setTimeout(()=>{proc.kill();resolve()},4000);
      proc.once('exit',()=>{clearTimeout(timer);resolve()});
      if(proc.connected)proc.send({type:'stop'},err=>{if(err)proc.kill()});else proc.kill();
    });
    if(log){log.end();log=null;}
  }
  return {start,close,meta};
}
module.exports={createRadarService};
