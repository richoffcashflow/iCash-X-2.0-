import assert from 'node:assert/strict';
import {enrichActiveOwners,activeOwnerExportRequest} from '../lib/owner-active-export.ts';
import {OwnerPreviewRateLimitError} from '../lib/owner-enrichment-deferral.ts';
import {OwnerExportPreflightPendingError,OwnerCheckingCleanupPendingError} from '../lib/owner-export-preflight.ts';

const account='00000000-0000-4000-8000-000000000001',primary='00000000-0000-4000-8000-000000000002';
const preflight='00000000-0000-4000-8000-000000000003',token='00000000-0000-4000-8000-000000000004';
const child='00000000-0000-4000-8000-000000000005';
const snapshot={propertyId:'prop_1',propertyType:'house',fetchedAt:new Date().toISOString(),sellerCostReserveCents:100000,
 raw:{data:{dm_property_id:'prop_1',full_address:'Synthetic fixture',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}}};
const candidate={screeningId:primary,snapshot},items=[{...candidate,ids:['per_1']}],request=activeOwnerExportRequest(['per_1'],false,true);
const config={contact_rate_id:'rate',contact_credit_cap:25,property_credit_micros:10000,data_rights_until:'2099-01-01',research_version:2};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const terminal={httpStatus:200,raw:{data:{deleted:true}},rawText:'{"data":{"deleted":true}}'};

function fixture(options={}){
 const events=[],calls=[],metrics=[],receipts=[];let admissions=0,claims=0,deleted=false,lostReceipt=false,admittedRequest;
 const db=async(path,method,p)=>{
  if(path==='rpc/icash_owner_active_export_capacity')return 'ready';
  if(path==='rpc/icash_owner_batch_candidates')return [candidate];
  if(path==='rpc/icash_owner_targeting_pools')return {[primary]:'active'};
  if(path==='rpc/icash_continued_owner_preflight')return options.source??{status:'bound',preflightId:preflight,items,request,cleanupRequired:true};
  if(path==='rpc/icash_admit_expired_checking_cleanup'){
   admissions++;assert.equal(admissions,1,'Never repeat an uncertain cleanup admission');
   assert.equal(p.p_account,account);assert.equal(p.p_id,preflight);assert.match(p.p_request,uuid);admittedRequest=p.p_request;events.push('admitted');
   if(options.lostAdmission)throw Error('LOST_ADMISSION_ACK');
   if(options.admission)return {status:options.admission};
   return {...{status:'admitted',id:preflight,accountId:account,requestId:p.p_request,token,listId:'original-list'},...options.badAck};
  }
  if(path==='rpc/icash_record_owner_preflight_cleanup'){
   assert.equal(p.p_id,preflight);assert.equal(p.p_token,token);receipts.push(structuredClone(p.p_receipt));events.push('saved-original-cleanup');
   if(options.unavailableReceipt)throw Error('UNAVAILABLE_RECEIPT_SAVE');
   if(options.falseReceipt)return false;
   if(p.p_receipt.httpStatus===200&&p.p_receipt.rawText===terminal.rawText)deleted=true;
   if(options.lostReceipt&&!lostReceipt){lostReceipt=true;throw Error('LOST_RECEIPT_ACK');}
   return deleted;
  }
  if(path==='rpc/icash_claim_owner_preflight'){
   claims++;assert.deepEqual(p.p_items,items);assert.deepEqual(p.p_request,request);events.push('ordinary-claim');
   if(options.unavailableClaim)throw Error('UNAVAILABLE_SOURCE_CLAIM');
   if(options.ordinaryStatus)return {status:options.ordinaryStatus};
   if(!deleted)return {status:'held'};
   return {status:'create',id:child,lease:'fresh-lease',name:'icash-owner-preflight-'+child,ids:['per_1'],mobileOnly:false};
  }
  if(path==='rpc/icash_take_dealmachine_request'){
   assert(deleted,'Only canonical deletion can reach ordinary new-generation admission');
   assert.equal(p.p_operation,'owner-preflight:'+child+':create');events.push('fresh-list-admission');return true;
  }
  if(path==='rpc/icash_record_owner_preflight'){
   assert.equal(p.p_id,child);assert.equal(p.p_lease,'fresh-lease');assert.equal(p.p_step,'create');events.push('saved-new-list');return options.creationHeld?'held':'pending';
  }
  if(path==='rpc/icash_claim_owner_preflight_cleanup')return null;
  if(path==='rpc/icash_finish_dealmachine_request'){metrics.push(p);return true;}
  throw Error('Unexpected DB '+path);
 };
 const transport=async(url,opts)=>{
  calls.push([url,opts.method]);assert.equal(opts.redirect,'error');assert.equal(opts.cache,'no-store');
  if(opts.method==='DELETE'){
   assert.equal(url,'https://api.v2.dealmachine.com/v1/lists/original-list');events.push('delete-original');
   if(options.timeout)throw Error('UNKNOWN_DELETE');
   if(options.unknownResponse)return Response.json({accepted:true});
   return new Response(terminal.rawText,{status:200});
  }
  assert(deleted,'No new generation before confirmed original cleanup');assert.equal(opts.method,'POST');
  assert.equal(url,'https://api.v2.dealmachine.com/v1/lists');
  assert.deepEqual(JSON.parse(opts.body),{name:'icash-owner-preflight-'+child,source_type:'people',record_ids:[1],add_as_prospects:false});
  events.push('create-new-list');return Response.json({data:{list_id:'new-list'}});
 };
 return {run:()=>enrichActiveOwners(db,account,candidate,config,250000,transport),events,calls,metrics,receipts,
  admissions:()=>admissions,claims:()=>claims,admittedRequest:()=>admittedRequest};
}

const originalKey=process.env.DEALMACHINE_API_KEY;process.env.DEALMACHINE_API_KEY='dm_sk_live_fixture';
try{
 const ok=fixture();await assert.rejects(ok.run(),OwnerExportPreflightPendingError);
 assert.deepEqual(ok.calls.map(x=>x[1]),['DELETE','POST']);assert.deepEqual(ok.receipts,[terminal]);
 assert(ok.events.indexOf('saved-original-cleanup')<ok.events.indexOf('create-new-list'));
 assert.equal(ok.metrics[0].p_request,ok.admittedRequest(),'Cleanup completion retains the original admitted request ID');
 assert.equal(ok.metrics.length,2,'Cleanup and normal fresh list each retain their own request metrics');

 for(const [options,code] of [[{timeout:true},'OWNER_CHECKING_CLEANUP_UNCONFIRMED'],[{unknownResponse:true},'OWNER_CHECKING_CLEANUP_UNCONFIRMED'],[{falseReceipt:true},'OWNER_CHECKING_CLEANUP_RECEIPT_UNCONFIRMED'],[{unavailableReceipt:true},'OWNER_CHECKING_CLEANUP_RECEIPT_UNAVAILABLE'],[{unavailableClaim:true},'OWNER_CHECKING_CLEANUP_CLAIM_UNAVAILABLE']]){
  const held=fixture(options);await assert.rejects(held.run(),error=>error.constructor===Error&&error.message===code);
  assert.deepEqual(held.calls.map(x=>x[1]),['DELETE']);assert.equal(held.admissions(),1);assert.equal(held.claims(),1);
  assert.equal(held.metrics[0].p_request,held.admittedRequest());
  assert(!held.events.includes('fresh-list-admission'),'Unknown cleanup never grants preview, count, generation or paid work');
 }
 const saved=fixture({lostReceipt:true});await assert.rejects(saved.run(),OwnerExportPreflightPendingError);
 assert.deepEqual(saved.calls.map(x=>x[1]),['DELETE','POST'],'Lost save acknowledgment repeats only the original receipt save');
 assert.deepEqual(saved.receipts,[terminal,terminal]);

 for(const [options,code] of [[{lostAdmission:true},'OWNER_CHECKING_CLEANUP_ADMISSION_UNAVAILABLE'],...['held','disabled'].map(admission=>[{admission},'OWNER_CHECKING_CLEANUP_HELD']),[{admission:'unknown'},'OWNER_CHECKING_CLEANUP_ADMISSION_INVALID'],
  ...[{id:child},{accountId:child},{requestId:child},{token:'not-a-token'},{listId:'../other-list'}].map(badAck=>[{badAck},'OWNER_CHECKING_CLEANUP_ADMISSION_INVALID'])]){
  const held=fixture(options);await assert.rejects(held.run(),error=>error.constructor===Error&&error.message===code);
  assert.equal(held.admissions(),1);assert.equal(held.claims(),0);assert.equal(held.calls.length,0);
  assert.equal(held.metrics.length,0,'No provider request is fabricated after failed or ambiguous admission');
 }
 const quota=fixture({admission:'quota_wait'});await assert.rejects(quota.run(),error=>error.constructor===OwnerPreviewRateLimitError);assert.equal(quota.calls.length,0);assert.equal(quota.claims(),0);
 for(const admission of ['pending','busy']){
  const pending=fixture({admission});await assert.rejects(pending.run(),error=>error.constructor===OwnerCheckingCleanupPendingError&&error.preflightId===preflight&&error.message==='OWNER_CHECKING_CLEANUP_PENDING');
  assert.equal(pending.calls.length,0);assert.equal(pending.claims(),0);
 }
 for(const source of [
  {status:'bound',items,request,cleanupRequired:true},
  {status:'bound',preflightId:'bad-id',items,request,cleanupRequired:true},
  {status:'bound',preflightId:preflight,items,request,cleanupRequired:'true'},
  {status:'none',preflightId:preflight,cleanupRequired:true},
 ]){
  const malformed=fixture({source});await assert.rejects(malformed.run(),/OWNER_CONTINUATION_SOURCE_UNAVAILABLE/);
  assert.equal(malformed.calls.length,0);assert.equal(malformed.admissions(),0);assert.equal(malformed.claims(),0);
 }
 for(const cleanupRequired of [undefined,false]){
  const waiting=fixture({source:{status:'bound',preflightId:preflight,items,request,cleanupRequired},ordinaryStatus:'pending'});
  await assert.rejects(waiting.run(),OwnerExportPreflightPendingError);
  assert.equal(waiting.admissions(),0);assert.equal(waiting.claims(),1);assert.equal(waiting.calls.length,0,'Existing waiting-family continuation is unchanged');
 }
 const disabled=fixture({ordinaryStatus:'disabled'});await assert.rejects(disabled.run(),error=>error.constructor===Error&&error.message==='OWNER_CHECKING_CONTINUATION_HELD');
 assert.deepEqual(disabled.calls.map(x=>x[1]),['DELETE'],'Disabled ordinary claim cannot fall through to fresh owner preview');
 const freshFailure=fixture({creationHeld:true});await assert.rejects(freshFailure.run(),error=>error.constructor===Error&&error.message==='OWNER_CHECKING_CONTINUATION_HELD');
 assert.deepEqual(freshFailure.calls.map(x=>x[1]),['DELETE','POST'],'A fresh-generation failure stays separate from confirmed original cleanup and never grants a property preview');
 console.log('PASS expired checking transport: exact atomic cleanup admission, original receipt and source binding, canonical-delete-before-renewal, no preview/count/paid fallback, uncertain acknowledgment, quota, malformed source and waiting-family compatibility.');
}finally{if(originalKey===undefined)delete process.env.DEALMACHINE_API_KEY;else process.env.DEALMACHINE_API_KEY=originalKey;}
