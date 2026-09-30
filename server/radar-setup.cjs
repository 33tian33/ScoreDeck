const fs = require('node:fs/promises');
const path = require('node:path');
const {GSI_PORT,resolvePort}=require('../radarhud/ports.cjs');
const {execFile}=require('node:child_process');
const run=(file,args)=>new Promise(resolve=>execFile(file,args,{windowsHide:true,timeout:8000,encoding:'utf8'},(err,out)=>resolve(err?'':out)));
async function isDirectory(dir){try{return (await fs.stat(dir)).isDirectory()}catch{return false}}
async function resolveCfg(input){
  if(typeof input!=='string'||!input.trim())return null;
  const dir=path.resolve(input.trim().replace(/^"|"$/g,''));
  for(const cfg of [dir,path.join(dir,'game','csgo','cfg'),path.join(dir,'csgo','cfg')]){
    if(path.basename(cfg).toLowerCase()==='cfg'&&path.basename(path.dirname(cfg)).toLowerCase()==='csgo'&&path.basename(path.dirname(path.dirname(cfg))).toLowerCase()==='game'&&await isDirectory(cfg))return cfg;
  }
  return null;
}
async function discoverCfg({roots,platform=process.platform}={}){
  if(!roots){
    roots=[process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA].filter(Boolean).map(p=>path.join(p,'Steam'));
    if(platform==='win32'){
      const command="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $r=@(); foreach($k in @('HKCU:\\Software\\Valve\\Steam','HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam','HKLM:\\SOFTWARE\\Valve\\Steam')) { $v=Get-ItemProperty -LiteralPath $k -ErrorAction SilentlyContinue; if($v.SteamPath){$r+=$v.SteamPath}; if($v.InstallPath){$r+=$v.InstallPath} }; ConvertTo-Json -Compress -InputObject @($r)";
      try{const values=JSON.parse(await run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',command]));if(Array.isArray(values))roots.push(...values.filter(v=>typeof v==='string'))}catch{}
    }
  }
  const libraries=new Set(roots);
  for(const root of roots){try{const text=await fs.readFile(path.join(root,'steamapps','libraryfolders.vdf'),'utf8');for(const m of text.matchAll(/"path"\s+"((?:\\.|[^"\\])*)"/g))libraries.add(m[1].replace(/\\\\/g,'\\'))}catch{}}
  const found=[];
  for(const root of libraries)for(const name of ['Counter-Strike Global Offensive','Counter-Strike 2']){
    const cfg=await resolveCfg(path.join(root,'steamapps','common',name));if(cfg&&!found.includes(cfg))found.push(cfg);
  }
  return found;
}
async function writeConfig(cfg,{port=31337,token=process.env.GSI_TOKEN||'change-me'}={}){
  port=resolvePort(port,GSI_PORT);
  cfg=await resolveCfg(cfg);if(!cfg)throw new Error('请选择 CS2 安装目录，或其中的 game\\csgo\\cfg 文件夹。');
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('GSI 接收端口无效');
  if(/["\\\r\n]/.test(token))throw new Error('GSI token 含不支持的字符');
  let content=await fs.readFile(path.join(__dirname,'..','radarhud','config','gamestate_integration_radarhud.cfg'),'utf8');
  content=content.replace('http://127.0.0.1:31337/gsi',`http://127.0.0.1:${port}/gsi`).replace('"change-me"',`"${token}"`);
  const target=path.join(cfg,'gamestate_integration_radarhud.cfg');
  let previous=null;try{previous=await fs.readFile(target,'utf8')}catch(e){if(e.code!=='ENOENT')throw e}
  let backup=null;
  if(previous!==null&&previous!==content){backup=target+'.'+Date.now()+'.bak';await fs.copyFile(target,backup,require('node:fs').constants.COPYFILE_EXCL)}
  await fs.writeFile(target,content,'utf8');
  if(await fs.readFile(target,'utf8')!==content)throw new Error('配置写入校验失败');
  return {ok:true,path:target,backup,message:'GSI 配置成功。请重启 CS2，进入比赛或观战后查看雷达连接状态。'};
}
function createSetup({selectDirectory,port,platform=process.platform}){
  let busy=false;
  return async ({directory,browse=false}={})=>{
    if(busy)throw new Error('配置正在进行，请完成当前的目录选择。');
    busy=true;
    try{
      if(platform!=='win32'&&!directory)return {ok:false,needsDirectory:true,message:'请填写这台电脑上的 CS2 安装目录或 game/csgo/cfg 路径。'};
      let candidates=[];
      if(!directory&&!browse){candidates=await discoverCfg();if(candidates.length===1)directory=candidates[0]}
      if(!directory&&selectDirectory){directory=await selectDirectory(candidates[0]);if(!directory)return {ok:false,cancelled:true,message:'已取消，未修改 GSI 配置。'}}
      if(!directory)return {ok:false,needsDirectory:true,message:'未找到唯一的 CS2 安装目录，请填写路径后重试。'};
      return await writeConfig(directory,{port});
    }catch(e){if(['EACCES','EPERM'].includes(e.code))throw new Error('无法写入 CS2 配置目录，请检查目录写入权限后重试。');throw e}finally{busy=false}
  };
}
module.exports={createSetup,discoverCfg,resolveCfg,writeConfig};
