const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('all imported sponsors rotate through the four broadcast positions without truncation',()=>{
 function element(){return {children:[],style:{},append(x){this.children.push(x)},replaceChildren(){this.children=[]},setAttribute(){},get firstElementChild(){return this.children[0]},getAttribute(k){return this[k]}};}
 const body=element();body.classList={toggle(){}};let receive,tick,now=0;
 vm.runInNewContext(fs.readFileSync(require.resolve('../dist/assets/sponsors.js'),'utf8'),{document:{body,createElement:element},location:{pathname:'/output/prematch',search:''},URLSearchParams,SDClient:{now:()=>now,subscribe(fn){receive=fn;}},setInterval(fn){tick=fn;return 1},clearInterval(){},addEventListener(){}});
 const entries=Array.from({length:9},(_,i)=>({name:'S'+i,logoImage:'/media/'+i+'.png'}));receive({sponsors:{slots:entries}});
 const cells=body.children[0].children;assert.equal(cells[0].firstElementChild.src,'/media/0.png');
 now=8000;tick();assert.equal(cells[0].firstElementChild.src,'/media/4.png');assert.equal(cells[3].firstElementChild.src,'/media/7.png');
 now=16000;tick();assert.equal(cells[0].firstElementChild.alt,'S8');assert.equal(cells[1].children.length,0);
 now=24000;tick();assert.equal(cells[0].firstElementChild.src,'/media/0.png');assert.equal(entries.length,9);
});
