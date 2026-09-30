const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {discoverCfg,resolveCfg,writeConfig,createSetup}=require('../server/radar-setup.cjs');
test('GSI setup discovers extra Steam libraries, validates paths, writes current port and backs up old configuration',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sd-gsi-'));
 try{
  const steam=path.join(root,'Steam'),extra=path.join(root,'游戏 库');
  const game=path.join(extra,'steamapps','common','Counter-Strike Global Offensive'),cfg=path.join(game,'game','csgo','cfg');
  await fs.mkdir(cfg,{recursive:true});await fs.mkdir(path.join(steam,'steamapps'),{recursive:true});
  await fs.writeFile(path.join(steam,'steamapps','libraryfolders.vdf'),'"libraryfolders" { "1" { "path" "'+extra+'" } }');
  assert.deepEqual(await discoverCfg({roots:[steam]}),[cfg]);
  assert.equal(await resolveCfg(game),cfg);assert.equal(await resolveCfg(root),null);
  await assert.rejects(writeConfig(root),/请选择/);
  const first=await writeConfig(game,{port:32123});assert.equal(first.ok,true);assert.equal(first.backup,null);
  assert.match(await fs.readFile(first.path,'utf8'),/127.0.0.1:32123\/gsi/);
  await fs.writeFile(first.path,'old config');
  const second=await writeConfig(cfg);assert.equal(await fs.readFile(second.backup,'utf8'),'old config');
  const third=await writeConfig(cfg);assert.equal(third.backup,null);
  const cancel=createSetup({platform:'win32',selectDirectory:async()=>null,port:31337});assert.equal((await cancel({browse:true})).cancelled,true);
  const select=createSetup({platform:'win32',selectDirectory:async()=>game,port:32124});assert.equal((await select({browse:true})).ok,true);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
