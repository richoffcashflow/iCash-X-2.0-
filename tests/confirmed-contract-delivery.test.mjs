import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=await PGlite.create(),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const account='00000000-0000-4000-8000-000000000001',message='00000000-0000-4000-8000-000000000008';
const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const send=()=>value('select public.icash_claim_text_before_owner_question($1,$2,$3)',[account,message,'+12025550102']);
const recovery=()=>value('select public.icash_claim_agreement_delivery_recovery()');
const current=()=>value('select public.icash_confirmed_seller_contract_text_current($1,$2)',[account,message]);
let scenarios=0;
try{
 await db.exec(read('tests/fixtures/confirmed-contract-delivery.sql'));
 for(const name of ['icash_claim_text_before_owner_question','icash_claim_agreement_delivery_recovery'])await db.exec(read(`tests/fixtures/${name}-20261105.sql`));
 assert.equal(await send(),null,'Original sender rejects the confirmed agreement using the old financial hold');
 assert.equal(await recovery(),null,'Original recovery strands the unattempted contract text');
 assert.equal(await value('select count(*) from public.icash_operation_spend'),0);
 const patch=read('config/confirmed-contract-text-delivery.sql');
 assert.equal(patch,read('supabase/migrations/20261105061229_confirmed_contract_text_delivery.sql'));
 await db.exec(patch);
 assert.equal(await current(),true);
 await db.exec('begin');
 const job=await recovery();assert.equal(job.accountId,account);assert.equal(job.phone,'+12025550101');
 assert.equal(await recovery(),null,'Only one recovery claimant');
 assert.deepEqual(await send(),{messageId:message});assert.equal(await send(),null,'Original message dispatch cannot repeat');
 assert.equal(await value('select count(*) from public.icash_operation_spend'),1);
 assert.equal(await value('select count(*) from public.icash_signing_envelopes'),1);
 assert.equal(await value('select count(*) from public.icash_text_messages'),1);
 assert.equal(await value("select result->'financialCheck'->>'status' from public.icash_screening_jobs"),'hold','Original screening evidence is unchanged');
 await db.exec('rollback');scenarios++;
 const blocked=[
  "update icash_call_offer_private.offers set state=state-'acceptedPriceCents'",
  "update icash_call_offer_private.offers set state=jsonb_set(state,'{quotedPriceCents}','9300000')",
  ...['factsPending','conditionPending','agreementRevisionRequired','contractBlocked','acceptanceConditional','payoffPending'].map(key=>`update icash_call_offer_private.offers set state=jsonb_set(state,'{${key}}','true')`),
  "update icash_call_offer_private.offers set state=jsonb_set(state,'{factsPending}','\"false\"')",
  "update icash_call_offer_private.offers set snapshot='{}'",
  "delete from icash_call_offer_private.offers",
  "update public.icash_deal_files set terms=jsonb_set(terms,'{inspectionDays}','7')",
  "update public.icash_deal_files set stage='cancelled'",
  "update public.icash_screening_jobs set state='archived'",
  "update public.icash_signing_envelopes set state='cancellation_pending'",
  "update public.icash_signing_envelopes set provider_id=null",
  "update public.icash_signing_envelopes set test_mode=true",
  "update public.icash_signing_envelopes set recipients=jsonb_set(recipients,'{0,phone}','\"+12025550999\"')",
  "update public.icash_signing_envelopes set recipients=jsonb_set(recipients,'{0,name}','\"Different Seller\"')",
  "update public.icash_contract_text_deliveries set signer_id='2'",
  "update icash_seller_agreement_private.confirmations set state='needs_review'",
  "update icash_seller_agreement_private.confirmations set confirmation=jsonb_set(confirmation,'{sendTextRequested}','false')",
  "update icash_seller_agreement_private.confirmations set terms=jsonb_set(terms,'{priceCents}','9300000')",
  "update public.icash_text_messages set body='Please accept a new price'",
  "update public.icash_text_threads set paused=true",
  "update public.icash_text_threads set manual_only=true",
  "update public.icash_text_threads set retired_at=now()",
  "update public.icash_text_threads set ai_mode='off'",
  "update public.icash_text_messages set account_id='00000000-0000-4000-8000-000000000099'",
  "update public.icash_text_messages set state='dispatching'",
  "update public.icash_text_messages set provider_id='uncertain-original'",
  "insert into public.icash_agreement_cancellations select id,true from public.icash_deal_files",
 ];
 for(const sql of blocked){
  await db.exec('begin');await db.exec(sql);
  assert.equal(await current(),false,sql);assert.equal(await send(),null,sql);assert.equal(await recovery(),null,sql);
  await db.exec('rollback');scenarios++;
 }
 for(const sql of [
  "update public.icash_accounts set bot_paused=true",
  "update public.fixture_controls set sms=false",
  "insert into public.icash_property_controls select account_id,snapshot->>'propertyId',true from public.icash_screening_jobs",
 ]){await db.exec('begin');await db.exec(sql);assert.equal(await send(),null,sql);assert.equal(await recovery(),null,sql);await db.exec('rollback');scenarios++;}
 for(const sql of [
  "update public.fixture_controls set membership=false",
  "update icash_seller_agreement_private.delivery_recovery set result='{\"sent\":false,\"status\":\"needs_review\"}'",
  "update icash_seller_agreement_private.delivery_recovery set expires_at=now()-interval '1 second'",
  "update icash_seller_agreement_private.delivery_recovery set claimed_at=now()",
  "update icash_seller_agreement_private.delivery_recovery set envelope_id=null",
  "update icash_seller_agreement_private.delivery_recovery set request_key='foreign-confirmation'",
  "insert into public.icash_text_suppressions values('+12025550101')",
  "insert into public.icash_contact_suppressions values(encode(sha256(convert_to('+12025550101','UTF8')),'hex'))",
  ...['reserved','dispatched','settled','needs_review'].map(state=>`insert into public.icash_operation_spend values('text:${message}','${account}','${state}')`),
 ]){await db.exec('begin');await db.exec(sql);assert.equal(await recovery(),null,sql);await db.exec('rollback');scenarios++;}
 // A good initial screen never overrides a later withdrawal of this agreement.
 await db.exec("begin;update public.icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"eligible\"}}';update icash_call_offer_private.offers set state=state-'acceptedPriceCents';");
 assert.equal(await send(),null);await db.exec('rollback');scenarios++;
 for(const role of ['anon','authenticated'])assert.equal(await value("select has_function_privilege($1,'public.icash_confirmed_seller_contract_text_current(uuid,uuid)','execute')",[role]),false);
 assert.equal(await value("select has_function_privilege('service_role','public.icash_confirmed_seller_contract_text_current(uuid,uuid)','execute')"),true);
 console.log(`PASS confirmed contract delivery: ${scenarios} scenarios, original rejection reproduced, exact approval/source/terms preserved, same envelope and message, unknown sends never replayed. No providers.`);
}finally{await db.close();}
