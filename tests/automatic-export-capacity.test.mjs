import assert from 'node:assert/strict';
import {recoverAutomaticOwnerExportCapacity} from '../lib/automatic-export-capacity.ts';
const env={VERCEL_ENV:'production',DEALMACHINE_API_KEY:'dm_sk_live_fixture',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40)};
function fixture({idle=false,quotaProbe,timeoutProbe,badProbe,largeProbe,lostSave=false,lostFinal=false,saveFails=false}={}){
 let claimed=false,finals=0;const calls=[],saved=new Map(),writes=[],metrics=[];
 const db=async(path,method,body)=>{
  assert.equal(method,'POST');
  if(path==='rpc/icash_claim_automatic_export_capacity'){assert.equal(body.p_release,env.VERCEL_GIT_COMMIT_SHA);if(idle||claimed)return null;claimed=true;return {reviewId:'review',requestId:'inventory'};}
  if(path==='rpc/icash_claim_export_capacity_probe')return quotaProbe===body.p_probe?null:body.p_probe;
  if(path==='rpc/icash_record_export_capacity_probe'){
   writes.push(body);if(saveFails)throw Error('database unavailable');
   if(saved.has(body.p_probe))assert.deepEqual(saved.get(body.p_probe),body.p_receipt);else{saved.set(body.p_probe,body.p_receipt);if(lostSave)throw Error('committed; response lost');}return true;
  }
  if(path==='rpc/icash_finish_dealmachine_request'){metrics.push(body);return true;}
  if(path==='rpc/icash_finish_automatic_export_capacity'){if(lostFinal&&finals++===0)throw Error('committed; response lost');return saved.size===3&&[...saved.values()].every(x=>x.httpStatus===200)?'capacity_verified':'capacity_review_held';}
  throw Error('Unexpected RPC '+path);
 };
 const transport=async(url,options)=>{
  const u=new URL(url),probe=u.searchParams.get('status')??'inventory';calls.push(probe);
  assert.equal(u.origin,'https://api.v2.dealmachine.com');assert.equal(u.pathname,'/v1/exports');assert.equal(u.searchParams.get('limit'),'100');assert.equal(u.searchParams.get('offset'),'0');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert(options.signal instanceof AbortSignal);
  if(timeoutProbe===probe)throw Error('network unavailable');
  if(largeProbe===probe)return new Response('x'.repeat(1048577));
  if(badProbe===probe)return new Response('invalid',{status:500});
  return Response.json({data:[],pagination:{limit:100,offset:0,total:0,has_more:false}},{headers:{'X-RateLimit-Remaining':'49','X-RateLimit-Day-Remaining':'300'}});
 };
 return {calls,saved,writes,metrics,run:overrides=>recoverAutomaticOwnerExportCapacity(db,transport,{...env,...overrides})};
}
for(const overrides of [{VERCEL_ENV:'preview'},{DEALMACHINE_API_KEY:''},{VERCEL_GIT_COMMIT_SHA:''},{VERCEL_GIT_COMMIT_SHA:undefined,RAILWAY_GIT_COMMIT_SHA:undefined}]){const f=fixture();assert.equal(await f.run(overrides),null);assert.equal(f.calls.length,0);}
const idle=fixture({idle:true});assert.equal(await idle.run(),null);assert.equal(idle.calls.length,0);
const good=fixture({lostSave:true,lostFinal:true});assert.deepEqual(await good.run(),{status:'capacity_verified'});assert.deepEqual(good.calls,['inventory','pending','processing']);assert.equal(good.writes.length,6);assert.equal(good.metrics.length,3);assert.equal(await good.run(),null);assert.equal(good.calls.length,3,'Acknowledgment loss never repeats a provider request');
for(const opts of [{quotaProbe:'pending'},{quotaProbe:'processing'},{timeoutProbe:'inventory'},{timeoutProbe:'pending'},{timeoutProbe:'processing'},{badProbe:'inventory'},{largeProbe:'inventory'},{saveFails:true}]){const f=fixture(opts);assert.deepEqual(await f.run(),{status:'capacity_review_held'});assert(f.calls.length<=3);assert.equal(new Set(f.calls).size,f.calls.length);const count=f.calls.length;await f.run();assert.equal(f.calls.length,count);}
console.log('PASS automatic capacity transport: only three separately admitted GETs, bounded responses/deadlines, quota stops, immutable receipt recovery and no export/download/send.');
