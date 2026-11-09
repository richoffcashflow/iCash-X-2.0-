import assert from 'node:assert/strict';
import {buyerContactObservations,emailVerificationStatuses} from '../lib/buyer-contact-quality.ts';
import {discoverBuyerPage} from '../lib/buyer-discovery.ts';
const phone={number:'2145550100',do_not_call:false,type:'wireless'},email={address:'fixture@example.invalid'};
for(const value of [0,0.001,75.019,99.6,100]){
 const result=buyerContactObservations([{...phone,match_confidence:value}],[{...email,match_confidence:value}]);
 assert.equal(result.phones[0].matchConfidence,value);assert.equal(result.emailObservations[0].matchConfidence,value);
}
for(const value of [undefined,null,'99.6',true,-1,101,NaN,Infinity,{},[]]){
 const result=buyerContactObservations([{...phone,match_confidence:value}],[{...email,match_confidence:value,verification_status:'future-provider-status'}]);
 assert.equal(result.phones[0].matchConfidence,null);assert.equal(result.emailObservations[0].matchConfidence,null);assert.equal(result.emailObservations[0].verificationStatus,null);
}
for(const status of emailVerificationStatuses)assert.equal(buyerContactObservations([], [{...email,verification_status:status}]).emailObservations[0].verificationStatus,status);
for(const dnc of [true,false,null,undefined,'false'])assert.equal(buyerContactObservations([{...phone,do_not_call:dnc}],[]).phones[0].doNotCall,typeof dnc==='boolean'?dnc:null);
assert.deepEqual(buyerContactObservations([null,[],{},'',{number:'x'.repeat(31)}],[null,{},[],{address:''},{address:'x'.repeat(321)}]),{phones:[],emails:[],emailObservations:[]});
assert.deepEqual(buyerContactObservations([phone,{...phone,do_not_call:true}],[]).phones.map(p=>p.doNotCall),[false,true],'Never discard contradictory DNC evidence');
let saved,requests=0;
await discoverBuyerPage({zip:'75201',page:1,perPage:10,since:'2025-09-29',unitCostMicros:10000,quotedCostMicros:100000},{
 request:async body=>{requests++;return body.estimate_cost?{estimated_credits:{this_page:1,breakdown:{properties:0,people:1}}}:{data:[{dm_person_id:'per_fixture',property:{dm_property_id:'prop_fixture'},phones:[{...phone,match_confidence:0}],emails:[{...email,match_confidence:87.5,verification_status:'undeliverable'}]}],credits:{used:1,people:1,properties:0},pagination:{has_next_page:false}};},
 claim:async()=>true,persist:async r=>{saved=r;}
});
assert.equal(requests,2);assert.equal(saved.candidates[0].contactObservedAt,saved.fetchedAt);assert.equal(saved.candidates[0].contactSource,'dealmachine');
assert.equal(saved.candidates[0].phones[0].matchConfidence,0);assert.equal(saved.candidates[0].emailObservations[0].verificationStatus,'undeliverable');
assert.deepEqual(saved.candidates[0].emails,[email.address]);assert(!('permitted' in saved.candidates[0]));
console.log('Buyer quality: actual provider metadata survives ingestion; zero/unknown/DNC conflicts and old email shape preserved, no additional provider request.');
