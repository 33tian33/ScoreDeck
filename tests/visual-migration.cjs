const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDefaultState,migrateState}=require('../server/default-state.cjs');
const half=require('../server/halftime.cjs');
test('visual upgrade preserves custom styles, assets and transparency',()=>{
 const input=createDefaultState();input.theme={...input.theme,visualRevision:undefined,accent:'#ab1234',backgroundTransparent:true};input.theme.elements.panel={fill:'#456789',border:'#aabbcc',opacity:.35,transparent:true};input.backgroundVideo.source='/media/custom.webm';
 const out=migrateState(input);assert.equal(out.theme.accent,'#ab1234');assert.equal(out.theme.backgroundTransparent,true);assert.deepEqual(out.theme.elements.panel,input.theme.elements.panel);assert.equal(out.backgroundVideo.source,'/media/custom.webm');
});
test('legacy shipped colors migrate once and remain editable afterward',()=>{
 const input=createDefaultState();input.theme={...input.theme,visualRevision:undefined,accent:'#c8aa67',background:'#080706'};const out=migrateState(input);assert.equal(out.theme.accent,'#ececec');assert.equal(out.theme.background,'#181818');out.theme.accent='#c8aa67';assert.equal(migrateState(out).theme.accent,'#c8aa67');
});
test('halftime theme migration preserves program, timer and transparent media slots',()=>{
 const before=half.action(half.normalize({background:'#030b29',accent:'#f5ff00',transparent:true,left:{type:'image',source:'/media/a.png'}}),'start',1000);assert.equal(before.background,'#181818');assert.equal(before.accent,'#ececec');const after=half.normalize(before);assert.equal(after.clock.endAt,before.clock.endAt);assert.equal(after.transparent,true);assert.equal(after.left.source,'/media/a.png');after.accent='#f5ff00';assert.equal(half.normalize(after).accent,'#f5ff00');
});
