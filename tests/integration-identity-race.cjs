const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createIdentitySync}=require('../server/integration-identity.cjs');
test('explicit identity changes wait for the in-flight sync and apply the latest preference before returning',async()=>{
 let firstResponse,receivedFirst;const first=new Promise(resolve=>receivedFirst=resolve),updates=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  updates.push(JSON.parse(raw).managed);
  const reply=()=>{res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');};
  if(updates.length===1){firstResponse=reply;receivedFirst();}else reply();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const prefs={voicebridge:{followMain:true},replay:{}},records={voicebridge:{phase:'running',generation:1},replay:{phase:'stopped'}};
 const sync=createIdentitySync({getState:()=>({}),dataDir:'.',prefs,records,url:()=>`http://127.0.0.1:${server.address().port}`});
 try{
  const active=sync.sync('voicebridge',true);await first;
  prefs.voicebridge.followMain=false;sync.reset('voicebridge');
  let done=false;const explicit=sync.sync('voicebridge',true).then(()=>{done=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);
  firstResponse();await Promise.all([active,explicit]);
  assert.deepEqual(updates,[true,false]);assert.equal(sync.meta('voicebridge').syncError,'');
 }finally{sync.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
