const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createNativeModules}=require('../server/native-modules.cjs');
const listen=s=>new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${s.address().port}`)));
const close=s=>new Promise(resolve=>{s.closeAllConnections();s.close(resolve);});
test('native transport retains methods, payloads, range requests and isolates loopback origins',async()=>{
 const upstream=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({url:req.url,method:req.method,body,range:req.headers.range}));});
 const origin=await listen(upstream),service={all:()=>({replay:{phase:'running',controlUrl:origin+'/'}})},native=createNativeModules(service);
 const server=http.createServer((req,res)=>{if(!native.handle(req,res)){res.writeHead(404);res.end();}}),base=await listen(server);
 try{
  const response=await fetch(base+'/native-modules/replay/api/config?q=x',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Range:'bytes=2-4'},body:'{"delay":12.5}'});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{url:'/api/config?q=x',method:'POST',body:'{"delay":12.5}',range:'bytes=2-4'});
  assert.equal((await fetch(base+'/native-modules/replay/api/state',{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal(await new Promise(resolve=>http.get(base+'/native-modules/replay/api/state',{headers:{Host:'evil.example'}},r=>{r.resume();resolve(r.statusCode)})),403);
  const doubleSlash=await fetch(base+'/native-modules/replay//evil.example/api/state');assert.equal(doubleSlash.status,200);assert.equal((await doubleSlash.json()).url,'//evil.example/api/state');
 }finally{native.close();await close(server);await close(upstream);}
});

