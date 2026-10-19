import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
import {processSellerEmails} from '../lib/seller-email-service.ts';
const require=createRequire(import.meta.url),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('NETWORK BLOCKED: seller email fixtures only');};
const f=await createOperationalContactFixture(require.resolve('@electric-sql/pglite'),{automaticChannels:true});
const {pg,q,one,rpc,isolated,account,user,other,screening,deal,phone}=f;
try{
 await pg.exec(read('config/customer-email-delivery.sql'));
 await pg.exec(read('config/customer-email-delivery-types.sql'));
 await pg.exec(`create table icash_seller_intakes(id uuid primary key,phone text,email text,email_consented boolean,name text,state text,created_at timestamptz default now(),data_rights_until timestamptz,attribution jsonb);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
 create table fixture_seller_email_policy(member boolean default true,evidence boolean default true,hours boolean default true,active boolean default false,claimed integer default 0);
 insert into fixture_seller_email_policy default values;
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select member from public.fixture_seller_email_policy$$;
 create function icash_seller_contact_evidence(uuid,uuid,uuid,text) returns jsonb language sql as $$select case when evidence then '{}'::jsonb end from public.fixture_seller_email_policy$$;
 create function icash_outreach_window_open(text,text,timestamptz) returns boolean language sql as $$select hours from public.fixture_seller_email_policy$$;
 create function icash_outreach_active_conversation(uuid,uuid,text,timestamptz) returns boolean language sql as $$select active from public.fixture_seller_email_policy$$;`);
 // Use the deployed contact projection rather than inventing email eligibility.
 const source=read('supabase/migrations/20261005200735_automatic_credits_and_manual_conversations.sql');
 await pg.exec(source.slice(source.indexOf('alter function public.icash_deal_email_contacts'),source.indexOf('revoke all on function public.icash_credit_work_pace')));
 // Preserve real queue validation; isolate provider/billing claim in this test.
 await pg.exec(`create or replace function public.icash_claim_deal_email(p_account uuid,p_id uuid) returns jsonb language plpgsql set search_path='' as $$declare m public.icash_deal_emails;begin
 select * into m from public.icash_deal_emails where id=p_id and account_id=p_account and state='ready';if not found then return null;end if;
 update public.fixture_seller_email_policy set claimed=claimed+1;update public.icash_deal_emails set state='dispatching' where id=p_id;
 return jsonb_build_object('id',p_id,'to',m.recipient);end$$;`);
 await pg.exec('create table icash_meta_leads(account_id uuid,screening_id uuid,response_at timestamptz)');
 const recovery=read('config/seller-gap-recovery.sql'),stopStart=recovery.indexOf('create function public.icash_seller_contact_stop(');
 await pg.exec(recovery.slice(stopStart,recovery.indexOf('$$;',stopStart)+3));
 await pg.exec(read('config/opportunity-engine.sql'));
 await pg.exec(read('config/automatic-seller-email.sql'));
 const lead=randomUUID(),email='seller@example.invalid';
 await q("insert into icash_seller_intakes values($1,$2,$3,true,'Fixture seller','assigned',now(),now()+interval '2 days','{\"contactTimezone\":\"America/Chicago\",\"contactTimezoneSource\":\"seller_browser\"}')",[lead,phone,email]);
 await q('insert into icash_seller_matches values($1,$2,$3)',[lead,account,screening]);
 await q("update icash_screening_jobs set snapshot=snapshot||jsonb_build_object('sellerRequest',jsonb_build_object('id',$2::text)) where id=$1",[screening,lead]);
 await q("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) select 'manual_email','SIMULATION seller email',charge_cents,costs_micros,'SIMULATION email costs',verified_at,expires_at,true from icash_operation_rates where id=$1",[f.sms]);
 const queue=()=>rpc('icash_queue_seller_emails',{p_limit:10}),claim=id=>rpc('icash_claim_deal_email',{p_account:account,p_id:id}),opening=()=>rpc('icash_seller_email_opening',{p_account:account,p_deal:deal});
 assert.equal((await opening()).recipient,email);
 assert.equal(await rpc('icash_seller_email_opening',{p_account:other,p_deal:deal}),null);
 const first=(await queue())[0];assert(first.email_id);assert.equal(first.account_id,account);
 assert.deepEqual(await queue(),[first],'queue retry preserves the one durable request');
 assert.equal((await one('select count(*) n from icash_seller_email_openers')).n,1);
 assert.equal((await one("select count(*) n from icash_operation_spend where operation_key like 'deal-email:%'")).n,0,'queue does not bill or reserve');
 assert.equal((await one('select balance_cents from icash_wallets where account_id=$1',[account])).balance_cents,100000);
 for(const [label,sql] of [
 ['pause','update icash_accounts set bot_paused=true'],['no credits','update icash_wallets set balance_cents=0'],
 ['membership','update fixture_seller_email_policy set member=false'],['consent evidence revoked','update fixture_seller_email_policy set evidence=false'],
 ['outside hours','update fixture_seller_email_policy set hours=false'],['unknown hours','update fixture_seller_email_policy set hours=null'],['already talking','update fixture_seller_email_policy set active=true'],
 ['email consent withdrawn','update icash_seller_intakes set email_consented=false'],['expired rights',"update icash_seller_intakes set data_rights_until=now()-interval '1 minute'"],
 ['raw data without assigned consent',"update icash_screening_jobs set snapshot=snapshot-'sellerRequest'"],
 ['practice',"update icash_deal_files set terms=terms||'{\"practice\":true}'"],['contract exists',"update icash_deal_files set stage='under_contract'"],
 ['stale research',"update icash_screening_jobs set completed_at=now()-interval '25 hours'"],['financial hold',"update icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"hold\"}}'"],
 ['recipient changed',"update icash_seller_intakes set email='different@example.invalid'"],
 ['address changed',"update icash_deal_files set terms=terms||'{\"address\":\"Different property\"}'"],
 ['email suppression',`insert into icash_email_suppressions(account_id,email,reason) values('${account}','${email}','fixture')`],
 ['text STOP',`insert into icash_text_suppressions(phone,reason) values('${phone}','fixture')`],
 ['manual property',`insert into icash_property_controls(account_id,property_id,manual) values('${account}','prop_1001',true)`]
 ])await isolated(async()=>{await q(sql);assert.equal(await claim(first.email_id),null,label);assert.equal((await one('select claimed from fixture_seller_email_policy')).claimed,0,label+' never reaches provider claim');});
 await isolated(async()=>{await q("update icash_deal_emails set permission_until=now()-interval '1 minute'");assert.deepEqual(await queue(),[],'expired queued work cannot monopolize the next batch');});
 await isolated(async()=>{assert(await claim(first.email_id));assert.equal(await claim(first.email_id),null);assert.deepEqual(await queue(),[]);});
 for(const state of ['accepted','dispatching','needs_review'])await isolated(async()=>{await q('update icash_deal_emails set state=$1 where id=$2',[state,first.email_id]);assert.deepEqual(await queue(),[],state+' is never reopened');});
 await isolated(async()=>{
  await q("update icash_deal_emails set state='accepted',provider_id=$2 where id=$1",[first.email_id,randomUUID()]);
  const reply=(sender,authenticated,text)=>rpc('icash_record_deal_email_reply',{p_email:randomUUID(),p_reference:first.email_id,p_sender:sender,p_subject:'Re: property',p_text:text,p_authenticated:authenticated});
  await reply(email,false,'unsubscribe');await reply('wrong@example.invalid',true,'unsubscribe');assert.equal((await one('select count(*) n from icash_email_suppressions')).n,0);
  await rpc('icash_refresh_opportunity_outcomes',{p_account:account});
  assert.equal((await one('select responded from icash_opportunity_outcomes where screening_id=$1',[screening])).responded,false,'accepted email is not a seller response');
  await reply(email,true,'unsubscribe');
  await q('delete from icash_opportunity_refreshes');
  await rpc('icash_refresh_opportunity_outcomes',{p_account:account});
  assert.equal((await one('select responded from icash_opportunity_outcomes where screening_id=$1',[screening])).responded,true,'authenticated reply promotes the existing property card');
  assert.equal((await one('select opted_out from icash_opportunity_outcomes where screening_id=$1',[screening])).opted_out,true,'unsubscribe is a response without inferred interest');assert.equal((await one('select count(*) n from icash_email_suppressions')).n,1);
  assert.equal((await one("select count(*) n from icash_deal_emails where direction='incoming'")).n,1,'real reply remains visible');
 });
 await q('set role anon');await assert.rejects(queue,/permission denied/);await assert.rejects(()=>q('select * from icash_seller_email_openers'),/permission denied/);await q('reset role');
 assert.equal(read('config/automatic-seller-email.sql'),read('supabase/migrations/20261019170227_automatic_seller_email.sql'));
 let calls=0;const fakeDb=async()=>{calls++;return [{account_id:account,email_id:'one'},{account_id:account,email_id:'two'}];};
 assert.equal((await processSellerEmails({db:fakeDb,dispatch:async()=>{throw Error();},configured:()=>true,env:{VERCEL_ENV:'preview',ICASH_LIVE_WORK_READY:'true'}})).status,'disabled');assert.equal(calls,0);
 assert.equal((await processSellerEmails({db:fakeDb,dispatch:async()=>{throw Error();},configured:()=>false,env:{VERCEL_ENV:'production',ICASH_LIVE_WORK_READY:'true'}})).status,'seller_email_configuration_required');assert.equal(calls,0);
 const result=await processSellerEmails({db:fakeDb,dispatch:async(a,id)=>{if(id==='one')throw Error('fixture failure');return {status:'email_accepted'};},configured:()=>true,env:{VERCEL_ENV:'production',ICASH_LIVE_WORK_READY:'true'}});
 assert.equal(result.accepted,1);assert.equal(result.held,1,'one changed recipient does not swallow another');
 console.log('Automatic seller email SQL and worker tests passed. Local permission/hour/claim delegates; no provider calls or production mutations.');
}finally{await pg.close();globalThis.fetch=originalFetch;}
