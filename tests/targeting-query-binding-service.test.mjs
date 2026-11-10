import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {discoverPage} from '../lib/discovery-pipeline.ts';
import {researchQueryPolicyValid} from '../lib/research-query-policy.ts';
import {DiscoveryFilterUnavailable} from '../lib/discovery-filters.ts';
import {DiscoveryEstimateHeld} from '../lib/discovery-estimate.ts';
Object.assign(process.env,{DEALMACHINE_API_KEY:'dm_sk_live_FIXTURE_NO_NETWORK',ICASH_ACQUISITION_MODE:'outbound'});
let targeting=null,filterState=[],plan,requests=[],rpc=[],estimateFails=false;
const legacy={version:'seller-filters-v1',strategy:'baseline',providerPage:1,mode:'explore'};
const target={version:'seller-targeting-v1',strategy:'target_00000000-0000-4000-8000-000000000010',providerPage:1,mode:'explore',targeting:{id:'00000000-0000-4000-8000-000000000010',segment:'vacant_absentee',asOf:'2026-10-30'}};
const policy={version:'research-efficiency-v2',exclusionListId:'verified-fixture-list'};
const svc=await loadService('lib/discovery-service.ts',{refreshFinancialMetadata:async()=>false,
 researchQueryPolicyValid,discoverPage,DiscoveryFilterUnavailable,DiscoveryEstimateHeld,
 discoveryWorkEnabled:()=>true,liveWorkReady:()=>true,propertyResearchMarketKnown:async()=>true,syncResearchExclusions:async()=>null,
 selectTargetingPlan:()=>plan,requestDiscoveryEstimate:async(_db,_a,_s,_p,_q,_body,request)=>request(),dealMachineRequest:async(_db,_purpose,request)=>{const r=await request();return {status:r.status,ok:r.ok,raw:await r.json()};},
 db:async(path,method,body)=>{
  rpc.push({path,body});
  if(path.startsWith('icash_discovery_configs'))return [{enabled:true,zip:'75217',rate_id:'rate',property_credit_micros:10000,data_rights_until:'2099-01-01',per_page:5,next_page:1,revision:'revision',research_version:2,research_list_id:null}];
  if(path.startsWith('icash_bot_setups'))return [{revision:1,profile:{marketMode:'city',market:'75217'}}];
  if(path.startsWith('icash_accounts'))return [{bot_paused:false}];
  if(path.startsWith('icash_wallets'))return [{balance_cents:100,reserved_cents:0}];
  if(path.startsWith('icash_operation_rates'))return [{enabled:true,operation:'property_search',expires_at:'2099-01-01',costs_micros:{dealmachine:50000}}];
  if(path.startsWith('icash_operation_spend'))return [];
  if(path==='rpc/icash_prepare_discovery_inventory')return 'ready';
  if(path==='rpc/icash_discovery_filter_state_v2')return filterState;
  if(path==='rpc/icash_targeting_state')return targeting;
  if(path==='rpc/icash_discovery_shared_evidence')return [];
  if(path==='rpc/icash_save_research_discovery')return 0;
  return true;
 }
});
globalThis.fetch=async(_url,opt)=>{const body=JSON.parse(opt.body);requests.push(body);if(body.estimate_cost&&estimateFails)throw Error('synthetic timeout');return Response.json(body.estimate_cost?{estimated_credits:{this_page:1,breakdown:{people:0}}}:{data:[],credits:{used:0,people:0},pagination:{has_next_page:true}});};
const run=async()=>{requests=[];rpc=[];return svc.discoverForAccount('account');};
plan=legacy;assert.equal((await run()).status,'no_new_properties');assert.equal(rpc.find(r=>r.path==='rpc/icash_reserve_research_discovery').body.p_policy.exclusionListId,null,'Old DB response remains ordinary compatible');
assert(!rpc.some(r=>r.path==='rpc/icash_targeting_query_context'),'No RPC missing on old database');
targeting={queryContext:{required:false,ready:true,policy}};await run();assert.equal(rpc.find(r=>r.path==='rpc/icash_reserve_research_discovery').body.p_policy.exclusionListId,null,'First baseline is not forced onto list');
plan=target;await run();assert.deepEqual(rpc.find(r=>r.path==='rpc/icash_reserve_research_discovery').body.p_policy,policy);assert.deepEqual({...requests[0],estimate_cost:false},requests[1],'Free and paid exact query identity');
estimateFails=true;await assert.rejects(run(),e=>e.stage==='estimate');assert.equal(requests.length,1);assert(!rpc.some(r=>r.path.includes('reserve_research')),'Failed list estimate does not fall back into paid request');estimateFails=false;
filterState=null;targeting={queryContext:{required:true,ready:true,policy}};await run();assert.deepEqual(rpc.find(r=>r.path==='rpc/icash_reserve_research_discovery').body.p_policy,policy,'Historical ZIP remains bound when ordinary filter allocator is disabled');
for(const queryContext of [{required:true,ready:false,policy:null},{required:'false',ready:true,policy},{required:true,ready:true,policy:{...policy,exclusionListId:'bad list!'}}]){targeting={queryContext};assert.equal((await run()).status,'inventory_held');assert.equal(requests.length,0);}
filterState=[];plan=legacy;targeting={queryContext:{required:false,ready:false,policy:null}};assert.equal((await run()).status,'no_new_properties','Sync-pending first experiment leaves ordinary supply');
console.log('Target query service: rolling DB compatibility, ordinary first baseline, exact free/paid identity, no timeout fallback, disabled-filter history and malformed hold passed.');
