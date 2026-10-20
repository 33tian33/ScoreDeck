const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function createMediaCache(dataDir){
 const file=path.join(dataDir,'web-sync','media-cache.json');let entries={},revision=0,persisted=0,writing=Promise.resolve();
 try{entries=JSON.parse(fs.readFileSync(file,'utf8')).entries||{};}catch{}
 const key=value=>{const u=new URL(value);if(u.hostname==='www.hushang985.online')u.hostname='hushang985.online';u.hash='';return u.href;};
 function valid(local){const m=/^\/media\/web-([a-f0-9]{64})\.(png|jpg|jpeg|webp|gif)$/.exec(local||'');if(!m)return false;try{return digest(fs.readFileSync(path.join(dataDir,local.slice(1))))===m[1];}catch{return false;}}
 function lookup(url){const u=new URL(url),immutable=['hushang985.online','www.hushang985.online'].includes(u.hostname)&&/^\/media\/([a-f0-9]{64})\.(png|jpg|webp)$/.exec(u.pathname);
  if(immutable){const local='/media/web-'+immutable[1]+'.'+immutable[2];if(valid(local))return {local,immutable:true};}
  const entry=entries[key(url)];return entry&&valid(entry.local)?{...entry,immutable:!!immutable}:null;
 }
 function remember(url,entry){entries[key(url)]=entry;revision++;}
 function flush(){const run=writing.then(async()=>{if(persisted===revision)return;fs.mkdirSync(path.dirname(file),{recursive:true});const version=revision,tmp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify({version:1,entries}));try{for(let i=0;;i++){try{await fs.promises.rename(tmp,file);break;}catch(e){if(i>=4||!['EPERM','EACCES','EBUSY'].includes(e.code))throw e;await new Promise(r=>setTimeout(r,50*(i+1)));}}persisted=version;}finally{fs.rmSync(tmp,{force:true});}});writing=run.catch(()=>{});return run;}
 return {lookup,remember,flush};
}
module.exports={createMediaCache};
