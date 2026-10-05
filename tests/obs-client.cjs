'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {WebSocketServer}=require('../modules/voicebridge/lib/vendor/ws');
const {connect}=require('../server/obs-client.cjs');
test('OBS v5 authentication and request correlation on real websocket',async()=>{
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>server.on('listening',r));
 const hash=s=>crypto.createHash('sha256').update(s).digest('base64');let identified=false;
 server.on('connection',ws=>{ws.send(JSON.stringify({op:0,d:{authentication:{salt:'salt',challenge:'challenge'}}}));ws.on('message',raw=>{const p=JSON.parse(raw);if(p.op===1){identified=p.d.authentication===hash(hash('passwordsalt')+'challenge');ws.send(JSON.stringify({op:2,d:{}}));}else if(p.op===6){ws.send(JSON.stringify({op:5,d:{eventType:'noise'}}));ws.send(JSON.stringify({op:7,d:{requestId:p.d.requestId,requestStatus:{result:p.d.requestType!=='Bad',comment:'bad request'},responseData:{currentProgramSceneName:'游戏'}}}));}});});
 let client;try{client=await connect({url:'ws://127.0.0.1:'+server.address().port,password:'password'});assert.equal(identified,true);assert.equal((await client.call('GetCurrentProgramScene')).currentProgramSceneName,'游戏');await assert.rejects(client.call('Bad'),/bad request/);}finally{client?.close();for(const c of server.clients)c.terminate();await new Promise(r=>server.close(r));}
});
