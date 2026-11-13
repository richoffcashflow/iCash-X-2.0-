import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {discoverBuyerPage,nextBuyerSearchFromReceipts} from '../lib/buyer-discovery.ts';
import {dealMachineRequest} from '../lib/dealmachine-request.ts';
import {SharedLearningSafetyHold} from '../lib/shared-learning.ts';
import {planBuyerOutreach} from '../lib/buyer-engine.ts';

const oldReady=process.env.ICASH_LIVE_WORK_READY,oldKey=process.env.DEALMACHINE_API_KEY;
process.env.ICASH_LIVE_WORK_READY='true';process.env.DEALMACHINE_API_KEY='fixture-no-network';
const future=new Date(Date.now()+86400000).toISOString();
async function fixture({outcome='success',admission=true,claim=true}={}){
 const admitted=[],finished=[],requests=[],saved=[],claims=[];
 const db=async(path,method,body)=>{
  if(path==='rpc/icash_take_dealmachine_request'){admitted.push(body);return admission;}
  if(path==='rpc/icash_finish_dealmachine_request'){finished.push(body);return null;}
  if(path==='rpc/icash_reserve_operation')return null;
  if(path==='rpc/icash_claim_buyer_search'){claims.push(body);return claim;}
  if(path==='rpc/icash_save_buyer_search'){saved.push(body);return null;}
  if(path==='rpc/icash_settle_dealmachine_usage')return null;
  if(path.startsWith('icash_buyer_search_configs?'))return [{enabled:true,rights_until:future,revision:'revision',max_pages:5,per_page:10,since:'2025-01-01',unit_cost_micros:1000,rate_id:'rate'}];
  if(path.startsWith('icash_deal_files?'))return [{screening_id:'screen',stage:'under_contract'}];
  if(path.startsWith('icash_accounts?'))return [{bot_paused:false}];
  if(path.startsWith('icash_signing_envelopes?'))return [{id:'signed'}];
  if(path.startsWith('icash_screening_jobs?'))return [{snapshot:{propertyId:'prop_fixture',raw:{data:{zip:'75217'}}}}];
  if(path.startsWith('icash_property_controls?')||path.startsWith('icash_buyer_search_receipts?')||path.startsWith('icash_operation_spend?'))return [];
  if(path.startsWith('icash_operation_rates?'))return [{enabled:true,operation:'buyer_discovery',expires_at:future,costs_micros:{dealmachine:10000}}];
  throw Error('Unexpected fixture boundary '+path);
 };
 const fetch=async(_url,options)=>{
  const body=JSON.parse(options.body);requests.push(body);
  const headers={'X-RateLimit-Remaining':'23','X-RateLimit-Day-Remaining':'987','Retry-After':'30'};
  if(body.estimate_cost)return Response.json({estimated_credits:{this_page:1,breakdown:{properties:0,people:1}}},{headers});
  if(outcome==='unknown')throw Error('Fixture transport outcome unknown');
  if(outcome==='429')return Response.json({error:'rate limit'},{status:429,headers});
  return Response.json({data:[],credits:{used:1,people:1,properties:0},pagination:{has_next_page:false}},{headers});
 };
 const service=await loadService('lib/buyer-discovery-service.ts',{db,fetch,dealMachineRequest,discoverBuyerPage,nextBuyerSearchFromReceipts,SharedLearningSafetyHold,assignSharedLearning:async()=>null});
 return {run:()=>service.discoverBuyersForDeal('account','deal'),admitted,finished,requests,saved,claims};
}
try{
 await test('buyer estimates and purchases retain scoped quota and provider feedback receipts',async()=>{
  const f=await fixture();await f.run();
  assert.deepEqual(f.admitted.map(r=>r.p_kind),['buyer_estimate','buyer_search']);
  assert(f.admitted.every(r=>r.p_account==='account'&&r.p_operation==='buyers:deal:revision:1'&&r.p_request));
  assert.equal(new Set(f.admitted.map(r=>r.p_request)).size,2);
  assert.deepEqual(f.finished.map(r=>r.p_request),f.admitted.map(r=>r.p_request));
  assert(f.finished.every(r=>r.p_result.minuteRemaining===23&&r.p_result.dayRemaining===987));
  assert.equal(f.finished[1].p_result.creditsUsed,1);assert.equal(f.saved.length,1);
 });
 await test('rate limits and unknown paid outcomes are recorded once without replay',async()=>{
  for(const outcome of ['429','unknown']){
   const f=await fixture({outcome});await assert.rejects(f.run());
   assert.equal(f.requests.length,2);assert.equal(f.claims.length,1);assert.equal(f.saved.length,0);
   assert.equal(f.finished.length,2);
   assert.equal(f.finished[1].p_result.outcome,outcome==='429'?'http_error':'unknown');
   if(outcome==='429'){assert.equal(f.finished[1].p_result.httpStatus,429);assert.equal(f.finished[1].p_result.retryAfter,30);}
  }
 });
 await test('quota and final spending denials never dispatch a paid request',async()=>{
  for(const admission of [false,null,'true',{},1]){
   const f=await fixture({admission});await assert.rejects(f.run());assert.equal(f.requests.length,0);
  }
  const f=await fixture({claim:false});assert.equal((await f.run()).status,'held');assert.equal(f.requests.length,1);assert.equal(f.saved.length,0);
 });
 await test('entity deduplication retains the permitted affordable contact and its own evidence',()=>{
  const now=Date.now(),deal={market:'Dallas',propertyType:'house',askingPriceCents:100,repairsCents:100,sellerContractSigned:true,marketingAuthorized:true};
  const b={id:'blocked',entityId:'entity',markets:['Dallas'],propertyTypes:['house'],maxPriceCents:1000,maxRepairCents:1000,criteriaConfirmedAt:now,permitted:false,proofOfFundsVerifiedAt:now,authorityVerified:true,completedDeals:100,failedDeals:0,estimatedContactChargeCents:100};
  const contact={...b,id:'permitted',permitted:true,completedDeals:2};
  for(const records of [[b,contact],[contact,b]]){
   const p=planBuyerOutreach(deal,records,now,200,100);assert.deepEqual(p.outreach,['permitted']);assert.equal(p.matches.length,1);assert.equal(p.matches[0].id,'permitted');
  }
  const expensive={...contact,id:'expensive',completedDeals:100,estimatedContactChargeCents:200};
  const affordable={...contact,id:'affordable',estimatedContactChargeCents:50};
  const first={...expensive,id:'first',entityId:'first',completedDeals:1000,estimatedContactChargeCents:100};
  assert.deepEqual(planBuyerOutreach(deal,[first,expensive,affordable],now,250,100).outreach,['first','affordable']);
  assert.deepEqual(planBuyerOutreach({...deal,marketingAuthorized:false},[b,contact],now,200,0).outreach,[]);
  assert.deepEqual(planBuyerOutreach(deal,[b,{...contact,permitted:false}],now,200,0).outreach,[]);
 });
}finally{
 if(oldReady===undefined)delete process.env.ICASH_LIVE_WORK_READY;else process.env.ICASH_LIVE_WORK_READY=oldReady;
 if(oldKey===undefined)delete process.env.DEALMACHINE_API_KEY;else process.env.DEALMACHINE_API_KEY=oldKey;
}
