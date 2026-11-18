import assert from 'node:assert/strict';
import {recoverOwnerExportCapacity} from '../lib/owner-export-capacity-recovery.ts';
import {transportCleanupFixture,settleBeforeCleanup} from './helpers/transport-cleanup-fixture.mjs';
const env={VERCEL_ENV:'production',DEALMACHINE_API_KEY:'dm_sk_live_fixture'};
function fixture({claim=true,result='capacity_verified',response,timeout=false,lostSave=false}={}){
 let claimed=false;const requests=[],saved=[],metrics=[];
 const db=async(path,method,body)=>{
  assert.equal(method,'POST');
  if(path==='rpc/icash_claim_export_capacity_review'){if(!claim||claimed)return null;claimed=true;return {reviewId:'review-fixture',requestId:'request-fixture'};}
  if(path==='rpc/icash_record_export_capacity_review'){saved.push(body);if(lostSave)throw Error('lost acknowledgment');return result;}
  if(path==='rpc/icash_finish_dealmachine_request'){metrics.push(body);return true;}
  throw Error('Unexpected database mutation '+path);
 };
 const transport=async(url,options)=>{
  requests.push(url);assert.equal(url,'https://api.v2.dealmachine.com/v1/exports?limit=100&offset=0');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert(options.signal instanceof AbortSignal);
  if(timeout)throw Error('timeout');
  return response??Response.json({data:[{export_id:'private-export',status:'failed',download_urls:[{url:'https://storage.googleapis.com/private?signature=secret'}]}]}, {headers:{'X-RateLimit-Remaining':'49','X-RateLimit-Day-Remaining':'400'}});
 };
 return {requests,saved,metrics,run:(overrides={})=>recoverOwnerExportCapacity(db,transport,{...env,...overrides})};
}
const good=fixture();assert.deepEqual(await good.run(),{status:'capacity_verified'});assert.equal(good.requests.length,1);assert.equal(good.saved.length,1);
assert.match(good.saved[0].p_receipt.rawText,/signature=secret/,'Raw evidence is privately retained');
assert.deepEqual(good.saved[0].p_receipt.headers,{minuteRemaining:49,dayRemaining:400});
assert.doesNotMatch(JSON.stringify(await good.run()),/private|secret|fixture/);assert.equal(good.requests.length,1,'No repeat after a consumed claim');
const quota=fixture({claim:false});assert.equal((await quota.run()).status,'capacity_review_idle');assert.equal(quota.requests.length,0);
for(const overrides of [{VERCEL_ENV:'preview'},{VERCEL_ENV:undefined},{DEALMACHINE_API_KEY:''}]){const f=fixture();assert.equal((await f.run(overrides)).status,'not_requested');assert.equal(f.requests.length,0);}
for(const opts of [{timeout:true},{response:new Response('x'.repeat(1048577))},{response:Response.json({error:{message:'private'}},{status:500}),result:'held'},{response:new Response('not json'),result:'held'},{lostSave:true}]){
 const f=fixture(opts);assert.equal((await f.run()).status,opts.lostSave?'capacity_recovery_unavailable':'capacity_review_held');assert.equal(f.requests.length,1);assert.equal(f.saved.length,1);await f.run();assert.equal(f.requests.length,1);
}
for(const bodyKind of ['complete','oversized'])for(const mode of ['pending','rejected','synchronous']){
 const rawText=' {"data":[{"export_id":"original","status":"failed"}]}\n';
 const stream=transportCleanupFixture({mode,body:rawText,...(bodyKind==='oversized'?{size:1048577}:{}),headers:{'X-RateLimit-Remaining':'49','X-RateLimit-Day-Remaining':'400'}});
 const f=fixture({response:stream.response,result:bodyKind==='complete'?'capacity_verified':'held'});
 const outcome=await settleBeforeCleanup(f.run(),stream);assert.equal(outcome.error,undefined);
 assert.equal(outcome.value.status,bodyKind==='complete'?'capacity_verified':'capacity_review_held');
 assert.equal(f.requests.length,1);assert.equal(f.saved.length,1);assert.equal(f.metrics.length,1);
 assert.deepEqual(f.saved[0].p_receipt,bodyKind==='complete'?{httpStatus:200,raw:JSON.parse(rawText),rawText,headers:{minuteRemaining:49,dayRemaining:400}}:{httpStatus:null,raw:null,rawText:'',outcome:'read_unavailable'});
 if(bodyKind==='oversized')assert.deepEqual(f.metrics[0].p_result,{outcome:'unknown'});
 await f.run();assert.equal(f.requests.length,1,'Consumed free review never repeats the provider request');
}
console.log('PASS capacity recovery: one admitted free GET, production-only, no export/download, bounded private receipt, quota wait and no replay after uncertainty.');
