import assert from 'node:assert/strict';
import {propertyBotStatus,propertyNextMove,mostPromisingProperty} from '../lib/workspace-guidance.ts';
import {makeWorkspaceFixture} from './fixtures/workspace-volume.mjs';
const active={manual:false,paused:false,available:true,stale:false,attention:false,practice:false};
assert.equal(propertyBotStatus(active).label,'AI on');
for(const hold of [{manual:true},{paused:true},{attention:true},{practice:true},{stage:'closed'},{stage:'canceled'}])assert.notEqual(propertyBotStatus({...active,...hold}).tone,'green');
for(const transport of [{stale:true},{available:false},{stale:true,available:false}])assert.deepEqual(propertyBotStatus({...active,...transport}),propertyBotStatus(active),'Technical availability does not replace the saved automatic mode');
assert.equal(propertyBotStatus({...active,stale:true,paused:true}).label,'AI paused','A saved Pause remains visible during a failed refresh');
assert.equal(propertyBotStatus({...active,stale:true,manual:true}).label,'You’re in control','A saved takeover remains visible during a failed refresh');
assert.equal(propertyBotStatus({...active,paused:true,attention:true}).label,'Needs you');
const work=makeWorkspaceFixture(),best=mostPromisingProperty(work.properties,work);assert(work.properties.some(p=>p.id===best&&p.result.financialCheck.status==='eligible'));
assert.equal(mostPromisingProperty([],work),null);
assert.match(propertyNextMove({...work.properties[0],result:{...work.properties[0].result,financialCheck:{status:'review'}}},{...work,deals:[],callbacks:[],handoffs:[],textAttention:[],signing:[],callRequests:[],propertyAttentionIds:[]}),/Review the property numbers/);
console.log('Property guidance: stable automatic mode, saved Pause/takeover and saved-evidence priorities passed.');

assert.equal(mostPromisingProperty(work.properties.map(p=>({...p,engagement:{responded:false,interested:false,optedOut:false}})),work),null,'Unanswered attempts are never promoted as promising');
assert.equal(mostPromisingProperty(work.properties.map(p=>({...p,engagement:{responded:true,interested:false,optedOut:true}})),work),null,'Opt-outs are never promoted as promising');
