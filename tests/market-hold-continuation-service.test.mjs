import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
Object.assign(process.env,{DEALMACHINE_API_KEY:'dm_sk_live_FIXTURE_NO_NETWORK',ICASH_ACQUISITION_MODE:'outbound'});
let calls=[],outcome='inventory_market_changed',providerRequests=0;
const forbidden=async()=>{providerRequests++;throw Error('Fixture reached provider work after held-market planning');};
const service=await loadService('lib/discovery-service.ts',{
 discoveryWorkEnabled:()=>true,liveWorkReady:()=>true,propertyResearchMarketKnown:async()=>true,
 syncResearchExclusions:async()=>null,refreshFinancialMetadata:forbidden,
 discoverPage:forbidden,requestDiscoveryEstimate:forbidden,
 db:async(path)=>{
  calls.push(path);
  if(path==='rpc/icash_prepare_research_efficiency')return null;
  if(path.startsWith('icash_discovery_configs'))return [{enabled:true,zip:'75217',rate_id:'rate',property_credit_micros:10000,data_rights_until:'2099-01-01',per_page:5,next_page:1,revision:'fixture-old-revision'}];
  if(path.startsWith('icash_bot_setups'))return [{revision:1,profile:{marketMode:'nationwide'}}];
  if(path.startsWith('icash_accounts'))return [{bot_paused:false}];
  if(path.startsWith('icash_wallets'))return [{balance_cents:1000,reserved_cents:0}];
  if(path.startsWith('icash_operation_rates'))return [{enabled:true,operation:'property_search',expires_at:'2099-01-01',costs_micros:{dealmachine:50000}}];
  if(path.startsWith('icash_operation_spend'))return [];
  if(path==='rpc/icash_prepare_discovery_inventory')return outcome;
  throw Error('Unexpected RPC after planning: '+path);
 }
});
const oldFetch=globalThis.fetch;globalThis.fetch=forbidden;
try{for(const status of ['inventory_market_changed','inventory_held']){
 outcome=status;calls=[];
 assert.equal((await service.discoverForAccount('fictional-account')).status,status);
 assert.equal(calls.at(-1),'rpc/icash_prepare_discovery_inventory');
 assert.equal(providerRequests,0,'Rotation/hold exits before free estimate, paid claim or provider dispatch');
}}finally{globalThis.fetch=oldFetch;}
console.log('PASS held-market service: changed and held plans stop at inventory preparation without provider work.');
