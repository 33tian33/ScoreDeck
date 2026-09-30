const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createDefaultState,migrateState}=require('../server/default-state.cjs');
const code=fs.readFileSync(path.join(__dirname,'../dist/assets/entrance-0.4-integrated.js'),'utf8');
test('four-letter abbreviation survives migration and entrance badge',()=>{
 const state=createDefaultState();state.teams[0].shortName='TEAM';
 assert.equal(migrateState(state).teams[0].shortName,'TEAM');
 const expr=code.match(/const initials = (.*);/)[1];
 assert.equal(vm.runInNewContext('('+expr+')("TEAM")',{esc:x=>x}),'TEAM');
});
test('Clutch option migrates compatibly and both team timelines agree with server return time',()=>{
 const state=createDefaultState();assert.equal(migrateState(state).entrance.showClutch,true);
 state.entrance.showClutch=false;assert.equal(migrateState(state).entrance.showClutch,false);
 const functions=code.slice(code.indexOf('  function teamTimeline('),code.indexOf('  function timeline('));
 const timeline=code.slice(code.indexOf('  function timeline('),code.indexOf('\n  }',code.indexOf('  function timeline('))+4);
 const server=fs.readFileSync(path.join(__dirname,'../server/broadcast-server.cjs'),'utf8');
 const duration=server.slice(server.indexOf('  const entranceDurationMs ='),server.indexOf('  const scheduleEntranceReturn ='));
 for(const showClutch of [true,false])for(const transition of [.2,20/30,1]){
   const config={showClutch,status:'running',durations:{identity:2.4,lineup:2.6,clutch:2.1,transition}};
   const ctx=vm.createContext({entrance:()=>config,state:{entrance:config},isDedicated:false});
   vm.runInContext(functions+timeline+duration,ctx);
   const total=vm.runInContext('timeline(0).total',ctx);
   assert.ok(Math.abs(total*1000-vm.runInContext('entranceDurationMs()',ctx))<.00001);
   const pages=new Set();for(let t=0;t<total;t+=.02){const item=vm.runInContext('timeline('+t+')',ctx);if(item.scene)pages.add(item.scene.key)}
   assert.equal(pages.size,showClutch?6:4);assert.equal([...pages].some(x=>x.includes('clutch')),showClutch);
   assert.equal(vm.runInContext('timeline('+total+').done',ctx),true);
 }
});
