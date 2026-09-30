import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ApiSettings} from '../lib/api-settings.mjs';
test('API settings preserve keys, redact responses, validate and reload on restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vb-api-'));
 try{
 const path=join(dir,'api.json'),env={DASHSCOPE_API_KEY:'test-aliyun',DEEPSEEK_API_KEY:'test-deep'};
 const config=new ApiSettings(path,env);await config.load();
 assert.equal(config.public().values.DASHSCOPE_API_KEY_SET,true);
 assert.ok(!JSON.stringify(config.public()).includes('test-aliyun'));
 await config.save({ASR_PROVIDER:'openai',ASR_MODEL:'whisper-1',OPENAI_API_KEY:'test-openai',DASHSCOPE_API_KEY:'',DEEPSEEK_ENABLED:'false'});
 assert.equal(env.ASR_PROVIDER,undefined,'save must not mutate running service');
 const disk=JSON.parse(await readFile(path,'utf8'));
 assert.equal(disk.DASHSCOPE_API_KEY,'test-aliyun');
 assert.equal(disk.OPENAI_API_KEY,'test-openai');
 const newEnv={ASR_PROVIDER:'aliyun'},restarted=new ApiSettings(path,newEnv);await restarted.load();
 assert.equal(newEnv.ASR_PROVIDER,'openai');assert.equal(newEnv.DEEPSEEK_ENABLED,'false');
 assert.equal(restarted.public().restartRequired,false);
 await restarted.save({ASR_PROVIDER:'aliyun',ASR_MODEL:'paraformer-realtime-v2',OPENAI_API_KEY:''});
 assert.equal(restarted.values().OPENAI_API_KEY,'test-openai');
 for(const bad of [{ASR_PROVIDER:'fake'},{ASR_WS_URL:'http://example.com'},{OPENAI_API_KEY:'x\nX=y'},{OTHER:'x'},{ASR_MODEL:''}]){
 await assert.rejects(restarted.save(bad));
 }
 assert.equal(JSON.parse(await readFile(path,'utf8')).ASR_PROVIDER,'aliyun');
 }finally{await rm(dir,{recursive:true,force:true});}
});
