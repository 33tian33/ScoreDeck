import '../lib/env.mjs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
let child,stopping=false,opened=false;
function launch(){
 child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{stdio:'inherit',env:{...process.env,VB_SUPERVISED:'1'}});
 child.on('error',e=>{console.error(e);process.exitCode=1;});
 child.on('exit',code=>{if(code===75&&!stopping)launch();else process.exitCode=code||0;});
 if(!opened){opened=true;openBrowser();}
}
async function openBrowser(){const url=`http://127.0.0.1:${Number(process.env.PORT||8787)}`;
 for(let i=0;i<40;i++){try{const r=await fetch(url+'/healthz',{signal:AbortSignal.timeout(500)});if(r.ok){const b=spawn('explorer.exe',[url],{stdio:'ignore',detached:true});b.on('error',()=>console.log(url));b.unref();return;}}catch{}await new Promise(r=>setTimeout(r,250));}}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;child?.kill(signal);});
launch();
