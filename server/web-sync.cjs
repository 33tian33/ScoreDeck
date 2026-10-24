'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ORIGIN='https://hushang985.online';
const SYNC_TIMEOUT_MS=210000,DOWNLOAD_CONCURRENCY=8;
const clone=x=>structuredClone(x),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const list=(x,label)=>{if(!Array.isArray(x))throw Error(`网站数据缺少 ${label} 数组`);return x;};
const parsed=x=>typeof x==='string'?JSON.parse(x):x;
const mapName=x=>'de_'+require('./match-data.cjs').mapKey(x);
function validate(raw){
 if(!raw||typeof raw.config!=='object'||!raw.config)throw Error('网站赛事设置无效');
 for(const key of ['teams','players','matches','sponsors','schools'])list(raw[key],key);
 for(const key of ['teams','players','matches'])if(new Set(raw[key].map(x=>String(x.id))).size!==raw[key].length)throw Error(`网站 ${key} 编号重复`);
 const teams=new Set(raw.teams.map(x=>String(x.id))),players=new Set(raw.players.map(x=>String(x.id)));
 for(const p of raw.players)if(!teams.has(String(p.team_id)))throw Error('网站选手引用不存在的队伍');
 for(const m of raw.matches){for(const k of ['maps','bp','stats'])m[k]=list(parsed(m[k]??[]),k);m.bp_config=parsed(m.bp_config||{});if(![1,2,3,5].includes(m.bo))throw Error('不支持的网站 BO');for(const k of ['team_a','team_b'])if(m[k]!=null&&!teams.has(String(m[k])))throw Error('网站比赛队伍引用无效');for(const st of m.stats)if(!players.has(String(st.playerId)))throw Error('网站比赛选手引用无效');}
 return raw;
}
function definitions(plan){const out=[];for(const st of plan.stages||[]){const n=st.teamCount;if(st.type==='group'){const size=n/st.groupCount;for(let g=0;g<st.groupCount;g++)for(let i=g*size;i<(g+1)*size;i++)for(let j=i+1;j<(g+1)*size;j++)out.push({key:`${st.id}:g${g}:${i}-${j}`,stageId:st.id,group:g,a:{slot:i},b:{slot:j}});}else{let entries=st.slots.map((_,slot)=>({slot})),round=1;while(entries.length>1){if(st.bracket==='worldcup2026'&&round>1)entries=st.roundPairs[round-2].flatMap(pair=>pair.map(i=>entries[i]));const next=[];for(let i=0;i<entries.length;i+=2){const key=`${st.id}:r${round}:${i/2}`;out.push({key,stageId:st.id,group:null,a:entries[i],b:entries[i+1]});next.push({kind:'winner',matchKey:key});}entries=next;round++;}}}return out;}
function mapState(input,current,source=ORIGIN){
 const raw=validate(clone(input)),key=hash(source).slice(0,10),prefix=`web-${key}-`,tid=id=>id==null?'':prefix+'t'+id,mid=id=>prefix+'m'+id,sid=id=>prefix+'s'+id;
 const marker={source,mode:'snapshot'},warnings=['网站为准：当前赛果、积分、晋级及世界杯第三名分配按网站快照展示；后续网站变动需再次同步。'];
 const next=clone(current),players=new Map(),teams=raw.teams.map(t=>{
  const school=raw.schools.find(s=>s.name===t.school),roster=raw.players.filter(p=>p.team_id===t.id).map((p,i)=>{const duplicates=raw.players.filter(q=>q.team_id===t.id&&q.nickname===p.nickname).length,id=p.nickname+(duplicates>1?` #${p.id}`:'');players.set(String(p.id),{id,teamId:tid(t.id)});return {...p,id,sourcePlayerId:p.id,steamId:'',role:p.position||p.role,avatar:p.avatar||'',starter:!['替补','Substitute'].includes(p.role)&&i<5,rating:null};});
  return {...t,id:tid(t.id),shortName:t.tag||t.name,logoPrimary:t.logo||'',logoSecondary:t.show_school_badge?school?.emblem||'':'',players:roster,group:t.group_name,webSync:marker};
 });
 const plan=raw.flow?.active||{stages:[]},defs=definitions(plan),byKey=new Map(raw.matches.filter(m=>m.flow_key).map(m=>[m.flow_key,m])),stages=[];
 for(const st of plan.stages){const size=st.type==='group'?st.teamCount/st.groupCount:st.teamCount,groups=st.type==='group'?Array.from({length:st.groupCount},(_,g)=>({id:'g'+g,name:String.fromCharCode(65+g)+'组',size,format:'round-robin',bestOf:st.bo,tieBreak:raw.config.tieBreak==='h2h,map,round'?'head-to-head':'round-diff'})):[];
  const slots=st.slots.map((src,i)=>{let teamId=src.kind==='team'?tid(src.teamId):'';for(const d of defs.filter(d=>d.stageId===st.id)){const m=byKey.get(d.key);if(m){if(d.a.slot===i)teamId=tid(m.team_a);if(d.b.slot===i)teamId=tid(m.team_b);}}return {id:'entry-'+i,groupId:st.type==='group'?'g'+Math.floor(i/size):'entry',label:`${i+1}号位`,teamId:src.kind==='team'?teamId:'',resolvedTeamId:teamId,webSyncTeamId:teamId,webSyncSource:clone(src)};});
  const local={id:sid(st.id),name:st.name,type:st.type,format:st.type==='group'?'round-robin':st.type==='custom'?'custom':'single',bestOf:st.bo,teamCount:st.teamCount,groups,slots,routes:{},comparators:(st.comparators||[]).map(c=>({id:c.id,name:c.name,teamCount:c.inputs.length})),webSync:{...marker,sourceStageId:st.id,definition:clone(st),tables:[],comparisons:[]}};
  const row=r=>({...r,team:teams.find(t=>t.id===tid(r.teamId)),played:r.played,won:r.w,drawn:r.d,lost:r.l,mapsWon:r.mw,mapsLost:r.ml,mapDiff:r.mw-r.ml,roundDiff:r.rd,points:r.pts,groupId:'g'+r.group,groupName:String.fromCharCode(65+(r.group||0))+'组'});
  local.webSync.tables=(raw.flow?.tables||[]).filter(t=>t.stageId===st.id).map(t=>({...t,groupId:'g'+t.group,rows:t.rows.map(row)}));
  local.webSync.comparisons=(raw.flow?.comparisons||[]).filter(c=>c.stageId===st.id).map(c=>({...c,rows:c.rows.map(row)}));
  for(const g of groups)for(let r=1;r<=g.size;r++)local.routes[`rank:${g.id}:${r}`]={kind:r<=st.advance?'end':'eliminate',...(r<=st.advance?{label:'Qualified'}:{})};
  for(const c of st.comparators||[]){c.inputs.forEach((src,i)=>{if(src)local.routes[`rank:g${src.group}:${src.rank}`]={kind:'comparator',comparatorId:c.id,position:i+1};});c.outcomes.forEach((out,i)=>local.routes[`compare:${c.id}:${i+1}`]=out==='qualified'?{kind:'end',label:'Qualified'}:{kind:'eliminate'});}
  stages.push(local);
 }
 const route=(src,to)=>{let owner,key;if(src.kind==='rank'){owner=stages.find(st=>st.id===sid(src.stageId));key=`rank:g${src.group}:${src.rank}`;}else if(src.kind==='comparison'){owner=stages.find(st=>st.id===sid(src.stageId));key=`compare:${src.comparatorId}:${src.rank}`;}else if(['winner','loser'].includes(src.kind)){const m=byKey.get(src.matchKey);if(m){owner=stages.find(st=>st.id===sid(src.matchKey.split(':')[0]));key=`${src.kind==='winner'?'win':'lose'}:${mid(m.id)}`;}}if(owner)owner.routes[key]=to;};
 for(const st of plan.stages)st.slots.forEach((src,i)=>route(src,{kind:'slot',stageId:sid(st.id),slotId:'entry-'+i}));
 const matches=raw.matches.map((m,i)=>{
  const def=defs.find(d=>d.key===m.flow_key);let st=stages.find(st=>st.id===sid(def?.stageId));
  if(!st){const id=sid('unplanned-'+m.stage);st=stages.find(x=>x.id===id);if(!st){st={id,name:m.stage==='group'?'网站独立小组赛':'网站独立对阵',type:m.bo===2?'group':'custom',format:m.bo===2?'round-robin':'custom',bestOf:m.bo,teamCount:teams.length,groups:[],slots:[],routes:{},comparators:[],webSync:marker};stages.push(st);}}
  const maps=m.maps.map(x=>({map:mapName(x.name),a:x.scoreA,b:x.scoreB}));while(maps.length<m.bo)maps.push({map:`MAP ${maps.length+1}`,a:null,b:null});
  const match={...m,id:mid(m.id),webSync:marker,stageId:st.id,stage:st.name,round:m.round_name,role:'normal',bestOf:m.bo,status:{scheduled:'upcoming',finished:'completed',live:'live'}[m.status]||'tbd',teamAId:tid(m.team_a),teamBId:tid(m.team_b),scoreA:m.maps.filter(x=>x.scoreA>x.scoreB).length,scoreB:m.maps.filter(x=>x.scoreB>x.scoreA).length,mapScores:maps,scheduleOrder:i+1,scheduledAt:m.time,schedule:m.time,date:(m.time||'').split('T')[0],time:(m.time||'').split('T')[1]||'',groupId:def?.group!=null?'g'+def.group:'',group:def?.group!=null?`${st.id}/g${def.group}`:'',bracketRound:st.type==='group'?'':m.round_name,
   mapDetails:maps.map((x,index)=>({...x,teamA:[],teamB:[],manualLocked:true,...Object.fromEntries(['A','B'].map(side=>['team'+side,m.stats.filter(s=>s.map===index&&players.get(String(s.playerId))?.teamId===tid(m[side==='A'?'team_a':'team_b'])).map(s=>({...s,playerId:players.get(String(s.playerId)).id,starter:true}))]))})),
   bp:m.bp.map(b=>({...b,team:b.teamId!=null&&b.teamId===m.team_a?'A':b.teamId!=null&&b.teamId===m.team_b?'B':'',action:b.action.toLowerCase(),map:require('./match-data.cjs').mapKey(b.map),sidePicker:b.sidePicker!=null&&b.sidePicker===m.team_a?'A':b.sidePicker!=null&&b.sidePicker===m.team_b?'B':'',startSide:b.startSide||''})),bpBestOf:m.bo,bpTeams:[tid(m.team_a),tid(m.team_b)],bpFirstSide:m.bp_config.first||'A',bpOrder:'imported',bpPool:m.bp_config.pool||[]};
  for(const [side,src]of [['A',def?.a],['B',def?.b]]){if(src?.slot!=null)match['entry'+side]={kind:'slot',slotId:'entry-'+src.slot};else if(src)route(src,{kind:'match',matchId:match.id,side});else match['entry'+side]={kind:'team',teamId:match['team'+side+'Id']};}
  if(m.mvp_player_id!=null){const p=players.get(String(m.mvp_player_id));if(p)match.mvp={teamId:p.teamId,playerId:p.id};}
  st.routes['win:'+match.id]||={kind:'end',label:'Qualified'};st.routes['lose:'+match.id]||={kind:'eliminate'};
  if(m.round_name==='决赛'){match.role='final';st.routes['win:'+match.id]={kind:'end',label:'冠军'};st.routes['lose:'+match.id]={kind:'end',label:'亚军'};}
  if(/季军/.test(st.name+' '+m.round_name)){match.role='thirdPlace';st.routes['win:'+match.id]={kind:'end',label:'季军'};st.routes['lose:'+match.id]={kind:'end',label:'殿军'};}
  if(st.type==='group'){delete st.routes['win:'+match.id];delete st.routes['lose:'+match.id];}
  return match;
 });
 // Imported records are upserted; unrelated records and previously imported removed records are retained.
 const merge=(old,items)=>{const ids=new Set(items.map(x=>x.id));return [...(old||[]).filter(x=>!ids.has(x.id)),...items];};
 next.teams=merge(next.teams,teams);next.matches=merge(next.matches,matches);next.stages=merge(next.stages,stages);
 next.tournament={...next.tournament,name:raw.config.name,edition:raw.config.season,location:raw.config.location,formatId:'flow',format:'网页赛事同步',webConfig:clone(raw.config)};
 const importedSponsors=raw.sponsors.map(s=>({...s,id:prefix+'sponsor'+s.id,sourceSponsorId:s.id,logoImage:s.image,webSync:marker})),sponsorIds=new Set(importedSponsors.map(s=>s.id));
 next.sponsors={...next.sponsors,enabled:true,slots:[...importedSponsors,...(next.sponsors?.slots||[]).filter(s=>s.logoImage&&!sponsorIds.has(s.id))]};
 next.webSync={source,syncedAt:new Date().toISOString(),mode:'snapshot',warnings,counts:{teams:teams.length,players:raw.players.length,matches:matches.length,stages:stages.length,sponsors:raw.sponsors.length},snapshot:raw};
 next.selectedStageId=stages[0]?.id||next.selectedStageId;next.selectedMatchId=matches[0]?.id||next.selectedMatchId;
 try{require('./tournament-flow.cjs').activate(next);}catch(error){warnings.push('网站数据已映射；本地赛事尚未启用：'+error.message);next.flowLifecycle={status:'draft'};}
 return next;
}
function requestError(status,retryAfter){return Object.assign(Error(`网站请求失败 HTTP ${status}`),{retryable:[408,429,500,502,503,504].includes(status),retryAfter:Math.min(5000,Math.max(0,Number(retryAfter)*1000||Date.parse(retryAfter)-Date.now()||0))});}
async function limited(response,limit){if(!response.ok){await response.body?.cancel();throw requestError(response.status,response.headers.get('retry-after'));}if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('网站文件超过大小限制');}const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('网站文件超过大小限制');chunks.push(chunk);}return Buffer.concat(chunks);}
function publicIP(address){if(address.includes(':'))return !/^(::|fc|fd|fe[89ab]|ff)/i.test(address)&&!address.includes('.');const p=address.split('.').map(Number);return p.length===4&&!([0,10,127].includes(p[0])||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&p[1]===168||p[0]===100&&p[1]>=64&&p[1]<=127);}
async function externalImage(url,redirects=0,headers={},signal){
 const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')throw Error('网站图片必须使用公开 HTTPS 地址');
 const addresses=await require('node:dns').promises.lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(x=>!publicIP(x.address)))throw Error('网站图片指向非公开网络地址');
 const selected=addresses[0];return new Promise((resolve,reject)=>{const req=require('node:https').get(u,{headers,signal,lookup:(host,options,cb)=>options.all?cb(null,[selected]):cb(null,selected.address,selected.family),timeout:SYNC_TIMEOUT_MS},res=>{
  if([301,302,303,307,308].includes(res.statusCode)){res.resume();if(redirects>=3)return reject(Error('网站图片重定向过多'));return externalImage(new URL(res.headers.location,u).href,redirects+1,headers,signal).then(resolve,reject);}
  if(res.statusCode===304){res.resume();return resolve({notModified:true});}if(res.statusCode!==200){res.resume();return reject(requestError(res.statusCode,res.headers['retry-after']));}let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>8*1024*1024){res.destroy();reject(Error('网站图片超过8MB'));}else chunks.push(chunk);});res.on('end',()=>resolve({bytes:Buffer.concat(chunks),etag:res.headers.etag,lastModified:res.headers['last-modified']}));res.on('error',reject);
 });req.on('timeout',()=>req.destroy(Error('网站图片下载超时')));req.on('error',reject);});
}
function imageExtension(bytes,fallback){if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'webp';if(bytes.toString('ascii',0,3)==='GIF')return 'gif';throw Error('网站返回的图片内容无效');}
function createWebSync({dataDir,getState,fetchImpl=fetch,retryDelay=attempt=>500*2**attempt,requestTimeoutMs=SYNC_TIMEOUT_MS,imageTimeoutMs=SYNC_TIMEOUT_MS}){
 let busy=false,preview=null,lastError='',job=null,task=null,closed=false,imageOrigin=ORIGIN;
 const emptyProgress=()=>({completed:0,total:0,active:0,reused:0,downloaded:0,retries:0,failed:0});
 let progress=emptyProgress();
 const stop=new AbortController();
 const mediaCache=require('./web-media-cache.cjs').createMediaCache(dataDir);
 const sourceUrl=value=>{const url=new URL(value||ORIGIN);if(![ORIGIN,'https://www.hushang985.online'].includes(url.origin)||url.username||url.password)throw Error('当前同步仅允许 https://hushang985.online/');return ORIGIN;};
 async function retry(action){for(let attempt=0;;attempt++){stop.signal.throwIfAborted();try{return await action();}catch(error){const temporary=error.retryable||['TypeError','TimeoutError'].includes(error.name)||/^(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|UND_ERR_)/.test(error.code||error.cause?.code||'');if(stop.signal.aborted||!temporary||attempt>=2)throw error;progress.retries++;await require('node:timers/promises').setTimeout(Math.max(retryDelay(attempt),error.retryAfter||0),undefined,{signal:stop.signal});}}}
 const responseFor=async(url,headers={},depth=0,timeoutMs=requestTimeoutMs)=>{
  const response=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.any([stop.signal,AbortSignal.timeout(timeoutMs)]),headers:{Accept:'application/json,image/*',...headers}});
  if([301,302,303,307,308].includes(response.status)){if(depth>=3)throw Error('网站重定向过多');const target=new URL(response.headers.get('location'),url);sourceUrl(target.href);await response.body?.cancel();return responseFor(target.href,headers,depth+1,timeoutMs);}
  if(response.ok&&new URL(url).pathname==='/api/state')imageOrigin=new URL(url).origin;
  return response;
 };
 const get=async(url,limit)=>retry(async()=>limited(await responseFor(url),limit));
 const imageGet=async(url,headers)=>retry(async()=>{const u=new URL(url);if(![ORIGIN,'https://www.hushang985.online'].includes(u.origin))return externalImage(url,0,headers,AbortSignal.any([stop.signal,AbortSignal.timeout(imageTimeoutMs)]));u.hostname=new URL(imageOrigin).hostname;const r=await responseFor(u.href,headers,0,imageTimeoutMs);if(r.status===304){await r.body?.cancel();return {notModified:true};}return {bytes:await limited(r,8*1024*1024),etag:r.headers.get('etag'),lastModified:r.headers.get('last-modified')};});

 async function localize(raw,source){
  const copy=clone(raw),jobs=new Map();
  function collect(value){for(const [k,v]of Object.entries(value||{})){if(v&&typeof v==='object')collect(v);else if(typeof v==='string'&&v&&(['logo','avatar','image','emblem'].includes(k)||/^\/media\//.test(v)||/\.(png|jpe?g|webp|gif)(?:[?#]|$)/i.test(v))){let url=v.startsWith('data:image/')?v:new URL(v,source).href;if(!url.startsWith('data:')){const u=new URL(url);if(u.hostname==='www.hushang985.online')u.hostname='hushang985.online';u.hash='';if(u.origin===ORIGIN&&/^\/media\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(u.pathname))u.search='';url=u.href;}if(!jobs.has(url))jobs.set(url,[]);jobs.get(url).push([value,k]);}}}
  function saveImage(bytes,ext){if(bytes.length>8*1024*1024)throw Error('网站图片超过8MB');ext=imageExtension(bytes,ext.toLowerCase());const name='web-'+hash(bytes)+'.'+ext,dir=path.join(dataDir,'media');fs.mkdirSync(dir,{recursive:true});if(!fs.existsSync(path.join(dir,name))||hash(fs.readFileSync(path.join(dir,name)))!==hash(bytes))fs.writeFileSync(path.join(dir,name),bytes);return '/media/'+name;}
  collect(copy);const queue=[...jobs];progress={...emptyProgress(),retries:progress.retries,total:queue.length};let cursor=0;const failures=[];
  async function worker(){while(cursor<queue.length&&!stop.signal.aborted){const [url,refs]=queue[cursor++];progress.active++;try{let local;if(url.startsWith('data:image/')){if(!/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=\s]+$/.test(url))throw Error('网站内嵌图片格式无效');local=saveImage(Buffer.from(url.split(',')[1],'base64'),url.slice(11,url.indexOf(';')));}
   else{const cached=mediaCache.lookup(url);if(cached?.immutable){local=cached.local;progress.reused++;}
    else{const headers={};if(cached?.etag)headers['If-None-Match']=cached.etag;if(cached?.lastModified)headers['If-Modified-Since']=cached.lastModified;
     const result=await imageGet(url,headers);if(result.notModified){if(!cached)throw Error('网站返回304但本地素材不存在');local=cached.local;progress.reused++;}
     else{local=saveImage(result.bytes,path.extname(new URL(url).pathname).slice(1));mediaCache.remember(url,{local,etag:result.etag||'',lastModified:result.lastModified||''});progress.downloaded++;}}
   }for(const [value,k]of refs)value[k]=local;progress.completed++;if(progress.completed%8===0)await mediaCache.flush();}catch(e){progress.failed++;failures.push('素材下载失败（'+(url.startsWith('data:')?'内嵌图片':new URL(url).pathname)+'）：'+e.message);}finally{progress.active--;}}}
  await Promise.all(Array.from({length:Math.min(DOWNLOAD_CONCURRENCY,queue.length)},worker));await mediaCache.flush();stop.signal.throwIfAborted();if(failures.length)throw Error(`${failures.length} 张素材处理失败，已下载资源已保存；${failures[0]}`);
  // The upstream Fudan PNG is a brand-guidelines sheet, not an individual badge.
  // Match its exact content so a future corrected upstream emblem takes precedence.
  for(const school of copy.schools||[])if(school.name==='复旦大学'&&school.emblem==='/media/web-40ab9481e3aa7a39da83430849ee2b7e1d8c6e59f2f1f7c37a942a36cfaa3d5d.png')school.emblem=saveImage(fs.readFileSync(path.join(__dirname,'assets/fudan-emblem.png')),'png');
  return copy;
 }

 // Only changes to records that this import replaces should invalidate it.
 // Output controls and unrelated local records may change during a download.
 function guard(state,source){const prefix='web-'+hash(source).slice(0,10)+'-';return hash(JSON.stringify({tournament:Object.fromEntries(['name','edition','location','formatId','format','webConfig'].map(k=>[k,state.tournament?.[k]])),teams:state.teams.filter(x=>x.id.startsWith(prefix)),matches:state.matches.filter(x=>x.id.startsWith(prefix)),stages:(state.stages||[]).filter(x=>x.id.startsWith(prefix)),sponsors:{enabled:state.sponsors?.enabled,slots:(state.sponsors?.slots||[]).filter(x=>String(x.id).startsWith(prefix))}}));}
 const summary=p=>({token:p.token,revision:p.revision,counts:p.counts,warnings:p.warnings,name:p.raw.config.name});
 async function prepare(source){source=sourceUrl(source);const current=clone(getState()),raw=validate(JSON.parse((await get(source+'/api/state',32*1024*1024)).toString('utf8'))),mapped=mapState(raw,current,source);return {token:crypto.randomUUID(),source,raw,revision:current.revision,guard:guard(current,source),selection:{selectedStageId:current.selectedStageId,selectedMatchId:current.selectedMatchId},counts:mapped.webSync.counts,warnings:mapped.webSync.warnings,expires:Date.now()+10*60*1000};}
 async function apply(pending,commit,background=false){
  const localized=await localize(pending.raw,pending.source),current=getState();stop.signal.throwIfAborted();
  if(background?pending.guard!==guard(current,pending.source):pending.revision!==current.revision)throw Error('下载期间网站将覆盖的本地赛事数据已变化，请检查后重新同步；已下载资源已保存');
  if(background)job.phase='saving';const next=mapState(localized,current,pending.source);
  if(background)for(const k of Object.keys(pending.selection))if(current[k]!==pending.selection[k])next[k]=current[k];
  const dir=path.join(dataDir,'web-sync');fs.mkdirSync(dir,{recursive:true});const stamp=Date.now()+'-'+crypto.randomBytes(4).toString('hex'),backupDir=path.join(dataDir,'backups');fs.mkdirSync(backupDir,{recursive:true});
  fs.writeFileSync(path.join(backupDir,stamp+'-web-sync.json'),JSON.stringify(current));fs.writeFileSync(path.join(dir,stamp+'-source.json'),JSON.stringify(pending.raw));
  next.webSync.backup='backups/'+stamp+'-web-sync.json';next.webSync.sourceArchive='web-sync/'+stamp+'-source.json';const result=await commit(next);preview=null;
  return {ok:true,counts:next.webSync.counts,warnings:next.webSync.warnings,backup:next.webSync.backup,state:result};
 }
 const status=()=>clone({source:ORIGIN,busy,lastError,progress,job,lastSync:getState().webSync?.syncedAt,counts:getState().webSync?.counts,warnings:getState().webSync?.warnings||[]});
 return {status,
  async preview(source){if(busy||closed)throw Error('网页同步正在进行或服务已关闭');busy=true;lastError='';progress=emptyProgress();try{preview=await prepare(source);return summary(preview);}catch(error){lastError=error.message;throw error;}finally{busy=false;}},
  async sync(token,commit){if(busy||closed)throw Error('网页同步正在进行或服务已关闭');if(!preview||preview.token!==token||preview.expires<Date.now())throw Error('请重新预览网站数据');if(preview.revision!==getState().revision)throw Error('本地数据已变化，请重新预览');busy=true;lastError='';progress=emptyProgress();try{return await apply(preview,commit);}catch(error){lastError=error.message;throw error;}finally{busy=false;}},
  start({source,token,requestId},commit){
   source=sourceUrl(source);if(closed)throw Error('同步服务已关闭');if(typeof requestId!=='string'||!requestId||requestId.length>128)throw Error('无效的同步请求编号');
   if(job?.requestId===requestId||busy&&job&&['reading','downloading','saving'].includes(job.phase))return status();if(busy)throw Error('正在读取网站预览，请稍候');
   busy=true;lastError='';progress=emptyProgress();job={id:crypto.randomUUID(),requestId,phase:'reading',startedAt:new Date().toISOString()};
   task=(async()=>{try{
    const pending=preview&&preview.token===token&&preview.source===source&&preview.expires>Date.now()&&preview.guard===guard(getState(),source)?preview:await prepare(source);
    Object.assign(job,{phase:'downloading',name:pending.raw.config.name,counts:pending.counts,warnings:pending.warnings});
    const {state,...result}=await apply(pending,commit,true);Object.assign(job,{phase:'completed',result});
   }catch(error){lastError=error.message;Object.assign(job,{phase:'failed',error:lastError});}finally{busy=false;job.finishedAt=new Date().toISOString();}})();
   return status();
  },
  async close(){closed=true;stop.abort();await task;await mediaCache.flush();}
 };
}
module.exports={mapState,validate,definitions,createWebSync,ORIGIN,publicIP,imageExtension};
