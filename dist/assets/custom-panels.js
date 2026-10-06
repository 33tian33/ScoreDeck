(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.ScoreDeckPanels=api;})(globalThis,function(){
'use strict';
const ids=['custom1','custom2'];
const number=(v,f,min,max)=>Number.isFinite(Number(v))?Math.min(max,Math.max(min,Number(v))):f;
const color=(v,f)=>/^#[0-9a-f]{6}$/i.test(v||'')?v:f;
function source(v){return typeof v==='string'&&(/^(https?:\/\/)/i.test(v)||/^\/media\/[a-zA-Z0-9_.-]+$/.test(v))?v:'';}
function element(raw={},index=0){raw=raw&&typeof raw==='object'?raw:{};return {
 id:String(raw.id||`element-${index}`),type:['text','image','video','shape'].includes(raw.type)?raw.type:'text',
 name:String(raw.name||'元素').slice(0,100),text:String(raw.text??'新增文字').slice(0,10000),src:source(raw.src),
 x:number(raw.x,160,-1920,3840),y:number(raw.y,160,-1080,2160),width:number(raw.width,640,20,3840),height:number(raw.height,180,20,2160),
 rotation:number(raw.rotation,0,-360,360),opacity:number(raw.opacity,1,0,1),fontSize:number(raw.fontSize,64,8,500),
 fontFamily:String(raw.fontFamily||'Microsoft YaHei').slice(0,100),color:color(raw.color,'#ffffff'),background:color(raw.background,'#252b34'),
 transparent:raw.transparent!==false,bold:raw.bold!==false,align:['left','center','right'].includes(raw.align)?raw.align:'center',
 radius:number(raw.radius,0,0,500),fit:['contain','cover','fill'].includes(raw.fit)?raw.fit:'contain',
 hidden:raw.hidden===true,loop:raw.loop!==false,muted:raw.muted!==false
};}
function normalize(value){return Object.fromEntries(ids.map((id,i)=>{const raw=value?.[id]||{};return [id,{name:String(raw.name||`自定义推送 ${i+1}`).slice(0,100),background:color(raw.background,'#181818'),transparent:raw.transparent===true,elements:(Array.isArray(raw.elements)?raw.elements:[]).slice(0,100).map(element)}];}));}
return {ids,normalize,element,source};
});
