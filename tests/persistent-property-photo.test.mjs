import assert from 'node:assert/strict';
import {persistentPropertyPhoto} from '../lib/persistent-property-photo.ts';
const photo={source:'DealMachine',view:'street_view',url:'https://img.dealmachine.com/sv/1,2.jpg',fallbackUrl:'https://img.dealmachine.com/sat/1,2.jpg'};
let state={state:'claimed',lease:'lease-a'},loads=0,saves=[];
const db=async(path,method,body)=>{assert.equal(method,'POST');assert.equal(body.p_account,'account');assert.equal(body.p_screening,'screening');if(path==='rpc/icash_claim_photo_cache')return state;saves.push(body);return true;};
const load=async()=>{loads++;return photo;};
assert.deepEqual(await persistentPropertyPhoto(db,'account','screening',load),photo);
assert.equal(loads,1);assert.equal(saves[0].p_lease,'lease-a');
state={state:'cached',photo};assert.deepEqual(await persistentPropertyPhoto(db,'account','screening',load),photo);assert.equal(loads,1);
for(const claim of [{state:'loading'},{state:'unavailable'},null,{state:'cached',photo:null},{state:'cached',photo:{...photo,url:'https://evil.invalid/sv/a'}}]){
 state=claim;assert.equal(await persistentPropertyPhoto(db,'account','screening',load),null);
}assert.equal(loads,1);
await assert.rejects(persistentPropertyPhoto(async()=>{throw Error('DB unavailable');},'account','screening',load));assert.equal(loads,1);
state={state:'claimed',lease:'lease-b'};assert.equal(await persistentPropertyPhoto(db,'account','screening',async()=>{throw Error('Provider unavailable');}),null);assert.equal(saves.at(-1).p_photo,null);
console.log('Persistent photo cache: tenant scope, shared hit/lease, negative caching and fail-closed provider access passed.');
