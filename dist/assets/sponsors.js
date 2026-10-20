(()=>{
 if(!location.pathname.startsWith('/output'))return;
 const bar=document.createElement('div');bar.id='sd-sponsor-output';bar.setAttribute('aria-label','赞助商');document.body.append(bar);
 const slots=Array.from({length:4},()=>{const cell=document.createElement('div');bar.append(cell);return cell;});
 let latest;const render=state=>{if(!state)return;const config=state.sponsors;const halftimeLive=location.pathname==='/output/live'&&state.liveScene==='halftime';const customScene=new URLSearchParams(location.search).get('scene')||(location.pathname==='/output/live'?state.liveScene:location.pathname.split('/')[2]);const shown=!['custom1','custom2'].includes(customScene)&&!halftimeLive&&config?.enabled!==false&&config?.slots?.some(s=>s.logoImage);
 document.body.classList.toggle('sd-has-sponsors',!!shown);bar.hidden=!shown;
 const entries=config?.slots||[],offset=entries.length>4?(Math.floor(SDClient.now()/8000)%Math.ceil(entries.length/4))*4:0;
 slots.forEach((cell,i)=>{const slot=entries[offset+i];if(!slot?.logoImage){cell.replaceChildren();return;}let img=cell.firstElementChild;if(!img){img=document.createElement('img');cell.append(img);}img.alt=slot.name||'赞助商 '+(offset+i+1);if(img.getAttribute('src')!==slot.logoImage)img.src=slot.logoImage;img.style.objectFit=slot.fit==='fill'?'fill':'cover';});
 };
 const unsubscribe=SDClient.subscribe(state=>{latest=state;render(state);});
 const timer=setInterval(()=>{if(latest?.sponsors?.slots?.length>4)render(latest);},1000);
 addEventListener('pagehide',()=>{clearInterval(timer);if(typeof unsubscribe==='function')unsubscribe();},{once:true});
})();
