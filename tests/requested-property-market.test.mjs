import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {discoveryWorkEnabled} from '../lib/live-work-admission.ts';
// Compile the service so this suite cannot reach the real database.
const location={location_id:'loc_zip_code_94103',type:'zip_code',code:'94103',name:'San Francisco',state:'CA',property_count:15000};
const response=data=>({data,pagination:{page:1,total_pages:1}});
const token='11111111-1111-1111-1111-111111111111';
let claim={status:'lookup_required',zip:'94103',token},requests=0,provisions=0,saved=[],failure=false;
const db=async(path,_method,body)=>{
 if(path==='rpc/icash_claim_requested_property_zip'){assert.deepEqual(body,{p_user:'owner',p_account:'account'});return claim;}
 if(path==='rpc/icash_take_dealmachine_request')return true;
 if(path==='rpc/icash_save_requested_property_zip'){saved.push(body);return {status:body.p_location?.property_count>0?'known':'provider_market_unavailable'};}
 if(path==='rpc/icash_provision_funded_account'){provisions++;return {status:'configured'};}
 throw Error('Unexpected path '+path);
};
const service=await loadService('lib/requested-property-market.ts',{db,discoveryWorkEnabled});
assert.deepEqual(service.requestedZipLocation(response([location]),'94103'),location);
assert.equal(service.requestedZipLocation(response([{...location,code:'94104',location_id:'loc_zip_code_94104'}]),'94103'),null);
for(const patch of [{state:'ZZ'},{state:'PR'},{location_id:'different'},{property_count:-1},{property_count:1.1},{property_count:'50'},{name:''}])assert.throws(()=>service.requestedZipLocation(response([{...location,...patch}]),'94103'));
assert.throws(()=>service.requestedZipLocation(response([location,location]),'94103'));
assert.throws(()=>service.requestedZipLocation({data:[location],pagination:{page:2,total_pages:2}},'94103'));
assert.throws(()=>service.requestedZipLocation(response(Array(101).fill(location)),'94103'));
Object.assign(process.env,{ICASH_LIVE_WORK_READY:'true',DEALMACHINE_API_KEY:'dm_sk_live_SIMULATION_NO_NETWORK'});
const oldFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{requests++;assert.equal(url,'https://api.v2.dealmachine.com/v1/locations?q=94103&type=zip_code&per_page=100&page=1');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');if(failure)throw Error('Synthetic provider failure');return Response.json(response([location]));};
try{
 assert.equal((await service.resolveRequestedPropertyMarket('account','owner')).status,'configured');assert.equal(requests,1);assert.equal(provisions,1);assert.equal(saved[0].p_token,token);
 for(const status of ['not_requested','funding_required','market_lookup_held']){claim={status};assert.equal((await service.resolveRequestedPropertyMarket('account','owner')).status,status);}
 assert.equal(requests,1);assert.equal(provisions,1);
 claim={status:'known',zip:'94103'};assert.equal((await service.resolveRequestedPropertyMarket('account','owner')).status,'configured');assert.equal(requests,1);assert.equal(provisions,2);
 claim={status:'lookup_required',zip:'94103',token};failure=true;assert.equal((await service.resolveRequestedPropertyMarket('account','owner')).status,'market_lookup_unavailable');assert.equal(requests,2);assert.equal(saved.length,1);assert.equal(provisions,2);
}finally{globalThis.fetch=oldFetch;}
console.log('Requested ZIP: exact US-state/ZIP/provider ID and bounded response validation; no neighboring fallback, territories or malformed counts; only claimed free GET, cached reuse, and no provision after failed lookup.');
