export function validateScoreDeckTeams(value){
 if(typeof value?.managed!=='boolean')throw Error('无效主赛跟随设置');
 if(!value.managed)return {managed:false};
 if(!Array.isArray(value.teams)||value.teams.length!==2)throw Error('主赛必须提供两队');
 const teams=value.teams.map(t=>{
  if(typeof t.name!=='string'||!t.name.trim()||t.name.length>200||/[\x00-\x1f]/.test(t.name))throw Error('队名无效');
  if(typeof t.logo!=='string'||t.logo.length>1400000||t.logo&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(t.logo))throw Error('队标无效');
  return {id:String(t.id||''),name:t.name,shortName:String(t.shortName||t.name).slice(0,24),color:/^#[a-f0-9]{6}$/i.test(t.color)?t.color:'#888888',logo:t.logo};
 });
 return {managed:true,matchId:String(value.matchId||''),teams};
}
export function applyScoreDeckTeams(channels,identity){if(!identity?.managed)return;channels.forEach((c,i)=>{const t=identity.teams[c.id==='channel-alpha'?0:1];Object.assign(c,{name:t.name,shortName:t.shortName,color:t.color,logo:t.logo,teamId:t.id});});}
