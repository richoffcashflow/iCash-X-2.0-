import assert from 'node:assert/strict';
import {checkOwnerExportPreflight,preflightProvider,identityPreflightProvider,preflightBranch} from '../scripts/check-owner-export-preflight.mjs';
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:preflightBranch,VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),VERCEL_GIT_REPO_OWNER:'richoffcashflow',VERCEL_GIT_REPO_SLUG:'iCash-X-2.0-',SUPABASE_URL:'https://ofjbbpwugyjfxbhqfguh.supabase.co',SUPABASE_SECRET_KEY:'fixture',DEALMACHINE_API_KEY:'dm_sk_live_fixture'};
const now=Date.now(),reviewId='12345678-1234-1234-1234-123456789012';
function fixture(options={}){
 let result={status:'planned',reviewId,reviewedCommit:env.VERCEL_GIT_COMMIT_SHA,maxRequests:options.identity?6:5,maxCredits:0,sourceBatch:'6a1d8667-7079-467a-98c0-56af6ad6dbee',sourceReceiptHash:'22be42e2d819a07868216bddcbed8608',peopleIds:['per_1','per_2','per_3','per_4','per_5'],expiresAt:new Date(now+600000).toISOString(),...options.plan};
 const calls=[],metrics=[];
 const db=async(path,method='GET',data)=>{
  if(options.identity&&path.startsWith('icash_integration_checks?provider=eq.'+preflightProvider))return [{result:{status:'finished',peopleIds:result.peopleIds,summary:{reason:options.badPrior?'other':'PREFLIGHT_SCOPE_UNVERIFIED',cleanup:'deleted'}}}];
  if(path.startsWith('icash_integration_checks?provider=eq.'+(options.identity?identityPreflightProvider:preflightProvider))){
   if(method==='GET')return [{result}];
   assert.equal(method,'PATCH');
   if(options.lostClaim&&result.status==='planned')return [];
   if(path.includes('result->>status=eq.planned')&&result.status!=='planned')return [];
   if(options.lostSave&&calls.length===2)throw Error('private fixture detail');
   result=data.result;return [{result}];
  }
  if(path==='rpc/icash_take_dealmachine_request')return options.quota!==false;
  if(path==='rpc/icash_finish_dealmachine_request'){metrics.push(data);return true;}
  throw Error('Unexpected mutation '+path);
 };
 const transport=async(url,init)=>{
  const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):null;
  assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert(init.signal instanceof AbortSignal);
  calls.push({path,method:init.method,body});
  assert(!/export|\/people\/search$/.test(path),'No paid endpoint');
  if(options.timeoutAt===calls.length)throw Error('private provider error');
  const headers={'X-RateLimit-Remaining':'40','X-RateLimit-Day-Remaining':'1000',...options.headers};
  if(options.httpAt===calls.length)return Response.json({error:{message:'private'}},{status:500,headers});
  if(path==='/v1/people/ids'){
   assert.equal(body.enrich,false);assert.equal(body.include_properties,false);assert.deepEqual(body.ids,result.peopleIds);
   return Response.json({data:body.ids.map(dm_person_id=>({dm_person_id,found:true,...(options.contactData?{phones:[{number:'private'}]}:{})})),credits:{used:options.paidPreview?1:0,people:0,properties:0,deduplicated:0},totals:{submitted:5,found:5,not_found:0}},{headers});
  }
  if(path==='/v1/filters')return Response.json({data:['has_active_phone_number','has_non_dnc_phone'].map(filter_id=>({filter_id,type:'BOOLEAN',is_premium_filter:options.premium??false,allowed_operators:['is_boolean']})),pagination:{has_next_page:options.more??false}},{headers});
  if(path==='/v1/lists'){
   assert.deepEqual(body.record_ids,[1,2,3,4,5]);assert.equal(body.add_as_prospects,false);assert.equal(body.source_type,'people');
   return Response.json({data:{list_id:options.listId??123,name:options.wrongName?'foreign':body.name,source_type:'people',status:'completed',total_count:5}},{headers});
  }
  if(path==='/v1/people/search/count'){
   assert.deepEqual(body.include_lists,{people_list_ids:[options.listId??123]});
   const n=body.filters?(options.matched??0):(options.baseline??5);
   if(body.filters)assert.deepEqual(body.filters,[{filter_id:'has_active_phone_number',value:true},{filter_id:'has_non_dnc_phone',value:true}]);
   return Response.json({total_people:n,total_results:options.invalidCount?999:n,total_properties:5,...(options.charged?{credits:{used:1}}:{})},{headers});
  }
  assert.equal(path,'/v1/lists/'+(options.listId??123));
  if(init.method==='GET')return Response.json({data:{list_id:options.listId??123,name:'icash-owner-count-review-'+reviewId,source_type:'people',status:'completed',total_count:options.changedList?4:5}},{headers});
  assert.equal(init.method,'DELETE');
  return Response.json({data:{deleted:true}},{headers});
 };
 return {calls,metrics,state:()=>result,run:overrides=>checkOwnerExportPreflight({env:{...env,...overrides},db,transport,clock:()=>now,identityReview:options.identity??false,wait:async ms=>assert.equal(ms,30000)})};
}
const good=fixture();assert.deepEqual(await good.run(),{status:'no_qualifying_owners',providerRequests:5,paidRequests:0,baseline:5,matched:0,cleanup:'deleted'});assert.equal(good.metrics.length,5);assert.equal((await good.run()).status,'not_planned');assert.equal(good.calls.length,5);
for(const id of [321,'abc-123']){const f=fixture({listId:id,matched:2});assert.equal((await f.run()).status,'candidate_owners_present');assert.equal(f.calls.length,5);}
for(const options of [{more:true},{premium:true},{headers:{'X-RateLimit-Remaining':'0'}},{headers:{'X-RateLimit-Day-Remaining':'not-known'}}]){const f=fixture(options);assert.equal((await f.run()).status,'held');assert.equal(f.calls.length,1);}
for(const options of [{quota:false},{lostClaim:true},{plan:{reviewedCommit:'b'.repeat(40)}},{plan:{expiresAt:new Date(now-1).toISOString()}},{plan:{sourceReceiptHash:'changed'}}]){const f=fixture(options);await f.run();assert.equal(f.calls.length,0);}
for(const options of [{baseline:0},{baseline:4},{baseline:6},{invalidCount:true},{charged:true}]){const f=fixture(options);const r=await f.run();assert.equal(r.status,'held');assert.equal(r.cleanup,'deleted');assert.equal(f.calls.length,4);}
for(const options of [{timeoutAt:2},{httpAt:2},{wrongName:true},{lostSave:true}]){const f=fixture(options);await f.run().catch(()=>null);assert.equal(f.calls.length,2);await f.run().catch(()=>null);assert.equal(f.calls.length,2,'Unknown create never repeats or deletes a foreign list');}
const counted=fixture({httpAt:4});assert.equal((await counted.run()).cleanup,'deleted');assert.equal(counted.calls.length,5);
const cleanup=fixture({timeoutAt:5});assert.equal((await cleanup.run()).cleanup,'pending');assert.equal(cleanup.state().requests.length,5);await cleanup.run();assert.equal(cleanup.calls.length,5);
for(const overrides of [{VERCEL_ENV:'production'},{VERCEL_ENV:undefined},{VERCEL_GIT_REPO_OWNER:'foreign'},{VERCEL_GIT_COMMIT_REF:'main'}]){const f=fixture();await f.run(overrides);assert.equal(f.calls.length,0);}
const unsafe=fixture({plan:{peopleIds:['per_9007199254740993','per_2','per_3','per_4','per_5']}});await assert.rejects(unsafe.run(),/PREFLIGHT_ID_UNSUPPORTED/);assert.equal(unsafe.calls.length,0);
assert(!JSON.stringify(await fixture({timeoutAt:2}).run()).includes('private'));
const identity=fixture({identity:true});assert.deepEqual(await identity.run(),{status:'no_qualifying_owners',providerRequests:6,paidRequests:0,baseline:5,matched:0,cleanup:'deleted',found:5});await identity.run();assert.equal(identity.calls.length,6);
const delayed=fixture({identity:true,baseline:0});assert.equal((await delayed.run()).reason,'PREFLIGHT_SCOPE_UNVERIFIED');assert.equal(delayed.calls.length,5);
for(const options of [{paidPreview:true},{contactData:true}]){const f=fixture({identity:true,...options});assert.equal((await f.run()).reason,'PREFLIGHT_PREVIEW_INVALID');assert.equal(f.calls.length,1);}
const prior=fixture({identity:true,badPrior:true});assert.equal((await prior.run()).status,'prior_review_invalid');assert.equal(prior.calls.length,0);
const changed=fixture({identity:true,changedList:true});assert.equal((await changed.run()).reason,'PREFLIGHT_LIST_READBACK');assert.equal(changed.calls.length,4);
console.log('PASS free exact-owner count review: five-request bound, atomic one-use plan, quota, zero and positive counts, scope validation, cleanup, timeouts, no paid request or replay.');
