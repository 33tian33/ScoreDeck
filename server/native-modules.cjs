// Same-origin transport for the native module components. Only the two managed
// loopback services are reachable; this is deliberately not a general proxy.
const http=require('node:http');
const local=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
function createNativeModules(integrations){
 const sockets=new Set();
 function target(req){const m=/^\/native-modules\/(replay|voicebridge)(\/.*)$/.exec(req.url);if(!m)return null;const s=integrations.all()[m[1]],url=new URL(s.controlUrl);const split=m[2].indexOf('?');url.pathname=split<0?m[2]:m[2].slice(0,split);url.search=split<0?'':m[2].slice(split);return {state:s,url};}
 function allowed(req){if(!local(req))return false;try{const host=new URL('http://'+req.headers.host);if(!['localhost','127.0.0.1','[::1]'].includes(host.hostname))return false;return !req.headers.origin||req.headers.origin===host.origin;}catch{return false;}}
 function handle(req,res){const t=target(req);if(!t)return false;if(!allowed(req)){res.writeHead(403);res.end('Local application access only');return true;}if(t.state.phase!=='running'){res.writeHead(503);res.end('Module is not running');return true;}
  const headers={...req.headers,host:t.url.host};delete headers.origin;delete headers.connection;
  const upstream=http.request(t.url,{method:req.method,headers},r=>{const h={...r.headers};delete h['content-security-policy'];delete h['x-frame-options'];res.writeHead(r.statusCode,h);r.pipe(res);});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Module connection unavailable');});req.pipe(upstream);res.on('close',()=>upstream.destroy());return true;
 }
 function upgrade(req,socket,head){const t=target(req);if(!t)return false;if(!req.headers.origin||!allowed(req)||t.state.phase!=='running'){socket.destroy();return true;}
  const headers={...req.headers,host:t.url.host,origin:t.url.origin};
  const upstream=http.request(t.url,{headers});upstream.on('upgrade',(r,peer,extra)=>{sockets.add(socket);sockets.add(peer);socket.write(`HTTP/1.1 ${r.statusCode} ${r.statusMessage}\r\n`+Object.entries(r.headers).map(([k,v])=>`${k}: ${v}\r\n`).join('')+'\r\n');if(extra.length)socket.write(extra);if(head.length)peer.write(head);socket.pipe(peer).pipe(socket);const close=()=>{sockets.delete(socket);sockets.delete(peer);socket.destroy();peer.destroy();};socket.on('close',close);peer.on('close',close);socket.on('error',close);peer.on('error',close);});upstream.on('response',()=>socket.destroy());upstream.on('error',()=>socket.destroy());upstream.end();return true;
 }
 return {handle,upgrade,close(){for(const socket of sockets)socket.destroy();sockets.clear();}};
}
module.exports={createNativeModules};
