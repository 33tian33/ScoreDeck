// Streaming, checksummed package. No per-file or total 512 MB archive limit.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const MAGIC=Buffer.from('SCOREDECK-FULL-PACK-1\n');
const hash=async p=>{const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(p))h.update(b);return h.digest('hex')};
function safe(name){return typeof name==='string'&&name.length<2048&&!/[\\:\x00-\x1f]/.test(name)&&!name.startsWith('/')&&name.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!/[. ]$/.test(s)&&! /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s));}
async function walk(root,relative=''){const result=[];for(const e of await fs.promises.readdir(path.join(root,relative),{withFileTypes:true})){const rel=relative?relative+'/'+e.name:e.name;if(!safe(rel))throw Error('不支持的文件名：'+rel);if(e.isSymbolicLink())throw Error('素材包含符号链接：'+rel);if(e.isDirectory())result.push(...await walk(root,rel));else if(e.isFile()&&e.name!=='instance.lock')result.push(rel);}return result;}
function mapStrings(v,fn){if(typeof v==='string')return fn(v);if(Array.isArray(v))return v.map(x=>mapStrings(x,fn));if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,mapStrings(x,fn)]));return v;}
// Cache policy is scoped to managed modules. Presentation videos stay in media/.
function replaySettings(root){const file=path.join(root,'integrations/replay/state.json');if(!fs.existsSync(file))return null;return JSON.parse(fs.readFileSync(file,'utf8'));}
function cacheFilter(root){
 const disk=replaySettings(root),keep=new Set(Object.values(disk?.state?.output||{}).filter(v=>typeof v==='string'&&/^[a-zA-Z0-9_.-]+\.(mp4|webm)$/i.test(v)).map(v=>'integrations/replay/media/'+v));
 return rel=>{
  if(/^(integrations\/(replay|voicebridge)\.(backup|import)-)/.test(rel))return false;
  if(rel.startsWith('integrations/replay/')){
   const sub=rel.slice('integrations/replay/'.length);
   if(sub==='media')return true;
   if(sub.startsWith('media/'))return keep.has(rel);
   if(/^(clips|cache|recordings|tmp|downloads|logs)(\/|$)/.test(sub)||/^(raw-recordings\.json|instance\.lock|.*\.lock|\.state-.*)$/.test(sub))return false;
  }
  if(rel.startsWith('integrations/voicebridge/runtime/'))return rel==='integrations/voicebridge/runtime/operator.json';
  return path.basename(rel)!=='instance.lock';
 };
}
async function runtimeOptions(source,target){
 const operator=path.join(source,'operator.json');let options=fs.existsSync(operator)?JSON.parse(fs.readFileSync(operator,'utf8')):{};
 try{const mode=JSON.parse(fs.readFileSync(path.join(source,'current.json'),'utf8')).mode;if(['live','demo'].includes(mode))options.archiveMode=mode;}catch{}
 if(Object.keys(options).length){await fs.promises.mkdir(target,{recursive:true});await fs.promises.writeFile(path.join(target,'operator.json'),JSON.stringify(options,null,2));}
}
function voiceRuntime(root){const vb=path.join(root,'integrations/voicebridge'),desktop=path.join(vb,'desktop-settings.json');let runtime='';if(fs.existsSync(desktop))runtime=JSON.parse(fs.readFileSync(desktop,'utf8')).path||'';if(!runtime&&fs.existsSync(path.join(vb,'.env'))){const match=fs.readFileSync(path.join(vb,'.env'),'utf8').match(/^RUNTIME_DIR\s*=\s*["']?([^\r\n"']+)/m);if(match)runtime=match[1].trim();}return runtime||path.join(vb,'runtime');}
async function stripCaches(root){
 const include=cacheFilter(root);
 const runtime=path.join(root,'integrations/voicebridge/runtime');if(fs.existsSync(runtime))await runtimeOptions(runtime,runtime);
 async function prune(dir,rel=''){for(const e of await fs.promises.readdir(dir,{withFileTypes:true})){const name=rel?rel+'/'+e.name:e.name,p=path.join(dir,e.name);if(!include(name))await fs.promises.rm(p,{recursive:true,force:true});else if(e.isDirectory())await prune(p,name);}}
 await prune(root);
 const disk=replaySettings(root);
 if(disk?.state){for(const key of ['events','jobs','artifacts','queue','half_queue','full_queue','logs'])disk.state[key]=[];disk.paths={};await fs.promises.writeFile(path.join(root,'integrations/replay/state.json'),JSON.stringify(disk,null,2));}
}
async function pruneImported(stage,targetRoot){
 const imported=path.join(stage,'imported');
 if(fs.existsSync(imported)){
  const refs=new Set();for(const rel of await walk(stage))if(rel.endsWith('.json')){try{mapStrings(JSON.parse(await fs.promises.readFile(path.join(stage,rel),'utf8')),v=>{refs.add(v.replace(/\\/g,'/'));return v});}catch{}}
  for(const rel of await walk(imported))if(!refs.has(path.join(targetRoot,'imported',rel).replace(/\\/g,'/')))await fs.promises.rm(path.join(imported,rel),{force:true});
 }
}
async function capture(dataRoot){
 const temp=await fs.promises.mkdtemp(path.join(os.tmpdir(),'scoredeck-full-')),stage=path.join(temp,'data');
 try{
 const include=cacheFilter(dataRoot),configuredRuntime=voiceRuntime(dataRoot);
 if(!path.isAbsolute(configuredRuntime))throw Error('VoiceBridge 录音目录须先设置为绝对路径');
 await fs.promises.cp(dataRoot,stage,{recursive:true,filter:p=>{const rel=path.relative(dataRoot,p).split(path.sep).join('/');const overlapsSettings=configuredRuntime===dataRoot||configuredRuntime===path.join(dataRoot,'integrations/voicebridge');if(overlapsSettings&&p.startsWith(configuredRuntime+path.sep)&&/^(sessions|current\.json|clips|chunks|tracks)(\/|$)/.test(path.relative(configuredRuntime,p).split(path.sep).join('/')))return false;if(!overlapsSettings&&(p===configuredRuntime||p.startsWith(configuredRuntime+path.sep)))return false;if(!include(rel))return false;if(fs.lstatSync(p).isSymbolicLink())throw Error('数据包含符号链接');return true}});
 await stripCaches(stage);
 await pruneImported(stage,dataRoot);
 const relocation=[{from:dataRoot,to:''}];
 // Preserve operator options from external storage without collecting recordings.
 const vb=path.join(stage,'integrations/voicebridge');
 await runtimeOptions(configuredRuntime,path.join(vb,'runtime'));
 if(configuredRuntime!==dataRoot)relocation.push({from:configuredRuntime,to:'integrations/voicebridge/runtime'});
 // Preserve external files referenced by configuration (Replay cache references have been removed).
 const mediaExt=/\.(mp4|webm|ogv|mkv|mov|avi|wav|mp3|ogg|flac|png|jpe?g|webp|gif|svg|dem)$/i;
 const external=new Map();
 async function localFile(value){if(!path.isAbsolute(value)||!mediaExt.test(value)||value.startsWith('/media/'))return;if(value===dataRoot||value.startsWith(dataRoot+path.sep))return;if(relocation.some(x=>value.startsWith(x.from+path.sep)))return;if(external.has(value))return;if(!fs.existsSync(value)||!fs.statSync(value).isFile())throw Error('素材不存在：'+value);const rel='imported/'+crypto.createHash('sha256').update(value).digest('hex').slice(0,24)+path.extname(value);await fs.promises.mkdir(path.join(stage,'imported'),{recursive:true});await fs.promises.copyFile(value,path.join(stage,rel));external.set(value,rel);relocation.push({from:value,to:rel});}
 for(const rel of await walk(stage))if(rel.endsWith('.json')){let obj;try{obj=JSON.parse(await fs.promises.readFile(path.join(stage,rel),'utf8'))}catch{continue;}const strings=[];mapStrings(obj,v=>{strings.push(v);return v});for(const v of strings)await localFile(v);}
 // Download URL-based visual/audio assets; webpage slots remain live URLs.
 const statePath=path.join(stage,'broadcast-state.json'),state=JSON.parse(await fs.promises.readFile(statePath,'utf8')),remote=new Map();
 async function visit(obj){if(!obj||typeof obj!=='object')return;for(const [key,value]of Object.entries(obj)){
  const asset=typeof value==='string'&&/^https?:\/\//.test(value)&&((/^(logoImage|logoPrimary|logoSecondary|avatar|logoA|logoB|backgroundImage|backgroundVideo)$/.test(key))||(key==='source'&&obj.type!=='web'&&obj.type!=='scoredeck'));
  if(asset){let dest=remote.get(value);if(!dest){const response=await fetch(value,{signal:AbortSignal.timeout(120000)});if(!response.ok||!response.body)throw Error('无法打包远程素材：'+value);const type=(response.headers.get('content-type')||'').split(';')[0],ext=({'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','image/svg+xml':'.svg','video/mp4':'.mp4','video/webm':'.webm','video/ogg':'.ogv'})[type];if(!ext)throw Error('远程素材类型不支持：'+value);dest='/media/archive-'+crypto.randomBytes(12).toString('hex')+ext;await fs.promises.mkdir(path.join(stage,'media'),{recursive:true});await pipeline(response.body,fs.createWriteStream(path.join(stage,dest.slice(1))));remote.set(value,dest);}obj[key]=dest;
  }else if(value&&typeof value==='object')await visit(value);
 }}
 await visit(state);mapStrings(state,value=>{if(value.startsWith('/media/')){const rel=value.split(/[?#]/)[0].slice(1);if(!safe(rel)||!fs.existsSync(path.join(stage,rel)))throw Error('缺少素材：'+value);}return value;});await fs.promises.writeFile(statePath,JSON.stringify(state,null,2));
 return {temp,stage,relocation};
 }catch(e){await fs.promises.rm(temp,{recursive:true,force:true});throw e;}
}
async function writePackage(capture,file){
 const files=[];for(const rel of await walk(capture.stage)){const p=path.join(capture.stage,rel);files.push({name:rel,size:(await fs.promises.stat(p)).size,sha256:await hash(p)});}
 const manifest={format:'ScoreDeck-Full',version:1,cachePolicy:'exclude-replay-and-recordings',createdAt:new Date().toISOString(),relocation:capture.relocation,files};
 const meta=Buffer.from(JSON.stringify(manifest));if(files.length>200000||meta.length>32*1024*1024)throw Error('完整包文件清单过大');const length=Buffer.alloc(4);length.writeUInt32LE(meta.length);
 const out=await fs.promises.open(file,'w');let pos=0;
 try{async function write(b){let p=0;while(p<b.length){const r=await out.write(b,p,b.length-p,pos);p+=r.bytesWritten;pos+=r.bytesWritten;}}
 await write(MAGIC);await write(length);await write(meta);
 for(const entry of files){const h=crypto.createHash('sha256');let count=0;for await(const b of fs.createReadStream(path.join(capture.stage,entry.name))){h.update(b);count+=b.length;await write(b);}if(count!==entry.size||h.digest('hex')!==entry.sha256)throw Error('打包过程中素材发生变化');}
 await out.sync();return manifest;
 }finally{await out.close();}
}
async function readPackage(file,stage,targetRoot){
 const handle=await fs.promises.open(file,'r');let pos=0;
 try{
 async function read(n){const b=Buffer.alloc(n);let got=0;while(got<n){const r=await handle.read(b,got,n-got,pos);if(!r.bytesRead)throw Error('完整包被截断');got+=r.bytesRead;pos+=r.bytesRead;}return b;}
 if(!(await read(MAGIC.length)).equals(MAGIC))throw Error('请选择 ScoreDeck 导出的 .sdpack 完整包');
 const length=(await read(4)).readUInt32LE();if(length>32*1024*1024)throw Error('完整包清单过大');
 const manifest=JSON.parse((await read(length)).toString());
 if(manifest.format!=='ScoreDeck-Full'||manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length>200000||!Array.isArray(manifest.relocation))throw Error('完整包格式无效');
 const names=new Set();let expected=pos;
 for(const f of manifest.files){if(!safe(f.name)||names.has(f.name.toLowerCase())||!Number.isSafeInteger(f.size)||f.size<0||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('完整包文件清单无效');names.add(f.name.toLowerCase());expected+=f.size;}
 if(!names.has('broadcast-state.json')||expected!==(await handle.stat()).size)throw Error('完整包不完整或存在多余数据');
 await fs.promises.mkdir(stage,{recursive:true});
 for(const entry of manifest.files){const p=path.join(stage,entry.name);await fs.promises.mkdir(path.dirname(p),{recursive:true});const out=await fs.promises.open(p,'wx');const h=crypto.createHash('sha256');try{let left=entry.size;while(left){const b=await read(Math.min(left,1024*1024));h.update(b);let written=0;while(written<b.length)written+=(await out.write(b,written,b.length-written)).bytesWritten;left-=b.length;}}finally{await out.close();}if(h.digest('hex')!==entry.sha256)throw Error('素材校验失败：'+entry.name);}
 const mappings=manifest.relocation.map(x=>{if(typeof x.from!=='string'||!x.from||typeof x.to!=='string'||x.to&&!safe(x.to))throw Error('完整包路径映射无效');return {from:x.from.replace(/\\/g,'/').replace(/\/$/,''),to:path.join(targetRoot,x.to)}}).sort((a,b)=>b.from.length-a.from.length);
 const rebase=v=>{const normalized=v.replace(/\\/g,'/');for(const x of mappings){if(normalized===x.from)return x.to;if(normalized.startsWith(x.from+'/'))return path.join(x.to,...normalized.slice(x.from.length+1).split('/'));}return v;};
 for(const rel of await walk(stage)){const p=path.join(stage,rel);if(rel.endsWith('.json')){let v;try{v=JSON.parse(await fs.promises.readFile(p,'utf8'))}catch{continue;}await fs.promises.writeFile(p,JSON.stringify(mapStrings(v,rebase),null,2));}else if(path.basename(rel)==='.env'){const text=await fs.promises.readFile(p,'utf8');await fs.promises.writeFile(p,text.replace(/^(\s*[A-Z_][A-Z0-9_]*\s*=\s*)(.*)$/gm,(_,prefix,value)=>{const quote=/^["']/.test(value)?value[0]:'';return prefix+quote+rebase(quote?value.slice(1,-1):value)+quote}));}}
 await stripCaches(stage);
 await pruneImported(stage,targetRoot);
 return manifest;
 }catch(e){await fs.promises.rm(stage,{recursive:true,force:true});throw e;}finally{await handle.close();}
}
function applyPending(dataRoot){const pending=dataRoot+'.restore-pending',marker=pending+'.ready';if(!fs.existsSync(marker))return;const backup=dataRoot+'.before-restore-'+Date.now();if(!fs.existsSync(path.join(pending,'broadcast-state.json')))throw Error('待恢复完整包缺少赛事数据');if(fs.existsSync(dataRoot))fs.renameSync(dataRoot,backup);try{fs.renameSync(pending,dataRoot);fs.unlinkSync(marker)}catch(e){if(!fs.existsSync(dataRoot)&&fs.existsSync(backup))fs.renameSync(backup,dataRoot);throw e;}}
module.exports={capture,writePackage,readPackage,applyPending,walk,hash};
