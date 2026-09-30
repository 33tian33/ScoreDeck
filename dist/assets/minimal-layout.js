/* Match the preview's actual container, including resizing and embedded pages. */
(()=>{
 const observed=new Set();
 const observer=new ResizeObserver(entries=>{for(const {target,contentRect} of entries)target.style.setProperty('--sd-preview-scale',String(contentRect.width/1920));});
 let queued=false;
 const scan=()=>{queued=false;for(const frame of document.querySelectorAll('.app-shell .preview-frame'))if(!observed.has(frame)){observed.add(frame);observer.observe(frame);}for(const frame of observed)if(!frame.isConnected){observer.unobserve(frame);observed.delete(frame);}for(const k of document.querySelectorAll('.sd-nav-search kbd')){const label=navigator.platform?.includes('Mac')?'⌘K':'⌃K';if(k.textContent!==label)k.textContent=label;}};
 const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(scan);}};
 new MutationObserver(schedule).observe(document.getElementById('root'),{childList:true,subtree:true});scan();
})();
