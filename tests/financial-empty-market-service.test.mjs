import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {discoverPage} from '../lib/discovery-pipeline.ts';
import {selectTargetingPlan} from '../lib/dealmachine-targeting.ts';
import {DiscoveryFilterUnavailable} from '../lib/discovery-filters.ts';
import {requestDiscoveryEstimate,DiscoveryEstimateHeld} from '../lib/discovery-estimate.ts';
import {researchQueryPolicyValid} from '../lib/research-query-policy.ts';
import {dealMachineRequest} from '../lib/dealmachine-request.ts';
Object.assign(process.env,{DEALMACHINE_API_KEY:'dm_sk_live_FIXTURE_NO_NETWORK',ICASH_ACQUISITION_MODE:'outbound'});
let tier=2,providerPage=1,complete=true,rpc=[],requests=0;
const service=await loadService('lib/discovery-service.ts',{
 discoverPage,selectTargetingPlan,DiscoveryFilterUnavailable,requestDiscoveryEstimate,DiscoveryEstimateHeld,researchQueryPolicyValid,dealMachineRequest,
 refreshFinancialMetadata:async()=>false,syncResearchExclusions:async()=>null,discoveryWorkEnabled:()=>true,liveWorkReady:()=>true,propertyResearchMarketKnown:async()=>true,
 db:async(path,method,body)=>{
  if(path.startsWith('icash_discovery_configs'))return[{enabled:true,zip:'75217',rate_id:'fixture-rate',property_credit_micros:10000,data_rights_until:'2099-01-01',per_page:5,next_page:1,revision:'fixture-revision',research_version:2,research_list_id:'fixture-list'}];
  if(path.startsWith('icash_bot_setups'))return[{revision:1,profile:{marketMode:'city',market:'75217'}}];
  if(path.startsWith('icash_accounts'))return[{bot_paused:false}];
  if(path.startsWith('icash_wallets'))return[{balance_cents:100,reserved_cents:0}];
  if(path.startsWith('icash_operation_rates'))return[{enabled:true,operation:'property_search',expires_at:'2099-01-01',costs_micros:{dealmachine:50000}}];
  if(path.startsWith('icash_operation_spend'))return[];
  rpc.push({path,body});
  if(path==='rpc/icash_prepare_discovery_inventory')return'ready';
  if(path==='rpc/icash_discovery_filter_state_v2')return['baseline','vacant','absentee','repairs'].map(strategy=>({strategy,nextPage:providerPage,exhausted:strategy!=='baseline',pages:0,attempted:0,pendingAttempts:0,recentUnproductivePages:0,matureAttempts:0,interested:0,optedOut:0,costCents:0,costsComplete:true}));
  if(path==='rpc/icash_targeting_state')return{enabled:false,queryContext:{required:true,ready:true,policy:{version:'financial-prefilter-v1',exclusionListId:'fixture-list',asOf:'2026-11-10',tier}}};
  if(path==='rpc/icash_claim_discovery_estimate')return{status:'request',token:'00000000-0000-4000-8000-000000000001'};
  if(path==='rpc/icash_finish_empty_financial_market'){if(complete==='unavailable'||complete==='committed_response_lost')throw Error('Fixture unavailable response');return complete;}
  if(path==='rpc/icash_finish_empty_filter'&&complete==='committed_response_lost')return false;
  if(path.includes('reserve'))throw Error('Empty fixture must never reserve a purchase');
  return true;
 }
});
const originalFetch=globalThis.fetch;
try{
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.v2.dealmachine.com/v1/properties/search');assert.equal(JSON.parse(options.body).estimate_cost,true);
  requests++;return Response.json({estimated_credits:{this_page:0,breakdown:{people:0}},totals:{properties:0},pagination:{total_results:0,has_next_page:false}});
 };
 assert.equal((await service.discoverForAccount('fixture-account')).status,'empty');
 assert.equal(requests,1);assert.equal(rpc.filter(x=>x.path==='rpc/icash_finish_empty_financial_market').length,1);
 assert(!rpc.some(x=>x.path==='rpc/icash_finish_empty_filter'),'Successful atomic market completion is not finalized a second time');
 const input=rpc.find(x=>x.path==='rpc/icash_finish_empty_financial_market').body;
 assert.equal(input.p_account,'fixture-account');assert.equal(input.p_scope.p_revision,'fixture-revision');assert.equal(input.p_policy.tier,2);assert.equal(input.p_plan.strategy,'baseline');
 for(const outcome of [false,'unavailable','committed_response_lost']){
  rpc=[];requests=0;complete=outcome;assert.equal((await service.discoverForAccount('fixture-account')).status,'empty');
  assert.equal(requests,1);assert.equal(rpc.filter(x=>x.path==='rpc/icash_finish_empty_filter').length,1,'Missing proof or additive schema keeps original progress');
 }
 for(const nextTier of [0,1]){
  rpc=[];tier=nextTier;assert.equal((await service.discoverForAccount('fixture-account')).status,'financial_preferences_widened');
  assert(!rpc.some(x=>x.path==='rpc/icash_finish_empty_financial_market'));
 }
 rpc=[];tier=2;providerPage=2;assert.equal((await service.discoverForAccount('fixture-account')).status,'empty');
 assert(!rpc.some(x=>x.path==='rpc/icash_finish_empty_financial_market'),'A later provider page is not a broad market proof');
 console.log('PASS empty-market service: exact tier2/first-baseline invocation, existing widening and missing-proof/schema fallback, no paid calls or synthetic arm receipts.');
}finally{globalThis.fetch=originalFetch;}
