import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {atomicJson} from './atomic-json.mjs';

export async function loadCs2Hotwords(path) {
  const preset=JSON.parse(await readFile(path,'utf8'));
  const words=new Map();
  for(const [group,items] of Object.entries(preset.groups)) {
    if(typeof items!=='string')throw new Error(`无效热词组：${group}`);
    for(const raw of items.split(',')) {
      const word=raw.trim();
      if(!word||/[\r\n\0]/.test(word)||(/[^\x00-\x7f]/.test(word)?[...word].length>15:word.split(/\s+/).length>7))throw new Error(`无效热词：${word}`);
      const weight=group==='通用术语'?3:4;
      words.set(word,Math.max(words.get(word)||0,weight));
    }
  }
  if(words.size>500)throw new Error('Paraformer 热词数超过 500');
  const vocabulary=[...words].map(([text,weight])=>({text,weight}));
  const digest=createHash('sha256').update(JSON.stringify(vocabulary)).digest('hex');
  return {version:preset.version,mapPool:preset.mapPool,groups:Object.fromEntries(Object.entries(preset.groups).map(([key,value])=>[key,value.split(',').length])),count:vocabulary.length,digest,vocabulary};
}

export async function installCs2Hotwords({preset,settings,statePath,fetchImpl=fetch}) {
  const config=settings.values();
  if(config.ASR_PROVIDER!=='aliyun'||config.ASR_MODEL!=='paraformer-realtime-v2')throw new Error('CS2 热词预设需使用阿里云 paraformer-realtime-v2');
  if(!config.DASHSCOPE_API_KEY)throw new Error('请先保存阿里云 API Key');
  const workspace=config.DASHSCOPE_WORKSPACE_ID;
  if(!/^[a-zA-Z0-9-]{3,128}$/.test(workspace))throw new Error('请先保存有效的北京地域工作空间 ID');
  let previous={};try{previous=JSON.parse(await readFile(statePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const same=previous.id&&previous.model===config.ASR_MODEL&&previous.workspace===workspace;
  if(same&&previous.digest===preset.digest){
    if(config.ASR_VOCABULARY_ID!==previous.id)await settings.save({ASR_VOCABULARY_ID:previous.id});
    return {vocabularyId:previous.id,reused:true,count:preset.count,restartRequired:settings.pending};
  }
  const input=same
    ?{action:'update_vocabulary',vocabulary_id:previous.id,vocabulary:preset.vocabulary}
    :{action:'create_vocabulary',target_model:config.ASR_MODEL,prefix:'audioincs2',vocabulary:preset.vocabulary};
  const endpoint=`https://${workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/asr/customization`;
  let response;
  try{response=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:`Bearer ${config.DASHSCOPE_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:'speech-biasing',input}),signal:AbortSignal.timeout(20000)});}
  catch(e){throw new Error(e.name==='TimeoutError'?'创建热词表超时':'无法连接北京地域热词接口');}
  let data={};try{data=await response.json();}catch{}
  if(!response.ok||data.code||data.error)throw new Error(`热词接口返回错误（HTTP ${response.status}${data.code?', '+String(data.code).slice(0,60):''}）`);
  const id=same?previous.id:data.output?.vocabulary_id;
  if(typeof id!=='string'||!/^vocab-[\w-]{8,128}$/.test(id))throw new Error('热词接口未返回有效词表 ID');
  await atomicJson(statePath,{id,model:config.ASR_MODEL,workspace,digest:preset.digest,version:preset.version});
  await settings.save({ASR_VOCABULARY_ID:id});
  return {vocabularyId:id,reused:false,count:preset.count,restartRequired:true};
}
