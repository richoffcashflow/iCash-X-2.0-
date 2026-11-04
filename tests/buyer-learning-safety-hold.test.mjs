import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {assignSharedLearning,SharedLearningSafetyHold} from '../lib/shared-learning.ts';
process.env.ICASH_LIVE_WORK_READY='true';process.env.DEALMACHINE_API_KEY='synthetic-no-network';
const requests=[],future=new Date(Date.now()+86400000).toISOString();
const db=async(path,method='GET',body)=>{
 requests.push({path,method,body});
 if(path==='rpc/icash_assign_shared_learning'){assert.equal(body.p_domain,'buyer_search');return {held:true,reason:'learning_safety_hold'};}
 assert.equal(method,'GET');
 if(path.startsWith('icash_buyer_search_configs?'))return [{enabled:true,rights_until:future,revision:'revision',max_pages:5}];
 if(path.startsWith('icash_deal_files?'))return [{screening_id:'screen',stage:'under_contract'}];
 if(path.startsWith('icash_accounts?'))return [{bot_paused:false}];
 if(path.startsWith('icash_signing_envelopes?'))return [{id:'signature'}];
 if(path.startsWith('icash_screening_jobs?'))return [{snapshot:{propertyId:'prop_123',raw:{data:{zip:'75217'}}}}];
 if(path.startsWith('icash_property_controls?')||path.startsWith('icash_buyer_search_receipts?'))return [];
 throw Error('Unexpected work after learning hold: '+path);
};
const forbidden=()=>{throw Error('Learning hold must precede provider search or cursor selection');};
const service=await loadService('lib/buyer-discovery-service.ts',{db,assignSharedLearning,SharedLearningSafetyHold,nextBuyerSearch:forbidden,discoverBuyerPage:forbidden});
assert.deepEqual(await service.discoverBuyersForDeal('account','deal'),{status:'learning_safety_hold',canContinue:false});
assert.equal(requests.filter(r=>r.method!=='GET').length,1);
assert(!requests.some(r=>/reserve|claim|icash_operation_spend|icash_operation_rates/.test(r.path)));
console.log('PASS buyer learning safety: explicit hold stops before cursor, financial reservation and provider search.');
