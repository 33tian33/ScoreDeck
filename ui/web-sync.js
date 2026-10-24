function sdWebSyncPanel(){
 const h=l.createElement,[source,setSource]=l.useState('https://hushang985.online/'),[preview,setPreview]=l.useState(null),[pending,setPending]=l.useState(false),[message,setMessage]=l.useState(''),[status,setStatus]=l.useState(null),request=l.useRef(null);
 l.useEffect(()=>{let alive=true,timer;const controller=new AbortController();async function poll(){try{const next=await SDClient.request('/api/web-sync',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(5000)])});if(alive){setStatus(next);if(request.current&&next.job?.requestId===request.current){setMessage('');if(!next.busy)request.current=null;}}}catch{}if(alive)timer=setTimeout(poll,1000);}void poll();return()=>{alive=false;clearTimeout(timer);controller.abort();};},[]);
 const active=status?.busy||pending;
 const run=async action=>{
  if(pending||status?.busy)return;
  if(SDClient.pending||SDClient.failedDraft){setMessage('请先完成保存并处理未保存修改');return;}
  setPending(true);setMessage('');let requestId;
  try{
   if(action==='preview'){
    const result=await SDClient.request('/api/web-sync/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source})});setPreview(result);setMessage('预览已就绪，可以开始同步。');
   }else{
    requestId=request.current ||= typeof crypto.randomUUID==='function'?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2);
    const body=JSON.stringify({source,token:preview?.token,requestId});let result;
    // Retrying the same request attaches to the existing job if its reply was lost.
    for(let attempt=0;attempt<3;attempt++){try{result=await SDClient.request('/api/web-sync/start',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(5000)});break;}catch(error){if(error.status||attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));}}
    setStatus(result);setPreview(null);request.current=null;
   }
  }catch(error){if(requestId&&!error.status){request.current=requestId;setMessage('连接暂时中断，正在恢复同步进度…');}else{setMessage(error.message);request.current=null;}}finally{setPending(false);}
 };
 const job=status?.job,counts=(status?.busy?job?.counts:null)||preview?.counts||job?.counts||status?.counts,warnings=preview?.warnings||job?.warnings||status?.warnings||[];
 const phaseMessage=job?.phase==='completed'?`同步完成。同步前备份：${job.result.backup}`:job?.phase==='failed'?job.error:status?.busy?({reading:'正在读取网站赛事…',downloading:'正在并行下载图片（最多 8 路），单次请求超时为 3 分 30 秒，短暂网络故障会自动重试；可以切换栏目，后台会继续同步。',saving:'图片已就绪，正在保存赛事…'}[job?.phase]||'正在读取网站预览…'):'';
 const progress=status?.progress,processed=(progress?.completed||0)+(progress?.failed||0),percent=progress?.total?Math.floor(processed/progress.total*100):0;
 return h('section',{className:'panel sd-web-sync-panel'},
  h('div',{className:'panel-heading'},h('h2',null,'网页赛事同步')),
  h('div',{className:'sd-recovery-body'},
   h('p',{className:'hint'},'点击一次即可读取网站完整赛事并将图片下载到本地。已下载的资源自动复用，短暂网络故障自动重试。重复同步更新同源记录，保留无关本地数据；网站删除的记录会保留在本地。'),
   h('label',null,'赛事网站',h('input',{type:'url',value:source,disabled:active,onChange:e=>{setSource(e.target.value);setPreview(null);request.current=null;},style:{width:'100%'}})),
   h('div',{className:'sync-actions'},h('button',{className:'button primary',disabled:active,onClick:()=>run('sync')},active?'同步处理中…':job?.phase==='failed'?'重试同步':'开始同步'),h('button',{className:'button secondary',disabled:active,onClick:()=>run('preview')},'仅预览网站数据')),
   (preview?.name||job?.name)&&h('p',null,'网站赛事：'+(preview?.name||job.name)),
   counts&&h('p',{className:'hint'},`${counts.teams} 支队伍 · ${counts.players} 位选手 · ${counts.matches} 场比赛 · ${counts.stages} 个赛段 · ${counts.sponsors} 个赞助商`),
   ...warnings.map((x,i)=>h('p',{key:i,className:'hint'},x)),
   status?.lastSync&&h('p',{className:'hint'},'上次同步：'+new Date(status.lastSync).toLocaleString()),
   progress?.total>0&&h('progress',{'aria-label':'素材处理进度',max:progress.total,value:processed,style:{width:'100%'}}),
   progress?.total>0&&h('p',{role:'status',className:'hint'},`素材处理：${processed} / ${progress.total}（${percent}%） · 正在处理 ${progress.active||0} · 复用 ${progress.reused} · 下载 ${progress.downloaded}${progress.retries?' · 自动重试 '+progress.retries+' 次':''}${progress.failed?' · 失败 '+progress.failed:''}`),
   h('p',{role:'status',className:'hint'},message||phaseMessage)));
}
