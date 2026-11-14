import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {databaseAdapter} from './helpers/simulated-journey-services.mjs';
import {purchaseAccessFollowupMessage} from '../lib/purchase-access-followups.ts';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const pg=await PGlite.create(),{rpc,q}=databaseAdapter(pg);
const source=read('supabase/migrations/20261017171814_paid_phone_access_recovery.sql');
const functionSql=(text,name)=>{
 const start=text.indexOf('create or replace function public.'+name+'(');
 const fallback=text.indexOf('create function public.'+name+'(');
 const at=start>=0?start:fallback;
 assert(at>=0,`Actual function ${name} is present`);
 const end=text.indexOf('$$;',at);assert(end>=0);return text.slice(at,end+3);
};
let nextPhone=1000;
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 -- Match Supabase's default table grants: a later narrower GRANT does not revoke them.
 alter default privileges in schema public grant all privileges on tables to service_role;
 create table icash_memberships(id uuid primary key,mode text,state text,paid_through timestamptz,payer_email text,payer_phone text,account_id uuid,guest_hash text,stripe_session_id text,post_purchase_webinar_id uuid);
 create table icash_membership_invoices(stripe_invoice_id text primary key,membership_id uuid references icash_memberships,amount_cents bigint,stripe_payment_id text,recorded_at timestamptz default now());
 create table icash_billing_reviews(payment_id text,resolved_at timestamptz);
 create table icash_email_suppressions(email text,reason text);
 create table icash_webinar_suppressions(email text primary key,reason text);
 create table icash_webinars(id uuid primary key,parent_webinar_id uuid,config jsonb);
 create table icash_webinar_visitors(id uuid primary key,email text,phone text,funding_guest_hash text,account_id uuid,sms_consent_at timestamptz,sms_opted_out_at timestamptz,sms_consent_version text);
 create table icash_text_suppressions(phone text primary key,reason text);
 create table icash_webinar_phone_suppressions(phone text primary key);
 create table icash_messaging_settings(id int,config jsonb);insert into icash_messaging_settings values(1,'{"smsEnabled":true}');
 create table icash_webinar_text_senders(phone text primary key,enabled boolean default true,preferred boolean default true);
 create table icash_webinar_text_assignments(recipient text primary key,sender text);
 create table icash_text_threads(sender text,recipient text,retired_at timestamptz);
 create table icash_webinar_delivery_receipts(channel text,provider_id text,kind text,primary key(channel,provider_id));
 create table icash_purchase_access_contacts(membership_id uuid,checkout_id text,phone text);
 create table icash_software_access_receipts(account_id uuid,recorded_at timestamptz);
 create table icash_workspace_walkthroughs(account_id uuid,course_opened_at timestamptz);
 create table icash_course_progress(account_id uuid,updated_at timestamptz);
 insert into icash_webinar_text_senders(phone) values('+12125550100');`);
 await pg.exec(functionSql(read('supabase/migrations/20261008174620_customer_lifecycle_and_text_roles.sql'),'icash_webinar_campaign_sender'));
 await pg.exec(read('supabase/migrations/20261017145924_purchase_access_email.sql'));
 await pg.exec(read('supabase/migrations/20261017152224_purchase_access_reminder_and_text.sql'));
 await pg.exec(read('supabase/migrations/20261017152700_purchase_access_phone_normalization.sql'));
 await pg.exec('alter table icash_purchase_access_followups add column checkout_permission boolean not null default false;');
 await pg.exec(functionSql(source,'icash_access_phone'));
 await pg.exec(functionSql(source,'icash_purchase_access_followup_allowed'));
 const beforePredicate=(await q("select pg_get_functiondef('icash_purchase_access_followup_allowed(uuid)'::regprocedure) as definition")).rows[0].definition;
 const followup=async(p,channel='email')=>(await q('select * from icash_purchase_access_followups where membership_id=$1 and channel=$2',[p.id,channel])).rows[0];
 const emailRow=async p=>(await q('select * from icash_purchase_access_emails where membership_id=$1',[p.id])).rows[0];
 async function purchase({linked=false,attempted=true,sent=true}={}){
  const id=randomUUID(),account=linked?randomUUID():null,email=id+'@example.invalid',visitor=randomUUID(),guest=randomUUID(),phone='+1212555'+String(nextPhone++),provider=randomUUID();
  await q("insert into icash_memberships values($1,'live','active',now()+interval '1 month',$2,$3,$4,$5,$6,null)",[id,email,phone,account,guest,'cs_'+id]);
  await q("insert into icash_membership_invoices values($1,$2,5000,$3,now()-interval '1 minute')",['in_'+id,id,'pi_'+id]);
  await q("insert into icash_webinar_visitors values($1,$2,$3,$4,$5,now(),null,'webinar-sms-ongoing-2026-10-09')",[visitor,email,phone,guest,account]);
  await q("insert into icash_purchase_access_contacts values($1,$2,$3)",[id,'cs_'+id,phone]);
  await q("insert into icash_purchase_access_emails(membership_id,invoice_id,recipient,status,first_attempt_at,provider_id,message) values($1,$2,$3,$4,case when $5 then now() else null end,$6,case when $5 then jsonb_build_object('to',jsonb_build_array($3::text)) else null end)",[id,'in_'+id,email,sent?'sent':attempted?'sending':'pending',attempted,sent?provider:null]);
  const p={id,email,account,phone,provider,visitor};
  await q("update icash_purchase_access_followups set due_at=now()-interval '1 second',next_attempt_at=now()-interval '1 second' where membership_id=$1",[id]);
  return p;
 }
 const old=await purchase({linked:true});
 const historicalCanceled=await purchase();
 await q("update icash_purchase_access_emails set created_at=now()-interval '1 day' where membership_id in($1,$2)",[old.id,historicalCanceled.id]);
 await q("update icash_purchase_access_followups set status='canceled',attempts=1 where membership_id=$1",[historicalCanceled.id]);
 const historyBefore=(await q('select * from icash_purchase_access_followups where membership_id=$1 order by channel',[historicalCanceled.id])).rows;
 const migration=read('supabase/migrations/20261114175727_unopened_purchase_access_reminder.sql');
 assert.equal(migration,read('config/unopened-purchase-access-reminder.sql'),'Reviewed configuration is byte-identical to the deployable migration');
 await pg.exec(migration);
 const privileges=async table=>(await q("select privilege,has_table_privilege('service_role',$1,privilege) as allowed from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege",[table])).rows;
 for(const table of ['icash_purchase_email_engagement','icash_purchase_access_reminder_policy'])assert((await privileges(table)).every(p=>p.allowed),'Production-default grants reproduce the original overbroad service-role permissions');
 const disabledBeforePermissions=(await q('select * from icash_purchase_access_reminder_policy')).rows;
 const permissionMigration=read('supabase/migrations/20261114180122_unopened_purchase_access_reminder_permissions.sql');
 assert.equal(permissionMigration,read('config/unopened-purchase-access-reminder-permissions.sql'),'Permission remediation matches the installed migration');
 await pg.exec(permissionMigration);
 assert.deepEqual((await q('select * from icash_purchase_access_reminder_policy')).rows,disabledBeforePermissions,'Permission remediation cannot activate or change the rollout cutoff');
 for(const [table,expected] of [['icash_purchase_email_engagement',['SELECT','INSERT']],['icash_purchase_access_reminder_policy',['SELECT','UPDATE']]]){
  const actual=(await privileges(table)).filter(p=>p.allowed).map(p=>p.privilege).sort();
  assert.deepEqual(actual,[...expected].sort(),`${table} keeps only its intended runtime privileges`);
 }
 assert.equal((await q('select enabled from icash_purchase_access_reminder_policy')).rows[0].enabled,false,'Install inactive');
 const allowed=async(p,channel='email')=>rpc('icash_purchase_access_followup_allowed',{p_id:(await followup(p,channel)).id});
 const needed=async p=>rpc('icash_purchase_email_reminder_needed',{p_id:(await emailRow(p)).id});
 const record=async(p,overrides={})=>rpc('icash_record_purchase_email_engagement',{p_event:randomUUID(),p_id:(await emailRow(p)).id,p_provider:p.provider,p_recipient:p.email,p_kind:'opened',p_at:new Date().toISOString(),...overrides});
 const count=async p=>(await q('select count(*)::int as n from icash_purchase_email_engagement where purchase_email_id=$1',[(await emailRow(p)).id])).rows[0].n;
 assert.equal(await allowed(old),false,'Disabled policy preserves account-claim suppression');
 const disabledUnclaimed=await purchase();await record(disabledUnclaimed);assert.equal(await allowed(disabledUnclaimed),true,'Disabled policy preserves old behavior even with engagement stored');
 await q("update icash_purchase_access_reminder_policy set enabled=true,activated_at=now() where id=1");
 assert.deepEqual((await q('select * from icash_purchase_access_followups where membership_id=$1 order by channel',[historicalCanceled.id])).rows,historyBefore,'Activation does not requeue old jobs');
 assert.equal(await allowed(old),false,'Pre-cutover linked accounts retain old predicate');
 assert.equal(await allowed(disabledUnclaimed),true,'Pre-cutover unclaimed accounts retain existing sequence');

 const linked=await purchase({linked:true});assert.equal(await allowed(linked),true,'Account linkage alone is not actual entry');
 const claim=await rpc('icash_claim_purchase_access_followup',{p_channel:'email',p_membership:linked.id});assert(claim);
 const message=await rpc('icash_authorize_purchase_access_followup',{p_id:claim.id,p_claim:claim.claimToken,p_message:purchaseAccessFollowupMessage(claim)});assert(message);
 await rpc('icash_finish_purchase_access_followup',{p_id:claim.id,p_claim:claim.claimToken,p_provider:randomUUID()});
 assert.equal(await rpc('icash_claim_purchase_access_followup',{p_channel:'email',p_membership:linked.id}),null,'Finite existing outbox prevents extra reminders');
 for(const kind of ['opened','clicked']){
  const p=await purchase({linked:true});await record(p,{p_kind:kind});assert.equal(await needed(p),false,`${kind} suppresses reminder`);
  assert.equal(await rpc('icash_claim_purchase_access_followup',{p_channel:'email',p_membership:p.id}),null);
  assert.equal((await followup(p)).status,'canceled');assert.equal((await emailRow(p)).delivery,null,'Engagement does not invent delivery');
 }
 for(const [table,column] of [['icash_software_access_receipts','recorded_at'],['icash_workspace_walkthroughs','course_opened_at'],['icash_course_progress','updated_at']]){
  const p=await purchase({linked:true});await q(`insert into ${table}(account_id,${column}) values($1,now()-interval '2 hours')`,[p.account]);
  assert.equal(await allowed(p),true,'Old product activity does not suppress a later purchase reminder');
  await q(`insert into ${table}(account_id,${column}) values($1,now())`,[p.account]);assert.equal(await allowed(p),false,`${table} stops reminder after actual entry`);
 }
 const early=await purchase({linked:true,sent:false});await record(early);assert.equal(await count(early),1,'Signed event can precede send receipt');assert.equal(await needed(early),true,'Unbound provider event has no effect');
 await q("update icash_purchase_access_emails set provider_id=$2,status='sent' where membership_id=$1",[early.id,early.provider]);assert.equal(await needed(early),false,'Same provider receipt binds early event');
 const mismatched=await purchase({linked:true,sent:false});await record(mismatched,{p_provider:randomUUID()});await q("update icash_purchase_access_emails set provider_id=$2,status='sent' where membership_id=$1",[mismatched.id,mismatched.provider]);assert.equal(await needed(mismatched),true,'Different-provider early event never suppresses');
 const responseLost=await purchase({linked:true,sent:false});
 await q("update icash_purchase_access_emails set status='pending' where membership_id=$1",[responseLost.id]);
 await record(responseLost);assert.equal(await count(responseLost),1,'Signed open survives a lost response and pending idempotent retry');
 assert.equal(await needed(responseLost),true,'Pending receipt is not assumed to match the provider');
 await q("update icash_purchase_access_emails set provider_id=$2,status='sent' where membership_id=$1",[responseLost.id,responseLost.provider]);assert.equal(await needed(responseLost),false);

 const invalid=await purchase({linked:true});
 const invalidEvents=[{p_id:randomUUID()},{p_provider:randomUUID()},{p_recipient:'someone-else@example.invalid'},{p_event:''},{p_event:'x'.repeat(201)},{p_kind:'delivered'},{p_provider:'invalid'},{p_at:new Date(Date.now()+6*60000).toISOString()},{p_at:new Date(Date.now()-6*60000).toISOString()},{p_at:'infinity'},{p_at:null}];
 for(const overrides of invalidEvents){await record(invalid,overrides);assert.equal(await count(invalid),0,JSON.stringify(overrides));}
 const unattempted=await purchase({sent:false,attempted:false});await record(unattempted);assert.equal(await count(unattempted),0,'No attempted first email means no binding');
 const noTagEarly=await purchase({sent:false});await record(noTagEarly,{p_id:null});assert.equal(await count(noTagEarly),0,'Unknown-provider early event requires exact email tag');
 const eventId=randomUUID();await record(invalid,{p_event:eventId,p_recipient:' '+invalid.email.toUpperCase()+' '});
 const recorded=(await q('select * from icash_purchase_email_engagement where event_id=$1',[eventId])).rows[0];
 await record(invalid,{p_event:eventId,p_kind:'clicked',p_at:new Date(Date.now()+1000).toISOString()});
 assert.deepEqual((await q('select * from icash_purchase_email_engagement where event_id=$1',[eventId])).rows[0],recorded,'Duplicate event cannot rewrite original evidence');
 const noTag=await purchase();await record(noTag,{p_id:null});assert.equal(await count(noTag),1,'Known exact provider+recipient binding does not require a tag');

 const race=await purchase({linked:true});const racedClaim=await rpc('icash_claim_purchase_access_followup',{p_channel:'email',p_membership:race.id});assert(racedClaim);await record(race);
 assert.equal(await rpc('icash_authorize_purchase_access_followup',{p_id:racedClaim.id,p_claim:racedClaim.claimToken,p_message:purchaseAccessFollowupMessage(racedClaim)}),null,'Open between claim and final authorization blocks dispatch');
 assert.equal((await followup(race)).status,'canceled');
 for(const change of ['bounce','complaint','failed','suppression','cancel','review','expired','wrong_email']){
  const p=await purchase({linked:true});
  if(change==='bounce'||change==='complaint')await q('update icash_purchase_access_emails set delivery=$2 where membership_id=$1',[p.id,change==='bounce'?'bounced':'complained']);
  if(change==='failed')await q("update icash_purchase_access_emails set delivery='failed' where membership_id=$1",[p.id]);
  if(change==='suppression')await q("insert into icash_email_suppressions values($1,'suppressed')",[p.email]);
  if(change==='cancel')await q("update icash_memberships set state='cancelled' where id=$1",[p.id]);
  if(change==='review')await q('insert into icash_billing_reviews values($1,null)',['pi_'+p.id]);
  if(change==='expired')await q("update icash_memberships set paid_through=now()-interval '1 second' where id=$1",[p.id]);
  if(change==='wrong_email')await q("update icash_memberships set payer_email='changed@example.invalid' where id=$1",[p.id]);
  assert.equal(await allowed(p),false,`Original ${change} protection remains`);
 }
 const sms=await purchase({linked:true});await record(sms);assert.equal(await allowed(sms,'sms'),true,'Email engagement does not change SMS admission');
 await q("update icash_purchase_access_followups set checkout_permission=true where membership_id=$1 and channel='sms'",[sms.id]);assert.equal(await allowed(sms,'sms'),true,'Current checkout-phone permission remains supported');
 await q("update icash_messaging_settings set config='{"+'"smsEnabled":false'+"}'");assert.equal(await allowed(sms,'sms'),false,'SMS disable is preserved');
 await q("update icash_messaging_settings set config='{"+'"smsEnabled":true'+"}'");
 await q("insert into icash_text_suppressions values($1,'STOP')",[sms.phone]);assert.equal(await allowed(sms,'sms'),false,'SMS STOP remains authoritative');
 const afterPredicate=(await q("select pg_get_functiondef('icash_purchase_access_followup_allowed(uuid)'::regprocedure) as definition")).rows[0].definition;
 assert.equal(afterPredicate,beforePredicate.replace('m.account_id is null and f.recipient=e.recipient','public.icash_purchase_email_reminder_needed(e.id) and f.recipient=e.recipient'),'Only the email activation predicate changes');
 await q('update icash_purchase_access_reminder_policy set enabled=false where id=1');assert.equal(await allowed(await purchase({linked:true})),false,'Disabling safely returns to original behavior');
 const linkedEmailId=(await emailRow(linked)).id;
 for(const role of ['anon','authenticated']){
  await pg.exec('set role '+role);
  for(const table of ['icash_purchase_email_engagement','icash_purchase_access_reminder_policy'])await assert.rejects(()=>q('select * from '+table));
  await assert.rejects(()=>q("select icash_purchase_email_reminder_needed($1)",[linkedEmailId]));
  await assert.rejects(()=>q("select icash_record_purchase_email_engagement('event',null,null,null,null,null)"));
  await pg.exec('reset role');
 }
 await pg.exec('set role service_role');
 await q('select * from icash_purchase_email_engagement where event_id=$1',[eventId]);
 await record(noTag,{p_event:'service-insert-'+randomUUID()});
 await q('select * from icash_purchase_access_reminder_policy');
 await q('update icash_purchase_access_reminder_policy set enabled=false where id=1');
 await assert.rejects(()=>q('update icash_purchase_email_engagement set kind=\'clicked\' where event_id=$1',[eventId]),'Runtime cannot rewrite engagement evidence');
 await assert.rejects(()=>q('delete from icash_purchase_email_engagement where event_id=$1',[eventId]),'Runtime cannot delete engagement evidence');
 await assert.rejects(()=>q('truncate icash_purchase_email_engagement'),'Runtime cannot truncate engagement evidence');
 await assert.rejects(()=>q('insert into icash_purchase_access_reminder_policy(id) values(1) on conflict do nothing'),'Runtime cannot insert a rollout policy');
 await assert.rejects(()=>q('delete from icash_purchase_access_reminder_policy where id=1'),'Runtime cannot delete the rollout policy');
 await assert.rejects(()=>q('truncate icash_purchase_access_reminder_policy'),'Runtime cannot truncate the rollout policy');
 await pg.exec('reset role');
 assert.deepEqual((await q('select * from icash_purchase_access_followups where membership_id=$1 order by channel',[historicalCanceled.id])).rows,historyBefore,'Historical canceled rows stay untouched throughout');
 console.log('PASS unopened purchase reminder: real current SQL admission; inactive/cutover behavior, finite reminders, linked-but-unused accounts, opened/clicked and actual-use stops, provider-bound early events, malformed/duplicate events, final-authorization races, payment/suppression/SMS preservation, private permissions, no historical replay. No live messages.');
}finally{await pg.close();}
