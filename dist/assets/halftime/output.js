(()=>{'use strict';
const $=s=>document.querySelector(s),stage=$('#stage'),preview=new URLSearchParams(location.search).has('preview');
const autoOutput=location.pathname==='/output/halftime-auto';
function clearSlots(){for(const side of ['left','right']){const s=slots[side];if(s.video){s.video.pause();s.video.removeAttribute('src');s.video.load();}$('#'+side+' .content').replaceChildren();slots[side]={};}}
let snapshot=null,offset=0,items=[],itemsError='',fetching=false,lastRevision='',mediaKey='',draftPreview=false;
const slots={left:{},right:{}};
const now=()=>Date.now()+offset;
function resize(){stage.style.transform=`translate(-50%,-50%) scale(${Math.min(innerWidth/1920,innerHeight/1080)})`;for(const side of ['left','right'])fitFrame(side);}
function fitFrame(side){const s=slots[side];if(!s.frame)return;const box=$('#'+side+' .content'),w=s.width||1920,h=s.height||1080,fit=s.config.fit;const sx=box.clientWidth/w,sy=box.clientHeight/h;s.frame.style.width=w+'px';s.frame.style.height=h+'px';s.frame.style.transform=fit==='fill'?`translate(-50%,-50%) scale(${sx},${sy})`:`translate(-50%,-50%) scale(${fit==='cover'?Math.max(sx,sy):Math.min(sx,sy)})`;}
function setText(id,value){$('#'+id).textContent=value??'';}
function hide(id,visible){$('#'+id).hidden=!visible;}
function elapsed(){const c=snapshot.config.media;return c.offsetMs+(c.status==='running'?Math.max(0,now()-c.startAt):0);}
function frame(side,url,w,h,sandbox){const s=slots[side],f=document.createElement('iframe');f.title=side==='left'?'左侧展示':'右侧展示';f.allow='autoplay; fullscreen';f.referrerPolicy='no-referrer';if(sandbox)f.setAttribute('sandbox',new URL(url).origin===location.origin?'allow-scripts':'allow-scripts allow-same-origin');f.src=url;s.frame=f;s.width=w;s.height=h;$('#'+side+' .content').append(f);fitFrame(side);}
function setup(side,c){const box=$('#'+side+' .content'),previous=slots[side],key=JSON.stringify([c.type,c.scene,c.source,c.half,c.layer,c.fade,c.showPlayers,snapshot.radar.hudPort]);previous.config=c;
 if(previous.key!==key){box.replaceChildren();slots[side]={config:c,key};const s=slots[side];
  if(c.type==='image'&&c.source){const im=new Image();im.src=c.source;box.append(im);s.image=im;}
  if(c.type==='video'||c.type==='replay'){const video=document.createElement('video');video.playsInline=true;video.preload='auto';video.muted=preview||c.muted;video.onerror=()=>{video.style.visibility='hidden'};video.onloadeddata=()=>{video.style.visibility='visible'};box.append(video);s.video=video;if(c.type==='video'&&c.source)video.src=c.source;}
  if(c.type==='radar'){const u=new URL(snapshot.radar.outputUrl);u.searchParams.set('embed','halftime');u.searchParams.set('parent',location.origin);u.searchParams.set('half',c.half);u.searchParams.set('layer',c.layer);u.searchParams.set('fade',c.fade);u.searchParams.set('players',c.showPlayers?'1':'0');frame(side,u.href,1024,1024);}
  if(c.type==='scoredeck')frame(side,location.origin+'/output/'+c.scene+'?preview=1&halftimeEmbed=1',1920,1080);
  if(c.type==='web'&&c.source){if(preview){const p=document.createElement('p');p.textContent='自定义网页 · 在独立输出中预览';p.style.cssText='font:36px sans-serif;color:#aab4cf;padding:50px';box.append(p);return;}const u=new URL(c.source);if(u.origin===location.origin&&['/output/halftime','/output/halftime-auto','/halftime','/halftime-output.html','/halftime-control.html','/'].includes(u.pathname))return;frame(side,u.href,1920,1080,true);}
 }
 const s=slots[side];if(s.image)s.image.style.objectFit=c.fit;if(s.video){s.video.style.objectFit=c.fit;s.video.muted=preview||c.muted;s.video.volume=preview?0:1;s.video.playbackRate=c.speed;}fitFrame(side);const label=$('#'+side+' .label');label.textContent=c.label;label.hidden=c.type==='replay'||!c.showLabel||!c.label||c.type==='none';
}
function render(s){if(window.SDHighlights?.render(s)){stage.hidden=true;clearSlots();$('#background-video').pause();return;}snapshot=s;offset=s.serverTime-Date.now();stage.hidden=autoOutput&&!s.auto?.active;if(stage.hidden){clearSlots();const bg=$('#background-video');bg.pause();bg.removeAttribute('src');bg.load();return;}const h=s.config,r=s.resolved;
 for(const [key,value]of Object.entries({'bg':h.transparent?'transparent':h.background,'fg':h.foreground,'accent':h.accent,'blue':h.blue,'title-scale':h.titleScale,'timer-scale':h.timerScale,'score-scale':h.scoreScale,'round-scale':h.roundScale,'left':h.leftPercent+'fr','right':(100-h.leftPercent)+'fr','gap':h.gap+'px'}))stage.style.setProperty('--'+key,value);
 const bg=$('#background-video');bg.hidden=!h.backgroundVideo;bg.style.objectFit=h.backgroundFit;if(h.backgroundVideo){if(bg.getAttribute('src')!==h.backgroundVideo)bg.src=h.backgroundVideo;bg.play().catch(()=>{});}else if(bg.hasAttribute('src')){bg.pause();bg.removeAttribute('src');bg.load();}
 stage.style.backgroundImage=h.backgroundImage?`url(${JSON.stringify(h.backgroundImage)})`:'none';stage.style.backgroundSize='cover';hide('decoration',h.decoration);
 for(const [key,value]of Object.entries({round:r.round,title:h.title,nameA:r.nameA,nameB:r.nameB,scoreA:r.scoreA,scoreB:r.scoreB,map:r.map}))setText(key,value);
 for(const [id,on]of Object.entries({round:h.showRound,title:h.showTitle,timer:h.showTimer,scoreboard:h.showScore,map:h.showMap}))hide(id,on);
 for(const side of ['A','B']){const img=$('#logo'+side),src=r['logo'+side];img.hidden=!h.showLogos||!src;if(src&&img.getAttribute('src')!==src){img.src=src;img.onerror=()=>img.hidden=true;}}
 setup('left',h.left);setup('right',h.right);resize();tick();parent.postMessage({type:'scoredeck-halftime-ready'},location.origin);
}
function syncVideo(s,time,running,loop){const v=s.video;if(!v||!v.getAttribute('src')||!Number.isFinite(v.duration)||v.duration<=0)return;let target=time/1000;if(loop)target%=v.duration;else target=Math.min(target,Math.max(0,v.duration-.04));if(Math.abs(v.currentTime-target)>.45)try{v.currentTime=target}catch{};if(running&&(loop||time/1000<v.duration)){if(v.paused)v.play().catch(()=>{});}else if(!v.paused)v.pause();}
function tick(){if(!snapshot||stage.hidden)return;const h=snapshot.config,c=h.clock;const sec=Math.ceil(Math.max(0,c.status==='running'?c.endAt-now():c.remainingMs)/1000);const ended=sec===0&&h.showEndText;$('#timer').classList.toggle('ended',ended);setText('timer',ended?h.endText:String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0'));
 const t=elapsed(),running=h.media.status==='running';for(const side of ['left','right']){const s=slots[side],cfg=s.config;if(!cfg)continue;
  if(cfg.type==='radar'&&s.frame)s.frame.contentWindow?.postMessage({type:'scoredeck-halftime-clock',elapsedMs:t*cfg.speed,playing:running,loop:cfg.loop},new URL(snapshot.radar.outputUrl).origin);
  if(cfg.type==='video')syncVideo(s,t*cfg.speed,running,cfg.loop);
  if(cfg.type==='replay'&&s.video){const valid=items.filter(a=>Number(a.duration)>0),total=valid.reduce((n,a)=>n+Number(a.duration)*1000,0);if(!total){if(s.video.hasAttribute('src')){s.video.pause();s.video.removeAttribute('src');s.video.load();s.clip='';}continue;}if(h.media.status==='running'&&h.media.offsetMs===0&&s.epoch!==h.media.startAt){s.epoch=h.media.startAt;s.replayBase=null;}if(s.replayBase==null)s.replayBase=t;let pos=Math.max(0,t-s.replayBase)*cfg.speed;if(cfg.loop)pos%=total;else if(pos>=total){s.video.pause();s.video.style.visibility='hidden';continue;}let chosen;for(const a of valid){if(pos<a.duration*1000){chosen=a;break;}pos-=a.duration*1000;}if(chosen){s.video.style.visibility='visible';if(s.clip!==chosen.id){s.clip=chosen.id;s.video.src='/api/halftime/replay/media/'+encodeURIComponent(chosen.id);}syncVideo(s,pos,running,false);}}
 }}
async function poll(){if(fetching||draftPreview)return;fetching=true;try{const r=await fetch('/api/halftime'+(new URLSearchParams(location.search).get('mode')?'?mode='+new URLSearchParams(location.search).get('mode'):''),{cache:'no-store'});if(!r.ok)throw 0;render(await r.json());}catch{}finally{fetching=false;}}
async function pollReplay(){if(snapshot&&!stage.hidden&&['left','right'].some(k=>snapshot.config[k].type==='replay'))try{const r=await fetch('/api/halftime/replay',{cache:'no-store'});const data=await r.json();items=data.items||[];itemsError=data.error||'';}catch{items=[];}}
addEventListener('message',e=>{if(preview&&e.source===parent&&e.origin===location.origin&&e.data?.type==='scoredeck-halftime-preview'){const s=e.data.snapshot;draftPreview=true;render(s);}});
addEventListener('resize',resize);resize();poll();setInterval(poll,1500);setInterval(pollReplay,1800);setInterval(tick,100);SDClient.subscribe(state=>{if(state)poll();});
})();
