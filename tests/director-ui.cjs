const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../dist/assets/director.js'),'utf8');
function harness(request){const intervals=[],nodes=new Map();const ctx=vm.createContext({request,busy:false,render(){},setInterval:fn=>intervals.push(fn),$:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);},tell(){},act:()=>{throw Error('global busy gate must not block cancellation');}});
 vm.runInContext('let state=null,polling=false;'+source.slice(source.indexOf('let trackerRevision='),source.indexOf('function render(){'))+source.slice(source.indexOf('async function poll()'),source.indexOf("$$('[data-toggle]"))+source.slice(source.indexOf('let heartBusy='),source.indexOf("window.addEventListener('pagehide'"))+"\nglobalThis.api={tracker,poll,clipTime,getState:()=>state,lease:()=>leaseActive,setState:s=>state=s};",ctx);
 return {api:ctx.api,ctx,intervals,nodes};}
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};}
test('connected idle director timers only read state and never send control commands',async()=>{
 const calls=[],state={tracker:{verified:true,active:null}},h=harness(p=>{calls.push(p);return Promise.resolve(state);});
 h.api.setState(state);
 for(let round=0;round<5;round++){
  for(const tick of h.intervals)await tick();
  await new Promise(r=>setImmediate(r));
 }
 assert.ok(calls.length>0);assert.ok(calls.every(p=>p==='state'),JSON.stringify(calls));
});
test('start renews lease before state/voice responds, and an older poll cannot overwrite its result',async()=>{
 const old=deferred(),start=deferred(),calls=[];
 const h=harness((p)=>{calls.push(p);if(p==='state')return old.promise;if(p==='tracker/start')return start.promise;return Promise.resolve({active:{id:'new'}});});
 const poll=h.api.poll(),action=h.api.tracker('start',{type:'smoke'});assert.equal(h.api.lease(),true);
 await h.intervals[0]();assert.ok(calls.includes('tracker/heartbeat'));
 start.resolve({active:{id:'new'}});await action;old.resolve({tracker:{active:null},voice:null});await poll;
 assert.equal(h.api.getState().tracker.active.id,'new');assert.equal(h.api.lease(),true);
 await h.api.tracker('cancel-return'); // Server returns the authoritative resulting state.
});
test('session clock is labelled and does not wrap at 24 hours',()=>{
 const h=harness(()=>{});assert.equal(h.api.clipTime(2000),'会话 00:00:02');assert.equal(h.api.clipTime(86402000),'会话 24:00:02');assert.equal(h.api.clipTime(360000000),'会话 100:00:00');
});

test('a poll during a pending start cannot disable the new lease',async()=>{
 const start=deferred(),h=harness(p=>p==='tracker/start'?start.promise:Promise.resolve({tracker:{active:null}}));
 const action=h.api.tracker('start',{type:'smoke'});await h.api.poll();assert.equal(h.api.lease(),true);
 start.resolve({active:{id:'tracked'}});await action;assert.equal(h.api.getState().tracker.active.id,'tracked');
});
