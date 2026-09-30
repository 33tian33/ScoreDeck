const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const backend = fs.readFileSync(path.join(root, 'backend.cjs'), 'utf8').split('// installer/sea-entry.cjs')[0];
process.env.RADAR_HUD_PUBLIC_DIR = path.join(root, "public");
const ctx = vm.createContext({require:require('node:module').createRequire(path.join(root,'backend.cjs')), process, console, URL, Buffer, setTimeout, clearTimeout, setInterval, clearInterval});
vm.runInContext(backend + '\ninit_hud_server();', ctx);
test('Nuke / Vertigo height boundaries and player layer metadata', () => {
  for (const [name, boundary] of [['de_nuke', -495], ['de_vertigo', 11700]]) {
    assert.equal(ctx.radarPosition(name, [0,0,boundary - 1]).layer, 'low');
    assert.equal(ctx.radarPosition(name, [0,0,boundary]).layer, 'high');
    const result = ctx.hudStateFromFrame({state:{map:{name, round:0}, players:[
      {entity_id:'1', side:'CT', state:{health:100}, position:[0,0,boundary-1]},
      {entity_id:'2', side:'T', state:{health:100}, position:[0,0,boundary+1]}
    ]}}, null);
    assert.equal(result.players[0].layer, 'low');
    assert.equal(result.players[1].layer, 'high');
  }
});
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const helpers = app.slice(app.indexOf('function layerVisible'), app.indexOf('function renderFloorMap'));
const ui = vm.createContext({latestState:{map:{layers:[{id:'low'},{id:'high'}]}}, selectedLayer:'all'});
vm.runInContext(helpers,ui);
const points = ['low','low','high','high','low','low'].map((layer,i) => ({layer,position:[i,i]}));
test('all floors split cross-floor paths; hidden intervals never bridge', () => {
  assert.equal(ui.floorSegments(points).length, 3);
  ui.selectedLayer='low';
  const seg = ui.floorSegments(points);
  assert.equal(seg.length,2);
  assert.equal(JSON.stringify(seg.flat().map(p=>p.position[0])),"[0,1,4,5]");
  ui.selectedLayer='high';
  assert.equal(ui.floorSegments(points).length,1);
  assert.equal(ui.layerVisible('low'),false);
});
test('single-floor maps remain visible with a retained dual-floor preference', () => {
  ui.latestState={map:{layers:[{id:'single'}]}};
  assert.equal(ui.layerVisible('single'),true);
});
function fakeNode() {
  return {children:[], attrs:{}, style:{},dataset:{},checked:true,
    classList:{toggle(){},add(){},contains(){return false}},
    addEventListener(){},setAttribute(k,v){this.attrs[k]=v},
    append(...v){this.children.push(...v)},replaceChildren(...v){this.children=v}};
}
const nodes=new Map();
const document={body:fakeNode(),querySelector(s){if(!nodes.has(s))nodes.set(s,fakeNode());return nodes.get(s)},querySelectorAll(){return []},createElement:fakeNode,createElementNS:fakeNode};
const renderCtx=vm.createContext({URLSearchParams,location:{search:''},document,localStorage:{getItem(){return null}},performance:{now(){return 0}},console});
vm.runInContext(app.slice(0,app.indexOf('replayToggle.addEventListener')) + '\nfunction showTrajectory(){return true}', renderCtx);
const fixture={connected:true,sourceAgeMs:0,roundNumber:0,timeMs:500, map:{name:'de_nuke',layers:[{id:'low'},{id:'high'}]},players:[],props:[],trajectories:[]};
for(const [i,layer] of ['low','high'].entries()) {
 fixture.players.push({layer,side:'CT',position:[200+i*400,300],visible:false});
 fixture.props.push({id:String(i),layer,side:'T',type:'frag',position:[200+i*400,310],visible:false});
 fixture.trajectories.push({side:'CT',type:'smoke',round_number:0,round_started_time_ms:0,detonation_time_ms:100,detonation_position:[200+i*400,350],range_scale:{x:.2,y:.2,layer},points:[{layer,position:[200+i*400,330],time_ms:0},{layer,position:[200+i*400,350],time_ms:100}]});
}
renderCtx.fixture=fixture;
test('live and replay rendering filter players, props, smoke, paths and base map',()=>{
 for(const [mode,count] of [['all',2],['low',1],['high',1]]) {
  vm.runInContext(`selectedLayer='${mode}';latestState=fixture;renderLive(fixture);`,renderCtx);
  assert.equal(nodes.get('#radar-objects').children.length,count*2);
  assert.equal(nodes.get('#trajectory-paths').children.filter(n=>n.attrs.class?.startsWith('utility-range smoke')).length,count);
  assert.equal(nodes.get('#radar-image').style.clipPath==='none',mode==='all');
  vm.runInContext('renderReplayObjects(fixture.trajectories,500,new Map([[0,0]]));',renderCtx);
  assert.equal(nodes.get('#radar-objects').children.length,count);
 }
});
test('measured flame cells and estimated fire obey manual floor choice',()=>{
 for(const mode of ['low','high']) {
  renderCtx.fire={...fixture.trajectories[0],type:'inferno',flame_frames:[{time_ms:100,points:fixture.trajectories.map(t=>({position:t.detonation_position,layer:t.range_scale.layer,scale:t.range_scale}))}]};
  vm.runInContext(`selectedLayer='${mode}';renderTrajectories([fire],500,{});`,renderCtx);
  const layer=nodes.get('#trajectory-paths').children.at(-1);
  assert.equal(layer.children[0].children.length,1);
  renderCtx.fire.flame_frames=[];
  vm.runInContext('renderTrajectories([fire],500,{});',renderCtx);
  const areas=nodes.get('#trajectory-paths').children.filter(n=>n.attrs.class?.startsWith('utility-range fire'));
  assert.equal(areas.length,mode==='low'?1:0);
 }
});
