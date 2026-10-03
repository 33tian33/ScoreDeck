// Per-map result exports use stored match data, including previously collected GSI stats.
function sdResultVisible(match, mode) {
 return mode==='completed'?match.status==='completed':mode==='hide'?match.status!=='completed':true;
}
function sdResultMaps(match) {
 if(match.status!=='completed'||match.autoBye)return [];
 const count=Number(match.scoreA)+Number(match.scoreB);
 const maps=Array.from({length:Number(match.bestOf)||1},(_,index)=>{
  const score=match.mapScores?.[index]||{},detail=match.mapDetails?.[index]||{};
  return {index,map:score.map||detail.map||`MAP ${index+1}`,a:score.a??detail.a,b:score.b??detail.b,detail};
 });
 const played=maps.filter(ScoreDeckRules.validMap);
 return played.length?played:maps.slice(0,Number.isFinite(count)?Math.max(0,count):0);
}
function sdResultModel(state,match,map) {
 const number=value=>value!==null&&value!==''&&Number.isFinite(Number(value))?Number(value):0;
 return {...map,title:state.tournament?.name||'比赛战报',series:`${match.scoreA??0} : ${match.scoreB??0}`,teams:['A','B'].map(side=>{
  const team=state.teams.find(t=>t.id===match[`team${side}Id`])||{},stored=map.detail?.[`team${side}`]||[];
  const roster=(team.players||[]).map((p,i)=>{
   const stats=stored.find(s=>s.playerId===p.id)||{};
   return {...p,...stats,playerId:p.id,starter:stats.starter??p.starter??i<5};
  });
  for(const stats of stored)if(!roster.some(p=>p.playerId===stats.playerId))roster.push(stats);
  return {id:team.id||'',side,name:team.name||side,logo:team.logoPrimary||team.logoSecondary||'',players:roster.filter(p=>p.starter).map(p=>({id:p.playerId,avatar:p.avatar||'',kills:number(p.kills),deaths:number(p.deaths),assists:number(p.assists),rating:number(stored.find(s=>s.playerId===p.playerId)?.rating)}))};
 })};
}
async function sdResultCanvas(model) {
 await document.fonts?.ready;
 const sources=[...new Set(model.teams.flatMap(t=>[t.logo,...t.players.map(p=>p.avatar)]).filter(Boolean))];
 const images=new Map(await Promise.all(sources.map(src=>new Promise((resolve,reject)=>{
  const img=new Image(),timer=setTimeout(()=>reject(Error('队标或头像加载超时，请检查图片后重试')),10000);
  img.crossOrigin='anonymous';img.onload=()=>{clearTimeout(timer);resolve([src,img]);};img.onerror=()=>{clearTimeout(timer);reject(Error('队标或头像加载失败，请检查图片后重试'));};img.src=src;
 }))));
 const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=Math.max(820,360+Math.max(...model.teams.map(t=>t.players.length))*88);
 const ctx=canvas.getContext('2d');
 ctx.fillStyle='#0c1424';ctx.fillRect(0,0,canvas.width,canvas.height);
 const text=(value,x,y,size=24,color='#eef3ff',align='left',width=1400)=>{ctx.font=`600 ${size}px "Microsoft YaHei", sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(String(value),x,y,width);};
 const picture=(src,x,y,size,label)=>{ctx.fillStyle='#24334b';ctx.fillRect(x,y,size,size);const img=images.get(src);if(img){const scale=Math.min(size/img.width,size/img.height);ctx.drawImage(img,x+(size-img.width*scale)/2,y+(size-img.height*scale)/2,img.width*scale,img.height*scale);}else text(String(label||'?').slice(0,2),x+size/2,y+size*.65,size*.3,'#8fa9ca','center',size);};
 text(model.title,60,58,26,'#8fa9ca');text(`图${model.index+1} · ${model.map}`,800,115,40,'#ffffff','center');
 text(`${model.a??0} : ${model.b??0}`,800,186,52,'#7dd3fc','center');text(`BO 总比分  ${model.series}`,800,228,22,'#8fa9ca','center');
 model.teams.forEach((team,i)=>{const x=60+i*780;
  picture(team.logo,x+(i?620:0),160,80,team.name);text(team.name,x+(i?600:100),194,30,'#ffffff',i?'right':'left',420);
  ctx.fillStyle='#18263d';ctx.fillRect(x,266,700,42);text('选手 ID',x+84,294,20,'#8fa9ca');text('K / D / A',x+482,294,20,'#8fa9ca','center');text('RATING',x+632,294,20,'#8fa9ca','center');
  team.players.forEach((p,j)=>{const y=322+j*88;ctx.fillStyle=j%2?'#142038':'#101c30';ctx.fillRect(x,y,700,78);picture(p.avatar,x+10,y+7,64,p.id);text(p.id,x+84,y+46,24,'#eef3ff','left',295);text(`${p.kills} / ${p.deaths} / ${p.assists}`,x+482,y+46,24,'#eef3ff','center',180);text(p.rating.toFixed(2),x+632,y+46,26,'#7dd3fc','center');});
 });
 text('K 击杀  /  D 死亡  /  A 助攻     ·     未填写数据按 0 显示',60,canvas.height-26,18,'#8fa9ca');return {canvas,images};
}
async function sdResultDocument(state,match,map) {
 const model=sdResultModel(state,match,map),{canvas,images}=await sdResultCanvas(model);
 const embedded=new Map();
 for(const [src,img] of images){const asset=document.createElement('canvas');asset.width=img.naturalWidth;asset.height=img.naturalHeight;asset.getContext('2d').drawImage(img,0,0);embedded.set(src,asset.toDataURL('image/png'));}
 return {
  schemaVersion:1,tournament:model.title,matchId:match.id,round:match.round||'',bestOf:match.bestOf,
  seriesScore:{a:match.scoreA??0,b:match.scoreB??0},
  map:{number:map.index+1,name:map.map,score:{a:map.a??0,b:map.b??0}},
  teams:model.teams.map(team=>({...team,logo:embedded.get(team.logo)||'',players:team.players.map(player=>({...player,avatar:embedded.get(player.avatar)||''}))})),
  // Keep the self-contained map report image as the final JSON property.
  mapResultImage:{mimeType:'image/png',encoding:'data-url',data:canvas.toDataURL('image/png')}
 };
}
async function sdDownloadResult(state,match,map) {
 const result=await sdResultDocument(state,match,map);
 const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=`${match.id}_图${map.index+1}_${map.map}.json`.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function sdResultExports({state,match}) {
 const h=l.createElement,[busy,setBusy]=l.useState(false),[error,setError]=l.useState('');
 if(match.status!=='completed')return null;
 const maps=sdResultMaps(match);
 return h('div',null,h('div',{className:'sf-actions'},...maps.map(map=>h(sdFlowButton,{key:map.index,disabled:busy,onClick:async()=>{setBusy(true);setError('');try{await sdDownloadResult(state,match,map);}catch(e){setError(e.message);}finally{setBusy(false);}}},`导出图${map.index+1}_${map.map}`))),maps.length>0&&h('small',null,'导出 JSON，文件末尾内嵌该图战绩图片；未填写数据按 0 显示。'),busy&&h('small',{role:'status'},'正在生成 JSON 与当图战绩图片…'),!maps.length&&h('small',null,'无已进行地图可导出'),error&&h('p',{role:'alert',className:'sf-error'},error));
}
