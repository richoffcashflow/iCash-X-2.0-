// Local PostgreSQL only. All admission functions below are production SQL;
// transport is replaced with a saved synthetic receipt after the real claim.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {databaseAdapter,loadService} from './simulated-journey-services.mjs';
import {dealTermsSchema} from '../../lib/deal-documents.ts';
const read=path=>readFileSync(path,'utf8');
export async function installAutomaticBuyerOutreach(f){
 const {pg,q,account}=f;
 await pg.exec(`alter table icash_text_threads add column if not exists manual_only boolean not null default false;
 alter table icash_accounts add column if not exists billing_model text not null default 'membership_credits';
 create table if not exists icash_memberships(account_id uuid,mode text,state text,paid_through timestamptz);
 create table if not exists icash_email_suppressions(account_id uuid,email text,reason text,primary key(account_id,email));`);
 const membership=read('supabase/migrations/20261003223200_membership_and_prepaid_credits.sql');
 const start=membership.indexOf('create function public.icash_membership_work_allowed(');
 await pg.exec(membership.slice(start,membership.indexOf('$$;',start)+3));
 await q("insert into icash_memberships values($1,'live','active',now()+interval '1 day')",[account]);
 const reservations=read('config/buyer-purchase-terms-and-reservations.sql');
 await pg.exec(reservations.slice(reservations.indexOf('create table public.icash_buyer_deposit_receipts'),reservations.indexOf('create function public.icash_confirm_buyer_deposit')));
 await pg.exec(read('config/automatic-outreach-channels.sql'));
 const sql=read('config/automatic-buyer-outreach.sql');
 assert.equal(sql,read('supabase/migrations/'+readdirSync('supabase/migrations').find(name=>name.endsWith('_automatic_buyer_outreach.sql'))));
 await pg.exec(sql);
 const scope=read('config/buyer-outreach-receipt-scope.sql');
 assert.equal(scope,read('supabase/migrations/'+readdirSync('supabase/migrations').find(name=>name.endsWith('_buyer_outreach_receipt_scope.sql'))));
 await pg.exec(scope);
}

export async function testAutomaticBuyerOutreach(f,{thread,packageBody,emailRate,envelope}){
 const {pg,q,rpc,one,isolated,account,other,user,deal,screening,phone,sender,timezone,sms}=f;
 const {db}=databaseAdapter(pg);
 const prepare=()=>rpc('icash_prepare_buyer_outreach',{p_account:account,p_deal:deal});
 const targets=()=>rpc('icash_buyer_package_text_targets',{p_account:account,p_deal:deal});
 const status=()=>rpc('icash_buyer_outreach_status',{p_account:account,p_deal:deal});
 // Start from the actual intake-created pause, with no activation or acknowledgment.
 await q('begin');
 try{
  assert.equal((await one('select count(*) n from icash_outreach_campaigns where account_id=$1',[account])).n,0);
  assert.equal((await one('select count(*) n from icash_campaign_acknowledgments where account_id=$1',[account])).n,0);
  await q('delete from icash_buyer_package_texts where thread_id=$1',[thread]);
  await q('delete from icash_text_messages where thread_id=$1',[thread]);
  await q('update icash_text_threads set paused=true,sms_intake_pending=true where id=$1',[thread]);
  assert.equal((await status()).intakePending,1);
  assert.equal(await prepare(),1,'initial buyer intake releases automatically without Run or a campaign');
  assert.equal(await prepare(),0,'release is idempotent');
  assert.equal((await status()).smsContacts,1);
  assert.deepEqual(await targets(),[{id:thread}]);
  assert.equal((await one('select count(*) n from icash_buyer_qualification_requests')).n,0,'introduction does not require funds/signatory qualification');
  const message=await rpc('icash_queue_buyer_package_text',{p_account:account,p_thread:thread,p_body:packageBody});
  assert(message);
  const claim=await rpc('icash_claim_text',{p_account:account,p_message:message,p_sender:sender});
  assert.equal(claim.message,packageBody,'actual final SMS claim succeeds without a campaign');
  assert.equal(await rpc('icash_claim_text',{p_account:account,p_message:message,p_sender:sender}),null);
  assert.equal((await one('select count(*) n from icash_outreach_campaigns where account_id=$1',[account])).n,0);
  assert.equal((await one('select count(*) n from icash_campaign_acknowledgments where account_id=$1',[account])).n,0);
 }finally{await q('rollback');}

 const guards=[
  ["update icash_accounts set bot_paused=true where id=$1",[account]],
  ["update icash_wallets set balance_cents=0 where account_id=$1",[account]],
  ["update icash_memberships set paid_through=now()-interval '1 second' where account_id=$1",[account]],
  ["select icash_record_sms_inbound_campaign($1,$2,'sms-inbound-2026-09-30.1',true)",[account,user]],
  ["update icash_text_threads set manual_only=true where id=$1",[thread]],
  ["update icash_text_threads set sms_intake_pending=false where id=$1",[thread]],
  ["insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[phone]],
  ["update icash_disposition_authorities set expires_at=now()-interval '1 second' where deal_id=$1",[deal]],
  ["insert into icash_property_controls(account_id,property_id,manual) values($1,'prop_1001',true)",[account]],
 ];
 for(const [sql,args] of guards)await isolated(async()=>{
  await q('delete from icash_buyer_package_texts where thread_id=$1',[thread]);
  await q('delete from icash_text_messages where thread_id=$1',[thread]);
  await q('update icash_text_threads set paused=true,sms_intake_pending=true where id=$1',[thread]);
  await q(sql,args);
  assert.equal(await prepare(),0,sql);
  assert.equal((await one('select paused from icash_text_threads where id=$1',[thread])).paused,true);
 });
 assert.equal(await rpc('icash_prepare_buyer_outreach',{p_account:other,p_deal:deal}),0);
 assert.equal(await rpc('icash_buyer_outreach_status',{p_account:other,p_deal:deal}),null);

 await isolated(async()=>{
  // Earlier UUIDs have no contact permission and must not consume the batch.
  for(let i=1;i<=5;i++)await q("insert into icash_text_threads(id,account_id,deal_id,sender,recipient,timezone,sms_rate_id,party,paused,ai_mode) values($1,$2,$3,$4,$5,$6,$7,'buyer',false,'auto')",['00000000-0000-4000-8000-00000000000'+i,account,deal,sender,'+1214555020'+i,timezone,sms]);
  assert.deepEqual(await targets(),[{id:thread}],'ineligible rows cannot starve the eligible buyer');
  await q("update icash_fulfillment_jobs set state='complete',updated_at=now()-interval '6 minutes',result='{}' where deal_id=$1",[deal]);
  await rpc('icash_queue_fulfillment');
  assert.equal((await one('select state from icash_fulfillment_jobs where deal_id=$1',[deal])).state,'ready','buyer work wakes before the one-day refresh');
 });

 await isolated(async()=>{
  await q("update icash_fulfillment_jobs set state='held',updated_at=now()-interval '2 days' where deal_id=$1",[deal]);
  await rpc('icash_queue_fulfillment');
  assert.equal((await one('select state from icash_fulfillment_jobs where deal_id=$1',[deal])).state,'held','never reset held jobs');
  await q('update icash_text_threads set paused=true where id=$1',[thread]);
  const audit=await status();assert.equal(audit.smsContacts,0);assert(audit.blockers.includes('no_direct_buyer_contacts'));
 });

 await isolated(async()=>{
  let sent=0;
  const emailService=await loadService('lib/buyer-package-email.ts',{db,dealTermsSchema,dealEmailConfigured:()=>true,dispatchDealEmail:async(a,id)=>{
   const claim=await rpc('icash_claim_deal_email',{p_account:a,p_id:id});
   assert(claim,'real SQL email dispatch admission');sent++;
   await q("update icash_deal_emails set state='accepted',provider_id=$2 where id=$1",[id,randomUUID()]);
   return {status:'email_accepted'};
  }});
  for(const email of ['a','b','c','d','e','f','a'])await q("insert into icash_text_messages(account_id,thread_id,direction,body,state) values($1,$2,'incoming',$3,'received')",[account,thread,'Please email the package to '+email+'@example.invalid']);
  const keys=await rpc('icash_buyer_package_email_targets',{p_account:account,p_deal:deal});
  assert.equal(keys.length,3);
  for(const row of keys){const h=createHash('sha256').update(`${account}:${deal}:${envelope}:${row.email}`).digest('hex');assert.equal(row.request_key,`${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`,'same keys as previously sent packages');}
  assert.equal((await emailService.sendRequestedBuyerPackages(account,deal)).accepted,3);
  await q("update icash_deal_emails set created_at=now()-interval '2 minutes' where account_id=$1",[account]);
  assert.equal((await emailService.sendRequestedBuyerPackages(account,deal)).accepted,3,'fourth through sixth requests reach final claims');
  assert.equal((await emailService.sendRequestedBuyerPackages(account,deal)).accepted,0);
  assert.equal(sent,6,'duplicate request is not a seventh package');
  assert.equal((await status()).emailsAccepted,6);
  const receipt=await one('select id from icash_deal_emails where account_id=$1 order by recipient limit 1',[account]);
  await q("update icash_deal_emails set state='needs_review' where id=$1",[receipt.id]);
  assert.equal((await emailService.sendRequestedBuyerPackages(account,deal)).accepted,0,'uncertain delivery never retries');
 });
 for(const role of ['anon','authenticated'])for(const signature of ['icash_prepare_buyer_outreach(uuid,uuid)','icash_buyer_outreach_status(uuid,uuid)','icash_buyer_package_email_targets(uuid,uuid)'])assert.equal((await one('select has_function_privilege($1,$2,\'execute\') allowed',[role,signature])).allowed,false);
 console.log('PASS automatic buyer outreach: no campaign or second Run; actual SMS/email claims; no funds qualification for introductions; six email recipients across batches; no duplicate/uncertain retry; intake/manual/STOP/membership/credit/tenant gates; prompt scheduling and truthful contact counts. Zero provider requests.');
}
