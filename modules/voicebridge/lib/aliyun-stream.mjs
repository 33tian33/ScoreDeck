import {randomUUID} from 'node:crypto';
import WebSocket from './vendor/ws/wrapper.mjs';
import {DEFAULT_ALIYUN_WS,sentenceSegment} from './aliyun-asr.mjs';

// One bounded speech window per socket. PCM arrives while capture is ongoing.
export function openAliyunStream({apiKey,wsUrl=DEFAULT_ALIYUN_WS,model='paraformer-realtime-v2',language='zh',workspaceId='',vocabularyId='',timeoutMs=30000,onPartial=()=>{},WebSocketImpl=WebSocket}={}) {
 const url=new URL(wsUrl);
 if(!apiKey)throw new Error('未配置 DASHSCOPE_API_KEY');
 if(url.protocol!=='wss:'&&!(url.protocol==='ws:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('ASR_WS_URL 必须使用 wss://');
 const id=randomUUID(),headers={Authorization:`Bearer ${apiKey}`};if(workspaceId)headers['X-DashScope-WorkSpace']=workspaceId;
 const ws=new WebSocketImpl(wsUrl,{headers,handshakeTimeout:Math.min(timeoutMs,15000),perMessageDeflate:false,maxPayload:2*1024*1024});
 let resolve,reject,started=false,ending=false,finished=false,settled=false,queuedBytes=0,sentBytes=0;
 const queue=[],segments=new Map(),result=new Promise((r,j)=>{resolve=r;reject=j;});
 const fail=(message,retryable=true)=>{const e=new Error(message);e.retryable=retryable;complete(e);};
 function complete(error){if(settled)return;settled=true;clearTimeout(timer);clearInterval(poller);ws.terminate();error?reject(error):resolve([...segments.values()].sort((a,b)=>a.start-b.start));}
 const timer=setTimeout(()=>fail('阿里云流式识别超时'),timeoutMs),poller=setInterval(drain,20);
 function send(value,binary=false){ws.send(binary?value:JSON.stringify(value),binary?{binary:true}:{},e=>{if(e)fail('阿里云流式发送失败');});}
 function drain(){if(!started||settled||ws.readyState!==WebSocket.OPEN)return;
  while(queue.length&&ws.bufferedAmount<256*1024){const pcm=queue.shift();queuedBytes-=pcm.length;sentBytes+=pcm.length;send(pcm,true);}
  if(ending&&!queue.length&&!finished){finished=true;send({header:{action:'finish-task',task_id:id,streaming:'duplex'},payload:{input:{}}});}
 }
 ws.on('open',()=>send({header:{action:'run-task',task_id:id,streaming:'duplex'},payload:{task_group:'audio',task:'asr',function:'recognition',model,parameters:{format:'pcm',sample_rate:48000,language_hints:[language],semantic_punctuation_enabled:false,max_sentence_silence:800,punctuation_prediction_enabled:true,...(vocabularyId?{vocabulary_id:vocabularyId}:{})},input:{}}}));
 ws.on('message',(data,binary)=>{if(binary||settled)return;try{const m=JSON.parse(data),h=m.header||{};if(h.task_id!==id)return;
  if(h.event==='task-started'){started=true;drain();}
  if(h.event==='result-generated'){const sentence=m.payload?.output?.sentence;if(!started)throw new Error('阿里云响应顺序异常');const s=sentenceSegment(sentence);if(s)segments.set(`${s.start}:${s.end}`,s);if(sentence?.text)onPartial(String(sentence.text).slice(0,1000));}
  if(h.event==='task-finished'){if(!finished||!sentBytes)throw new Error('阿里云提前结束任务');complete();}
  if(h.event==='task-failed'){const code=String(h.error_code||'UNKNOWN');fail(`阿里云流式识别失败：${code}`,/throttl|rate|limit|timeout|internal|server|unavailable/i.test(code));}
 }catch(e){complete(e);}});
 ws.on('unexpected-response',(_req,res)=>{res.resume();fail(`阿里云握手 HTTP ${res.statusCode}`,res.statusCode===429||res.statusCode>=500);});
 ws.on('error',()=>fail('阿里云流式连接失败'));
 ws.on('close',()=>{if(!settled)fail('阿里云流式连接提前关闭');});
 return {result,write(pcm){if(settled||ending)return;if(!Buffer.isBuffer(pcm)||pcm.length%2)throw new Error('无效PCM');queue.push(pcm);queuedBytes+=pcm.length;if(queuedBytes>4*1024*1024){fail('流式上传积压，转入补识别');return;}drain();},finish(){ending=true;drain();return result;},abort(){fail('流式识别已取消');}};
}
