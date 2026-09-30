(function(){
  'use strict';
  // Same-origin embedded previews share their parent's state transport. Each
  // subscription belongs to the child document and is released on navigation.
  // This leaves HTTP/1.1 connections available for control writes and media.
  let parentClient;
  try { if (window.parent !== window) parentClient = window.parent.SDClient; } catch {}
  if (parentClient) {
    const subscriptions = new Set();
    const client = Object.create(parentClient);
    client.subscribe = fn => {
      const detach = parentClient.subscribe(fn);
      const unsubscribe = () => { subscriptions.delete(unsubscribe); detach(); };
      subscriptions.add(unsubscribe);
      return unsubscribe;
    };
    const forward = event => window.dispatchEvent(new CustomEvent('scoredeck:sync', {detail:event.detail}));
    window.parent.addEventListener('scoredeck:sync', forward);
    addEventListener('pagehide', () => {
      for (const unsubscribe of [...subscriptions]) unsubscribe();
      window.parent.removeEventListener('scoredeck:sync', forward);
    }, {once:true});
    window.SDClient = client;
    return;
  }
  const clone=x=>structuredClone(x),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const observers=new Set();let confirmed=null,visible=null,meta=null,connection='connecting',queue=[],active=false,issue='',retry=null,failedDraft=null,clockOffset=0;
  const keyFromURL=new URLSearchParams(location.search).get('key');
  if(keyFromURL){sessionStorage.setItem('scoredeck-key',keyFromURL);const u=new URL(location.href);u.searchParams.delete('key');history.replaceState(null,'',u);}
  let key=sessionStorage.getItem('scoredeck-key')||'';
  function uuid(){if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;return [...b].map((n,i)=>([4,6,8,10].includes(i)?'-':'')+n.toString(16).padStart(2,'0')).join('');}
  const internal=['revision','lastSavedAt','serverEpoch','controlEpoch','serverTime'];
  function diff(a,b,path=[],out=[]){
    if(equal(a,b))return out;
    if(Array.isArray(a)&&Array.isArray(b)&&a.some((v,i)=>v?.id!==undefined&&v.id!==b[i]?.id)){out.push({path,before:a,after:b,missingBefore:false,remove:false});return out;}
    if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)&&(!Array.isArray(a)||a.length===b.length)){
      for(const k of new Set([...Object.keys(a),...Object.keys(b)])){if(path.length===0&&internal.includes(k))continue;diff(a[k],b[k],[...path,k],out);}
    }else out.push({path,before:a===undefined?null:a,after:b===undefined?null:b,missingBefore:a===undefined,remove:b===undefined});
    return out;
  }
  function apply(state,changes){
    for(const change of changes){let target=state;for(const part of change.path.slice(0,-1)){if(!target[part]||typeof target[part]!=='object')target[part]={};target=target[part];}const last=change.path.at(-1);if(change.remove)delete target[last];else target[last]=clone(change.after);}
    return state;
  }
  function publish(){
    if(confirmed){visible=clone(confirmed);for(const job of queue)apply(visible,job.changes);}
    for(const fn of observers)fn(visible,meta,connection);
    window.dispatchEvent(new CustomEvent('scoredeck:sync',{detail:{pending:queue.length,issue,connection,failedDraft:!!failedDraft}}));
  }
  function stopQueue(message){
    if(queue.length&&!failedDraft)failedDraft=clone(visible);
    const stopped=queue;queue=[];clearTimeout(retry);issue=message;
    for(const job of stopped){job.cancelled=true;job.reject(new Error(message));}
  }
  const retiredGenerations=new Set();
  function accept(state){
    const generation=state.serverEpoch+'/'+state.controlEpoch;
    if(retiredGenerations.has(generation))return;
    const restarted=confirmed&&state.serverEpoch!==confirmed.serverEpoch;
    const transferred=confirmed&&state.controlEpoch!==confirmed.controlEpoch;
    if(restarted||transferred){retiredGenerations.add(confirmed.serverEpoch+'/'+confirmed.controlEpoch);stopQueue(restarted?'服务已重新启动，旧操作已暂停。请检查草稿后重新操作。':'导播授权已交接，旧操作已暂停。请使用新的接班链接。');}
    if(!confirmed||restarted||transferred||Number(state.revision)>=Number(confirmed.revision)){
      if(Number.isFinite(state.serverTime))clockOffset=state.serverTime-Date.now();confirmed=state;publish();
    }
  }
  function authHeaders(){return {'X-ScoreDeck-Key':key,'X-ScoreDeck-Epoch':confirmed?.serverEpoch||'','X-ScoreDeck-Control-Epoch':confirmed?.controlEpoch||''};}
  async function request(url,options={}){
    const response=await fetch(url,{...options,headers:{...authHeaders(),...options.headers}});
    const result=await response.json();
    if(!response.ok){const error=new Error(result.error||`请求失败 ${response.status}`);error.status=response.status;error.current=result.current;throw error;}
    return result;
  }
  function rebaseOwnNormalization(job,state){
    if(confirmed&&Number(confirmed.revision)>Number(state.revision))return;
    const corrections=new Map();
    for(const c of job.changes){const value=c.path.reduce((v,k)=>v?.[k],state);if(!c.remove&&!equal(value,c.after))corrections.set(JSON.stringify(c.path),{from:c.after,to:value});}
    for(const next of queue)for(const c of next.changes){const k=JSON.stringify(c.path),fix=corrections.get(k);if(fix&&equal(c.before,fix.from)){c.before=fix.to===undefined?null:clone(fix.to);c.missingBefore=fix.to===undefined;corrections.delete(k);}}
  }
  async function pump(){
    if(active||!queue.length)return;active=true;const job=queue[0];
    try{
      const state=await request('/api/state',{method:'PATCH',headers:{'Content-Type':'application/json',...job.headers},body:JSON.stringify({changes:job.changes,mutationId:job.id})});
      if(!job.cancelled){queue.shift();rebaseOwnNormalization(job,state);accept(state);job.resolve(state);connection='online';if(!failedDraft)issue='';}
    }catch(error){
      if(!job.cancelled){if(error.status){stopQueue(error.status===409?'保存冲突，未覆盖服务器。整份未保存草稿已保留，请导出或放弃后继续。':error.message);if(error.current)accept(error.current);}
      else{connection='offline';issue='连接中断，修改暂存在当前窗口；同一服务恢复后重试。';clearTimeout(retry);retry=setTimeout(async()=>{try{accept(await request('/api/state'));pump();}catch{pump();}},2000);}}
    }finally{active=false;publish();}
    if(connection!=='offline'&&queue.length)queueMicrotask(pump);
  }
  function enqueue(before,after){
    if(!visible)return Promise.reject(new Error('尚未连接服务'));
    if(failedDraft)return Promise.reject(new Error('请先导出未保存草稿，或确认放弃草稿后继续。'));
    if(before.serverEpoch!==confirmed.serverEpoch||before.controlEpoch!==confirmed.controlEpoch)return Promise.reject(new Error('服务或授权已变化，请重新打开编辑窗口。'));
    const changes=diff(before,after);
    for(const c of changes){
      if(['teams','matches'].includes(c.path[0])&&c.path.length>2){
        const entity=before[c.path[0]]?.[c.path[1]];c.entityId=entity?.id;c.guards=[];
        if(c.path[0]==='matches')for(const k of ['teamAId','teamBId','bestOf'])if(entity?.[k]!==undefined)c.guards.push({path:c.path.slice(0,2).concat(k),value:entity[k]});
        if(c.path[0]==='teams'&&c.path[2]==='players'&&c.path.length>4)c.guards.push({path:c.path.slice(0,4).concat('id'),value:entity?.players?.[c.path[3]]?.id});
        if(c.path[0]==='matches'&&c.path[2]==='mapDetails'&&['teamA','teamB'].includes(c.path[4])&&c.path.length>6){const p=c.path.slice(0,6);c.guards.push({path:p.concat('playerId'),value:p.reduce((v,k)=>v?.[k],before)?.playerId});}
        c.guards=c.guards.filter(g=>g.value!==undefined);
      }
    }
    if(!changes.length)return Promise.resolve(visible);
    const promise=new Promise((resolve,reject)=>queue.push({id:uuid(),changes,headers:authHeaders(),resolve,reject}));publish();pump();return promise;
  }
  function mutate(update){if(!visible)return Promise.reject(new Error('尚未连接服务'));const base=clone(visible);return enqueue(base,update(clone(base)));}
  function mutateFrom(base,update){return enqueue(base,update(clone(base)));}
  async function replace(state,expectedRevision=confirmed?.revision){
    if(queue.length||failedDraft)throw new Error('请先完成保存并处理未保存草稿，再导入。');
    const result=await request('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...state,expectedRevision})});accept(result);return result;
  }
  async function handoff(){
    if(queue.length||failedDraft)throw new Error('请先完成保存并处理未保存草稿，再交接。');
    const result=await request('/api/handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    key=result.controlKey;sessionStorage.setItem('scoredeck-key',key);accept(result.state);meta={...meta,controlKey:key,controlEpoch:result.controlEpoch};issue='交接完成：旧远程授权已失效。';publish();return result;
  }
  async function connect(){
    try{meta=await request('/api/meta');if(meta.controlKey){key=meta.controlKey;sessionStorage.setItem('scoredeck-key',key);}accept(await request('/api/state'));connection='online';publish();}
    catch{connection='offline';publish();setTimeout(connect,2500);}
  }
  const events=new EventSource('/api/events');
  events.addEventListener('state',e=>{connection='online';accept(JSON.parse(e.data));if(queue.length)pump();});
  events.addEventListener('meta',e=>{meta={...meta,...JSON.parse(e.data)};publish();});events.onerror=()=>{connection='offline';publish();};
  window.SDClient={get state(){return visible},get meta(){return meta},get issue(){return issue},get pending(){return queue.length},get failedDraft(){return failedDraft},now:()=>Date.now()+clockOffset,authHeaders,diff,apply,mutate,mutateFrom,replace,request,handoff,
    subscribe(fn){observers.add(fn);fn(visible,meta,connection);return()=>observers.delete(fn);},retry(){connection='online';pump();},dismiss(){issue='';failedDraft=null;publish();}
  };
  addEventListener('beforeunload',e=>{if(queue.length||failedDraft){e.preventDefault();e.returnValue='';}});connect();
})();
