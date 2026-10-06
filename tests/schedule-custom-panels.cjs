const {test}=require('node:test'),assert=require('node:assert/strict');
const D=require('../server/flow-display.cjs'),P=require('../server/custom-panels.cjs'),S=require('../server/default-state.cjs'),F=require('../server/tournament-flow.cjs'),{createTestState}=require('./fixtures/state.cjs');
test('chronological order keeps unknown and equal start times stable without mutating source',()=>{
 const ms=[{id:'unknown'},{id:'late',date:'2026-10-08',time:'09:00'},{id:'early',date:'2026-10-06',time:'21:00'},{id:'same',date:'2026-10-06',time:'21:00'},{id:'partial',date:'2026-10-01'},{id:'invalid',date:'broken',time:'12:00'}];
 assert.deepEqual(D.chronological(ms).map(m=>m.id),['early','same','late','unknown','partial','invalid']);assert.equal(ms[0].id,'unknown');
});
test('schedule pages and each bracket column use chronological order and retain all matches',()=>{
 const s=createTestState(),st=F.addStage(s,'playoff',{teamCount:8});st.slots.forEach((sl,i)=>sl.teamId=s.teams[i].id);F.reconcile(s);
 const ms=F.matchesOf(s,st.id);ms[0].date='2026-10-08';ms[0].time='12:00';ms[1].date='2026-10-06';ms[1].time='12:00';
 assert.deepEqual(D.pages(s,'schedule')[0].matches.slice(0,2).map(m=>m.id),[ms[1].id,ms[0].id]);
 const nodes=D.bracketPages(s,st).flatMap(p=>p.nodes);assert.deepEqual(nodes.filter(n=>n.col===0).slice(0,2).map(n=>n.m.id),[ms[1].id,ms[0].id]);assert.equal(nodes.length,ms.length);
});
test('search matches both teams, substitutes and historical map lineups, with combined case-insensitive terms',()=>{
 const s=createTestState(),m={teamAId:s.teams[0].id,teamBId:s.teams[1].id,mapDetails:[{teamA:[{id:'历史选手'}]}]};
 s.teams[0].name='上海队';s.teams[1].shortName='STAR';
 for(const q of ['上海','star','player_1_7','历史选手','上海 STAR'])assert.ok(D.searchMatch(s,m,q),q);
 assert.equal(D.searchMatch(s,m,'player_3_1'),false);assert.ok(D.searchMatch(s,m,' '));
});
test('two isolated panels persist through migration and accept cycle output; unsafe sources and invalid dimensions are normalized',()=>{
 const s=S.createDefaultState();s.customPanels.custom1.elements.push(P.element({id:'text',text:'欢迎',width:-50,opacity:0}));s.customPanels.custom2.elements.push(P.element({id:'video',type:'video',src:'/media/test.mp4',loop:false,muted:false}));s.outputCycle.nodes[0].scene='custom2';
 const restored=S.migrateState(JSON.parse(JSON.stringify(s)));assert.equal(restored.customPanels.custom1.elements[0].text,'欢迎');assert.equal(restored.customPanels.custom1.elements[0].width,20);assert.equal(restored.customPanels.custom1.elements[0].opacity,0);assert.equal(restored.customPanels.custom2.elements[0].muted,false);assert.equal(restored.outputCycle.nodes[0].scene,'custom2');assert.equal(P.element({src:'javascript:alert(1)'}).src,'');assert.equal(P.element({src:'file:///C:/test.png'}).src,'');assert.equal(P.element({src:'https://example.com/a.png'}).src,'https://example.com/a.png');
});
test('custom media panels can go live in draft while tournament output remains protected',()=>{
 const previous=S.createDefaultState(),next=structuredClone(previous);next.liveScene='custom1';assert.doesNotThrow(()=>F.enforceSave(previous,next));next.liveScene='bracket';assert.throws(()=>F.enforceSave(previous,next),/草稿/);
});
