import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
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

const search={zip:'75201',page:1,perPage:10,since:'2025-09-29',unitCostMicros:10000,quotedCostMicros:100000};
const owner={dm_person_id:'per_repeat',full_name:'Fixture repeat owner',property:{dm_property_id:'prop_first',full_address:'First fixture property'},phones:[],emails:[]};
const positive={...owner,property:{dm_property_id:'prop_second'},phones:[{...phone,match_confidence:99}],emails:[{...email,verification_status:'very_likely_deliverable',match_confidence:98}]};
const negative={...owner,property:{dm_property_id:'prop_third'},phones:[{...phone,do_not_call:true,match_confidence:0}],emails:[{...email,verification_status:'undeliverable',match_confidence:0}]};
async function discoverRows(rows){
 let result,requests=0,claims=0;
 const outcome=await discoverBuyerPage(search,{
  request:async body=>{requests++;return body.estimate_cost?{estimated_credits:{this_page:rows.length,breakdown:{properties:0,people:rows.length}}}:{data:rows,credits:{used:rows.length,people:rows.length,properties:0},pagination:{has_next_page:false}};},
  claim:async()=>{claims++;return true;},persist:async value=>{result=value;},
 });
 assert.equal(requests,2);assert.equal(claims,1);assert.equal(outcome.status,'buyers_saved');assert.equal(result.creditsUsed,rows.length);
 return result;
}
// A contact-less first property row cannot hide the same owner's later contacts.
const later=await discoverRows([owner,positive]);
assert.equal(later.candidates.length,1);assert.equal(later.candidates[0].propertyId,'prop_first');
assert.deepEqual(later.candidates[0].phones.map(p=>p.number),[phone.number]);assert.deepEqual(later.candidates[0].emails,[email.address]);
// Preserve conflicting observations in either order. Neither becomes a new
// contact grant, verified buyer criterion or a fabricated provider timestamp.
for(const rows of [[owner,positive,negative,positive],[owner,negative,positive,negative]]){
 const result=await discoverRows(rows),candidate=result.candidates[0];
 assert.equal(result.candidates.length,1);assert.equal(candidate.phones.length,2);assert.equal(candidate.emailObservations.length,2);
 assert.deepEqual(new Set(candidate.phoneObservations.map(p=>p.doNotCall)),new Set([false,true]));
 assert.deepEqual(new Set(candidate.phoneObservations.map(p=>p.matchConfidence)),new Set([99,0]));
 assert(candidate.phones.every(p=>p.doNotCall===true));assert.equal(candidate.contactQualityVersion,'buyer-contacts-v2');
 assert.deepEqual(new Set(candidate.emailObservations.map(e=>e.verificationStatus)),new Set(['very_likely_deliverable','undeliverable']));
 assert.deepEqual(candidate.emails,[email.address]);assert.equal(candidate.contactObservedAt,result.fetchedAt);
 assert.equal(candidate.propertyId,'prop_first');assert.equal(candidate.propertyAddress,'First fixture property');
 for(const key of ['permitted','criteriaConfirmedAt','proofOfFundsVerifiedAt','authorityVerified'])assert(!(key in candidate));
}
// Never merge contact observations across distinct owners, even for a shared number.
const separate=await discoverRows([positive,{...negative,dm_person_id:'per_other'}]);
assert.equal(separate.candidates.length,2);assert.deepEqual(separate.candidates.map(c=>c.phones.map(p=>p.doNotCall)),[[false],[true]]);
// Still validate every row before deduplication; a repeated owner cannot hide
// a malformed property binding and turn a broken receipt into a saved result.
await assert.rejects(()=>discoverRows([positive,{...negative,property:{dm_property_id:'not-a-property'}}]),/BUYER_RESPONSE_INVALID/);

// Execute the existing consumers' actual discovery predicates. They use ANY
// false, so preserving contradictory raw entries in phones alone would expand
// eligibility when a negative first row is followed by a positive duplicate.
const predicates=['buyer-voice.sql','buyer-introduction-calls.sql'].map(name=>{
 const line=readFileSync(new URL('../config/'+name,import.meta.url),'utf8').split('\n').find(line=>line.includes("jsonb_array_elements(coalesce(b.discovery->'phones'"));
 assert(line,'Expected original buyer phone predicate in '+name);return line.trim().replace(/^and /,'');
});
const pg=await PGlite.create();
try{
 for(const predicate of predicates){
  const eligible=async(candidate,number)=> (await pg.query(`with b as (select $1::jsonb discovery),p as (select $2::text phone) select (${predicate}) eligible from b,p`,[JSON.stringify(candidate),number])).rows[0].eligible;
  for(const restricted of [true,null])for(const negativeNumber of [phone.number,'(214) 555-0100','+12145550100']){
   const restrictedRow={...negative,phones:[{number:negativeNumber,do_not_call:restricted}]};
   for(const rows of [[restrictedRow,positive],[positive,restrictedRow]]){
    const candidate=(await discoverRows(rows)).candidates[0];
    assert.equal(await eligible(candidate,phone.number),false,'A later or earlier false cannot erase negative/unknown DNC evidence');
    assert(candidate.phones.every(p=>p.doNotCall===restricted));
    assert(candidate.phoneObservations.some(p=>p.doNotCall===restricted));
    assert(candidate.phoneObservations.some(p=>p.doNotCall===false));
   }
  }
  const clear=(await discoverRows([owner,positive,positive])).candidates[0];
  assert.equal(await eligible(clear,phone.number),true,'Uncontradicted false remains source-eligible; other dispatch gates still apply');
  const mixed=(await discoverRows([negative,{...positive,phones:[{...phone,number:'4695550100'}]}])).candidates[0];
  assert.equal(await eligible(mixed,phone.number),false);assert.equal(await eligible(mixed,'4695550100'),true,'A different number keeps its own evidence');
 }
}finally{await pg.close();}
console.log('Buyer quality: repeated-owner contact evidence retained; negative/unknown DNC dominates existing SQL predicates without cross-owner merging, extra requests or permission grants.');
