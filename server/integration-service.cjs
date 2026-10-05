const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const dgram = require('node:dgram');
const {spawn} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const delay = ms => new Promise(r => setTimeout(r, ms));
const defaults = {replay:{port:7788,autoStart:false},voicebridge:{port:8787,autoStart:false}};
const names = {replay:'Replay',voicebridge:'VoiceBridge'};
function writeJSON(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file);}
async function probe(port,udp=false){
  return new Promise((resolve,reject)=>{
    const s=udp?dgram.createSocket('udp4'):net.createServer();
    s.once('error',()=>{try{s.close()}catch{}reject(Error(`${udp?'UDP':'TCP'} ${port} 已被占用，请先退出独立运行的模块或修改端口。`))});
    if(udp)s.bind(port,'127.0.0.1',()=>s.close(resolve));else s.listen(port,'127.0.0.1',()=>s.close(resolve));
  });
}
function createIntegrationService({dataDir,moduleRoot=path.join(__dirname,'..','modules'),selectDirectory,nodeExecutable,replayExecutable,getState=()=>({})}={}){
  const root=path.join(dataDir,'integrations'),prefsFile=path.join(root,'settings.json');
  fs.mkdirSync(root,{recursive:true});
  let saved={};if(fs.existsSync(prefsFile))saved=JSON.parse(fs.readFileSync(prefsFile,'utf8'));
  const prefs={},records={};
  for(const id of Object.keys(defaults)){
    const v={...defaults[id],followMain:true,swapTeams:false,...saved[id]};
    if(!Number.isInteger(v.port)||v.port<1024||v.port>65535||typeof v.autoStart!=='boolean')throw Error(`无效 ${id} 集成设置，请检查 ${prefsFile}`);
    prefs[id]=v;records[id]={phase:'stopped',error:'',child:null,desired:false,busy:false,generation:0};
  }
  if(prefs.replay.port===prefs.voicebridge.port)throw Error('Replay 和 VoiceBridge 端口不能相同');
  let origin='',reserved=[],closed=false;
  const dataPath=id=>path.join(root,id);
  const url=id=>`http://127.0.0.1:${prefs[id].port}`;
  const identity=require('./integration-identity.cjs').createIdentitySync({getState,dataDir,prefs,records,url});
  function record(id){if(!Object.hasOwn(records,id))throw Error('未知模块');return records[id];}
  function meta(id){const r=record(id);return {id,name:names[id],version:id==='replay'?'0.2.6':'0.6.4-sd',...prefs[id],identity:identity.meta(id),phase:r.phase,error:r.error,generation:r.generation,controlUrl:url(id)+'/',outputUrl:url(id)+(id==='replay'?'/output.html':'/overlay?output=program'),dataDir:dataPath(id),logFile:path.join(root,id+'.log'),busy:r.busy};}
  function all(){return Object.fromEntries(Object.keys(records).map(id=>[id,meta(id)]));}
  function prepareVoice(){const d=dataPath('voicebridge');fs.mkdirSync(d,{recursive:true});const f=path.join(d,'.env');if(!fs.existsSync(f))fs.copyFileSync(path.join(moduleRoot,'voicebridge','.env.example'),f);}
  async function prepareReplay(){
    const response=await fetch(url('replay')+'/api/state',{signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('无法读取 Replay 默认转场设置');
    const {state}=await response.json();
    const missing=[1,2].filter(slot=>!state.output['transition'+slot]);
    if(!missing.length)return;
    const video=await fs.promises.readFile(path.join(moduleRoot,'replay','assets','Replay-gold.mp4'));
    for(const slot of missing){
      const result=await fetch(url('replay')+`/api/output/transition/${slot}?name=Replay-gold.mp4`,{
        method:'POST',headers:{'Content-Type':'video/mp4'},body:video,signal:AbortSignal.timeout(10000)
      });
      if(!result.ok)throw Error(`Replay 默认转场 ${slot} 导入失败（HTTP ${result.status}）`);
    }
  }
  async function launch(id){
    const r=record(id);if(closed)throw Error('ScoreDeck 正在退出');
    if(r.child)throw Error('模块仍在运行或退出中');
    if(!origin)throw Error('ScoreDeck 尚未就绪');
    if(reserved.includes(prefs[id].port))throw Error('模块端口与 ScoreDeck / RadarHUD 重复，请修改后重试');
    r.phase='starting';r.error='';
    await probe(prefs[id].port);
    if(id==='voicebridge')await probe(8790,true);
    if(closed||!r.desired){r.phase='stopped';return;}
    fs.mkdirSync(dataPath(id),{recursive:true});
    if(id==='voicebridge')prepareVoice();
    const instance=randomUUID(),dir=path.join(moduleRoot,id);
    const bundledNode=path.join(dir,'bin','node.exe');
    const voiceNode=nodeExecutable||(process.platform==='win32'&&(fs.existsSync(bundledNode)||process.versions.electron)?bundledNode:process.execPath);
    const executable=id==='replay'?(replayExecutable||path.join(dir,process.platform==='win32'?'ProjectReplay.exe':'ProjectReplay')):voiceNode;
    const args=id==='replay'?['-role','director','-listen',`127.0.0.1:${prefs[id].port}`,'-data',dataPath(id),'-no-browser','-scoredeck-managed','-scoredeck-origin',origin]:[path.join(dir,'server.mjs')];
    if(!fs.existsSync(executable))throw Error(`${names[id]} 可执行文件缺失，请完整解压 Windows 整合包。`);
    const env={...process.env,SD_INSTANCE:instance};
    delete env.ELECTRON_RUN_AS_NODE;
    if(id==='voicebridge')Object.assign(env,{PORT:String(prefs[id].port),HOST:'127.0.0.1',PCM_BRIDGE_PORT:'8790',VB_DATA_DIR:dataPath(id),VB_SUPERVISED:'1',SD_ORIGIN:origin});
    const logFile=path.join(root,id+'.log');
    if(fs.existsSync(logFile)&&fs.statSync(logFile).size>4*1024*1024){fs.rmSync(logFile+'.previous',{force:true});fs.renameSync(logFile,logFile+'.previous');}
    const out=fs.openSync(logFile,'a');let child;
    try{child=spawn(executable,args,{cwd:dir,env,windowsHide:true,stdio:id==='voicebridge'?['pipe',out,out,'ipc']:['pipe',out,out]});}finally{fs.closeSync(out);}
    r.child=child;r.instance=instance;
    child.stdin.on('error',()=>{});
    child.once('error',e=>{r.error=`${names[id]} 启动失败：${e.message}`;r.phase='error';});
    child.once('close',(code,signal)=>{
      if(r.child!==child)return;r.child=null;
      if(id==='voicebridge'&&code===75&&r.desired&&!closed){
        r.phase='restarting';
        setImmediate(()=>launch(id).catch(async e=>{await stop(id);r.error=e.message;r.phase='error';}));
      }else if(r.desired&&!closed){r.phase='error';r.error=`${names[id]} 已退出（${signal||code}），请查看运行日志。`;r.desired=false;}
      else r.phase='stopped';
    });
    // Verify this exact child, never attach to an unrelated process on a reused port.
    for(let i=0;i<120;i++){
      if(r.child!==child||r.phase==='error')throw Error(r.error||'模块在启动过程中退出');
      let ready=false;
      try{
        const response=await fetch(url(id)+(id==='replay'?'/scoredeck/health':'/healthz'),{signal:AbortSignal.timeout(400)});
        const status=await response.json();
        ready=response.ok&&status.ok&&status.instance===instance;
      }catch{}
      if(ready){
        if(id==='replay')await prepareReplay();
        r.phase='running';r.generation++;await identity.sync(id,true);return meta(id);
      }
      await delay(150);
    }
    throw Error(`${names[id]} 启动超时，请查看运行日志。`);
  }
  async function stop(id){
    const r=record(id);r.desired=false;const child=r.child;
    if(!child){r.phase='stopped';return;}
    r.phase='stopping';
    try{if(id==='voicebridge'&&child.connected)child.send({type:'scoredeck-stop'},()=>{});else child.stdin.end('shutdown\n');}catch{}
    const end=Date.now()+45000;
    while(r.child===child&&Date.now()<end)await delay(100);
    if(r.child===child){
      child.kill();
      const forced=Date.now()+5000;while(r.child===child&&Date.now()<forced)await delay(100);
      r.error='模块未在 45 秒内退出，已终止进程；请检查最近会话数据。';
      if(r.child===child)throw Error('模块进程未能退出，请在任务管理器检查');
    }
    r.phase='stopped';
  }
  async function action(id,op,input={}){
    const r=record(id);if(closed)throw Error('ScoreDeck 正在退出');
    if(r.busy||['starting','restarting','stopping'].includes(r.phase))throw Error('模块正在处理上一项操作，请稍后重试');
    r.busy=true;
    try{
      if(op==='start'){if(r.child)return meta(id);r.desired=true;try{await launch(id)}catch(e){await stop(id);r.phase='error';r.error=e.message;throw e;}}
      else if(op==='stop')await stop(id);
      else if(op==='restart'){await stop(id);r.desired=true;try{await launch(id)}catch(e){await stop(id);r.phase='error';r.error=e.message;throw e;}}
      else if(op==='settings'){
        if(r.child)throw Error('请停止模块后修改启动设置');
        if(!Number.isInteger(input.port)||input.port<1024||input.port>65535||typeof input.autoStart!=='boolean')throw Error('请输入 1024–65535 之间的端口和有效的自启选项');
        if(reserved.includes(input.port)||Object.keys(prefs).some(k=>k!==id&&prefs[k].port===input.port))throw Error('此端口已分配给其他模块');
        prefs[id]={...prefs[id],port:input.port,autoStart:input.autoStart};writeJSON(prefsFile,prefs);
      }else if(op==='identity'){
        if(typeof input.followMain!=='boolean'||typeof input.swapTeams!=='boolean')throw Error('无效主赛跟随设置');
        prefs[id]={...prefs[id],followMain:input.followMain,swapTeams:input.swapTeams};writeJSON(prefsFile,prefs);identity.reset(id);await identity.sync(id,true);
      }else if(op==='import'){
        if(r.child)throw Error('导入前请停止模块，并退出旧版程序');
        let source=input.directory;
        if(input.browse){if(!selectDirectory)throw Error('请手动填写旧版程序目录');source=await selectDirectory(id);if(!source)return meta(id);}
        if(typeof source!=='string'||!path.isAbsolute(source))throw Error('请选择旧版程序的绝对路径');
        source=path.resolve(source);const target=dataPath(id);
        if(source===target||source.startsWith(target+path.sep)||target.startsWith(source+path.sep))throw Error('不能从当前模块数据目录或其父子目录导入');
        if(id==='replay'&&fs.existsSync(path.join(source,'replay-data')))source=path.join(source,'replay-data');
        const list=id==='replay'?fs.readdirSync(source).filter(n=>n!=='instance.lock'):['.env','api-settings.json','hotwords-preset.json','team-names.json','desktop-settings.json',...(input.includeRecordings?['runtime']:[])].filter(n=>fs.existsSync(path.join(source,n)));
        if(!list.length||(id==='replay'&&!list.includes('state.json')))throw Error('未找到对应的旧版配置文件');
        const stage=target+'.import-'+Date.now();fs.mkdirSync(stage,{recursive:true});
        let backup=null;
        try{
          for(const name of list){await fs.promises.cp(path.join(source,name),path.join(stage,name),{recursive:true,filter:src=>{if(fs.lstatSync(src).isSymbolicLink())throw Error('导入目录包含符号链接，请使用实际文件');return true;}});}
          for(const name of list.filter(n=>n.endsWith('.json')))JSON.parse(fs.readFileSync(path.join(stage,name),'utf8'));
          if(id==='replay'){
            const stateFile=path.join(stage,'state.json'),state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
            if(!state.state?.config||!Array.isArray(state.state.artifacts))throw Error('Replay 存档结构无效');
            const rebase=value=>{
              if(typeof value==='string'&&path.isAbsolute(value)){
                const relative=path.relative(source,value);
                if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))return path.join(target,relative);
              }
              if(Array.isArray(value))return value.map(rebase);
              if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rebase(v)]));
              return value;
            };
            writeJSON(stateFile,rebase(state));
          }else if(list.includes('team-names.json')){
            const names=JSON.parse(fs.readFileSync(path.join(stage,'team-names.json'),'utf8'));
            for(const key of ['channel-alpha','channel-bravo'])if(typeof names[key]!=='string'||!names[key].trim()||Array.from(names[key]).length>24)throw Error('VoiceBridge 队名配置无效');
          }
          if(fs.existsSync(target)){backup=target+'.backup-'+Date.now();fs.renameSync(target,backup);}
          fs.renameSync(stage,target);r.error='';
        }catch(e){fs.rmSync(stage,{recursive:true,force:true});if(backup&&!fs.existsSync(target))fs.renameSync(backup,target);throw e;}
      }else throw Error('未知模块操作');
      return meta(id);
    }finally{r.busy=false;}
  }
  return {all,meta,action,active:()=>Object.values(records).some(r=>r.child||r.busy||r.desired),
    configure(o,ports){origin=o;reserved=ports},
    async autoStart(){for(const id of Object.keys(records))if(prefs[id].autoStart)await action(id,'start').catch(e=>{records[id].phase='error';records[id].error=e.message;})},
    async close(){closed=true;identity.close();await Promise.all(Object.keys(records).map(stop));},
  };
}
module.exports={createIntegrationService};
