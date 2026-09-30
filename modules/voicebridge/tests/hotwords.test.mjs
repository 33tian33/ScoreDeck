import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ApiSettings} from '../lib/api-settings.mjs';
import {loadCs2Hotwords,installCs2Hotwords} from '../lib/hotwords.mjs';

test('CS2 preset creates one real Paraformer vocabulary and reuses its ID',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'vb-hotwords-'));
 try{
  const preset=await loadCs2Hotwords(new URL('../data/cs2-hotwords-v1.json',import.meta.url));
  assert.equal(preset.mapPool.length,7);
  assert(preset.mapPool.includes('Cache')&&!preset.mapPool.includes('Overpass'));
  assert(preset.count>250&&preset.count<=500);
  assert.equal(new Set(preset.vocabulary.map(x=>x.text)).size,preset.count);
  const settings=new ApiSettings(join(directory,'api-settings.json'),{});
  await settings.save({DASHSCOPE_API_KEY:'test-key',DASHSCOPE_WORKSPACE_ID:'ws-test-123'});
  let calls=0;
  const fetchImpl=async(url,options)=>{
   calls++;
   assert.equal(url,'https://ws-test-123.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/asr/customization');
   assert.equal(options.headers.Authorization,'Bearer test-key');
   const body=JSON.parse(options.body);
   assert.equal(body.model,'speech-biasing');
   assert.equal(body.input.action,'create_vocabulary');
   assert.equal(body.input.target_model,'paraformer-realtime-v2');
   assert.equal(body.input.vocabulary.length,preset.count);
   return {ok:true,status:200,json:async()=>({output:{vocabulary_id:'vocab-audioincs2-123456789abcdef'}})};
  };
  const params={preset,settings,statePath:join(directory,'hotwords-preset.json'),fetchImpl};
  const first=await installCs2Hotwords(params);
  assert.equal(first.vocabularyId,'vocab-audioincs2-123456789abcdef');
  assert.equal(JSON.parse(await readFile(settings.path,'utf8')).ASR_VOCABULARY_ID,first.vocabularyId);
  assert.equal((await installCs2Hotwords(params)).reused,true);
  assert.equal(calls,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});
