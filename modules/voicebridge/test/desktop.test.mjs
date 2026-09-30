import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Desktop,validateStorage} from '../lib/desktop.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'desktop-'));t.after(()=>rm(root,{recursive:true,force:true}));const d=new Desktop(root,join(root,'old-cache'),8);d.control=join(root,'control');return {d,root};}
test('GUI storage validates absolute path and quota; persisted setting preserves old data',async t=>{const {d,root}=await fixture(t);await writeFile(join(root,'.env'),'SECRET=preserve');const result=await d.save({path:join(root,'new-cache'),maxGB:12});assert.equal(result.restartRequired,true);assert.equal((await d.settings()).pending.maxGB,12);assert.equal(await readFile(join(root,'.env'),'utf8'),'SECRET=preserve');assert.throws(()=>validateStorage({path:'relative',maxGB:1}));assert.throws(()=>validateStorage({path:root,maxGB:0}));assert.throws(()=>validateStorage({path:root+'\n',maxGB:1}));});
test('offline Windows-only actions report unsupported host honestly',async t=>{const {d}=await fixture(t);if(process.platform==='win32')return;await assert.rejects(d.volume('mute'),/Windows/);await assert.rejects(d.install({}),/Windows/);});
test('plugin inventory expires and commands require matching acknowledgment',async t=>{const {d,root}=await fixture(t);d.requireWindows=()=>{};await mkdir(d.control);const file=join(d.control,'inventory.json');await writeFile(file,JSON.stringify({connections:[{handler:'1',channels:[{id:'2'}]}]}));assert.equal((await d.inventory()).connected,true);await assert.rejects(d.command({operation:'bind',handler:'1',channel:'bad',group:'channel-alpha'}),/频道/);
 const timer=setInterval(async()=>{try{const text=await readFile(join(d.control,'command.txt'),'utf8');await writeFile(join(d.control,'result.json'),JSON.stringify({id:text.split('\n')[0],error:''}));}catch{}},20);t.after(()=>clearInterval(timer));
 const promise=d.command({operation:'bind',handler:'1',channel:'2',group:'channel-alpha'});await new Promise(r=>setTimeout(r,50));await assert.rejects(d.command({operation:'unbind',handler:'1'}),/进行/);assert.equal((await promise).ok,true);await assert.rejects(readFile(join(d.control,'command.txt')),/ENOENT/);clearInterval(timer);
 await utimes(file,new Date(0),new Date(0));assert.equal((await d.inventory()).connected,false);
});
