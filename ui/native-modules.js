// Mount the complete module controls in the application's DOM, with scoped
// styles, DOM queries and managed resources. No nested browsing context.
async function sdMountNativeModule(host,id,controlUrl,signal,reload){
 const root=host.shadowRoot||host.attachShadow({mode:'open'}),base='/native-modules/'+id;
 const cleanup=[],timers=new Set(),intervals=new Set(),frames=new Set(),connections=new Set();
 let disposed=false;
 const route=value=>{if(typeof value!=='string'||!value||value.startsWith(base+'/')||/^(data:|blob:|#)/.test(value))return value;const u=new URL(value,controlUrl);if(u.origin!==new URL(controlUrl).origin)return value;return base+u.pathname+u.search+u.hash;};
 const stop=()=>{if(disposed)return;disposed=true;for(const f of cleanup)try{f();}catch{}for(const t of timers)clearTimeout(t);for(const t of intervals)clearInterval(t);for(const f of frames)cancelAnimationFrame(f);for(const c of connections)try{c.close()?.catch?.(()=>{});}catch{}for(const media of root.querySelectorAll('audio,video')){media.pause();media.removeAttribute('src');media.load();}root.replaceChildren();};
 signal.addEventListener('abort',stop,{once:true});
 const abortQuietly=error=>{if(signal.aborted)return new Promise(()=>{});throw error;};
 const fetchLocal=(url,options={})=>{const routed=route(url),headers=new Headers(typeof routed==='string'&&routed.startsWith(base+'/')?(window.SDClient?.authHeaders?.()||{}):{});new Headers(options.headers).forEach((value,key)=>headers.set(key,value));return fetch(routed,{...options,headers,signal:options.signal?AbortSignal.any([signal,options.signal]):signal}).then(response=>new Proxy(response,{get(target,key){const value=Reflect.get(target,key,target);if(['text','json','blob','arrayBuffer'].includes(key))return (...args)=>value.apply(target,args).catch(abortQuietly);return typeof value==='function'?value.bind(target):value;}})).catch(abortQuietly);};
 const source=await fetchLocal('/').then(r=>{if(!r.ok)throw Error('控制台加载失败：'+r.status);return r.text();});
 if(disposed)return stop;
 const parsed=new DOMParser().parseFromString(source,'text/html');
 const scripts=[...parsed.querySelectorAll('script')].map(s=>({src:s.getAttribute('src'),text:s.textContent}));parsed.querySelectorAll('script').forEach(s=>s.remove());
 const css=await Promise.all([...parsed.querySelectorAll('link[rel="stylesheet"]')].map(async link=>{const url=link.getAttribute('href');const text=await fetchLocal(url).then(r=>{if(!r.ok)throw Error('样式加载失败：'+url);return r.text();});return text.replace(/url\((['"]?)([^)'"\s]+)\1\)/g,(_,q,v)=>'url('+JSON.stringify(route(new URL(v,new URL(url,controlUrl)).href))+')').replace(/:root\b/g,':host').replace(/\bbody\b/g,'.sd-native-body').replace(/\bhtml\b/g,':host');}));
 if(disposed)return stop;
 const style=document.createElement('style');style.textContent=':host{display:block;min-height:620px;color-scheme:dark}.sd-native-body{margin:0;min-height:620px}'+css.join('\n');
 const body=document.createElement('div');body.className='sd-native-body '+parsed.body.className;body.innerHTML=parsed.body.innerHTML;
 root.replaceChildren(style,body);
 function prepare(el){if(!(el instanceof Element))return el;for(const attr of ['src','href','poster']){if(el.hasAttribute(attr)){const value=el.getAttribute(attr);el.setAttribute(attr,attr==='href'&&el instanceof HTMLAnchorElement&&!value.startsWith('#')?new URL(value,controlUrl).href:route(value));}}
  if(el instanceof HTMLMediaElement){const descriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');Object.defineProperty(el,'src',{configurable:true,get(){return descriptor.get.call(this)},set(v){descriptor.set.call(this,route(v))}});}
  return el;
 }
 root.querySelectorAll('*').forEach(prepare);
 const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof Element){prepare(node);node.querySelectorAll('*').forEach(prepare);}});observer.observe(body,{childList:true,subtree:true});cleanup.push(()=>observer.disconnect());
 const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);cleanup.push(()=>target.removeEventListener(type,fn,options));};
 const doc={querySelector:s=>root.querySelector(s),querySelectorAll:s=>root.querySelectorAll(s),getElementById:s=>root.getElementById(s),createElement:(...args)=>prepare(document.createElement(...args)),addEventListener:(...args)=>listen(root,...args),removeEventListener:(...args)=>root.removeEventListener(...args),body,documentElement:host,get activeElement(){return root.activeElement}};
 const scopedWindow={addEventListener:(type,fn,options)=>{if(type==='message')return;if(type==='pagehide'||type==='beforeunload'){cleanup.push(()=>fn(new Event(type)));return;}listen(window,type,fn,options);},removeEventListener:(...args)=>window.removeEventListener(...args)};
 const scopedLocation={...new URL(controlUrl),origin:new URL(controlUrl).origin,host:new URL(controlUrl).host,protocol:new URL(controlUrl).protocol,reload};
 function socketURL(value){const u=new URL(value,controlUrl);return location.origin.replace(/^http/,'ws')+base+u.pathname+u.search;}
 const EventStream=new Proxy(EventSource,{construct(Target,args){const instance=new Target(route(args[0]),args[1]);connections.add(instance);return instance;}});
 const Socket=new Proxy(WebSocket,{construct(Target,args){const instance=new Target(socketURL(args[0]),args[1]);connections.add(instance);return instance;}});
 const Context=window.AudioContext&&new Proxy(AudioContext,{construct(Target,args){const instance=new Target(...args);connections.add(instance);return instance;}});
 const mediaDevices=navigator.mediaDevices&&new Proxy(navigator.mediaDevices,{get(target,key){if(key==='addEventListener')return (...args)=>listen(target,...args);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 const nav=new Proxy(navigator,{get(target,key){if(key==='mediaDevices')return mediaDevices;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 const scopedTimeout=(fn,ms,...args)=>{const t=setTimeout(()=>{timers.delete(t);if(!disposed)fn(...args);},ms);timers.add(t);return t;};
 const scopedInterval=(fn,ms,...args)=>{const t=setInterval(()=>{if(!disposed)fn(...args);},ms);intervals.add(t);return t;};
 const names=['document','window','parent','location','fetch','EventSource','WebSocket','AudioContext','navigator','setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame'];
 const values=[doc,scopedWindow,scopedWindow,scopedLocation,fetchLocal,EventStream,Socket,Context,nav,scopedTimeout,t=>{clearTimeout(t);timers.delete(t)},scopedInterval,t=>{clearInterval(t);intervals.delete(t)},fn=>{const f=requestAnimationFrame(t=>{frames.delete(f);if(!disposed)fn(t)});frames.add(f);return f},f=>{cancelAnimationFrame(f);frames.delete(f)}];
 for(const script of scripts){const text=script.src?await fetchLocal(script.src).then(r=>{if(!r.ok)throw Error('控制组件加载失败：'+script.src);return r.text();}):script.text;if(disposed)return stop;new Function(...names,'"use strict";\n'+text+'\n//# sourceURL=scoredeck-native-'+id+'-'+(script.src||'inline'))(...values);}
 host.dataset.ready='true';
 host.openSettings=()=>{if(id==='replay')root.querySelector('#settings-btn')?.click();else{for(const panel of root.querySelectorAll('details.setup-panel'))panel.open=true;root.querySelector('#apiPanel')?.scrollIntoView({behavior:'smooth',block:'start'});}};
 cleanup.push(()=>{delete host.openSettings;delete host.dataset.ready;});return stop;
}
function sdNativeModule({id,controlUrl}){
 const host=l.useRef(null),[error,setError]=l.useState(''),[revision,setRevision]=l.useState(0);
 l.useEffect(()=>{const controller=new AbortController();setError('');sdMountNativeModule(host.current,id,controlUrl,controller.signal,()=>setRevision(v=>v+1)).catch(e=>{if(!controller.signal.aborted){controller.abort();setError(e.message);}});return()=>controller.abort();},[id,controlUrl,revision]);
 return l.createElement(l.Fragment,null,error&&l.createElement('p',{role:'alert'},error,l.createElement('button',{onClick:()=>setRevision(v=>v+1)},'重试')),l.createElement('div',{ref:host,className:'sd-native-module','data-native-module':id}));
}




