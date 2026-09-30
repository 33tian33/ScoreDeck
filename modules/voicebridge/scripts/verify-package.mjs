import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('BUILD-MANIFEST.json',root),'utf8'));
let failed=false;
for(const [name,expected] of Object.entries(manifest.sha256)){
  try{const b=await readFile(new URL(name,root));const hash=createHash('sha256').update(b).digest('hex');
    if(hash!==expected)throw new Error('SHA256 mismatch');
    const pe=b.readUInt32LE(60);if(b.toString('ascii',pe,pe+4)!=='PE\0\0'||b.readUInt16LE(pe+4)!==0x8664)throw new Error('Not Windows x64');
    console.log(`PASS ${name}`);
  }catch(e){failed=true;console.error(`FAIL ${name}: ${e.message}`);}
}
console.log(`Node ${process.version} / ${process.platform} / ${process.arch}`);
if(process.platform==='win32'&&process.arch!=='x64'){failed=true;console.error('64-bit Node required');}
console.log(failed?'Package verification failed.':'Package verified. TeamSpeak must still load the plugin to test runtime compatibility.');
process.exitCode=failed?1:0;
