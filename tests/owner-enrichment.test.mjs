import assert from 'node:assert/strict';
import {enrichOwners} from '../lib/owner-enrichment.ts';
import {automationTick} from '../worker/runner.mjs';
const now=Date.now();
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:100000,raw:{data:{dm_property_id:'prop_123',full_address:'Fixture',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}}};
const input={snapshot,creditCap:25,unitCostMicros:10000,quotedDataCostMicros:250000};
const owner=id=>({dm_person_id:id,full_name:'Fixture',is_likely_owner:true,is_in_owner_family:false,is_resident:false,is_likely_renter:false});
const preview=contacts=>({data:{dm_property_id:'prop_123',contacts},credits:{used:0,people:0,properties:0,deduplicated:0}});
const receipt=(ids,found=ids.length,deduplicated=0)=>({data:ids.map((id,index)=>({dm_person_id:id,found:index<found,full_name:'Fixture',phones:[{number:'5555555555',do_not_call:index%2===0}],emails:[{address:'fixture@example.com'}]})),totals:{submitted:ids.length,found,not_found:ids.length-found},credits:{used:found-deduplicated,people:found,properties:0,deduplicated}});
function harness(contacts=[owner('per_123')]){
 const state={events:[],preview:preview(contacts),raw:null,saved:null,observation:null,claim:true};
 state.dependencies={
  previewOwners:async id=>{state.events.push('preview');assert.equal(id,'prop_123');return state.preview;},
  reserveAndClaim:async()=>{state.events.push('claim');return state.claim;},
  fetchPeople:async ids=>{state.events.push('paid');assert(Object.isFrozen(ids));assert(ids.length<=25);assert.equal(new Set(ids).size,ids.length);state.ids=ids;return state.raw??receipt(ids);},
  recordReceipt:async r=>{state.events.push('observe');state.observation=r;},
  persist:async r=>{state.events.push('persist');state.saved=r;},
 };
 return state;
}
let h=harness();
assert.equal((await enrichOwners(input,h.dependencies,now)).status,'contacts_saved');
assert.deepEqual(h.events,['preview','claim','paid','observe','persist']);
assert.deepEqual(h.ids,['per_123']);
assert.equal(h.saved.contacts[0].phones[0].doNotCall,true);
assert.equal(h.saved.contacts[0].phones[0].permission,'unverified');
assert.equal(h.saved.contacts[0].ownershipVerified,false);
assert.equal(h.saved.contacts[0].outreachAuthorized,false);
assert.equal(h.saved.outreachAuthorized,false);
assert.deepEqual(h.saved.providerCredits,{used:1,people:1,properties:0,deduplicated:0});
assert.equal(h.saved.propertyId,'prop_123');
assert.equal(h.saved.estimated_value,undefined);

// More than the allowance is safe: only the frozen first unique IDs can be billed.
h=harness(Array.from({length:40},(_,i)=>owner('per_'+i)));h.preview.data.contacts.splice(1,0,owner('per_0'));
await enrichOwners(input,h.dependencies,now);
assert.equal(h.ids.length,25);assert.deepEqual(h.ids,Array.from({length:25},(_,i)=>'per_'+i));
assert.equal(h.saved.creditsUsed,25);
h=harness([owner('per_1'),owner('per_1'),owner('per_2')]);
await enrichOwners({...input,creditCap:1},h.dependencies,now);assert.deepEqual(h.ids,['per_1']);
h=harness([owner('per_1'),owner('per_2')]);h.raw=receipt(['per_1','per_2'],1,1);
await enrichOwners(input,h.dependencies,now);assert.equal(h.saved.creditsUsed,0);assert.equal(h.saved.peopleCredits,1);assert.equal(h.saved.contacts.length,1);
// Person-level flags cannot invent property-specific ownership.
h=harness([{dm_person_id:'per_1'}]);h.raw=receipt(['per_1']);h.raw.data[0].is_likely_owner=true;
await enrichOwners(input,h.dependencies,now);assert.equal(h.saved.contacts[0].likelyOwner,false);assert.equal(h.saved.contacts[0].matchFlags.is_likely_owner,null);

h=harness([]);assert.equal((await enrichOwners(input,h.dependencies,now)).status,'empty');assert.deepEqual(h.events,['preview']);
for(const malformed of [null,{},preview([{}]),preview([{dm_person_id:'123'}]),preview([{dm_person_id:'per_'}]),preview([null]),preview([owner('per_1'),{...owner('per_1'),is_likely_owner:false}]),{...preview([owner('per_1')]),data:{dm_property_id:'prop_456',contacts:[owner('per_1')]}},{...preview([owner('per_1')]),credits:{used:0,people:1,properties:0,deduplicated:0}},preview([...Array.from({length:25},(_,i)=>owner('per_'+i)),{}])]){
 h=harness();h.preview=malformed;await assert.rejects(enrichOwners(input,h.dependencies,now),/CONTACT_PREVIEW_INVALID/);assert.deepEqual(h.events,['preview']);
}
for(const config of [{creditCap:26},{creditCap:0},{creditCap:1.2},{quotedDataCostMicros:249999},{unitCostMicros:0},{quotedDataCostMicros:NaN}]){
 h=harness();await assert.rejects(enrichOwners({...input,...config},h.dependencies,now),/CONTACT_RATE_REQUIRED/);assert.deepEqual(h.events,[]);
}
h=harness();assert.equal((await enrichOwners({...input,snapshot:{...snapshot,sellerCostReserveCents:undefined}},h.dependencies,now)).status,'financial_hold');assert.deepEqual(h.events,[]);
for(const stamp of [now-86400001,now+1]){
 h=harness();await assert.rejects(enrichOwners({...input,snapshot:{...snapshot,fetchedAt:new Date(stamp).toISOString()}},h.dependencies,now),/INVALID_SNAPSHOT/);assert.deepEqual(h.events,[]);
}
h=harness();h.claim=false;assert.equal((await enrichOwners(input,h.dependencies,now)).status,'held');assert.deepEqual(h.events,['preview','claim']);
h=harness();h.dependencies.fetchPeople=async()=>{h.events.push('paid');throw Error('timeout');};
await assert.rejects(enrichOwners(input,h.dependencies,now),/timeout/);assert.deepEqual(h.events,['preview','claim','paid']);

const invalidReceipts=[
 r=>{r.data[0].dm_person_id='per_other';},r=>{r.data.push(r.data[0]);},r=>{r.data[0].found='true';},
 r=>{r.data[0].properties=[{dm_property_id:'prop_other'}];},r=>{r.data[0].property={dm_property_id:'prop_123'};},
 r=>{r.credits.properties=1;r.credits.used=2;},r=>{r.credits.used=26;},r=>{r.credits.people=26;},
 r=>{r.credits.deduplicated=1;},r=>{r.totals.submitted=2;},r=>{r.totals.found=0;},
 r=>{delete r.credits;},r=>{r.credits.used='1';},r=>{r.data=[];},r=>{delete r.totals;},
];
for(const mutate of invalidReceipts){
 h=harness();h.raw=receipt(['per_123']);mutate(h.raw);
 await assert.rejects(enrichOwners(input,h.dependencies,now),/CONTACT_RECEIPT_REQUIRES_RECONCILIATION/);
 assert.deepEqual(h.events,['preview','claim','paid','observe']);assert.equal(h.saved,null);
 const used=h.raw.credits?.used;assert.equal(h.observation.used,typeof used==='number'?used:null);
}
let sends=0;assert.equal(await automationTick(async()=>null,async()=>{sends++;}),false);assert.equal(sends,0);
const token='12345678-1234-1234-1234-123456789012'.repeat(2);
assert.equal(await automationTick(async()=>({token}),async(url,opt)=>{sends++;assert.equal(url,'https://www.geticashx.com/api/internal/automation');assert.equal(opt.redirect,'error');assert.equal(opt.headers.Authorization,'Bearer '+token);return new Response('{}');}),true);
await assert.rejects(automationTick(async()=>({token}),async()=>{throw new Error('timeout');}));
console.log('Owner enrichment: free preview, frozen/deduplicated 25-ID bound, malformed/empty holds, receipt reconciliation, screening, DNC/ownership provenance and no retry passed.');
