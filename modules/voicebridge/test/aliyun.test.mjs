import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer } from '../lib/vendor/ws/wrapper.mjs';
import { transcribeAliyun, sentenceSegment } from '../lib/aliyun-asr.mjs';
import { wav } from '../lib/audio.mjs';
async function mock(t,handler){
  const server=http.createServer();const wss=new WebSocketServer({server});
  wss.on('connection',(ws,req)=>handler(ws,req));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{for(const ws of wss.clients)ws.terminate();wss.close();server.close();});
  return `ws://127.0.0.1:${server.address().port}`;
}
test('Aliyun uses authentication, waits for task-started, sends raw PCM, final timestamps and finish-task',async t=>{
  const pcm=Buffer.alloc(9600,1);let bytes=0;
  const url=await mock(t,(ws,req)=>{
    assert.equal(req.headers.authorization,'Bearer fake-key');let id;
    ws.on('message',(data,binary)=>{
      if(binary){bytes+=data.length;assert.ok(id);assert.notEqual(data.toString('ascii',0,4),'RIFF');return;}
      const m=JSON.parse(data);id=m.header.task_id;
      if(m.header.action==='run-task'){
        assert.equal(m.payload.model,'paraformer-realtime-v2');assert.equal(m.payload.parameters.sample_rate,48000);
        ws.send(JSON.stringify({header:{event:'task-started',task_id:id}}));
        ws.send(JSON.stringify({header:{event:'result-generated',task_id:id},payload:{output:{sentence:{sentence_end:false,text:'临时',begin_time:0}}}}));
      }else{
        assert.equal(m.header.action,'finish-task');assert.equal(bytes,pcm.length);
        const result={header:{event:'result-generated',task_id:id},payload:{output:{sentence:{sentence_end:true,text:'进攻 A 点',begin_time:10,end_time:90}}}};
        ws.send(JSON.stringify(result));ws.send(JSON.stringify(result)); // duplicate final is idempotent
        ws.send(JSON.stringify({header:{event:'task-finished',task_id:id}}));
      }
    });
  });
  const result=await transcribeAliyun(wav(pcm),{apiKey:'fake-key',wsUrl:url});
  assert.deepEqual(result,[{start:.01,end:.09,text:'进攻 A 点'}]);
});
test('Aliyun uses word timestamps when sentence end is null',()=>{
  assert.deepEqual(sentenceSegment({sentence_end:true,begin_time:170,end_time:null,text:'好',words:[{begin_time:170,end_time:920}]}),{start:.17,end:.92,text:'好'});
  assert.throws(()=>sentenceSegment({sentence_end:true,text:'missing'}),/时间码/);
});
test('Aliyun handshake authentication failure is not retried',async t=>{
  const s=http.createServer();s.on('upgrade',(req,socket)=>{socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');});
  await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>s.close());
  await assert.rejects(transcribeAliyun(wav(Buffer.alloc(960)),{apiKey:'bad',wsUrl:`ws://127.0.0.1:${s.address().port}`}),e=>e.retryable===false&&e.message.includes('401'));
});
test('Aliyun provider failures reject, throttling remains retryable',async t=>{
  const url=await mock(t,ws=>ws.on('message',data=>{const m=JSON.parse(data);ws.send(JSON.stringify({header:{task_id:m.header.task_id,event:'task-failed',error_code:'Throttling',error_message:'do not log secrets'}}));}));
  await assert.rejects(transcribeAliyun(wav(Buffer.alloc(960)),{apiKey:'key',wsUrl:url}),e=>e.retryable===true&&!e.message.includes('secrets'));
});
test('Aliyun early close and missing completion do not silently succeed',async t=>{
 const url=await mock(t,ws=>ws.on('message',()=>ws.close()));
 await assert.rejects(transcribeAliyun(wav(Buffer.alloc(960)),{apiKey:'key',wsUrl:url}),/提前关闭/);
 const timeout=await mock(t,()=>{});
 await assert.rejects(transcribeAliyun(wav(Buffer.alloc(960)),{apiKey:'key',wsUrl:timeout,timeoutMs:150}),/超时/);
});
