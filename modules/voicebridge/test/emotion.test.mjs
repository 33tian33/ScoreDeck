import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyLocal,normalizeModelOutput,segmentConversation} from '../lib/segmenter.mjs';
const items=(texts)=>texts.map((text,i)=>({id:`u${i}`,speakerId:`p${i}`,speakerName:`P${i}`,startMs:i*200,endMs:i*200+600,text}));
for(const [category,text] of Object.entries({encouragement:'没关系，打得好',morale:'加油，我们能赢',opponent_taunt:'对面太菜了',conflict:'你到底会不会玩'}))test(category,()=>assert.equal(classifyLocal(items([text])).category,category));
test('tactical and ambiguous speech excluded',async()=>{for(const text of ['去B点，等闪','太菜了','我真菜','别说对面太菜了']){const r=await segmentConversation(items([text]),{final:true});assert.ok(r.segments.every(s=>!s.eligible));}});
test('semantic model keeps all five speakers and evidence',()=>{const u=items(['去B','打得好','谢谢','没事下一把','加油']);const r=normalizeModelOutput({segments:[{start_utterance_id:'u0',end_utterance_id:'u4',category:'encouragement',confidence:.93,evidence_ids:['u1','u3'],reason:'队友赞扬并安慰失误',title:'互相鼓励'}]},u,{final:true});assert.equal(r[0].eligible,true);assert.equal(r[0].speakerNames.length,5);assert.equal(r[0].utteranceIds.length,5);assert.equal(r[0].mixMode,'all-channel-tracks');});
test('model rejects fabricated evidence',()=>assert.throws(()=>normalizeModelOutput({segments:[{start_utterance_id:'u0',end_utterance_id:'u0',category:'conflict',confidence:.9,evidence_ids:['fake'],reason:'x'}]},items(['闭嘴']))));
test('none model decisions stay excluded',()=>assert.equal(normalizeModelOutput({segments:[{start_utterance_id:'u0',end_utterance_id:'u0',category:'none',confidence:.9,evidence_ids:[],reason:'战术'}]},items(['去B']))[0].eligible,false));
test('API failure explicitly becomes review-only rule screening',async()=>{const r=await segmentConversation(items(['加油']),{final:true,apiKey:'test',fetchImpl:async()=>{throw new Error('offline')}});assert.equal(r.segments[0].reviewRequired,true);assert.match(r.warning,/降级/);});

import {CaptureStore} from '../lib/capture-store.mjs';
test('all five simultaneous tracks are summed; other channel excluded',async()=>{
 const store=new CaptureStore('/unused');
 store.tracks=new Map(Array.from({length:6},(_,i)=>[String(i),{id:String(i),channelId:i<5?'alpha':'bravo'}]));
 const seen=[];store.readTrack=async id=>{seen.push(id);const b=Buffer.alloc(960*2);for(let i=0;i<960;i++)b.writeInt16LE((Number(id)+1)*100,i*2);return b;};
 const result=await store.mix('alpha',0,20);
 assert.deepEqual(seen,['0','1','2','3','4']);
 for(let i=44;i<result.length;i+=2)assert.equal(result.readInt16LE(i),1500);
});

test('pressure on teammates enters conflict while enemy-target speech does not',()=>{assert.equal(classifyLocal(items(['你又在送，你会不会玩'])).category,'conflict');assert.notEqual(classifyLocal(items(['给对面压力，去B点'])).category,'conflict');});
