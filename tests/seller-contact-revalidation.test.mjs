// In-memory PostgreSQL only. Real contact/recovery functions, synthetic receipts.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createSellerRevalidationFixture} from './helpers/seller-contact-revalidation-fixture.mjs';
const require=createRequire(import.meta.url);
const f=await createSellerRevalidationFixture(require.resolve('@electric-sql/pglite'));
const {pg,q,rpc,one,isolated,account,thread,fresh,oldContact,oldReceipt,gap,snapshot,review,apply,enable}=f;
let cases=0;
const scenario=async(name,action)=>isolated(async()=>{try{await action();cases++;}catch(e){throw new Error(name+': '+e.message,{cause:e});}});
const originalEvidence=()=>one(`select jsonb_build_object(
 'contacts',(select jsonb_agg(to_jsonb(c) order by id) from icash_operational_contacts c),
 'receipts',(select jsonb_agg(to_jsonb(d) order by id) from icash_dnc_verification_receipts d),
 'wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w),
 'spend',(select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o),
 'messages',(select jsonb_agg(to_jsonb(m) order by id) from icash_text_messages m)) evidence`);
const counts=()=>one(`select (select count(*)::int from icash_seller_recovery_private.contact_revalidations) applications,
 (select count(*)::int from icash_seller_recovery_attempts) attempts,
 (select count(*)::int from icash_text_messages) messages`);
const assertHeld=async()=>{assert.equal((await one('select state from icash_seller_gaps where id=$1',[gap])).state,'needs_review');assert.equal((await one('select operational_contact_id from icash_text_threads where id=$1',[thread])).operational_contact_id,oldContact);assert.equal((await counts()).applications,0);};
const rejectAfterReview=async(change)=>{await enable();const id=await review();assert(id);await change();const before=await originalEvidence();assert.equal(await apply(id),false);await assertHeld();assert.deepEqual(await originalEvidence(),before);};
const candidate=async(patch={},receiptPatch={})=>{
 const dr=(await one(`insert into icash_dnc_verification_receipts select (jsonb_populate_record(null::icash_dnc_verification_receipts,to_jsonb(d)||$2::jsonb)).*
 from icash_dnc_verification_receipts d where d.id=$1 returning id`,[f.dnc,{id:randomUUID(),provider_reference:'SIMULATION fresh receipt '+randomUUID(),...receiptPatch}])).id;
 return (await one(`insert into icash_operational_contacts select (jsonb_populate_record(null::icash_operational_contacts,to_jsonb(c)||$2::jsonb)).*
 from icash_operational_contacts c where c.id=$1 returning id`,[fresh,{id:randomUUID(),dnc_receipt_id:dr,...patch}])).id;
};
try{
 assert.equal(readFileSync(new URL('../config/seller-contact-revalidation.sql',import.meta.url),'utf8'),readFileSync(new URL('../supabase/migrations/20261103191336_seller_contact_revalidation.sql',import.meta.url),'utf8'));
 await scenario('production mismatch is reproduced without loosening cadence',async()=>{
  const g=await one('select state,review_reason,due_at>=source_at+interval \'3 days\' three_days from icash_seller_gaps where id=$1',[gap]);
  assert.deepEqual(g,{state:'needs_review',review_reason:'contact_checks_expired',three_days:true});
  assert.equal(await rpc('icash_seller_recovery_current',{p_gap:gap}),false);
  assert.equal((await one('select eligibility_until>now() current from icash_operational_contacts where id=$1',[fresh])).current,true);
  assert.equal(await rpc('icash_sms_thread_review_current',{p_account:account,p_thread:thread,p_check_hour:false}),false,'Fresh separate evidence alone does not silently renew an existing thread');
 });
 await scenario('migration and review are inactive; exact hash is required',async()=>{
  assert.equal((await one('select enabled from icash_seller_recovery_private.contact_revalidation_policy')).enabled,false);
  assert.equal(await rpc('icash_review_seller_contact_revalidation',{p_gap:gap,p_contact:fresh,p_expected_hash:'0'.repeat(64),p_reference:'SIMULATION review without matching evidence'}),null);
  const before=await snapshot(),money=await originalEvidence(),id=await review();assert(id);
  assert.equal(await apply(id),false);assert.deepEqual(await snapshot(),before);assert.deepEqual(await originalEvidence(),money);await assertHeld();
 });
 await scenario('only a reviewed new receipt resumes one gap; no send or evidence rewrite',async()=>{
  await enable();const before=await snapshot(),money=await originalEvidence(),id=await review();
  assert.equal(await apply(id),true);assert.equal(await apply(id),false,'One-use application');
  assert.equal((await one('select state from icash_seller_gaps where id=$1',[gap])).state,'open');
  assert.equal((await one('select operational_contact_id from icash_text_threads where id=$1',[thread])).operational_contact_id,fresh);
  assert.equal(await rpc('icash_seller_recovery_current',{p_gap:gap}),true);
  assert.deepEqual(await originalEvidence(),money);assert.deepEqual(await counts(),{applications:1,attempts:0,messages:1});
  const audit=await one('select before_evidence,after_thread,after_gap from icash_seller_recovery_private.contact_revalidations');
  assert.deepEqual(audit.before_evidence,before);
  for(const key of ['account_id','deal_id','sender','recipient','party','seller_intake_id','paused','manual_only','ai_mode','retired_at','sms_rate_id','permission_until','permission_evidence'])assert.deepEqual(audit.after_thread[key],before.thread[key],key);
  for(const key of ['source','source_id','source_at','quote','due_at','expires_at','outgoing_id'])assert.deepEqual(audit.after_gap[key],before.gap[key],key);
  await assert.rejects(q("update icash_seller_recovery_private.contact_revalidations set after_gap='{}'"),/immutable|cannot|mutation|Append-only/i);
 });
 // Fresh controls invalidate the review or the unchanged authoritative guards.
 for(const [name,change] of [
  ['customer Pause',()=>q('update icash_accounts set bot_paused=true where id=$1',[account])],
  ['thread Pause',()=>q('update icash_text_threads set paused=true where id=$1',[thread])],
  ['manual takeover',()=>q('update icash_text_threads set manual_only=true where id=$1',[thread])],
  ['retired thread',()=>q('update icash_text_threads set retired_at=now() where id=$1',[thread])],
  ['changed sender',async()=>{await q("insert into icash_text_senders select (jsonb_populate_record(null::icash_text_senders,to_jsonb(s)||jsonb_build_object('phone','+12145550999'))).* from icash_text_senders s limit 1");await q("update icash_text_threads set sender='+12145550999' where id=$1",[thread]);}],
  ['SMS route hold',()=>q('update icash_sms_routes set needs_review=true')],
  ['global STOP',()=>q("insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[f.phone])],
  ['revoked new contact',()=>q('update icash_operational_contacts set revoked_at=now() where id=$1',[fresh])],
  ['revoked original contact',()=>q('update icash_operational_contacts set revoked_at=now() where id=$1',[oldContact])],
  ['receipt revoked',()=>q('update icash_dnc_verification_receipts set revoked_at=now() where id=$1',[f.dnc])],
  ['source reference changed',()=>q("update icash_dnc_verification_sources set source_reference='SIMULATION changed source' where id=$1",[f.source])],
  ['source validity extended',()=>q("update icash_dnc_verification_sources set expires_at=expires_at+interval '1 day' where id=$1",[f.source])],
  ['source disabled',()=>q('update icash_dnc_verification_sources set enabled=false where id=$1',[f.source])],
  ['identity changed',()=>q("update icash_customer_identities set company_name='SIMULATION changed principal' where account_id=$1",[account])],
  ['owner purchase unsettled',()=>q("update icash_operation_spend set state='dispatched' where account_id=$1",[account])],
  ['saved owner data changed',()=>q("update icash_owner_contacts set result=jsonb_set(result,'{contacts,0,phones,0,doNotCall}','true') where screening_id=$1",[f.screening])],
  ['disabled SMS sender',()=>q('update icash_text_senders set enabled=false')],
  ['financially ineligible property',()=>q("update icash_screening_jobs set result=jsonb_set(result,'{financialCheck,status}',to_jsonb('ineligible'::text)) where id=$1",[f.screening])],
  ['future screening',()=>q("update icash_screening_jobs set completed_at=now()+interval '1 minute' where id=$1",[f.screening])],
  ['seven-day screening expired',()=>q("update icash_screening_jobs set completed_at=now()-interval '8 days' where id=$1",[f.screening])],
  ['property manual control',()=>q("insert into icash_property_controls(account_id,property_id,manual) values($1,'prop_1001',true)",[account])],
  ['prior ready draft',()=>q("insert into icash_text_messages(account_id,thread_id,direction,body,state) values($1,$2,'outgoing','SIMULATION retained draft','ready')",[account,thread])],
  ['unknown send',()=>q("insert into icash_text_messages(account_id,thread_id,direction,body,state) values($1,$2,'outgoing','SIMULATION unknown send','needs_review')",[account,thread])],
  ['new incoming reply',()=>q("insert into icash_text_messages(account_id,thread_id,direction,body,state,event_id) values($1,$2,'incoming','SIMULATION reply','received',$3)",[account,thread,randomUUID()])],
  ['expired gap',()=>q("update icash_seller_gaps set expires_at=now()-interval '1 second' where id=$1",[gap])],
  ['changed gap quote',()=>q("update icash_seller_gaps set quote='SIMULATION changed request' where id=$1",[gap])],
 ])await scenario(name+' preserves every hold',()=>rejectAfterReview(change));
 for(const [name,patch,receiptPatch] of [
  ['different identity',{sending_principal:'SIMULATION another principal'},{}],
  ['different source hash',{source_hash:'b'.repeat(64)},{}],
  ['different owner',{owner_user_id:f.otherUser},{}],
  ['voice instead of SMS',{channel:'voice'},{}],
  ['expired new evidence',{eligibility_until:new Date(Date.now()-1000).toISOString()},{}],
  ['older receipt',{}, {checked_at:new Date(Date.now()-5*86400000).toISOString()}],
  ['future receipt',{}, {checked_at:new Date(Date.now()+3600000).toISOString()}],
  ['receipt not clear',{}, {clear:false}],
 ]){
  await scenario(name+' cannot authorize revalidation',async()=>{await enable();const c=await candidate(patch,receiptPatch),id=await review(c);assert(id);assert.equal(await apply(id),false);await assertHeld();});
 }
 for(const [name,change] of [
  ['revoked original receipt',()=>q('update icash_dnc_verification_receipts set revoked_at=now() where id=$1',[oldReceipt])],
  ['original receipt no longer clear',()=>q('update icash_dnc_verification_receipts set clear=false where id=$1',[oldReceipt])],
 ])await scenario(name+' is not an expiry-only repair',async()=>{await enable();await change();const id=await review();assert(id);assert.equal(await apply(id),false);await assertHeld();});
 await scenario('foreign-account evidence is not visible to the review binding',async()=>{await enable();const c=await candidate({account_id:f.other,owner_user_id:f.otherUser});assert.equal(await review(c),null);await assertHeld();});
 await scenario('expired exact review cannot reopen a gap',async()=>{
  await enable();const original=await review();
  const expired=(await one(`insert into icash_seller_recovery_private.contact_revalidation_reviews(gap_id,contact_id,snapshot,snapshot_hash,review_reference,created_at,expires_at)
   select gap_id,contact_id,snapshot,snapshot_hash,review_reference,now()-interval '31 minutes',now()-interval '1 minute' from icash_seller_recovery_private.contact_revalidation_reviews where id=$1 returning id`,[original])).id;
  assert.equal(await apply(expired),false);await assertHeld();
 });
 await scenario('same receipt cannot be re-stamped into a new check',async()=>{
  await enable();const same=await candidate({}, {checked_at:new Date((await one('select checked_at from icash_dnc_verification_receipts where id=$1',[oldReceipt])).checked_at).toISOString()});
  const id=await review(same);assert.equal(await apply(id),false);await assertHeld();
 });
 await scenario('current cadence rejects early and late cold reminders',async()=>{
  for(const age of ['2 days','6 days'])await isolated(async()=>{
   await q('update icash_text_messages set created_at=now()-$2::interval where id=$1',[f.message,age]);
   await enable();const id=await review();assert.equal(await apply(id),false);await assertHeld();
  });
 });
 await scenario('a failed final check rolls the binding and gap back atomically',async()=>{
  await enable();const before=await snapshot(),id=await review();
  await pg.exec('create or replace function icash_seller_recovery_current(p_gap uuid) returns boolean language sql as $$select false$$');
  assert.equal(await apply(id),false);assert.deepEqual(await snapshot(),before);await assertHeld();
 });
 await scenario('unrelated review reasons are not enrolled',async()=>{
  await q('update icash_seller_gaps set review_reason=null where id=$1',[gap]);assert.equal(await review(),null);
 });
 for(const role of ['anon','authenticated']){
  for(const fn of ['public.icash_seller_contact_revalidation_snapshot(uuid,uuid)','public.icash_review_seller_contact_revalidation(uuid,uuid,text,text)','public.icash_apply_seller_contact_revalidation(uuid)'])assert.equal((await one('select has_function_privilege($1,$2,\'execute\') allowed',[role,fn])).allowed,false);
 }
 for(const table of ['contact_revalidation_policy','contact_revalidation_reviews','contact_revalidations'])assert.equal((await one("select has_table_privilege('service_role',$1,'insert,update,delete') allowed",['icash_seller_recovery_private.'+table])).allowed,false);
 console.log(`PASS seller contact revalidation: ${cases} isolated scenarios, actual contact/SMS/cadence/recovery gates, immutable evidence, disabled rollout and no provider work.`);
}catch(e){console.error(e.message,e.cause?.message??'',e.where??'',e.cause?.where??'');process.exitCode=1;}finally{await pg.close();}
