import assert from 'node:assert/strict';
import {refreshInventoryGeographies,refreshInventoryGeographyBatch} from '../lib/inventory-geographies.ts';
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
// One rejected lease must not cancel other states, and the batch stays at four
// requests regardless of how much nationwide inventory remains.
let batchClaims=0,batchRequests=0,batchSaved=0,inFlight=0,peak=0;const finishes=[];
const batchDb=async(path,_method,body)=>{
 if(path==='rpc/icash_claim_inventory_geographies'){
  const n=batchClaims++;if(n===1)throw Error('one lease failed');
  return {...claim,state:['CA','FL','NY','WA'][n]};
 }
 if(path==='rpc/icash_take_dealmachine_request')return true;
 assert.equal(path,'rpc/icash_save_inventory_geographies');assert(body.p_result);batchSaved++;return 100;
};
const batchFetch=async(url)=>{
 assert.equal(new URL(url).pathname,'/v1/locations');batchRequests++;inFlight++;peak=Math.max(peak,inFlight);
 await new Promise(resolve=>finishes.push(resolve));inFlight--;
 return Response.json({data:[],pagination:{page:2,total_pages:2}});
};
const batch=refreshInventoryGeographyBatch(batchDb,batchFetch);
await new Promise(resolve=>setImmediate(resolve));assert.equal(batchClaims,4);assert.equal(peak,3);
finishes.forEach(resolve=>resolve());const batched=await batch;
assert.equal(batchRequests,3);assert.equal(batchSaved,3);assert.equal(batched.pages.length,4);
assert.equal(batched.pages.filter(p=>p.status==='metadata_unavailable').length,1);
console.log('Inventory geography: only bounded free metadata GETs, shared rate limit, claim-bound persistence and failure backoff passed.');
