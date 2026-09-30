// Included verbatim in the application bundle by scripts/build-integrations.cjs.
function sdIntegrationPanel({id,active}) {
  const h=l.createElement;
  const [visited,setVisited]=l.useState(false),[status,setStatus]=l.useState(null);
  const [busy,setBusy]=l.useState(false),[message,setMessage]=l.useState('');
  const [port,setPort]=l.useState(''),[autoStart,setAutoStart]=l.useState(false);
  const [directory,setDirectory]=l.useState(''),[includeRecordings,setIncludeRecordings]=l.useState(false);
  const [fullscreen,setFullscreen]=l.useState(false),[settingsOpen,setSettingsOpen]=l.useState(false);
  const frame=l.useRef(null),identityPending=l.useRef(false);
  const openModuleSettings=()=>{if(status?.phase==='running')frame.current?.contentWindow?.postMessage({type:'scoredeck-open-settings'},new URL(status.controlUrl).origin);};
  const local=['127.0.0.1','localhost','::1'].includes(location.hostname),title=id==='replay'?'Replay 回放':'VoiceBridge 语音';
  const labels={stopped:'已停止',starting:'正在启动',running:'运行中',restarting:'正在重启',stopping:'正在保存并退出',error:'启动或运行异常'};
  l.useEffect(()=>{if(active)setVisited(true);else setFullscreen(false);},[active]);
  l.useEffect(()=>{
    if(!visited||!local)return;let mounted=true;
    const poll=()=>fetch('/api/integrations').then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);if(mounted&&!identityPending.current)setStatus(d[id]);}).catch(e=>{if(mounted)setMessage(e.message)});
    poll();const timer=setInterval(poll,1500);return()=>{mounted=false;clearInterval(timer)};
  },[visited,id,local]);
  l.useEffect(()=>{if(status){setPort(String(status.port));setAutoStart(status.autoStart);}},[status?.port,status?.autoStart]);
  const act=async(op,data={})=>{
    if(['stop','restart','import'].includes(op)&&!confirm(op==='import'?'确认旧版程序已退出。导入将替换该模块的数据目录，当前数据会先备份。继续？':'此操作会中断该模块的采集、预听和播出。继续？'))return;
    if(op==='identity'){identityPending.current=true;setStatus(s=>({...s,identity:{...s.identity,...data,teams:data.swapTeams!==s.identity.swapTeams?[...s.identity.teams].reverse():s.identity.teams}}));}
    setBusy(true);setMessage('正在处理…');
    try{const s=await Vt('/api/integrations/'+id+'/'+op,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});setStatus(s);setMessage(op==='import'?'导入操作结束；已导入的数据将在下次启动时使用。':'操作完成');}
    catch(e){setMessage(e.message)}finally{identityPending.current=false;setBusy(false)};
  };
  const copy=async()=>{try{await navigator.clipboard.writeText(status.outputUrl);setMessage('已复制 OBS 浏览器源地址')}catch{setMessage('复制失败，请选中下方地址手动复制')}};
  if(!visited&&!active)return null;
  const transitional=busy||status?.busy||['starting','stopping','restarting'].includes(status?.phase),running=status?.phase==='running';
  return h('section',{className:'panel sd-integration-panel'+(fullscreen?' sd-integration-fullscreen':''),hidden:!active,'data-module':id},
    h('div',{className:'sd-integration-head'},h('div',null,h('p',{className:'eyebrow'},'BROADCAST MODULE'),h('h2',null,title),h('p',{className:'hint'},id==='replay'?'Project Replay 0.2.1 · 完整 Windows 导播台':'VoiceBridge 0.6.4-SD · 完整双频道语音导播台')),
      h('div',{className:'sd-module-actions'},h('span',{className:'sd-module-status '+(running?'running':'')},labels[status?.phase]||'等待连接'),h('button',{className:'button secondary','aria-expanded':settingsOpen,'aria-controls':'module-settings-'+id,onClick:()=>{setSettingsOpen(!settingsOpen);if(!settingsOpen)openModuleSettings();}},'设置'))),
    !local?h('p',{className:'hint'},'此模块连接本机 TS3、录制服务及 OBS，请在运行 ScoreDeck 的电脑上操作。远程赛事控制仍使用原有栏目。'):
    h(l.Fragment,null,
      h('div',{className:'sd-module-actions'},
        id==='voicebridge'?h('button',{className:'button',onClick:()=>window.sdOpenDirector?.()},'打开导播控制栏'):null,
        h('button',{className:'button primary',disabled:transitional||running||!status,onClick:()=>act('start')},'启动 '+(id==='replay'?'Replay':'VoiceBridge')),
        h('button',{className:'button secondary',disabled:transitional||!status||status.phase==='stopped',onClick:()=>act('restart')},'重启服务'),
        h('button',{className:'button secondary',disabled:transitional||!status||status.phase==='stopped',onClick:()=>act('stop')},'停止服务'),
        running&&h('a',{className:'button secondary',href:status.controlUrl,target:'_blank',rel:'noopener'},'独立窗口'),
        running&&h('button',{className:'button secondary',onClick:()=>setFullscreen(v=>!v)},fullscreen?'退出专注模式':'专注模式')),
      h('p',{role:'status','aria-live':'polite',className:'sd-module-message'},status?.error||message||'切换 ScoreDeck 栏目会保留此页面与后台服务。关闭 ScoreDeck 会保存并停止模块。'),
      status&&h('div',{className:'sd-module-output'},h('strong',null,'OBS 独立浏览器源'),h('code',null,status.outputUrl),h('button',{className:'button secondary',onClick:copy},'复制地址'),h('span',{className:'hint'},'1920 × 1080 · 60 fps')),
      h('div',{className:'sd-module-settings',id:'module-settings-'+id,hidden:!settingsOpen},
        h('div',{className:'sd-identity-settings'},h('h3',null,'主赛队伍同步'),
          h('label',{className:'sd-module-check'},h('input',{type:'checkbox',checked:status?.identity?.followMain!==false,disabled:transitional||!status,onChange:e=>act('identity',{followMain:e.target.checked,swapTeams:!!status?.identity?.swapTeams})}),'跟随当前主赛的队名、简称与主队标'),
          h('p',{className:'hint'},status?.identity?.matchId?[status.identity.stage,status.identity.round].filter(Boolean).join(' · '):'当前赛段没有主赛，队伍显示为待定'),
          h('div',{className:'sd-identity-teams'},...(status?.identity?.teams||[]).map((t,i)=>h('div',{key:i,className:'sd-identity-team'},t.logo?h('img',{src:t.logo,alt:''}):h('span',null,t.shortName),h('div',null,h('small',null,id==='replay'?(i?'开局 T':'开局 CT'):(i?'Bravo 频道':'Alpha 频道')),h('strong',null,t.name))))),
          h('label',{className:'sd-module-check'},h('input',{type:'checkbox',checked:!!status?.identity?.swapTeams,disabled:transitional||!status,onChange:e=>act('identity',{followMain:status.identity.followMain,swapTeams:e.target.checked})}),'交换两队对应位置'),
          h('p',{className:'hint'},id==='replay'?'这里设置第一回合的阵营；比赛中的换边仍按 Replay 的半场与加时参数自动处理。':'这里设置 Alpha / Bravo 频道对应的主赛队伍；TS3 实际频道绑定保持原设置。'),
          h('p',{className:status?.identity?.syncError?'sd-identity-error':'hint',role:'status'},status?.identity?.syncError?'同步失败：'+status.identity.syncError:status?.identity?.followMain===false?'已关闭跟随，可在模块内独立修改。':!running?'已保存，模块启动后自动同步。':status?.identity?.syncedAt?'已同步 · 主赛变化时自动更新':'等待同步…'),
          running&&h('button',{className:'button secondary',onClick:openModuleSettings},'打开模块完整设置')),
        h('h3',null,'启动设置与旧版配置导入'),
        h('div',{className:'sd-module-config-grid'},
          h('div',null,h('label',null,'HTTP 端口',h(sdTextField,{type:'number',min:1024,max:65535,value:port,disabled:running||transitional,onChange:e=>setPort(e.target.value)})),
            h('label',{className:'sd-module-check'},h(sdTextField,{type:'checkbox',checked:autoStart,disabled:running||transitional,onChange:e=>setAutoStart(e.target.checked)}),'随 ScoreDeck 自动启动'),
            h('button',{className:'button secondary',disabled:running||transitional||!status,onClick:()=>act('settings',{port:Number(port),autoStart})},'保存启动设置'),
            h('p',{className:'hint'},id==='voicebridge'?'TS3 插件 UDP 固定使用 8790。首次使用在下方完整页面中填写 API 并安装插件。':'中继公网 IP、凭据、群组码及录制节点等设置在下方「会话设置」中。')),
          h('div',null,h('label',null,'旧版程序 / 数据目录',h(sdTextField,{value:directory,onChange:e=>setDirectory(e.target.value),placeholder:id==='replay'?'D:/ProjectReplay/replay-data':'D:/VoiceBridge',disabled:running||transitional})),
            id==='voicebridge'&&h('label',{className:'sd-module-check'},h(sdTextField,{type:'checkbox',checked:includeRecordings,onChange:e=>setIncludeRecordings(e.target.checked)}),'同时导入默认 runtime 中的录音与历史（可能较大）'),
            h('div',{className:'sd-module-actions'},h('button',{className:'button secondary',disabled:running||transitional||!directory,onClick:()=>act('import',{directory,includeRecordings})},'导入填写的目录'),h('button',{className:'button secondary',disabled:running||transitional,onClick:()=>act('import',{browse:true,includeRecordings})},'选择目录并导入')),
            h('p',{className:'hint'},'请先退出旧版程序。原目录保留，已有集成数据会自动备份。自定义录音路径按原设置继续使用。'))),
        status&&h('p',{className:'hint'},'数据目录：',h('code',null,status.dataDir)),status&&h('p',{className:'hint'},'运行日志：',h('code',null,status.logFile))),
      running?h('iframe',{ref:frame,key:status.generation,title:title+'完整控制台',className:'sd-module-frame',src:status.controlUrl,allow:'autoplay; clipboard-read; clipboard-write; speaker-selection; fullscreen'}):h('div',{className:'sd-module-empty'},h('h3',null,transitional?'正在处理，请稍候…':'启动模块后显示完整控制台'),h('p',null,'本页保留模块的全部功能和设置。'))));
}
