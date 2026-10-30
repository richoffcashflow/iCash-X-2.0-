import {selectTargetingPlan} from '../lib/dealmachine-targeting.ts';
import assert from 'node:assert/strict';
import {dealMachineRequest} from '../lib/dealmachine-request.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {requestDiscoveryEstimate,DiscoveryEstimateHeld} from '../lib/discovery-estimate.ts';
import {discoverPage} from '../lib/discovery-pipeline.ts';
import {selectDiscoveryFilter,DiscoveryFilterUnavailable,discoveryStrategies} from '../lib/discovery-filters.ts';
import {ProspectingBudgetError,voiceReservationFailure} from '../lib/voice-budget-failure.ts';
Object.assign(process.env,{DEALMACHINE_API_KEY:'dm_sk_live_FIXTURE_NO_NETWORK',ICASH_ACQUISITION_MODE:'outbound'});
let events=[],rpc=[],response=200,failPaid=false,existing=false,disabled=false,empty=false,budgetRejected=false;
const svc=await loadService('lib/discovery-service.ts',{
 requestDiscoveryEstimate,DiscoveryEstimateHeld,dealMachineRequest,syncResearchExclusions:async()=>null,discoveryWorkEnabled:()=>true,liveWorkReady:()=>true,propertyResearchMarketKnown:async()=>true,discoverPage,selectDiscoveryFilter,selectTargetingPlan,DiscoveryFilterUnavailable,
 db:async(path,method,body)=>{
  if(path.startsWith('icash_discovery_configs'))return [{enabled:true,zip:'75217',rate_id:'rate',property_credit_micros:10000,data_rights_until:'2099-01-01',per_page:5,next_page:1,revision:'revision'}];
  if(path.startsWith('icash_bot_setups'))return [{revision:1,profile:{marketMode:'city',market:'75217'}}];
  if(path.startsWith('icash_accounts'))return [{bot_paused:false}];
  if(path.startsWith('icash_wallets'))return [{balance_cents:100,reserved_cents:0}];
  if(path.startsWith('icash_operation_rates'))return [{enabled:true,operation:'property_search',expires_at:'2099-01-01',costs_micros:{dealmachine:50000}}];
  if(path.startsWith('icash_operation_spend'))return existing?[{state:'dispatched'}]:[];
  rpc.push({path,body});
  if(path==='rpc/icash_claim_discovery_estimate')return {status:'request',token:'00000000-0000-4000-8000-000000000001'};
  if(path==='rpc/icash_finish_discovery_estimate')return true;
  if(path==='rpc/icash_prepare_discovery_inventory')return 'ready';
  if(path==='rpc/icash_save_filtered_discovery'||path==='rpc/icash_save_discovery')return 0;
  if(path==='rpc/icash_discovery_filter_state_v2')return disabled?null:discoveryStrategies.map(strategy=>({strategy,nextPage:3,exhausted:false,pages:0,attempted:0,pendingAttempts:0,recentUnproductivePages:0,matureAttempts:0,interested:0,optedOut:0,costCents:0,costsComplete:true}));
  if(path.includes('reserve_and_claim')){events.push('claim');if(budgetRejected)throw await voiceReservationFailure(path,400,Response.json({code:'P0001',message:'Prospecting budget reached',details:JSON.stringify({quoteCents:977})}));}
  return true;
 }
});
globalThis.fetch=async(url,opt)=>{
 assert.equal(url,'https://api.v2.dealmachine.com/v1/properties/search');const body=JSON.parse(opt.body);events.push(body.estimate_cost?'estimate':'paid');
 if(!body.estimate_cost&&failPaid)throw Error('uncertain receipt');
 return new Response(JSON.stringify(body.estimate_cost?{estimated_credits:{this_page:empty?0:1,breakdown:{people:0}}}:{data:[],credits:{used:0,people:0},pagination:{has_next_page:true}}),{status:response});
};
assert.equal((await svc.discoverForAccount('account')).status,'no_new_properties');assert.deepEqual(events,['estimate','claim','paid']);
assert.equal(rpc.find(x=>x.path==='rpc/icash_reserve_and_claim_filtered_discovery').body.p_plan.strategy,'vacant');
assert(rpc.some(x=>x.path==='rpc/icash_save_filtered_discovery'));assert(rpc.some(x=>x.path==='rpc/icash_settle_dealmachine_usage'));
events=[];rpc=[];budgetRejected=true;await assert.rejects(svc.discoverForAccount('account'),e=>e instanceof ProspectingBudgetError&&e.quoteCents===977);assert.deepEqual(events,['estimate','claim'],'Atomic budget rejection must stop before the paid provider request');assert(!rpc.some(x=>x.path.includes('save_filtered')||x.path.includes('settle')));budgetRejected=false;
events=[];rpc=[];response=422;assert.equal((await svc.discoverForAccount('account')).status,'empty');assert.deepEqual(events,['estimate']);assert.equal(rpc.at(-1).body.p_reason,'unavailable');
events=[];rpc=[];response=429;await assert.rejects(svc.discoverForAccount('account'),e=>/NO_RETRY/.test(e.message)&&e.stage==='estimate'&&e.httpStatus===429);assert.deepEqual(events,['estimate']);assert(!rpc.some(x=>x.path.includes('finish_empty')));
events=[];rpc=[];response=200;empty=true;assert.equal((await svc.discoverForAccount('account')).status,'empty');assert.deepEqual(events,['estimate']);assert.equal(rpc.at(-1).body.p_reason,'empty');empty=false;
events=[];rpc=[];failPaid=true;await assert.rejects(svc.discoverForAccount('account'),e=>/NO_RETRY/.test(e.message)&&e.stage==='paid'&&e.httpStatus===null);assert.deepEqual(events,['estimate','claim','paid']);assert(!rpc.some(x=>x.path.includes('finish_empty')));failPaid=false;
events=[];rpc=[];existing=true;assert.equal((await svc.discoverForAccount('account')).status,'awaiting_reconciliation');assert.deepEqual(events,[]);assert.deepEqual(rpc.map(x=>x.path),['rpc/icash_prepare_research_efficiency']);existing=false;
events=[];rpc=[];disabled=true;await svc.discoverForAccount('account');assert(rpc.some(x=>x.path==='rpc/icash_save_discovery'));assert(!rpc.some(x=>x.path==='rpc/icash_save_filtered_discovery'));
// Virtual deadlines exercise slow ordinary provider responses without spending
// credits or waiting on wall-clock timers. The original operation is never retried.
const originalTimeout=AbortSignal.timeout,originalFetch=globalThis.fetch,clocks=new Map();
try{
 AbortSignal.timeout=ms=>{const c=new AbortController();clocks.set(ms,c);return c.signal;};
 let paidSignal,finishPaid;
 events=[];rpc=[];
 globalThis.fetch=async(url,opt)=>{
  const body=JSON.parse(opt.body);
  if(body.estimate_cost)return originalFetch(url,opt);
  events.push('paid');paidSignal=opt.signal;
  return new Promise((resolve,reject)=>{finishPaid=()=>resolve(Response.json({data:[],credits:{used:0,people:0},pagination:{has_next_page:true}}));opt.signal.addEventListener('abort',()=>reject(opt.signal.reason),{once:true});});
 };
 const pending=svc.discoverForAccount('account');
 while(!paidSignal)await new Promise(r=>setImmediate(r));
 assert(clocks.has(60000));assert(clocks.has(90000));assert(!clocks.has(15000));
 clocks.get(20000).abort();assert.equal(paidSignal.aborted,false,'The completed estimate deadline cannot cancel the paid request');
 finishPaid();assert.equal((await pending).status,'no_new_properties');
 assert.deepEqual(events,['estimate','claim','paid']);assert(rpc.some(x=>x.path==='rpc/icash_save_discovery'));
 paidSignal=null;events=[];rpc=[];clocks.clear();
 const timeout=assert.rejects(svc.discoverForAccount('account'),e=>e.stage==='paid'&&e.httpStatus===null);
 while(!paidSignal)await new Promise(r=>setImmediate(r));
 clocks.get(60000).abort(new DOMException('Fixture timeout','TimeoutError'));await timeout;
 assert.deepEqual(events,['estimate','claim','paid']);assert(!rpc.some(x=>x.path==='rpc/icash_save_discovery'));
 events=[];rpc=[];clocks.clear();
 globalThis.fetch=async(url,opt)=>{const response=await originalFetch(url,opt);clocks.get(90000).abort(new DOMException('Fixture deadline','TimeoutError'));return response;};
 await assert.rejects(svc.discoverForAccount('account'),e=>e.name==='TimeoutError');
 assert.deepEqual(events,['estimate'],'An expired total deadline cannot reserve or start a paid request');
}finally{AbortSignal.timeout=originalTimeout;globalThis.fetch=originalFetch;}
console.log('Filter service: bounded longer search, deadline admission, settlement and no replay after uncertain paid requests passed.');
