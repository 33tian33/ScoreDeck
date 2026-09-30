const {test}=require('node:test');const {fork}=require('node:child_process');const net=require('node:net'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
const free=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
test('GSI to tracker HTTP to console integration for all four types',async()=>{
 const gsi=await free(),hud=await free(),commands=[];const sockets=new Set();
 const mock=net.createServer(s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));let pending='';s.on('data',d=>{pending+=d;const lines=pending.split('\n');pending=lines.pop();for(const line of lines){commands.push(line);if(line.startsWith('echo '))s.write(line.slice(5)+'\n');}});});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const root=path.resolve(__dirname,'../radarhud');const data=fs.mkdtempSync(path.join(os.tmpdir(),'tracker-ui-'));
 const child=fork(path.join(root,'backend.cjs'),[],{cwd:root,env:{...process.env,GSI_PORT:String(gsi),HUD_PORT:String(hud),GSI_TEMP_DIR:data,RADAR_HUD_PUBLIC_DIR:path.join(root,'public'),RADAR_HUD_OPEN_BROWSER:'0'},stdio:['ignore','pipe','pipe','ipc']});
 let logs='';child.stderr.on('data',d=>logs+=d);child.stdout.on('data',()=>{});
 let pump;try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('backend timeout '+logs)),6000);child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolve();}});child.on('exit',c=>reject(new Error('backend exit '+c+' '+logs)));});
 const base='http://127.0.0.1:'+hud;
 assert.equal((await fetch(base+'/api/tracker/start',{method:'POST',body:'{}'})).status,403);
 const s=await(await fetch(base+'/api/tracker')).json();assert.equal((await fetch(base+'/api/tracker/start',{method:'POST',headers:{Origin:'http://evil.test','X-Tracker-Key':s.key},body:'{}'})).status,403);
 let grenades={};let x=0;const a='76561198000000001',b='76561198000000002';
 const post=()=>fetch('http://127.0.0.1:'+gsi+'/gsi',{method:'POST',body:JSON.stringify({auth:{token:'change-me'},provider:{timestamp:Date.now()/1000},map:{name:'de_nuke',round:0,phase:'live'},round:{phase:'live'},player:{steamid:a,name:'Alpha',activity:'playing'},allplayers:{[a]:{name:'Alpha',team:'CT',observer_slot:1,position:'0,0,0',state:{health:100}},[b]:{name:'Beta',team:'T',observer_slot:2,position:'10,0,0',state:{health:100}}},allgrenades:grenades})});
 await post();pump=setInterval(()=>{x+=2;for(const g of Object.values(grenades))g.position=`${100+x},0,70`;post().catch(()=>{});},70);
 const api=async(action,input={})=>{const r=await fetch(base+'/api/tracker/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Tracker-Key':s.key},body:JSON.stringify(input)});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;};


 await api('config',{protocol:'text',port:mock.address().port});await api('connect');
 for(const type of ['flashbang','smoke','frag','firebomb']){
   grenades={};await post();await new Promise(r=>setTimeout(r,80));grenades={target:{type,owner:a,position:'100,0,70',velocity:'100,0,0',lifetime:'0.2'}};await post();
   let st=await api('start',{type});assert.equal(st.active.kind,type);assert.equal(st.active.id,'target');assert.match(st.active.reason,/2 秒/);
   await api('heartbeat');await new Promise(r=>setTimeout(r,100));await api('stop');st=await(await fetch(base+'/api/tracker')).json();assert.equal(st.active,null);
 }
 assert.ok(commands.some(c=>c.startsWith('spec_goto ')));assert.ok(commands.some(c=>c.includes('spec_player "Alpha"')));
 }finally{clearInterval(pump);child.send({type:'stop'});await new Promise(r=>child.once('exit',r));for(const s of sockets)s.destroy();await new Promise(r=>mock.close(r));}
});
