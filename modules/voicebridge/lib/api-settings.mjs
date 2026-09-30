import {readFile} from 'node:fs/promises';
import {atomicJson} from './atomic-json.mjs';
const secrets=['DASHSCOPE_API_KEY','OPENAI_API_KEY','DEEPSEEK_API_KEY'];
const defaults={DEEPSEEK_ENABLED:'true',ASR_PROVIDER:'aliyun',ASR_MODEL:'paraformer-realtime-v2',ASR_LANGUAGE:'zh',ASR_WS_URL:'wss://dashscope.aliyuncs.com/api-ws/v1/inference',ASR_BASE_URL:'https://api.openai.com/v1',DASHSCOPE_WORKSPACE_ID:'',ASR_VOCABULARY_ID:'',ASR_STREAMING:'true',DEEPSEEK_MODEL:'deepseek-flash'};
export class ApiSettings {
 constructor(path,env=process.env){this.path=path;this.env=env;this.saved={};this.pending=false;this.busy=false;}
 async load(){try{this.saved=JSON.parse(await readFile(this.path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}Object.assign(this.env,this.saved);}
 values(){const v={...defaults};for(const k of [...Object.keys(defaults),...secrets])v[k]=this.saved[k]??this.env[k]??defaults[k]??'';if(!this.saved.ASR_MODEL&&!this.env.ASR_MODEL&&v.ASR_PROVIDER==='openai')v.ASR_MODEL='whisper-1';return v;}
 public(){const v=this.values();for(const k of secrets){v[k+'_SET']=!!v[k];delete v[k];}return {values:v,restartRequired:this.pending};}
 async save(input){
 if(this.busy)throw new Error('配置正在保存，请稍后');this.busy=true;
 try{
 const next=this.values();
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('无效配置');
 for(const [k,v] of Object.entries(input)){
 if(!Object.hasOwn(defaults,k)&&!secrets.includes(k))throw new Error('未知配置字段');
 if(typeof v!=='string'||v.length>2048||/[\r\n\0]/.test(v))throw new Error('配置必须为单行文本');
 if(secrets.includes(k)){if(v.trim())next[k]=v.trim();}else next[k]=v.trim();
 }
 if(!['aliyun','openai'].includes(next.ASR_PROVIDER))throw new Error('请选择识别服务');
 if(!['true','false'].includes(next.DEEPSEEK_ENABLED))throw new Error('无效分段选项');
 if(!['true','false'].includes(next.ASR_STREAMING))throw new Error('无效实时识别选项');
 for(const k of ['ASR_MODEL','DEEPSEEK_MODEL'])if(!next[k]||next[k].length>128)throw new Error('请填写有效模型名称');
 for(const [k,protocol] of [['ASR_WS_URL','wss:'],['ASR_BASE_URL','https:']]){
 let u;try{u=new URL(next[k]);}catch{throw new Error('接口地址格式不正确');}
 if(u.protocol!==protocol||u.username||u.password||u.hash)throw new Error('接口地址必须使用 '+protocol);
 }
 await atomicJson(this.path,next);this.saved=next;this.pending=true;return this.public();
 }finally{this.busy=false;}
 }
}
