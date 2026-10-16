// Local fixtures only. No network, live records, provider calls or customer charges.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const pg=await PGlite.create(),q=(sql,values=[])=>pg.query(sql,values),one=async(sql,v=[])=>(await q(sql,v)).rows[0];
const [account,other,owner,lead,request,job,permission,screen]=Array.from({length:8},()=>randomUUID());
const version='icash-optin-call-now-2026-10-16.1',phone='+12145550123';
const requestNow=(source='demo_form',reference=version,actor=owner,acct=account)=>(one('select icash_request_optin_call_now($1,$2,$3,$4,$5,$6) result',[lead,request,source,reference,actor,acct]));
const current=async(acct=account)=>(await one('select icash_requested_optin_call_current($1,$2) ok',[acct,job])).ok;
const claim=async()=>(await one('select icash_claim_voice_job($1) ok',[job])).ok;
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_operating_budget(id integer primary key);insert into icash_operating_budget values(1);
 create table icash_accounts(id uuid primary key,owner_user_id uuid);
 create table icash_seller_intakes(id uuid primary key,request_id uuid,phone text,state text,ai_consented boolean,contact_consent_scope text,attribution jsonb,created_at timestamptz,consent_text text);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
 create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,party text,seller_intake_id uuid,phone text,local_start_hour integer,local_end_hour integer);
 create table icash_voice_jobs(id uuid primary key,account_id uuid,permission_id uuid,sms_source_message_id uuid,state text,operational_contact_id uuid,callback_id uuid,cancellation_notice_id uuid,provider_call_sid text,conversation_id text,created_at timestamptz,due_at timestamptz,outcome text,updated_at timestamptz);
 create table icash_text_suppressions(phone text);create table icash_contact_suppressions(contact_key text);
 create table icash_seller_responses(lead_id uuid,account_id uuid,state text,next_attempt_at timestamptz,updated_at timestamptz);
 create table fixture_policy(voice boolean,request boolean,admission boolean);insert into fixture_policy values(true,false,true);
 create function icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql as $$select voice from public.fixture_policy$$;
 create function icash_requested_seller_call_current(uuid,uuid) returns boolean language sql as $$select request from public.fixture_policy$$;
 create function icash_claim_voice_job(p_job uuid) returns boolean language plpgsql as $$declare j icash_voice_jobs;p icash_contact_permissions;h integer:=0;begin
 select * into j from icash_voice_jobs where id=p_job;select * into p from icash_contact_permissions where id=j.permission_id;
 if not (select admission from fixture_policy) then return false;end if;
 if (h<greatest(9,p.local_start_hour) or h>=least(case when public.icash_seller_voice_permission_current(j.account_id,p.id) then 20 else 18 end,p.local_end_hour)) and not public.icash_requested_seller_call_current(j.account_id,j.id) then return false;end if;
 return true;end$$;`);
 await q('insert into icash_accounts values($1,$2),($3,$2)',[account,owner,other]);
 await q("insert into icash_seller_intakes values($1,$2,$3,'assigned',true,'icash_x_demo',$4,now()-interval '1 minute','Original saved consent')",[lead,request,phone,{demoAccountId:account}]);
 await q("insert into icash_screening_jobs values($1,$2,'complete')",[screen,account]);
 await q('insert into icash_seller_matches values($1,$2,$3)',[lead,account,screen]);
 await q("insert into icash_contact_permissions values($1,$2,$3,'seller',$4,$5,9,20)",[permission,account,screen,lead,phone]);
 await q("insert into icash_voice_jobs values($1,$2,$3,null,'ready',null,null,null,null,null,now(),now()+interval '8 hours','Waiting for calling hours',now())",[job,account,permission]);
 await q("insert into icash_seller_responses values($1,$2,'needs_setup',now()+interval '1 minute',now())",[lead,account]);
 assert.equal(await claim(),false,'Reproduces original night opt-in failure');
 const migration=readFileSync(new URL('../config/optin-call-now.sql',import.meta.url),'utf8');
 assert.equal(readFileSync(new URL('../supabase/migrations/20261016053000_optin_call_now.sql',import.meta.url),'utf8'),migration);
 await pg.exec(migration);await pg.exec(migration);
 assert.equal(await current(),false);assert.equal(await claim(),false,'Consent alone cannot invent an immediate request');
 const grant=(await requestNow()).result;
 assert.equal(grant.requested,true);assert.equal(grant.jobId,job);assert.equal(await current(),true);assert.equal(await claim(),true);
 assert.equal((await one('select due_at<=now() ready from icash_voice_jobs')).ready,true);
 assert.equal((await one("select state in ('pending','needs_setup','queued') and next_attempt_at<=now() retryable from icash_seller_responses")).retryable,true,'Needs-setup response is immediately retryable without changing accepted SMS');
 assert.equal((await one('select consent_text from icash_seller_intakes')).consent_text,'Original saved consent');
 assert.deepEqual((await requestNow()).result,grant,'Retry neither refreshes nor changes the receipt');
 assert.equal(await current(other),false,'Wrong account never inherits permission');
 const denied=[
 "update fixture_policy set voice=false","update fixture_policy set admission=false",
 "update icash_optin_call_requests set requested_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute'",
 "update icash_optin_call_requests set requested_at=now()+interval '1 minute',expires_at=now()+interval '6 minutes'",
 "update icash_voice_jobs set state='dispatched'","update icash_voice_jobs set state='dispatching'",
 "update icash_voice_jobs set callback_id=gen_random_uuid()","update icash_voice_jobs set sms_source_message_id=gen_random_uuid()",
 "update icash_voice_jobs set operational_contact_id=gen_random_uuid()","update icash_voice_jobs set cancellation_notice_id=gen_random_uuid()",
 "update icash_voice_jobs set provider_call_sid='provider-attempt'","update icash_voice_jobs set conversation_id='conversation-attempt'",
 "update icash_contact_permissions set party='buyer'","update icash_contact_permissions set phone='+12145550999'",
 "update icash_screening_jobs set state='archived'","update icash_seller_matches set screening_id=gen_random_uuid()",
 "update icash_seller_intakes set ai_consented=false","update icash_seller_intakes set state='duplicate'",
 "update icash_seller_intakes set attribution='{}'","update icash_seller_intakes set request_id=gen_random_uuid()",
 "update icash_accounts set owner_user_id=gen_random_uuid()",
 ];
 for(const change of denied){await q('begin');await q(change);assert.equal(await claim(),false,change);await q('rollback');}
 await q('begin');await q("insert into icash_voice_jobs select gen_random_uuid(),account_id,permission_id,null,'dispatched',null,null,null,'old-call',null,created_at-interval '1 second',due_at,null,updated_at from icash_voice_jobs");assert.equal(await current(),false,'A new job cannot reuse a consumed initial call grant');await q('rollback');
 await assert.rejects(requestNow('demo_form',version,randomUUID()),/Presenting account/);
 await assert.rejects(requestNow('demo_form','old-version'),/Current call-now statement/);
 await assert.rejects(requestNow('seller_form',version,null,null),/Seller request binding/);
 await assert.rejects(q('select icash_request_optin_call_now($1,$2,$3,$4,$5,$6)',[lead,randomUUID(),'demo_form',version,owner,account]),/Current opt-in/);
 await q('begin');await q('delete from icash_optin_call_requests');await q('insert into icash_text_suppressions values($1)',[phone]);await assert.rejects(requestNow(),/Contact opted out/);await q('rollback');
 await q('begin');await q('delete from icash_optin_call_requests');
 const support=(await requestNow('support_request','Owner support message 2026-10-16: requested this submitted demo call now.')).result;
 assert.equal(support.requested,true);assert.equal(await current(),true);await q('rollback');
 await q('begin');await q('delete from icash_optin_call_requests');
 await q("update icash_seller_intakes set contact_consent_scope='homeoffer_network_and_matched_buyers',attribution='{}'");
 assert.equal((await requestNow('seller_form',version,null,null)).result.requested,true);assert.equal(await current(),true,'Public opt-in initial call now works after hours');
 assert.equal((await one('select account_id,requested_by from icash_optin_call_requests')).account_id,null);
 await q('rollback');
 for(const role of ['anon','authenticated'])for(const fn of ['icash_requested_optin_call_current(uuid,uuid)','icash_request_optin_call_now(uuid,uuid,text,text,uuid,uuid)'])assert.equal((await one('select has_function_privilege($1,$2,\'execute\') ok',[role,fn])).ok,false);
 console.log('PASS after-hours public/private fresh initial calls, original consent retained, one-time expiry/retry, phone/property/account/source/owner binding, provider-attempt no-retry, final admission and private RPC access. Local fixtures only.');
}finally{await pg.close();}
