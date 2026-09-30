(()=>{
 if(!location.pathname.startsWith('/output'))return;
 const bar=document.createElement('div');bar.id='sd-sponsor-output';bar.setAttribute('aria-label','赞助商');document.body.append(bar);
 const slots=Array.from({length:4},()=>{const cell=document.createElement('div');bar.append(cell);return cell;});
 SDClient.subscribe(state=>{if(!state)return;const config=state.sponsors;const halftimeLive=location.pathname==='/output/live'&&state.liveScene==='halftime';const shown=!halftimeLive&&config?.enabled!==false&&config?.slots?.some(s=>s.logoImage);
 document.body.classList.toggle('sd-has-sponsors',!!shown);bar.hidden=!shown;
 slots.forEach((cell,i)=>{const slot=config?.slots?.[i];if(!slot?.logoImage){cell.replaceChildren();return;}let img=cell.firstElementChild;if(!img){img=document.createElement('img');img.alt='赞助商 '+(i+1);cell.append(img);}if(img.getAttribute('src')!==slot.logoImage)img.src=slot.logoImage;img.style.objectFit=slot.fit==='fill'?'fill':'cover';});
 });
})();
