import assert from 'node:assert/strict';
import {preflightOwnerExport,cleanupOwnerPreflight} from '../lib/owner-export-preflight.ts';
const account='fixture-account',ids=['per_3','per_4'],base={id:'fixture-id',lease:'fixture-lease',listId:'fixture-list',name:'icash-owner-preflight-fixture-id',ids,mobileOnly:false};
function fixture(options={}){
 const calls=[],receipts=[],metrics=[];let status=options.status??'create',saved={},lost=false,cleanupClaimed=false;
 const db=async(path,method,p)=>{
  assert.equal(method,'POST');
  if(path==='rpc/icash_claim_owner_preflight')return {...base,status,mobileOnly:options.mobile??false,nextStep:options.nextStep};
  if(path==='rpc/icash_take_dealmachine_request')return options.quota!==false;
  if(path==='rpc/icash_defer_owner_preflight_quota'){assert.match(p.p_request,/^[0-9a-f-]{36}$/);assert.equal(p.p_lease,base.lease);status=options.refuseDeferral?'held':'pending';return !options.refuseDeferral;}
  if(path==='rpc/icash_finish_dealmachine_request'){metrics.push(p);return true;}
  if(path==='rpc/icash_record_owner_preflight'){
   receipts.push(p);assert.equal(p.p_id,base.id);assert.equal(p.p_lease,base.lease);
   if(!saved[p.p_step])saved[p.p_step]=p.p_receipt;
   else assert.deepEqual(p.p_receipt,saved[p.p_step],'DB acknowledgment retry must preserve the original bytes');
   const good=p.p_receipt.httpStatus===200;
   status=good?(p.p_step==='create'?'pending':p.p_step==='baseline'?'checking':options.empty?'empty':'ready'):'held';
   if(options.lostAck&&!lost){lost=true;throw Error('lost database acknowledgment');}
   return status;
  }
  if(path==='rpc/icash_claim_owner_preflight_cleanup'){
   if(options.noCleanup||cleanupClaimed||status==='pending')return null;
   cleanupClaimed=true;return {id:base.id,token:'cleanup-token',listId:base.listId};
  }
  if(path==='rpc/icash_record_owner_preflight_cleanup'){receipts.push(p);return true;}
  throw Error('Unexpected write '+path);
 };
 const transport=async(url,o)=>{
  const path=new URL(url).pathname,b=o.body?JSON.parse(o.body):null;calls.push({path,method:o.method,body:b});
  assert.equal(o.redirect,'error');assert.equal(o.cache,'no-store');assert(o.signal instanceof AbortSignal);assert(!path.includes('export'));assert(!path.includes('/people/ids'));
  if(options.timeout)throw Error('private provider detail');
  if(options.big)return new Response('x'.repeat(1048577));
  if(options.httpError)return Response.json({error:{message:'private provider detail'}},{status:500});
  if(path==='/v1/lists'){assert.deepEqual(b,{name:base.name,source_type:'people',record_ids:[3,4],add_as_prospects:false});return Response.json({data:{list_id:base.listId,name:base.name,source_type:'people',status:'completed',total_count:2}});}
  if(path==='/v1/people/search/count'){
   assert.deepEqual(b.include_lists,{people_list_ids:[base.listId]});
   if(b.filters)assert.deepEqual(b.filters.map(f=>f.filter_id),['has_active_phone_number','has_non_dnc_phone',...(options.mobile?['has_wireless_phone']:[])]);
   return Response.json({total_people:b.filters&&options.empty?0:2,total_results:b.filters&&options.empty?0:2,total_properties:2});
  }
  assert.equal(path,'/v1/lists/'+base.listId);assert.equal(o.method,'DELETE');return Response.json({data:{deleted:true}});
 };
 return {calls,receipts,metrics,run:()=>preflightOwnerExport(db,account,[],{},transport),cleanup:()=>cleanupOwnerPreflight(db,transport,base.id)};
}
const key=process.env.DEALMACHINE_API_KEY;process.env.DEALMACHINE_API_KEY='dm_sk_live_fixture';
try{
 const create=fixture();assert.equal((await create.run()).status,'pending');assert.equal(create.calls.length,1);assert.equal((await create.run()).status,'pending');assert.equal(create.calls.length,1,'Waiting on indexing does not create another list');
 for(const status of ['disabled','ready','empty','pending','quota_wait','held']){const f=fixture({status});assert.equal((await f.run()).status,status);assert.equal(f.calls.length,0);}
 for(const options of [{},{empty:true},{mobile:true}]){const f=fixture({status:'check',...options});assert.equal((await f.run()).status,options.empty?'empty':'ready');assert.equal(f.calls.length,3);assert.equal(f.receipts.length,3);assert.equal(f.metrics.length,3);}
 const remaining=fixture({status:'check',nextStep:'eligible'});assert.equal((await remaining.run()).status,'ready');assert.equal(remaining.calls.filter(x=>x.path==='/v1/people/search/count').length,1,'Locally denied eligible step reuses the original baseline');
 const lost=fixture({lostAck:true});assert.equal((await lost.run()).status,'pending');assert.equal(lost.calls.length,1);assert.equal(lost.receipts.length,2);
 for(const options of [{timeout:true},{big:true},{httpError:true}]){const f=fixture({...options,noCleanup:true});assert.equal((await f.run()).status,'held');assert.equal(f.calls.length,1);assert.equal((await f.run()).status,'held');assert.equal(f.calls.length,1);assert(!JSON.stringify(await f.run()).includes('private'));}
 const quota=fixture({quota:false,noCleanup:true});assert.equal((await quota.run()).status,'pending');assert.equal(quota.calls.length,0);assert.equal(quota.receipts.length,0,'A proved local refusal is not a provider receipt');
 const denied=fixture({quota:false,noCleanup:true,refuseDeferral:true});assert.equal((await denied.run()).status,'held');assert.equal(denied.calls.length,0);
 const cleanup=fixture({status:'held'});await cleanup.cleanup();await cleanup.cleanup();assert.equal(cleanup.calls.length,1);
 console.log('PASS owner preflight transport: separate creation/count capabilities, original receipt-before-interpretation, lost-save acknowledgment, free bounded cleanup, active/mobile filters, no export or repeat after unknown outcome.');
}finally{if(key===undefined)delete process.env.DEALMACHINE_API_KEY;else process.env.DEALMACHINE_API_KEY=key;}
