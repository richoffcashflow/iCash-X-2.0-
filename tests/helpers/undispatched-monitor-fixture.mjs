import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export async function verifyUndispatchedMonitoring({pg,one,refresh,id}){
 await pg.exec(`
 create table icash_accounts(id uuid primary key,bot_paused boolean default false,member boolean default true,sms_enabled boolean default true,voice_enabled boolean default true);
 create table icash_wallets(account_id uuid primary key,balance_cents bigint);
 create table icash_billing_reviews(account_id uuid,resolved_at timestamptz);
 create table icash_seller_intakes(id uuid primary key,phone text);
 create table icash_seller_responses(lead_id uuid,account_id uuid,screening_id uuid,state text,created_at timestamptz);
 create table icash_property_controls(account_id uuid,property_id text,manual boolean);
 create table icash_handoffs(account_id uuid,screening_id uuid,state text);
 create table icash_text_suppressions(phone text);
 create table icash_contact_suppressions(contact_key text);
 create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,phone text);
 create table icash_fulfillment_jobs(id uuid primary key,account_id uuid,deal_id uuid,state text,updated_at timestamptz);
 alter table icash_deal_files add terms jsonb default '{}';
 alter table icash_screening_jobs add snapshot jsonb default '{}';
 alter table icash_text_threads add party text default 'seller',add paused boolean default false,add ai_mode text default 'auto',add manual_only boolean default false,add sms_intake_pending boolean default false;
 alter table icash_voice_jobs add permission_id uuid,add callback_id uuid,add due_at timestamptz default now(),add provider_call_sid text;
 -- Controlled eligibility inputs; full channel, signed-package and membership
 -- admission are exercised by the automatic outreach SQL suites.
 create function icash_membership_work_allowed(uuid) returns boolean language sql set search_path='' as $$select member from public.icash_accounts where id=$1$$;
 create function icash_outreach_sms_current(uuid) returns boolean language sql set search_path='' as $$select sms_enabled from public.icash_accounts where id=$1$$;
 create function icash_outreach_voice_current(uuid) returns boolean language sql set search_path='' as $$select voice_enabled from public.icash_accounts where id=$1$$;
 create function icash_buyer_outreach_running(uuid,uuid) returns boolean language sql set search_path='' as $$select exists(select 1 from public.icash_deal_files where account_id=$1 and id=$2 and stage='under_contract' and coalesce(terms->>'testHold','false')<>'true')$$;
 grant select on all tables in schema public to service_role;
 `);
 await pg.exec(readFileSync(new URL('../../config/undispatched-work-monitoring.sql',import.meta.url),'utf8'));
 const account=id(20),lead=id(21),screen=id(22),deal=id(23),thread=id(24),permission=id(25),job=id(26),buyerDeal=id(27),buyerJob=id(28);
 await pg.query('insert into icash_accounts(id) values($1)',[account]);
 await pg.query('insert into icash_wallets values($1,1000)',[account]);
 await pg.query("insert into icash_seller_intakes values($1,'+12025550123')",[lead]);
 await pg.query("insert into icash_screening_jobs(id,account_id,state,snapshot) values($1,$2,'complete','{\"propertyId\":\"fixture-property\"}')",[screen,account]);
 await pg.query("insert into icash_deal_files(id,account_id,screening_id,stage) values($1,$2,$3,'draft')",[deal,account,screen]);
 await pg.query("insert into icash_seller_responses values($1,$2,$3,'pending',now())",[lead,account,screen]);
 await pg.exec("select icash_record_service_heartbeat('worker','ok')");
 assert.equal((await refresh()).snapshot.issueCount,0,'new handoffs have time to run');
 await pg.query("update icash_seller_responses set created_at=now()-interval '6 minutes'");
 let report=await refresh();assert.equal(report.status,'degraded');assert.equal(report.snapshot.issues[0].kind,'seller_response','no queue or receipt can no longer masquerade as healthy');
 assert.equal(report.snapshot.issues[0].accountId,account);assert(!JSON.stringify(report).includes('+1202'));
 for(const [change,undo] of [
  ['update icash_accounts set bot_paused=true','update icash_accounts set bot_paused=false'],
  ['update icash_wallets set balance_cents=0','update icash_wallets set balance_cents=1000'],
  ['update icash_accounts set member=false','update icash_accounts set member=true'],
  ['update icash_accounts set sms_enabled=false,voice_enabled=false','update icash_accounts set sms_enabled=true,voice_enabled=true'],
  ["insert into icash_property_controls values('"+account+"','fixture-property',true)",'delete from icash_property_controls'],
  ["insert into icash_text_suppressions values('+12025550123')",'delete from icash_text_suppressions'],
 ]){await pg.exec(change);assert.equal((await refresh()).snapshot.issueCount,0,'intentional admission hold is not a software stall: '+change);await pg.exec(undo);}
 await pg.query("insert into icash_text_threads(id,account_id,sender,recipient,deal_id) values($1,$2,'+12025550100','+12025550123',$3)",[thread,account,deal]);
 await pg.query("insert into icash_text_messages(id,account_id,thread_id,direction,state,provider_id) values($1,$2,$3,'outgoing','delivered','SIMULATION receipt')",[id(29),account,thread]);
 await pg.query("insert into icash_contact_permissions values($1,$2,$3,'+12025550123')",[permission,account,screen]);
 await pg.query("insert into icash_voice_jobs(id,account_id,state,permission_id,due_at) values($1,$2,'ready',$3,now()+interval '8 hours')",[job,account,permission]);
 assert.equal((await refresh()).snapshot.issueCount,0,'a delivered text plus scheduled call is not a setup failure');
 await pg.query("update icash_voice_jobs set due_at=now()-interval '6 minutes' where id=$1",[job]);
 assert.equal((await refresh()).snapshot.issues[0].kind,'seller_response','overdue first call is visible even with an empty dispatch queue');
 await pg.query("update icash_voice_jobs set state='dispatched',provider_call_sid='SIMULATION call receipt' where id=$1",[job]);
 assert.equal((await refresh()).snapshot.issueCount,0,'actual provider receipts clear the missing-start finding');
 await pg.query("insert into icash_deal_files(id,account_id,stage) values($1,$2,'under_contract')",[buyerDeal,account]);
 await pg.query("insert into icash_fulfillment_jobs values($1,$2,$3,'ready',now()-interval '11 minutes')",[buyerJob,account,buyerDeal]);
 report=await refresh();assert.equal(report.snapshot.issues[0].kind,'buyer_fulfillment');
 await pg.query("update icash_deal_files set terms='{\"testHold\":true}' where id=$1",[buyerDeal]);
 assert.equal((await refresh()).snapshot.issueCount,0,'explicit buyer test holds are preserved');
 await pg.query("update icash_deal_files set terms='{}' where id=$1",[buyerDeal]);
 await pg.query("update icash_fulfillment_jobs set state='held'");
 assert.equal((await refresh()).snapshot.issueCount,0,'a held buyer job is not reopened or called stalled');
 await pg.exec('set role service_role');
 assert.equal(await one('select count(*)::int from public.icash_undispatched_outreach_findings()'),0);
 await pg.exec('reset role');
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'public.icash_undispatched_outreach_findings()','EXECUTE')",[role]),false);
}
