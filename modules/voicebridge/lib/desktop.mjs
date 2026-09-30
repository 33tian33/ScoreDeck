import {readFile,writeFile,mkdir,rename,stat,copyFile,access,unlink} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {atomicJson} from './atomic-json.mjs';
const exec=promisify(execFile);
export function validateStorage(data){
 if(typeof data.path!=='string'||!data.path.trim()||/[\r\n\0"]/.test(data.path)||!isAbsolute(data.path))throw new Error('请输入本机绝对路径，例如 D:/VoiceBridgeCache');
 const gb=Number(data.maxGB);if(!Number.isFinite(gb)||gb<.1||gb>1000)throw new Error('采集额度须为0.1至1000 GiB');
 return {path:resolve(data.path.trim()),maxGB:gb};
}
export class Desktop {
 constructor(root,runtime,maxGB,dataRoot=root){this.dataRoot=dataRoot;this.root=root;this.runtime=runtime;this.maxGB=maxGB;this.busy=false;this.control=join(process.env.APPDATA||root,'VoiceBridge');}
 requireWindows(){if(process.platform!=='win32')throw new Error('此功能需要在Windows电脑上运行');}
 async settings(){let pending=null;try{pending=JSON.parse(await readFile(join(this.dataRoot,'desktop-settings.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}return {windows:process.platform==='win32',runtime:this.runtime,maxGB:this.maxGB,pending,pluginDirectory:process.env.APPDATA?join(process.env.APPDATA,'TS3Client','plugins'):''};}
 async save(data){const config=validateStorage(data);await mkdir(config.path,{recursive:true});const probe=join(config.path,`.voicebridge-write-${randomUUID()}`);await writeFile(probe,'test',{flag:'wx'});await unlink(probe);
 await atomicJson(join(this.dataRoot,'desktop-settings.json'),config);return {ok:true,restartRequired:true,...config};}
 async inventory(){this.requireWindows();try{const f=join(this.control,'inventory.json');const s=await stat(f);if(Date.now()-s.mtimeMs>7000)return {connected:false,connections:[],message:'插件未运行或心跳过期'};return {connected:true,...JSON.parse(await readFile(f,'utf8'))};}catch(e){if(e.code==='ENOENT')return {connected:false,connections:[],message:'请安装插件，在TS3启用并连接服务器'};throw e;}}
 async install(data){this.requireWindows();const {stdout}=await exec('tasklist.exe',['/FO','CSV','/NH'],{windowsHide:true});if(/ts3client_win(32|64)\.exe/i.test(stdout))throw new Error('请完全退出TeamSpeak后再安装；不会强制关闭客户端');
 const dest=data.directory||join(process.env.APPDATA,'TS3Client','plugins');if(typeof dest!=='string'||!isAbsolute(dest)||/[\r\n\0]/.test(dest))throw new Error('插件目录必须是绝对路径');
 await mkdir(dest,{recursive:true});const target=join(dest,'voicebridge_win64.dll');try{await access(target);await copyFile(target,`${target}.backup-${Date.now()}`);}catch(e){if(e.code!=='ENOENT')throw e;}
 await copyFile(join(this.root,'plugin','voicebridge_win64.dll'),target);return {ok:true,path:target,message:'已安装并备份旧插件。启动TS3，在插件管理中启用 VoiceBridge 0.5.0，再刷新连接列表。'};}
 async volume(action){this.requireWindows();if(!['mute','unmute','status'].includes(action))throw new Error('无效静音操作');const {stdout}=await exec(join(this.root,'bin','ts3-volume.exe'),[action],{windowsHide:true,timeout:10000});const r=JSON.parse(stdout);if(!r.sessions)throw new Error('未发现TS3音频会话：请启动TS3并播放一段声音后重试');if(r.errors)throw new Error('部分音频会话操作失败，请检查Windows音量混合器');if(action==='mute'&&r.muted!==r.sessions)throw new Error('未能确认全部TS3会话已静音');return {...r,ok:true};}
 async command(data){this.requireWindows();if(this.busy)throw new Error('上一个频道切换仍在进行');const inv=await this.inventory();const conn=inv.connections.find(c=>c.handler===data.handler);if(!conn)throw new Error('请选择仍在线的TS3连接');
 if(!['bind','unbind'].includes(data.operation)||!/^\d+$/.test(data.handler))throw new Error('无效命令');
 if(data.operation==='bind'&&(!['channel-alpha','channel-bravo'].includes(data.group)||!conn.channels.some(c=>c.id===data.channel)))throw new Error('请选择有效频道及队伍');
 const password=String(data.password||'');if(/[\r\n\0]/.test(password)||password.length>256)throw new Error('频道密码格式无效');
 this.busy=true;const id=randomUUID(),command=join(this.control,'command.txt');try{
 await mkdir(this.control,{recursive:true});await writeFile(command+'.tmp',[id,data.operation,data.handler,data.channel||'0',data.group||'',password].join('\n'));await rename(command+'.tmp',command);
 const until=Date.now()+18000;while(Date.now()<until){await new Promise(r=>setTimeout(r,250));try{const r=JSON.parse(await readFile(join(this.control,'result.json'),'utf8'));if(r.id===id){if(r.error)throw new Error(r.error);return {ok:true,message:'插件已确认频道绑定变更'};}}catch(e){if(e.code!=='ENOENT')throw e;}}
 throw new Error('插件未确认操作，请刷新实际连接状态后重试');
 }finally{await unlink(command).catch(()=>{});this.busy=false;}}
}
