const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createDirectorService}=require('../server/director-service.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('slow VoiceBridge cannot block tracker state; refresh is single-flight, times out and recovers',async()=>{
 let delay=3100,voiceRequests=0,running=true,leaseCalls=0;const timers=new Set();
 const server=http.createServer((req,res)=>{const send=data=>{if(!res.destroyed){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}};
  if(req.url.startsWith('/radar/')){if(req.url.endsWith('/heartbeat'))leaseCalls++;send({key:'test-key',active:{id:'tracked'},counts:{},returning:false});}
  else{voiceRequests++;const timer=setTimeout(()=>{timers.delete(timer);send({sessionId:'current',channels:[]});},delay);timers.add(timer);}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const root='http://127.0.0.1:'+server.address().port+'/';
 const service=createDirectorService({radar:{meta:()=>({controlUrl:root+'radar/'})},integrations:{all:()=>({voicebridge:{phase:running?'running':'stopped',controlUrl:root+'voice/'}})}});
 try{
  for(let i=0;i<3;i++){const start=performance.now(),s=await service.state();assert.ok(performance.now()-start<1000,'audio must not delay tracker');assert.equal(s.tracker.active.id,'tracked');assert.equal(s.tracker.key,undefined);}
  await service.action('tracker/heartbeat',{});assert.equal(leaseCalls,1);assert.equal(voiceRequests,1);
  await sleep(1300);let state=await service.state();assert.equal(state.voice,null);assert.equal(state.voiceStale,true);assert.match(state.voiceError,/超时/);delay=0;await sleep(1300);
  for(let i=0;i<20&&!state.voice;i++){await sleep(20);state=await service.state();}
  assert.equal(state.voice.sessionId,'current');assert.equal(state.voiceStale,false);
  // A response already in flight may not repopulate the cache after the module stops.
  running=false;state=await service.state();assert.equal(state.voice,null);await sleep(30);state=await service.state();assert.equal(state.voice,null);
  const cancel=await service.action('tracker/cancel-return',{});assert.equal(cancel.returning,false);
 }finally{for(const t of timers)clearTimeout(t);server.closeAllConnections();await new Promise(r=>server.close(r));}
});
