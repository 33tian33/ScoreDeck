(function(root,factory){const rules=factory();if(typeof module==='object')module.exports=rules;else root.ScoreDeckRules=rules;})(globalThis,function(){
  const validScore=v=>v!==null && v!==undefined && v!=='' && Number.isInteger(Number(v)) && Number(v)>=0;
  const validMap=m=>{
    if(!m || !validScore(m.a) || !validScore(m.b))return false;
    const w=Math.max(Number(m.a),Number(m.b)),l=Math.min(Number(m.a),Number(m.b));
    return (w===13 && l<=11) || (w>=16 && (w-16)%3===0 && l>=w-4 && l<=w-2);
  };
  const activeMaps=m=>(m.mapScores || []).slice(0,Number(m.bestOf)||3);
  function normalizeMatch(m,options={}) {
    m.bestOf=[1,2,3,5].includes(Number(m.bestOf))?Number(m.bestOf):3;
    const codes=[String(m.scoreA).toUpperCase(),String(m.scoreB).toUpperCase()];
    const walkover=(['W','WW'].includes(codes[0])&&['F','FF'].includes(codes[1]))||(['F','FF'].includes(codes[0])&&['W','WW'].includes(codes[1]));
    if(walkover&&!options.forceMaps)return m;
    const maps=activeMaps(m), played=maps.filter(validMap);
    if(options.forceMaps || played.length) {
      m.scoreA=played.filter(x=>Number(x.a)>Number(x.b)).length;
      m.scoreB=played.length-m.scoreA;
      (m.mapDetails || []).forEach((d,i)=>{const score=m.mapScores?.[i];if(score){d.map=score.map;d.a=score.a;d.b=score.b;}});
    }
    const winsNeeded=Math.floor(m.bestOf/2)+1;
    const hasScores=maps.some(x=>x&&(validScore(x.a)||validScore(x.b)));
    const validNumbers=validScore(m.scoreA)&&validScore(m.scoreB);
    const a=Number(m.scoreA),b=Number(m.scoreB);
    const validSeries=validNumbers && (m.bestOf===2 ? a+b===2 : Math.max(a,b)===winsNeeded && Math.min(a,b)<winsNeeded);
    const entered=maps.filter(x=>x&&(validScore(x.a)||validScore(x.b)));
    let complete=validSeries && (!hasScores || entered.every(validMap));
    if(hasScores && m.bestOf!==2){
      let wa=0,wb=0,closed=false;
      for(const map of maps){if(!validMap(map))continue;if(closed)complete=false;Number(map.a)>Number(map.b)?wa++:wb++;closed=wa===winsNeeded||wb===winsNeeded;}
    }
    if(m.status==='completed'&&!complete){m.status=m.teamAId&&m.teamBId?'live':'tbd';m.resultWarning='比分未满足完赛条件，暂不计入排名';} else if(complete){delete m.resultWarning;if(m.status==='completed')delete m.resultInvalidated;}
    if(m.bestOf===2 && options.finishBo2 && complete && played.length===2 && m.teamAId&&m.teamBId)m.status='completed';
    return m;
  }
  function standings(state,group){
    const rows = state.teams.filter(t=>t.group===group).map(team=>{
      const row={team,group,played:0,won:0,drawn:0,lost:0,mapsWon:0,mapsLost:0,mapDiff:0,roundDiff:0,points:0};
      for(const source of state.matches){
        if(source.group!==group||source.bracketRound||source.status!=='completed'||!(source.teamAId===team.id||source.teamBId===team.id))continue;
        const m=normalizeMatch(structuredClone(source));
        if(m.status!=='completed')continue;
        const a=m.teamAId===team.id, own=a?m.scoreA:m.scoreB, other=a?m.scoreB:m.scoreA;
        const forfeit=['F','FF'].includes(String(own).toUpperCase())||['F','FF'].includes(String(other).toUpperCase());
        let outcome=['F','FF'].includes(String(own).toUpperCase())?-1:['F','FF'].includes(String(other).toUpperCase())?1:Math.sign(Number(own)-Number(other));
        if(!forfeit && (!validScore(own)||!validScore(other)||(Number(own)+Number(other)===0)))continue;
        row.played++;row.won+=+(outcome>0);row.lost+=+(outcome<0);row.drawn+=+(outcome===0);
        if(!forfeit){row.mapsWon+=Number(own);row.mapsLost+=Number(other);}
        for(const map of activeMaps(m))if(validMap(map))row.roundDiff+=(Number(map.a)-Number(map.b))*(a?1:-1);
      }
      row.mapDiff+=row.mapsWon-row.mapsLost;row.points=row.won*3+row.drawn;
      return row;
    });
    return rankGroup(state,group,rows);
  }
  const groupRule=state=>state.tournament?.groupTieBreak==='head-to-head'?'head-to-head':'round-diff';
  const compareCrossGroup=(a,b)=>b.points-a.points||b.roundDiff-a.roundDiff||b.mapDiff-a.mapDiff||a.team.name.localeCompare(b.team.name)||String(a.team.id).localeCompare(String(b.team.id));
  function partition(rows,key){
    const buckets=new Map();for(const r of rows){const v=key(r);if(!buckets.has(v))buckets.set(v,[]);buckets.get(v).push(r);}
    return [...buckets].sort((a,b)=>b[0]-a[0]).map(x=>x[1]);
  }
  function rankGroup(state,group,rows){
    const matches=state.matches.filter(m=>m.group===group&&!m.bracketRound&&m.status==='completed').map(m=>normalizeMatch(structuredClone(m))).filter(m=>m.status==='completed');
    const fallback=rs=>rs.slice().sort(compareCrossGroup);
    function headToHead(rs){
      if(rs.length<2)return rs;
      const totals=new Map(rs.map(r=>[r.team.id,0])),seen=new Set();
      for(const m of matches){
        if(!totals.has(m.teamAId)||!totals.has(m.teamBId))continue;
        const a=String(m.scoreA).toUpperCase(),b=String(m.scoreB).toUpperCase();
        const result=['F','FF'].includes(a)?-1:['F','FF'].includes(b)?1:Math.sign(Number(a)-Number(b));
        if(!Number.isFinite(result))continue;
        seen.add([m.teamAId,m.teamBId].sort().join('/'));
        totals.set(m.teamAId,totals.get(m.teamAId)+(result>0?3:result===0?1:0));
        totals.set(m.teamBId,totals.get(m.teamBId)+(result<0?3:result===0?1:0));
      }
      // Incomplete mini leagues use overall figures until all tied teams have met.
      if(seen.size<rs.length*(rs.length-1)/2)return fallback(rs);
      const parts=partition(rs,r=>totals.get(r.team.id));
      return parts.length===1?fallback(rs):parts.flatMap(headToHead);
    }
    return partition(rows,r=>r.points).flatMap(tied=>groupRule(state)==='head-to-head'?headToHead(tied):partition(tied,r=>r.roundDiff).flatMap(headToHead));
  }
  function normalizeSteamId(value){
    if(value==null||value==='')return '';
    if(typeof value!=='string')throw Error('Steam64 ID 必须以文本保存；Excel 中请先将单元格设为文本，再重新输入完整 ID');
    const id=value.normalize('NFKC').trim();
    if(id&&!/^[1-9]\d{16}$/.test(id))throw Error('Steam64 ID 须为 17 位数字，或留空');
    return id;
  }
  function checkPlayerSteamId(state,teamId,index,value){
    const id=normalizeSteamId(value);
    if(id)for(const team of state.teams||[])for(const [i,p]of (team.players||[]).entries()){
      if(team.id===teamId&&i===index)continue;
      if(p.steamId&&normalizeSteamId(p.steamId)===id)throw Error(`Steam64 ID 已由 ${team.name} / ${p.id} 使用`);
    }
    return id;
  }
  function validateSteamIds(state){
    const seen=new Set();
    for(const team of state.teams||[])for(const p of team.players||[]){
      const id=normalizeSteamId(p.steamId);
      if(id&&seen.has(id))throw Error(`Steam64 ID 重复：${team.name} / ${p.id}`);
      if(id)seen.add(id);p.steamId=id;
    }
    return state;
  }
  function setPlayerSteamId(state,teamId,index,value){
    const id=checkPlayerSteamId(state,teamId,index,value),team=state.teams.find(t=>t.id===teamId),p=team?.players[index];
    if(!p)throw Error('队员不存在');
    const old=p.steamId||'';if(old===id)return state;p.steamId=id;
    for(const m of state.matches||[]){
      const side=m.teamAId===teamId?'A':m.teamBId===teamId?'B':null;if(!side)continue;
      for(const [key,b]of Object.entries(m.gsiBindings||{}))if(key===old||key===id||(b.side===side&&b.playerId===p.id))delete m.gsiBindings[key];
      delete m.gsiFingerprint;
    }
    return state;
  }
  function renamePlayer(state,teamId,index,newId){
    const team=state.teams.find(t=>t.id===teamId),oldId=team.players[index].id;
    if(team.players.some((p,i)=>i!==index&&p.id===newId))return state;
    team.players[index].id=newId;
    for(const match of state.matches){
      const side=match.teamAId===teamId?'teamA':match.teamBId===teamId?'teamB':null;
      if(side)for(const map of match.mapDetails||[])for(const stat of map[side]||[])if(stat.playerId===oldId)stat.playerId=newId;
      if(side){for(const b of Object.values(match.gsiBindings||{}))if(b.side===(side==='teamA'?'A':'B')&&b.playerId===oldId)b.playerId=newId;delete match.gsiFingerprint;}
      if(match.mvp?.teamId===teamId&&match.mvp.playerId===oldId)match.mvp.playerId=newId;
    }
    if(state.mvp?.teamId===teamId&&state.mvp.playerId===oldId)state.mvp.playerId=newId;
    const over=state.entrance?.overrides?.[teamId];if(over?.players?.[index])delete over.players[index].id;
    return state;
  }
  function migrateTeamProfiles(state){
    if(state.teamManagementVersion===1)return state;
    for(const team of state.teams || []){
      const over=state.entrance?.overrides?.[team.id];if(!over)continue;
      for(const key of ['name','shortName']){if(over[key])team[key]=over[key];delete over[key];}
      for(let i=0;i<(team.players||[]).length;i++){
        const p=over.players?.[i];if(!p)continue;
        if(p.id)renamePlayer(state,team.id,i,p.id);
        for(const key of ['role','avatar'])if(p[key])team.players[i][key]=p[key];
      }
      delete over.players;
    }
    state.teamManagementVersion=1;return state;
  }
  function reconcileBracket(state){
    if(state.tournament?.formatId==='flow')return state;
    const result=(m,kind)=>{
      if(!m || m.status!=='completed' || !m.teamAId || !m.teamBId)return '';
      const a=String(m.scoreA).toUpperCase(),b=String(m.scoreB).toUpperCase();
      let winner=['W','WW'].includes(a)&&['F','FF'].includes(b)?m.teamAId:['F','FF'].includes(a)&&['W','WW'].includes(b)?m.teamBId:Number(a)>Number(b)?m.teamAId:Number(b)>Number(a)?m.teamBId:'';
      return !winner?'':kind==='winner'?winner:winner===m.teamAId?m.teamBId:m.teamAId;
    };
    for(let pass=0;pass<state.matches.length;pass++){
      let changed=false;
      for(const match of state.matches){
        if(!match.sourceA&&!match.sourceB)continue;
        const a=match.sourceA?result(state.matches.find(m=>m.id===match.sourceA.matchId),match.sourceA.result):match.teamAId;
        const b=match.sourceB?result(state.matches.find(m=>m.id===match.sourceB.matchId),match.sourceB.result):match.teamBId;
        if(a!==match.teamAId||b!==match.teamBId){
          match.teamAId=a;match.teamBId=b;match.scoreA=0;match.scoreB=0;
          match.mapScores=Array.from({length:5},(_,i)=>({map:match.mapScores?.[i]?.map||`MAP ${i+1}`,a:null,b:null}));
          match.mapDetails=match.mapScores.map(m=>({...m,teamA:[],teamB:[]}));delete match.mvp;
          if(state.selectedMatchId===match.id&&state.mvp)state.mvp={...state.mvp,teamId:'',playerId:'',rating:'',we:'',statline:'',note:''};
          match.resultInvalidated=true;match.status=a&&b?'upcoming':'tbd';changed=true;
        }else if(!a||!b)match.status='tbd';
      }
      if(!changed)break;
    }
    return state;
  }
  function cyclePoint(config,now){
    const nodes=(config?.nodes||[]).filter(n=>n.enabled!==false);
    if(!config?.enabled||!nodes.length)return null;
    const durations=nodes.map(n=>Math.max(1,Number(n.durationSeconds)||1)*1000),total=durations.reduce((a,b)=>a+b,0);
    const start=Date.parse(config.startAt);if(!Number.isFinite(start))return {node:nodes[0],index:0,offset:0,serial:0,previous:null,seconds:0};
    const elapsed=Math.max(0,now-start);let offset=elapsed%total,index=0;
    while(index<nodes.length-1&&offset>=durations[index])offset-=durations[index++];
    const seconds=Math.min(durations[index]/1000,Math.max(0,Number(nodes[index].transitionSeconds)||0));
    return {node:nodes[index],index,offset,serial:nodes.length===1?0:Math.floor(elapsed/total)*nodes.length+index,previous:nodes.length>1&&elapsed>=durations[0]&&offset<seconds*1000?nodes[(index+nodes.length-1)%nodes.length]:null,seconds};
  }
  function reconcileSwiss(state,previous){
    if(state.tournament?.formatId!=='swiss-16')return state;
    const teams=state.teams.slice(0,16),ids=teams.map(t=>t.id);
    const roundOf=m=>Number(/^SWISS([1-5])$/.exec(m.bracketRound||'')?.[1]||0);
    const outcome=m=>{const a=String(m.scoreA).toUpperCase(),b=String(m.scoreB).toUpperCase();return ['W','WW'].includes(a)&&['F','FF'].includes(b)?1:['F','FF'].includes(a)&&['W','WW'].includes(b)?-1:Math.sign(Number(a)-Number(b));};
    const basis=(s,n)=>JSON.stringify([s.teams.slice(0,16).map(t=>t.id),s.matches.filter(m=>roundOf(m)>0&&roundOf(m)<n).map(m=>[m.id,m.teamAId,m.teamBId,m.status,m.scoreA,m.scoreB]).sort((a,b)=>a[0].localeCompare(b[0]))]);
    for(let round=2;round<=5;round++){
      const slots=state.matches.filter(m=>roundOf(m)===round).sort((a,b)=>(a.bracketIndex||0)-(b.bracketIndex||0));if(!slots.length)break;
      const key=basis(state,round),oldKey=slots.find(m=>m.pairingBasis)?.pairingBasis??(previous&&previous.tournament?.formatId==='swiss-16'?basis(previous,round):key);
      const changed=oldKey!==key,assigned=slots.some(m=>m.teamAId||m.teamBId);
      if(assigned&&!changed){slots.forEach(m=>m.pairingBasis=key);continue;}
      if(changed)for(const m of slots){
        if(m.teamAId||m.teamBId){if(m.status==='live'||m.status==='completed')m.invalidatedResult={teamAId:m.teamAId,teamBId:m.teamBId,scoreA:m.scoreA,scoreB:m.scoreB,mapDetails:structuredClone(m.mapDetails||[]),mapScores:structuredClone(m.mapScores||[]),mvp:m.mvp};m.resultInvalidated=true;}
        m.teamAId='';m.teamBId='';m.scoreA=0;m.scoreB=0;m.status='tbd';m.mapScores=Array.from({length:5},(_,i)=>({map:m.mapScores?.[i]?.map||`MAP ${i+1}`,a:null,b:null}));m.mapDetails=m.mapScores.map(x=>({...x,teamA:[],teamB:[]}));delete m.mvp;
      }
      slots.forEach(m=>m.pairingBasis=key);
      const last=state.matches.filter(m=>roundOf(m)===round-1&&(m.teamAId||m.teamBId));
      if(!last.length||!last.every(m=>m.teamAId&&m.teamBId&&m.status==='completed'&&outcome(m)))continue;
      const stats=new Map(ids.map(id=>[id,{id,w:0,l:0,opp:[]}])) ;
      for(const m of state.matches.filter(m=>roundOf(m)>0&&roundOf(m)<round&&m.status==='completed')){const a=stats.get(m.teamAId),b=stats.get(m.teamBId),o=outcome(m);if(!a||!b||!o)continue;a.opp.push(b.id);b.opp.push(a.id);if(o>0){a.w++;b.l++;}else{b.w++;a.l++;}}
      const live=[...stats.values()].filter(x=>x.w<3&&x.l<3).sort((a,b)=>b.w-a.w||a.l-b.l||b.opp.reduce((s,id)=>s+stats.get(id).w,0)-a.opp.reduce((s,id)=>s+stats.get(id).w,0)||ids.indexOf(a.id)-ids.indexOf(b.id));
      const pair=list=>{if(!list.length)return [];if(list.length%2)return null;const [a,...rest]=list;for(const b of [...rest].sort((x,y)=>Math.abs(x.w-a.w)-Math.abs(y.w-a.w))){if(a.opp.includes(b.id))continue;const tail=pair(rest.filter(x=>x!==b));if(tail)return [[a.id,b.id],...tail];}return null;};
      const pairs=pair(live);if(!pairs){slots.forEach(m=>m.resultWarning='瑞士轮无法生成无重复对阵，请人工确认');continue;}
      slots.forEach((m,i)=>{[m.teamAId,m.teamBId]=pairs[i]||['',''];m.status=m.teamAId&&m.teamBId?'upcoming':'tbd';});
    }
    return state;
  }
  return {normalizeSteamId,checkPlayerSteamId,validateSteamIds,setPlayerSteamId,groupRule,compareCrossGroup,rankGroup,cyclePoint,reconcileSwiss,reconcileBracket,validMap,normalizeMatch,standings,renamePlayer,migrateTeamProfiles};
});
