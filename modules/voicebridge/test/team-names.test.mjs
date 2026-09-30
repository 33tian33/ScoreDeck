import test from 'node:test';import assert from 'node:assert/strict';
import {validateTeamNames,applyTeamNames} from '../lib/team-names.mjs';
test('team names accept Chinese and reject blank/control/overlong input',()=>{
 assert.equal(validateTeamNames({'channel-alpha':' 以卵击石 ','channel-bravo':'FUNTRUE'})['channel-alpha'],'以卵击石');
 for(const value of ['', 'a\nb','x'.repeat(25)])assert.throws(()=>validateTeamNames({'channel-alpha':value,'channel-bravo':'B'}));
});
test('names update channel tabs and existing segments without altering IDs',()=>{
 const channels=[{id:'channel-alpha',name:'old',segments:[{id:'s',channelName:'old'}]}];applyTeamNames(channels,{'channel-alpha':'Funtrue'});assert.equal(channels[0].name,'Funtrue');assert.equal(channels[0].segments[0].channelName,'Funtrue');assert.equal(channels[0].segments[0].id,'s');
});
