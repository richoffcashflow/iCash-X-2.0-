import assert from 'node:assert/strict';
import {processSellerIntake} from '../lib/seller-pipeline.ts';
const noMatch=(credits=0)=>({data:[{matched:false,match_failure:{code:'no_match'}}],totals:{submitted:1},credits:{used:credits,people:0}});
const matched={data:[{matched:true,dm_property_id:'prop_123',full_address:'650 Gladiola Loop, Kyle, TX 78640',city:'Kyle',state:'TX',zip:'78640',property_type:1,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}],totals:{submitted:1},credits:{used:1,people:0}};
async function run(first,second,{receiptSaved=true,rateAllowed=true}={}){
 let available=true,calls=0,saved,writes=[],rates=0;
 const db=async(path,method,body)=>{
  if(path==='rpc/icash_take_dealmachine_request')return ++rates===1||rateAllowed;
  if(path==='rpc/icash_claim_seller_lookup_for'){if(!available)return null;available=false;return {id:'fixture',token:'claim',address:'650 Gladiola Lp, Kyle, TX 78640, USA',assignmentFeeCents:1000000,sellerCostReserveCents:100000};}
  if(path==='rpc/icash_finish_seller_lookup'){saved=body.p_output;return true;}
  if(method==='PATCH'){writes.push(body);return receiptSaved?[{id:'fixture'}]:[];}
  throw Error('Unexpected database call');
 };
 const transport=async(url,opts)=>{
  calls++;const input=JSON.parse(opts.body).data[0];
  if(calls===1)assert.equal(input.street,'650 Gladiola Loop');
  else {assert.equal(calls,2);assert.equal(input.full_address,'650 Gladiola Loop, Kyle, TX 78640');assert.equal(writes[0].result.addressAttempts[0].creditsUsed,0);}
  const output=calls===1?first:second;if(output instanceof Error)throw output;return Response.json(output);
 };
 const result=await processSellerIntake(db,'dm_sk_live_fixture',transport,'fixture');
 await processSellerIntake(db,'dm_sk_live_fixture',transport,'fixture');
 return {result,calls,saved,writes};
}
let r=await run(noMatch(),matched);assert.equal(r.calls,2);assert.equal(r.saved.status,'qualified');assert.equal(r.saved.creditsUsed,1);assert.equal(r.saved.result.addressAttempts.length,2);
r=await run(noMatch(),noMatch());assert.equal(r.calls,2);assert.equal(r.saved.status,'unmatched');assert.equal(r.saved.creditsUsed,0);
r=await run(noMatch(1),matched);assert.equal(r.calls,1,'Never repeat a charged no-match');
r=await run(new Error('timeout'),matched);assert.equal(r.calls,1);assert.equal(r.result.status,'lookup_requires_review');
r=await run(noMatch(),new Error('timeout'));assert.equal(r.calls,2);assert.equal(r.writes.at(-1).state,'review');assert.equal(r.writes.at(-1).result.addressAttempts[0].creditsUsed,0);
r=await run(noMatch(),matched,{receiptSaved:false});assert.equal(r.calls,1,'No fallback after losing the claim or receipt');
r=await run(noMatch(),matched,{rateAllowed:false});assert.equal(r.calls,1);assert.equal(r.saved.status,'unmatched');
console.log('PASS successful format recovery, zero-charge evidence, bounded total cost, durable claim, rate admission and no ambiguous replay.');
