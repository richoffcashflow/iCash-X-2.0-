import assert from 'node:assert/strict';
import {refreshInventoryGeographies} from '../lib/inventory-geographies.ts';
process.env.DEALMACHINE_API_KEY='dm_sk_live_SYNTHETIC_NO_NETWORK';
let writes=[],requests=[],due=true,allowed=true,status=200,failSave=false;
const claim={state:'TX',page:2,token:'00000000-0000-4000-8000-000000000001'};
const db=async(path,method,body)=>{
 assert.equal(method,'POST');
 if(path==='rpc/icash_claim_inventory_geographies')return due?claim:null;
 if(path==='rpc/icash_take_dealmachine_request')return allowed;
 assert.equal(path,'rpc/icash_save_inventory_geographies');writes.push(body);
 if(body.p_result&&failSave)throw Error('Invalid geography');
 return body.p_result?1:0;
};
const request=async(url,options)=>{
 requests.push({url,options});assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
 const parsed=new URL(url);assert.equal(parsed.origin,'https://api.v2.dealmachine.com');assert.equal(parsed.pathname,'/v1/locations');assert.equal(parsed.searchParams.get('state'),'TX');assert.equal(parsed.searchParams.get('page'),'2');assert.equal(parsed.searchParams.get('per_page'),'100');
 return Response.json({data:[],pagination:{page:2,total_pages:2}},{status});
};
assert.deepEqual(await refreshInventoryGeographies(db,request),{status:'metadata_saved',zipCount:1});assert.equal(requests.length,1);assert.equal(writes.length,1);
due=false;assert.equal((await refreshInventoryGeographies(db,request)).status,'not_due');assert.equal(requests.length,1);
due=true;allowed=false;assert.equal((await refreshInventoryGeographies(db,request)).status,'rate_limited');assert.equal(requests.length,1);assert.equal(writes.at(-1).p_result,null);
allowed=true;status=429;assert.equal((await refreshInventoryGeographies(db,request)).status,'metadata_unavailable');assert.equal(requests.length,2);assert.equal(writes.at(-1).p_result,null);
status=200;failSave=true;assert.equal((await refreshInventoryGeographies(db,request)).status,'metadata_unavailable');assert.equal(writes.at(-1).p_result,null);
assert(requests.every(x=>!x.options.body),'No paid search payload can reach this worker');
console.log('Inventory geography: only bounded free metadata GETs, shared rate limit, claim-bound persistence and failure backoff passed.');
