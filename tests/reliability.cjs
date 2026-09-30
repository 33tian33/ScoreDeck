const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {test}=require('node:test');
const root=path.resolve(__dirname,'..');
const {createBroadcastServer}=require(path.join(root,'server/broadcast-server.cjs'));
const {createDefaultState:createBlankState,migrateState}=require(path.join(root,'server/default-state.cjs'));
// These fixtures exercise legacy imports and legacy fixed-format schedules.
const createDefaultState=()=>{const s=createBlankState();s.tournament.formatId='world-cup-48';s.tournament.format='世界杯48队模式';return s;};
const archive=require(path.join(root,'server/archive.cjs'));
const sync=fs.readFileSync(path.join(root,'dist/assets/sync-client.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'dist/assets/index-evagatfp.js'),'utf8');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const free=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
const evidence=[];
function record(id,data){evidence.push({id,...data});console.log('verified '+id);}
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await delay(10)}throw Error('timeout');}
function client(initial,{transport,uuid=true}={}){
  let state=structuredClone(initial),key='test',listeners={},timers=new Set();
  const response=(data,status=200)=>({ok:status<400,status,json:async()=>structuredClone(data)});
  const ctx={structuredClone,Uint8Array,URL,URLSearchParams,queueMicrotask,crypto:uuid?crypto:{getRandomValues:crypto.getRandomValues.bind(crypto)},location:new URL('http://192.168.0.10:17890/'),history:{replaceState(){}},sessionStorage:{getItem:()=>key,setItem:(k,v)=>key=v},CustomEvent:class{constructor(type,o){this.type=type;this.detail=o?.detail}},addEventListener(){},dispatchEvent(){},
    setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();timers.add(t);return t},clearTimeout,
    EventSource:class{addEventListener(n,fn){listeners[n]=fn}},
    fetch:async(url,opts)=>{if(url==='/api/meta')return response({controlKey:key});if(!opts?.method)return response(state);return transport?transport(url,opts,response):response(state)}
  };ctx.window=ctx;vm.createContext(ctx);vm.runInContext(sync,ctx);
  return {ctx,get api(){return ctx.SDClient},emit(s){state=structuredClone(s);listeners.state({data:JSON.stringify(s)})},close(){for(const t of timers)clearTimeout(t)}};
}
function fn(name,next){return ui.slice(ui.indexOf('function '+name+'('),ui.indexOf('function '+next+'('));}
test('handoff regression: authority, conflicts, archive, Excel, cycle, statistics and Swiss',async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'sd-audit-'));
 process.env.SCOREDECK_RADAR_PORT=String(await free());process.env.SCOREDECK_GSI_PORT=String(await free());
 const app=createBroadcastServer({dataDir:data,initialPort:await free(),initialCountdownPort:await free()});let stream;
 try{
  const meta=await app.listen(),base=meta.localUrl;
  let auth=await(await fetch(base+'/api/meta')).json(),key=auth.controlKey;
  const get=async()=>await(await fetch(base+'/api/state')).json();
  const req=async(url,method,body)=>{const r=await fetch(base+url,{method,headers:{'X-ScoreDeck-Key':key,'X-ScoreDeck-Epoch':auth.serverEpoch,'X-ScoreDeck-Control-Epoch':auth.controlEpoch,'Content-Type':'application/json'},body:Buffer.isBuffer(body)?body:JSON.stringify(body)});return {status:r.status,data:await r.json()}};
  const patch=changes=>req('/api/state','PATCH',{changes,mutationId:crypto.randomUUID()});
  const reset=async()=>{const s=await get();return (await req('/api/state','PUT',{...createDefaultState(),expectedRevision:s.revision})).data};
  let s=await get();
  const c=client(s,{uuid:false});await until(()=>c.api.state);let err='';try{await c.api.mutate(s=>{s.tournament.name='remote';return s})}catch(e){err=e.message}assert.equal(err,'');record('H01-http-remote-edit',{error:err,pending:c.api.pending});c.close();
  const old=client({...s,revision:100});await until(()=>old.api.state);old.emit({...s,serverEpoch:'new-instance',revision:5,tournament:{...s.tournament,name:'RECOVERED'}});assert.equal(old.api.state.tournament.name,'RECOVERED');record('H02-revision-rollback',{oldRevision:100,incomingRevision:5,visibleName:old.api.state.tournament.name});old.close();
  const calls=[];let firstResolve;
  const q=client(s,{transport:async(url,opts,response)=>{const body=JSON.parse(opts.body);calls.push(body);if(calls.length===1)await new Promise(r=>firstResolve=r);const result=await req(url,opts.method,body);return response(result.data,result.status)}});await until(()=>q.api.state);
  const a=q.api.mutate(s=>{s.entrance.durations.identity=1;return s}).then(()=>200,e=>e.status);
  const b=q.api.mutate(s=>{s.entrance.durations.identity=10;return s}).then(()=>200,e=>e.status);
  firstResolve();const statuses=await Promise.all([a,b]);assert.deepEqual(statuses,[200,200]);assert.equal((await get()).entrance.durations.identity,10);record('H03-normalization-self-conflict',{statuses,requested:10,actual:(await get()).entrance.durations.identity});q.close();
  s=await reset();let release;
  const d=client(s,{transport:async(url,opts,response)=>{if(!release)await new Promise(r=>release=r);return response({error:'conflict',current:{...s,revision:s.revision+1,tournament:{...s.tournament,name:'other',location:'other-location'}}},409)}});await until(()=>d.api.state);
  const d1=d.api.mutate(x=>{x.tournament.name='MY UNSAVED NAME';return x}).catch(()=>{});
  const d2=d.api.mutate(x=>{x.tournament.location='MY UNSAVED LOCATION';return x}).catch(()=>{});release();await Promise.all([d1,d2]);assert.equal(d.api.failedDraft.tournament.name,'MY UNSAVED NAME');assert.equal(d.api.failedDraft.tournament.location,'MY UNSAVED LOCATION');record('H04-failed-draft-overwritten',{wantedName:'MY UNSAVED NAME',savedDraftName:d.api.failedDraft.tournament.name,issue:d.api.issue});d.close();
  s=await reset();const missing={...s,backgroundVideo:{...s.backgroundVideo,enabled:true,source:'/media/missing.mp4'}};
  const imported=await req('/api/archive?revision='+s.revision,'POST',archive.pack([['broadcast-state.json',Buffer.from(JSON.stringify(missing))]]));assert.equal(imported.status,400);assert.match(imported.data.error,/缺少素材/);const missingStatus=(await fetch(base+'/media/missing.mp4')).status;assert.equal(missingStatus,404);record('H05-missing-media-accepted',{importStatus:imported.status,assetStatus:missingStatus});
  s=await reset();const oldAuth={...auth};const transferred=await req('/api/handoff','POST',{});assert.equal(transferred.status,200);
  const denied=await req('/api/state','PATCH',{changes:[],mutationId:crypto.randomUUID()});assert.equal(denied.status,401);
  key=transferred.data.controlKey;auth={...auth,controlEpoch:transferred.data.controlEpoch};const allowed=await patch([{path:['tournament','name'],before:s.tournament.name,after:'NEW DIRECTOR'}]);assert.equal(allowed.status,200);record('H06-handoff-fence',{oldStatus:denied.status,newStatus:allowed.status});
  const ac=new AbortController();stream=ac;const resp=await fetch('http://127.0.0.1:'+meta.countdownPort+'/api/events',{signal:ac.signal});const reader=resp.body.getReader();await reader.read();const newPort=await free();const portChange=await req('/api/countdown-port','PUT',{port:newPort});assert.equal(portChange.status,200);await delay(600);const beforeClose=(await(await fetch(base+'/api/meta')).json()).countdownPort;assert.equal(beforeClose,newPort);await reader.cancel();ac.abort();stream=null;await delay(100);const afterClose=(await(await fetch(base+'/api/meta')).json()).countdownPort;assert.equal(afterClose,newPort);record('H07-countdown-port-hangs',{reportedSuccess:200,requested:newPort,whileOBSConnected:beforeClose,afterOBSDisconnect:afterClose});
  // Run original Excel writer/importer, replacing only browser download/import plumbing.
  const book={Sheets:{}},xlsx={utils:{book_new:()=>book,json_to_sheet:x=>x,aoa_to_sheet:x=>x,book_append_sheet:(b,s,n)=>b.Sheets[n]=s,sheet_to_json:s=>s},writeFile(){},read:()=>book};
  const start=ui.indexOf('  At = (e)'),end=ui.indexOf('async function Lt(');
  const code=ui.slice(start,end).replace('  At = (e)','var At = (e)').replaceAll('await k(() => import(`./xlsx-B7Fe_CV5.js`), [])','xlsx');
  const ex={ScoreDeckRules:require('../server/scoredeck-rules.cjs'),xlsx,structuredClone,ee:(s,m)=>m.mapDetails,kt:(x)=>x,normalizeSeriesScore:x=>Number(x)||0,f:{'world-cup-48':{name:'world'}},d:'ABCDEFGHIJKL'.split('')};vm.createContext(ex);vm.runInContext(code,ex);
  const event=migrateState(createDefaultState());event.matches=[{id:"m1",teamAId:event.teams[0].id,teamBId:event.teams[1].id,bestOf:3,status:"upcoming",scoreA:0,scoreB:0,mapScores:Array.from({length:5},(_,i)=>({map:"MAP "+(i+1),a:null,b:null})),mapDetails:Array.from({length:5},(_,i)=>({map:"MAP "+(i+1),a:null,b:null,teamA:[],teamB:[]}))}];event.teams[0].players[0].starter=false;event.teams[0].players[5].starter=true;event.teams[0].players[0].rating=1.77;event.teams[0].players[0].steamId='76561198000000001';event.countdown.endText='CUSTOM FINISH';event.entrance.showClutch=false;event.sponsors.slots[0].logoImage='data:image/png;base64,c3BvbnNvcg==';event.teams[0].logoPrimary='data:image/png;base64,'+'eA=='.repeat(10000);await ex.Nt(event);
  const roundtrip=migrateState(await ex.It({arrayBuffer:async()=>new ArrayBuffer(0)},migrateState(createDefaultState())));
  assert.equal(book.Sheets.队员[0].Steam64Id,'76561198000000001');assert.equal(roundtrip.teams[0].players[0].steamId,'76561198000000001');
  book.Sheets.队员[0].Steam64Id=76561198000000001;await assert.rejects(()=>ex.It({arrayBuffer:async()=>new ArrayBuffer(0)},migrateState(createDefaultState())),/文本/);book.Sheets.队员[0].Steam64Id='76561198000000001';
  assert.equal(roundtrip.teams[0].players[0].starter,false);assert.equal(roundtrip.teams[0].players[5].starter,true);assert.equal(roundtrip.teams[0].players[0].rating,1.77);assert.equal(roundtrip.countdown.endText,'CUSTOM FINISH');assert.equal(roundtrip.entrance.showClutch,false);assert.equal(roundtrip.sponsors.slots[0].logoImage,event.sponsors.slots[0].logoImage);assert.equal(roundtrip.teams[0].logoPrimary,event.teams[0].logoPrimary);
  record('H08-excel-loss',{starters:roundtrip.teams[0].players.map((p,i)=>p.starter?i:null).filter(x=>x!==null),rating:roundtrip.teams[0].players[0].rating,endText:roundtrip.countdown.endText,showClutch:roundtrip.entrance.showClutch,sponsor:roundtrip.sponsors.slots[0].logoImage,logoReference:roundtrip.teams[0].logoPrimary});
  const rules=require(path.join(root,'server/scoredeck-rules.cjs'));
  const cycle={enabled:true,startAt:new Date(100000).toISOString(),nodes:[{id:'a',enabled:true,scene:'standings',durationSeconds:10},{id:'b',enabled:true,scene:'prematch',durationSeconds:10}]};assert.equal(rules.cyclePoint(cycle,115000).node.scene,'prematch');record('H09-cycle-server-time',{});
  // The modal compares against its opening snapshot; untouched old statistics are not submitted.
  const modalCode=ui.slice(ui.indexOf('    S = () =>\n      SDClient.mutateFrom(',ui.indexOf('function Xt(')),ui.indexOf('    re = (e, t) =>',ui.indexOf('function Xt('))).trim().replace(/^S =/,'var S =').replace(/,\s*$/,';');
  const original=event.matches[0],draft=structuredClone(original.mapDetails);draft[0].teamA=[{playerId:event.teams[0].players[0].id,starter:true,kills:5,deaths:1,assists:0,rating:1}];
  event.matches[0].mapDetails=structuredClone(draft);const latest=structuredClone(event);latest.matches[0].mapDetails=structuredClone(draft);latest.matches[0].mapDetails[0].teamA[0].kills=30;
  let changed;const modal={editBase:{current:event},SDClient:{mutateFrom:(base,fn)=>changed=fn(structuredClone(base))},t:original,o:draft,y:null,te:()=>({a:0,b:0}),ScoreDeckRules:require(path.join(root,'server/scoredeck-rules.cjs')),ke:e=>e};vm.createContext(modal);vm.runInContext(modalCode+' S();',modal);assert.equal(changed.matches[0].mapDetails[0].teamA[0].kills,5);const diffClient=client(latest);await until(()=>diffClient.api.state);const overwrite=diffClient.api.diff(event,changed).find(c=>c.path.at(-1)==='kills');assert.equal(overwrite,undefined);record('H10-untouched-stat-not-overwritten',{});diffClient.close();
  const fixture=structuredClone(event);fixture.sponsors.slots.forEach(x=>x.logoImage='');fixture.teams.forEach(t=>{t.logoPrimary='';t.logoSecondary='';});
  const current=await get();const saved=(await req('/api/state','PUT',{...fixture,expectedRevision:current.revision})).data;
  const liveClient=client(saved,{transport:async(url,opts,response)=>{const result=await req(url,opts.method,JSON.parse(opts.body));return response(result.data,result.status);}});await until(()=>liveClient.api.state);
  const concurrent=await patch([{path:['matches','0','mapDetails','0','teamA','0','kills'],before:5,after:30}]);assert.equal(concurrent.status,200);liveClient.emit(concurrent.data);
  await assert.rejects(liveClient.api.mutateFrom(saved,s=>{s.matches[0].mapDetails[0].teamA[0].kills=6;return s;}));
  assert.equal((await get()).matches[0].mapDetails[0].teamA[0].kills,30);assert.equal(liveClient.api.failedDraft.matches[0].mapDetails[0].teamA[0].kills,6);liveClient.close();
  const game={structuredClone,ScoreDeckRules:require(path.join(root,'server/scoredeck-rules.cjs')),v:(s,id)=>s.teams.find(t=>t.id===id),b:(n,d=0)=>Number.isFinite(Number(n))?Number(n):d};vm.createContext(game);vm.runInContext(ui.slice(ui.indexOf('function normalizeSeriesScore('),ui.indexOf('function ve(')),game);
  const sw=structuredClone(event);sw.tournament.formatId='swiss-16';sw.teams=sw.teams.slice(0,16);sw.matches=Array.from({length:40},(_,i)=>({id:'sw'+i,bracketRound:'SWISS'+(Math.floor(i/8)+1),bracketIndex:i%8,teamAId:i<8?sw.teams[2*i].id:'',teamBId:i<8?sw.teams[2*i+1].id:'',status:i<8?'completed':'tbd',scoreA:i<8?1:0,scoreB:0,mapScores:[]}));game.T(sw);const priorSwiss=structuredClone(sw);const round2=structuredClone(sw.matches.slice(8,16));sw.matches[0].scoreA=0;sw.matches[0].scoreB=1;rules.reconcileSwiss(sw,priorSwiss);assert.notDeepEqual(sw.matches.slice(8,16).map(x=>[x.teamAId,x.teamBId]),round2.map(x=>[x.teamAId,x.teamBId]));const totals=game.de(sw,1).totals;const mismatched=sw.matches.slice(8,16).filter(m=>totals.get(m.teamAId).wins!==totals.get(m.teamBId).wins);assert.equal(mismatched.length,0);record('G01-swiss-correction-not-invalidated',{unchangedRound2:false,differentRecordPairings:mismatched.length});
  const legacySwiss=structuredClone(priorSwiss);legacySwiss.matches.forEach(m=>{delete m.pairingBasis;m.bestOf=1;});legacySwiss.matches[8].scoreA=1;legacySwiss.matches[8].scoreB=0;legacySwiss.matches[8].status='completed';
  const beforeImport=await get();const importedSwiss=await req('/api/state','PUT',{...legacySwiss,expectedRevision:beforeImport.revision});assert.equal(importedSwiss.status,200);assert.equal(importedSwiss.data.matches.find(m=>m.id==='sw8').status,'completed');
  const mvpMatch=structuredClone(event.matches[0]);mvpMatch.mapScores[0]={map:'A',a:13,b:5};mvpMatch.mapScores[1]={map:'B',a:13,b:7};mvpMatch.mapDetails[0]={...mvpMatch.mapScores[0],teamA:[{playerId:event.teams[0].players[1].id,starter:true,rating:1.4}],teamB:[]};mvpMatch.mapDetails[1]={...mvpMatch.mapScores[1],teamA:[],teamB:[]};const stats=game.ne(event,mvpMatch,event.teams[0].id,event.teams[0].players[1].id);assert.equal(stats.averageRating,1.4);assert.equal(stats.ratingMaps,1);record('G02-missing-rating-counted-as-zero',{enteredRating:1.4,secondMapStats:'missing',reported:stats});
  const radar=meta.radar.controlUrl.replace(/\/$/,'');
  const initialDisplay=await(await fetch(radar+'/api/display')).json();
  const setDisplay=async changes=>{const r=await fetch(radar+'/api/display',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({changes})});return {status:r.status,data:await r.json()};};
  assert.equal((await setDisplay([{path:['layer'],before:initialDisplay.layer,after:'low'}])).status,200);
  assert.equal((await setDisplay([{path:['showPlayers'],before:initialDisplay.showPlayers,after:true}])).status,200);
  assert.equal((await setDisplay([{path:['layer'],before:initialDisplay.layer,after:'high'}])).status,409);
  const finalDisplay=await(await fetch(radar+'/api/display')).json();assert.equal(finalDisplay.layer,'low');assert.equal(finalDisplay.showPlayers,true);record('H11-radar-field-conflicts',{});
 }finally{stream?.abort();await app.close();fs.rmSync(data,{recursive:true,force:true})}
 assert.equal(evidence.length,13);
});
test('late old-server packets and in-flight responses cannot revive transferred operations',async()=>{
 const state={...migrateState(createDefaultState()),serverEpoch:'server-a',controlEpoch:'owner-a'};let release;
 const c=client(state,{transport:async(url,options,response)=>{await new Promise(r=>release=r);return response({...state,revision:99});}});
 await until(()=>c.api.state);
 const pending=c.api.mutate(s=>{s.tournament.name='offline draft';return s}).then(()=>false,()=>true);
 c.emit({...state,serverEpoch:'server-b',controlEpoch:'owner-b',revision:1,tournament:{...state.tournament,name:'new-server'}});
 assert.equal(await pending,true);assert.equal(c.api.failedDraft.tournament.name,'offline draft');
 c.emit({...state,revision:999});release();await delay(10);
 assert.equal(c.api.state.serverEpoch,'server-b');assert.equal(c.api.state.tournament.name,'new-server');assert.equal(c.api.pending,0);c.close();
});
test('radar controllers apply peer changes while preserving queued local fields',()=>{
 const code=fs.readFileSync(path.join(root,'radarhud/public/app.js'),'utf8');const checkbox={checked:false},layerSelect={value:'all'},fadeDelayInput={value:'3'};
 const ctx={halftimeEmbed:false,structuredClone,cleanOutput:false,latestDisplaySettings:null,displayQueue:[],applyingSettings:false,selectedLayer:'all',selectedHalf:1,fadeDelaySeconds:3,replayMode:false,replayPlaying:false,replayOffsetMs:0,layerSelect,fadeDelayInput,textGroups:{},lastDisplaySnapshot:null,document:{body:{classList:{toggle(){}}},querySelector:()=>checkbox,querySelectorAll:()=>[]},startReplayClock(){},stopReplayClock(){}};
 vm.createContext(ctx);vm.runInContext(code.slice(code.indexOf('function readDisplaySettings('),code.indexOf('function saveDisplaySettings(')),ctx);
 const state={revision:1,layer:'low',half:1,fade:3,showPlayers:false,replay:false,playing:false,offset:0,texts:{},buys:{}};
 ctx.applyDisplaySettings(state);assert.equal(ctx.selectedLayer,'low');
 ctx.displayQueue=[{changes:[{path:['showPlayers'],before:false,after:true}]}];ctx.applyDisplaySettings({...state,revision:2,layer:'high'});assert.equal(ctx.selectedLayer,'high');assert.equal(checkbox.checked,true);
 ctx.applyDisplaySettings(state);assert.equal(ctx.selectedLayer,'high');
});
test('legacy statistics preserve missing ratings',()=>{
 const state=migrateState(createDefaultState());state.matches=[{id:'a',teamAId:state.teams[0].id,teamBId:state.teams[1].id,bestOf:1,status:'completed',scoreA:1,scoreB:0,mapScores:[{map:'A',a:13,b:1}],mapDetails:[{teamA:[{playerId:'p',starter:true}],teamB:[]}]}];
 assert.equal(migrateState(state).matches[0].mapDetails[0].teamA[0].rating,null);
});
