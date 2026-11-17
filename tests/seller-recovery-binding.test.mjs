import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {setup,jointScenario,preparedOriginal,originalContractMessage} from './helpers/seller-joint-memory-fixture.mjs';
import {scenario,rpc} from './helpers/seller-atomic-memory-fixture.mjs';
import {reviewSellerAgreementMemory} from '../lib/seller-agreement-memory-proof.ts';
globalThis.fetch=async()=>{throw Error('NO NETWORK: original recovery binding only');};
const pg=await PGlite.create();
try{
 await setup(pg);const s=await jointScenario(pg),queued=await rpc(pg,'icash_defer_seller_agreement',s.args);await s.complete();
 const job=await rpc(pg,'icash_claim_agreement_delivery_recovery',{});assert.equal(job.id,queued.id);assert(await reviewSellerAgreementMemory(s.db,job));
 const e=await preparedOriginal(s),bind=(args={})=>rpc(pg,'icash_bind_agreement_delivery_envelope',{p_account:s.account,p_recovery:job.id,p_envelope:e.id,...args});
 const original=async()=>({confirmation:(await pg.query('select state,envelope_id from icash_seller_agreement_private.confirmations where account_id=$1',[s.account])).rows[0],recovery:(await pg.query('select state,envelope_id from icash_seller_agreement_private.delivery_recovery where id=$1',[job.id])).rows[0]});
 const before=await original();assert.equal(before.confirmation.envelope_id,null);assert.equal(before.recovery.envelope_id,null);
 for(const change of [
  "update icash_seller_agreement_private.delivery_recovery set state='needs_review'",
  "update icash_seller_agreement_private.delivery_recovery set expires_at=now()-interval '1 second'",
  "update icash_seller_agreement_private.delivery_recovery set request_key='not-the-original'",
  "update icash_seller_agreement_private.delivery_recovery set requested_by=gen_random_uuid()",
  "update icash_seller_agreement_private.delivery_recovery set phone='+12125550999'",
  "update icash_seller_agreement_private.delivery_recovery set expected_terms=jsonb_set(expected_terms,'{priceCents}','10000000')",
  "update icash_seller_agreement_private.confirmations set confirmation=jsonb_set(confirmation,'{sendTextRequested}','false')",
  "update icash_seller_agreement_private.confirmations set envelope_id=gen_random_uuid()",
  "update icash_signing_envelopes set provider_id=null",
  "update icash_signing_envelopes set state='needs_review'",
  "update icash_signing_envelopes set requested_by=gen_random_uuid()",
  "update icash_signing_envelopes set created_at=now()-interval '1 day'",
  "update icash_signing_envelopes set test_mode=true",
  "update icash_signing_envelopes set recipients=jsonb_set(recipients,'{0,phone}','\"+12125550999\"')",
  "update icash_signing_envelopes set recipients=jsonb_set(recipients,'{0,name}','\"Another Seller\"')",
  "update icash_signing_envelopes set recipients=jsonb_set(recipients,'{1,email}','\"another@example.test\"')",
  "update icash_signing_envelopes set terms=jsonb_set(terms,'{inspectionDays}','5')",
  "update icash_deal_files set terms=jsonb_set(terms,'{closingDate}','\"2099-01-01\"')",
  "update icash_call_offer_private.offers set state=jsonb_set(state,'{factsPending}','true')",
  "insert into icash_signing_envelopes(account_id,deal_id,kind) select account_id,deal_id,kind from icash_signing_envelopes",
 ]){
  await pg.exec('begin');await pg.exec(change);const changed=await original();
  assert.equal(await bind(),false,change);assert.deepEqual(await original(),changed,'refusal cannot rewrite original bindings');await pg.exec('rollback');
 }
 for(const args of [{p_account:'00000000-0000-4000-8000-000000000001'},{p_recovery:'00000000-0000-4000-8000-000000000002'},{p_envelope:'00000000-0000-4000-8000-000000000003'}])assert.equal(await bind(args),false);
 for(const role of ['anon','authenticated'])assert.equal((await pg.query("select has_function_privilege($1,'public.icash_bind_agreement_delivery_envelope(uuid,uuid,uuid)','execute') allowed",[role])).rows[0].allowed,false);
 await pg.exec('set role service_role');try{assert.equal(await bind(),true);assert.equal(await bind(),true,'same original binding is idempotent');}finally{await pg.exec('reset role');}
 assert.equal((await original()).confirmation.envelope_id,e.id);assert.equal((await original()).recovery.envelope_id,e.id);
 for(const envelope of [null,'00000000-0000-4000-8000-000000000099']){
  assert.equal(await rpc(pg,'icash_finish_agreement_delivery_recovery',{p_id:job.id,p_envelope:envelope,p_result:{sent:false,status:'needs_review'}}),false,'outcome recording cannot clear or replace an attached original');
  assert.equal((await original()).recovery.envelope_id,e.id);
 }
 assert.equal((await pg.query('select count(*) n from icash_text_messages where account_id=$1',[s.account])).rows[0].n,0,'binding queues no contact');
 assert.equal((await pg.query('select count(*) n from icash_operation_spend where account_id=$1',[s.account])).rows[0].n,0,'binding creates no spending authorization');
 // Independent regressions: the failed-binder catch may retain its original
 // outcome/reference, but cannot obtain authority through the older finalizer.
 // Exercise both a not-yet-queued message and a rolling worker's existing link.
 const prepare=async()=>{
  const target=await jointScenario(pg),deferred=await rpc(pg,'icash_defer_seller_agreement',target.args);assert(deferred?.queued);await target.complete();
  const recovery=await rpc(pg,'icash_claim_agreement_delivery_recovery',{});assert.equal(recovery?.id,deferred.id);assert(await reviewSellerAgreementMemory(target.db,recovery));
  const envelope=await preparedOriginal(target);return {...target,recovery:recovery.id,envelope:envelope.id,
   bind:()=>rpc(pg,'icash_bind_agreement_delivery_envelope',{p_account:target.account,p_recovery:recovery.id,p_envelope:envelope.id})};
 };
 for(const queuedFirst of [false,true])for(const changed of ['requested_by','created_at','owner_email']){
  const target=await prepare();let message=queuedFirst?await originalContractMessage(target,target.envelope):null;
  if(changed==='requested_by')await pg.query('update public.icash_signing_envelopes set requested_by=gen_random_uuid() where id=$1',[target.envelope]);
  else if(changed==='created_at')await pg.query("update public.icash_signing_envelopes set created_at=clock_timestamp()-interval '2 days' where id=$1",[target.envelope]);
  else await pg.query("update auth.users set email='changed-owner@example.test' where id=$1",[target.user]);
  assert.equal(await target.bind(),false,changed+' must fail exact original binding');
  assert.equal(await rpc(pg,'icash_finish_agreement_delivery_recovery',{p_id:target.recovery,p_envelope:target.envelope,p_result:{sent:true,status:'accepted'}}),false,'unbound original cannot obtain unsupported positive outcome authority');
  assert.deepEqual((await pg.query('select state,envelope_id from icash_seller_agreement_private.delivery_recovery where id=$1',[target.recovery])).rows[0],{state:'claimed',envelope_id:null});
  if(!queuedFirst)assert.equal(Number((await pg.query('select count(*) n from public.icash_text_messages where account_id=$1',[target.account])).rows[0].n),0,'no text exists when binding fails');
  const outcome={sent:false,status:'needs_review',reason:'seller_original_agreement_binding_required'};
  assert.equal(await rpc(pg,'icash_finish_agreement_delivery_recovery',{p_id:target.recovery,p_envelope:target.envelope,p_result:outcome}),true,'retain the known held original outcome');
  assert.deepEqual((await pg.query('select state,envelope_id from icash_seller_agreement_private.confirmations where account_id=$1',[target.account])).rows[0],{state:'preparing',envelope_id:null},'failed binding cannot be granted by outcome recording');
  assert.deepEqual((await pg.query('select state,envelope_id,result from icash_seller_agreement_private.delivery_recovery where id=$1',[target.recovery])).rows[0],{state:'needs_review',envelope_id:target.envelope,result:outcome});
  message??=await originalContractMessage(target,target.envelope);
  await pg.query("update public.icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"eligible\"}}',completed_at=clock_timestamp() where id=$1",[target.screen]);
  assert.equal(await rpc(pg,'icash_claim_text_before_owner_question',{p_account:target.account,p_message:message,p_sender:'+14243948384'}),null,'eligible ordinary financial fallback cannot send a binder-rejected original');
  assert.equal(Number((await pg.query('select count(*) n from fixture_text_admissions where message_id=$1',[message])).rows[0].n),0);
 }
 {
  const target=await prepare();assert.equal(await target.bind(),true);
  const message=await originalContractMessage(target,target.envelope);
  await pg.query("update public.icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"eligible\"}}',completed_at=clock_timestamp() where id=$1",[target.screen]);
  assert((await rpc(pg,'icash_claim_text_before_owner_question',{p_account:target.account,p_message:message,p_sender:'+14243948384'}))?.messageId,'original source allowed its one earlier provider boundary');
  await target.incoming(pg,'Actually, I have another mortgage.');
  await pg.query("update icash_seller_agreement_private.confirmations set state='needs_review' where account_id=$1 and deal_id=$2",[target.account,target.deal]);
  const outcome={sent:true,status:'accepted'};
  assert.equal(await rpc(pg,'icash_finish_agreement_delivery_recovery',{p_id:target.recovery,p_envelope:target.envelope,p_result:outcome}),true,'later source changes cannot discard a previously bound accepted original outcome');
  assert.deepEqual((await pg.query('select state,envelope_id,result from icash_seller_agreement_private.delivery_recovery where id=$1',[target.recovery])).rows[0],{state:'sent',envelope_id:target.envelope,result:outcome});
  assert.deepEqual((await pg.query('select state,envelope_id from icash_seller_agreement_private.confirmations where account_id=$1 and deal_id=$2',[target.account,target.deal])).rows[0],{state:'needs_review',envelope_id:target.envelope},'accepted outcome does not clear later business review');
  assert.equal(await rpc(pg,'icash_claim_text_before_owner_question',{p_account:target.account,p_message:message,p_sender:'+14243948384'}),null,'later material source still blocks any new admission');
 }
 // Preserve the existing final sender behavior outside memory-backed automatic
 // links: manual creation, explicit customer authorship and disabled cohorts.
 for(const mode of ['manual','customer-authored','disabled']){
  const target=mode==='customer-authored'?await jointScenario(pg):await scenario(pg,{phone:mode==='manual'?'+12125550996':'+12125550997',enabled:mode!=='disabled'});
  if(mode!=='manual')assert((await target.claim())?.claimed);
  const created=await preparedOriginal(target),message=await originalContractMessage(target,created.id);
  await pg.query("update icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"eligible\"}}',completed_at=clock_timestamp() where id=$1",[target.screen]);
  if(mode==='customer-authored')await pg.query('update icash_text_messages set customer_author_id=$2 where id=$1',[message,target.user]);
  assert((await rpc(pg,'icash_claim_text_before_owner_question',{p_account:target.account,p_message:message,p_sender:'+14243948384'}))?.messageId,mode+' keeps its prior final sender behavior');
 }
}finally{await pg.close();}
console.log('PASS exact original recovery binding, independent immutable target checks, private access, no new spend, and manual/customer/disabled compatibility.');
