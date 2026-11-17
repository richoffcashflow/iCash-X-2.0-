import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {buyerCallPackageSource} from '../lib/buyer-call-package-source.ts';
import {processBuyerCallPackages} from '../lib/buyer-call-package-service.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {source,started,ended,id,setup,apply,enable,api} from './helpers/buyer-call-package-fixture.mjs';
globalThis.fetch=async()=>{throw Error('Network disabled');};
const row={id:id(7),account_id:id(1),conversation_id:'conv_fixture',call_started_at:started,call_ended_at:ended,max_total_seconds:600};
const conversation={conversation_id:'conv_fixture',status:'done',metadata:{start_time_unix_secs:Date.parse(started)/1000},transcript:source.turns.map(({seconds,...t})=>({...t,time_in_call_secs:seconds}))};
assert.deepEqual(buyerCallPackageSource(row,conversation),source);
for(const mutate of [c=>c.status='processing',c=>c.conversation_id='conv_other',c=>delete c.metadata.start_time_unix_secs,c=>c.transcript[1].message=null,c=>c.transcript[1].message='x'.repeat(12001),c=>delete c.transcript[1].time_in_call_secs,c=>c.transcript[1].time_in_call_secs=Infinity,c=>c.transcript[1].time_in_call_secs=121,c=>c.transcript[1].time_in_call_secs=46,c=>c.transcript=Array(1001).fill(c.transcript[0])]){
 const copy=structuredClone(conversation);mutate(copy);assert.equal(buyerCallPackageSource(row,copy),null);
}
const long=structuredClone(conversation);long.transcript=Array.from({length:120},(_,n)=>({role:n%2?'user':'agent',message:n===61?"Don't send anything.":'Thanks',time_in_call_secs:n}));
assert.equal(buyerCallPackageSource(row,long).turns[61].message,"Don't send anything.");
const tool=structuredClone(conversation);tool.transcript[0].message=null;assert.equal(buyerCallPackageSource(row,tool).turns[0].message,null);
// Terminal receipt ingestion may be delayed; it cannot extend the canonical
// original call's maximum speech window or shift the conversation start later.
const lateRow={...row,call_ended_at:new Date(Date.parse(started)+900000).toISOString()};
for(const shift of [700,580]){const late=structuredClone(conversation);late.metadata.start_time_unix_secs+=shift;assert.equal(buyerCallPackageSource(lateRow,late),null);}
const live={VERCEL_ENV:'production',ICASH_SMS_WORK_READY:'true'};
assert.equal((await processBuyerCallPackages({db:()=>assert.fail('Preview cannot claim'),dispatch:()=>assert.fail()},{})).status,'buyer_call_packages_disabled');

for(const first of ['message_held','messaging_configuration_required','message_delivery_needs_review','throw']){
 let calls=0;const dispatched=[];
 const result=await processBuyerCallPackages({db:async path=>{assert.equal(path,'rpc/icash_claim_buyer_call_package');calls++;return {accountId:id(calls),messageId:id(calls+10)};},dispatch:async(a,m)=>{dispatched.push([a,m]);if(dispatched.length===1){if(first==='throw')throw Error('Fixture unknown');return {status:first};}return {status:'message_accepted'};}},live);
 assert.equal(calls,2);assert.equal(dispatched.length,2);assert.equal(result.accepted,1);assert.equal(result.errors,['throw','message_delivery_needs_review','messaging_configuration_required'].includes(first)?1:0);
}
let sends=0;assert.equal((await processBuyerCallPackages({db:async()=>({accountId:id(1),messageId:id(2)}),dispatch:async()=>{sends++;return {status:'message_accepted'};}},live)).errors,1);assert.equal(sends,1);

// Actual reconciliation body saves a complete source; a failed optional write
// does not prevent original settlement or a separate session's reconciliation.
for(const outcome of ['recorded','source_conflict','write_failed']){
 const failed=outcome==='write_failed';
 const events=[];const current={...row,provider_account_sid:'ACfixture',call_sid:'CAfixture',state:'deleted',recording_sid:null,start_claimed_at:null,register_claimed_at:started,end_requested_at:ended,operation_key:'fixture-original',row_version:1,reconcile_lease_token:'fixture-lease'};
 const rpc=async(name,args)=>{
  if(name==='icash_claim_recorded_reception_work')return args.p_kind==='reconcile'?[current]:[];
  if(name==='icash_save_buyer_inbound_history')return outcome!=='source_conflict';
  if(name==='icash_save_seller_memory_inbound_history')return true;
  if(name==='icash_save_seller_inbound_history')return false;
  if(name==='icash_capture_buyer_call_package'){events.push('capture');assert.deepEqual(args.p_source,source);if(failed)throw Error('Fixture source write lost');return outcome;}
  if(name==='icash_finish_recorded_reception_work'){events.push(args.p_outcome);return current;}
  throw Error('Unexpected boundary '+name);
 };
 const {maintainRecordedReception}=await loadService('lib/recorded-reception-maintenance.ts',{
  recordingAuthorized:()=>true,object:x=>x&&typeof x==='object'?x:{},RecordingProviderError:class extends Error{},finalRecordingPayload:()=>assert.fail(),
  incomingCallIdentityMatches:()=>true,receptionRecordingMatches:()=>assert.fail(),receptionConversationMatches:()=>true,
  getRecordedReception:async()=>current,transitionRecordedReception:()=>assert.fail(),endRecordedReception:()=>assert.fail(),boundEndReceipt:()=>assert.fail(),bindRecordedReceptionCallStart:async()=>current,
  settleRecordedReception:async()=>{events.push('settle');return {settled:true};},sellerMemoryInboundTurns:()=>[],buyerCallPackageSource,
 });
 const result=await maintainRecordedReception(rpc,{getCall:async()=>({status:'completed'}),conversation:async()=>conversation},{TWILIO_ACCOUNT_SID:'ACfixture'});
 assert.deepEqual(events,['capture','settle',failed?'retry':'checked']);assert.equal(result.settled,1);assert.equal(result.reconciled,failed?0:1);assert.equal(result.held,outcome==='recorded'?0:1);
}
// Execute the actual maintenance hook against an existing SQL source/action.
// An explicitly changed source cannot disappear in the display-only filter.
const pg=await PGlite.create();
try{
 await setup(pg);await apply(pg);await enable(pg);const db=api(pg);
 for(const [name,transcript,contradiction] of [
  ['empty array',[],true],
  ['only oversized withdrawal',[{role:'user',message:'Do not send anything. '+'This request is withdrawn. '.repeat(500),time_in_call_secs:50}],true],
  ['only invalid user speech',[{role:'user',message:null,time_in_call_secs:50}],true],
  ['explicit malformed object',{invalid:'source'},true],
  ['omitted retained transcript',undefined,false],
  ['null retained transcript',null,false],
 ]){
  await pg.exec('begin');
  try{
   assert.equal(await db.capture(),'recorded');const original=await db.one('select source,source_hash from icash_buyer_call_package_private.sources');
   const pending=await db.claim();assert(pending);await pg.exec('update fixture_gates set admit=true');
   const events=[],current={...row,provider_account_sid:'ACfixture',call_sid:'CAfixture',state:'deleted',recording_sid:null,start_claimed_at:null,register_claimed_at:started,end_requested_at:ended,operation_key:'fixture-original',row_version:1,reconcile_lease_token:'fixture-lease'};
   const rpc=async(name,args)=>{
    if(name==='icash_claim_recorded_reception_work')return args.p_kind==='reconcile'?[current]:[];
    if(name==='icash_save_seller_inbound_history')return false;
    if(name==='icash_save_seller_memory_inbound_history')return true;
    if(name==='icash_save_buyer_inbound_history')return (await db.one('select icash_save_buyer_inbound_history($1,$2,$3) value',[args.p_session,args.p_conversation,JSON.stringify(args.p_transcript)])).value;
    if(name==='icash_capture_buyer_call_package'){events.push('capture');return db.capture(args.p_source,args.p_session,args.p_conversation);}
    if(name==='icash_finish_recorded_reception_work'){events.push(args.p_outcome);return current;}
    throw Error('Unexpected boundary '+name);
   };
   const {maintainRecordedReception}=await loadService('lib/recorded-reception-maintenance.ts',{
    recordingAuthorized:()=>true,object:x=>x&&typeof x==='object'?x:{},RecordingProviderError:class extends Error{},finalRecordingPayload:()=>assert.fail(),
    incomingCallIdentityMatches:()=>true,receptionRecordingMatches:()=>assert.fail(),receptionConversationMatches:()=>true,
    getRecordedReception:async()=>current,transitionRecordedReception:()=>assert.fail(),endRecordedReception:()=>assert.fail(),boundEndReceipt:()=>assert.fail(),bindRecordedReceptionCallStart:async()=>current,
    settleRecordedReception:async()=>{events.push('settle');return {settled:true};},sellerMemoryInboundTurns:()=>[],buyerCallPackageSource,
   });
   const replay={...conversation};if(transcript===undefined)delete replay.transcript;else replay.transcript=transcript;
   const result=await maintainRecordedReception(rpc,{getCall:async()=>({status:'completed'}),conversation:async()=>replay},{TWILIO_ACCOUNT_SID:'ACfixture'});
   assert.deepEqual(await db.one('select source,source_hash from icash_buyer_call_package_private.sources'),original,'Keep first source immutable: '+name);
   assert.equal(result.settled,1,'Source contradiction cannot block original settlement: '+name);
   if(contradiction){
    assert.equal(await db.final(pending.messageId),null,'Changed replay must remove original dispatch authority: '+name);
    assert.equal((await db.one('select count(*)::int n from icash_buyer_call_package_private.source_conflicts')).n,1,name);
    assert.deepEqual(events,['capture','settle','checked']);assert.equal(result.held,1);
    assert.equal((await db.one('select state from icash_text_messages where id=$1',[pending.messageId])).state,'ready');
    assert.equal((await db.one('select count(*)::int n from fixture_reservations')).n,0,'No reservation or provider admission after contradiction');
   }else{
    assert.deepEqual(events,['settle','checked']);assert.equal(result.held,0);
    assert.equal((await db.one('select count(*)::int n from icash_buyer_call_package_private.source_conflicts')).n,0,'Absent retained data is not evidence that a source changed');
    assert(await db.final(pending.messageId),'Original complete source remains usable: '+name);
   }
  }finally{await pg.exec('rollback');}
 }
}finally{await pg.close();}
console.log('PASS complete-source normalization, bounded independent SMS work, no unknown replay, and capture failure after original settlement.');
