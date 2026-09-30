// Compact projection: the native bar never needs full transcripts or credentials.
export function barState(s,netcon,wallOrigin){
 return {version:s.version,sessionId:s.sessionId,mode:s.mode,serverNow:Date.now(),netcon,
  delay:s.config.directorDelaySeconds,obs:s.obs,playback:s.playback,lastPlayback:s.lastPlayback,
  channels:s.channels.map(c=>({id:c.id,name:c.name,logo:c.logo||'',color:c.color,connectionStatus:c.connectionStatus,
   segments:c.segments.filter(x=>x.eligible&&x.status==='committed'&&x.audioReady&&!x.playedAt&&!['ignored','played'].includes(x.reviewState))
    .sort((a,b)=>b.startMs-a.startMs||b.endMs-a.endMs||a.id.localeCompare(b.id)).slice(0,200)
    .map(x=>({id:x.id,channelId:c.id,title:x.title,summary:x.summary,startMs:x.startMs,endMs:x.endMs,wallStart:wallOrigin+x.startMs,
      audioDurationMs:x.audioDurationMs,audioUrl:x.audioUrl,category:x.category,reviewRequired:x.reviewRequired,speakers:x.speakerNames}))}))};
}
