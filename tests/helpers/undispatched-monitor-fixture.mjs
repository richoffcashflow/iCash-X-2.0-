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
 alter table icash_screening_jobs add snapshot jsonb default '{}',add result jsonb default '{"financialCheck":{"status":"eligible"}}',add completed_at timestamptz default now();
 alter table icash_text_threads add party text default 'seller',add paused boolean default false,add ai_mode text default 'auto',add manual_only boolean default false,add sms_intake_pending boolean default false,add timezone text default 'America/Chicago',add fixture_permission boolean default true,add fixture_inquiry boolean default false;
 create table icash_operation_spend(operation_key text);
 create function icash_seller_sms_permission_current(uuid,uuid,boolean) returns boolean language sql as $$select fixture_permission from public.icash_text_threads where id=$2 and account_id=$1$$;
 create function icash_seller_sms_inquiry_window(uuid,uuid) returns boolean language sql as $$select fixture_inquiry from public.icash_text_threads where id=$2 and account_id=$1$$;
 create function icash_sms_message_route_current(uuid,uuid) returns boolean language sql as $$select exists(select 1 from public.icash_text_messages where id=$2 and account_id=$1)$$;
 alter table icash_voice_jobs add permission_id uuid,add callback_id uuid,add due_at timestamptz default now(),add provider_call_sid text,add outcome text,add operation_key text,add conversation_id text;
 create table icash_call_recordings(id uuid primary key,account_id uuid,voice_job_id uuid,operation_key text,call_sid text,state text,start_claimed_at timestamptz,recording_sid text,conversation_id text);
 create table icash_recorded_gate_terminal_receipts(recording_id uuid,account_id uuid,call_sid text,receipt jsonb);
 create function icash_prepare_seller_responses(uuid) returns boolean language sql as $$select exists(select 1 from icash_voice_jobs v join icash_contact_permissions p on p.id=v.permission_id where true and v.state='dispatched' and v.provider_call_sid is not null)$$;
 -- Controlled eligibility inputs; full channel, signed-package and membership
 -- admission are exercised by the automatic outreach SQL suites.
 create function icash_membership_work_allowed(uuid) returns boolean language sql set search_path='' as $$select member from public.icash_accounts where id=$1$$;
 create function icash_outreach_sms_current(uuid) returns boolean language sql set search_path='' as $$select sms_enabled from public.icash_accounts where id=$1$$;
 create function icash_outreach_voice_current(uuid) returns boolean language sql set search_path='' as $$select voice_enabled from public.icash_accounts where id=$1$$;
 create function icash_buyer_outreach_running(uuid,uuid) returns boolean language sql set search_path='' as $$select exists(select 1 from public.icash_deal_files where account_id=$1 and id=$2 and stage='under_contract' and coalesce(terms->>'testHold','false')<>'true')$$;
 grant select on all tables in schema public to service_role;
 `);
 await pg.exec(readFileSync(new URL('../../config/undispatched-work-monitoring.sql',import.meta.url),'utf8'));
 await pg.exec(readFileSync(new URL('../../config/recorded-seller-attempt-progress.sql',import.meta.url),'utf8'));
 const scheduledSql=readFileSync(new URL('../../config/scheduled-seller-sms-monitoring.sql',import.meta.url),'utf8');
 assert.equal(scheduledSql,readFileSync(new URL('../../supabase/migrations/20261019013456_scheduled_seller_sms_monitoring.sql',import.meta.url),'utf8'));
 await pg.exec(scheduledSql);
 const anytimeSql=readFileSync(new URL('../../config/anytime-seller-monitoring.sql',import.meta.url),'utf8');
 assert.equal(anytimeSql,readFileSync(new URL('../../supabase/migrations/20261019021302_anytime_seller_monitoring.sql',import.meta.url),'utf8'));
 await pg.exec(anytimeSql);
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
 // Inbound texts have no contact window. An undelivered first SMS stays
 // visible overnight even when the separate voice call is scheduled later.
 await pg.exec('begin');
 try{
  await pg.query("update icash_screening_jobs set snapshot=snapshot||jsonb_build_object('fetchedAt',now()) where id=$1",[screen]);
  await pg.query("update icash_text_threads set timezone=(select name from pg_timezone_names where extract(hour from now() at time zone name)=21 limit 1) where id=$1",[thread]);
  await pg.query("update icash_text_messages set state='ready',provider_id=null where id=$1",[id(29)]);
  const finding=()=>one('select count(*)::int from icash_undispatched_outreach_findings()');
  assert.equal(await finding(),1,'retired contact hours must not hide a missing first text');
  assert.equal(await one('select state from icash_text_messages where id=$1',[id(29)]),'ready');
  for(const mutation of [
   "update icash_text_threads set fixture_permission=false",
   "update icash_text_threads set fixture_inquiry=true",
   "update icash_text_threads set timezone=(select name from pg_timezone_names where extract(hour from now() at time zone name)=10 limit 1)",
   "update icash_screening_jobs set completed_at=now()-interval '25 hours'",
   "update icash_screening_jobs set snapshot=snapshot||jsonb_build_object('fetchedAt',now()-interval '25 hours')",
   "update icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"held\"}}'",
   "update icash_text_messages set provider_id='SIMULATION uncertain receipt'",
   "update icash_text_messages set state='dispatching'",
   "delete from icash_text_messages",
   "insert into icash_operation_spend values('text:"+id(29)+"')",
   "update icash_voice_jobs set due_at=now()-interval '6 minutes' where id='"+job+"'",
  ]){
   await pg.exec('savepoint scenario');await pg.exec(mutation);
   assert.equal(await finding(),1,'real missing/uncertain work remains visible: '+mutation);
   await pg.exec('rollback to scenario');
  }
  assert.equal(await one('select count(*)::int from icash_operation_spend'),0);
 }finally{await pg.exec('rollback');}
 await pg.query("update icash_voice_jobs set due_at=now()-interval '6 minutes' where id=$1",[job]);
 assert.equal((await refresh()).snapshot.issues[0].kind,'seller_response','overdue first call is visible even with an empty dispatch queue');
 await pg.query("update icash_voice_jobs set state='dispatched',provider_call_sid='SIMULATION call receipt' where id=$1",[job]);
 assert.equal((await refresh()).snapshot.issueCount,0,'actual provider receipts clear the missing-start finding');
 await pg.query("update icash_voice_jobs set state='held',outcome='ended_before_recording',operation_key='voice:fixture' where id=$1",[job]);
 assert.equal((await refresh()).snapshot.issueCount,1,'a SID or terminal label alone is not evidence');
 await pg.query("insert into icash_call_recordings(id,account_id,voice_job_id,operation_key,call_sid,state) values($1,$2,$3,'voice:fixture','SIMULATION call receipt','failed')",[id(30),account,job]);
 await pg.query("insert into icash_recorded_gate_terminal_receipts values($1,$2,'SIMULATION call receipt',$3)",[id(30),account,{sid:'SIMULATION call receipt',status:'no-answer'}]);
 for(const terminal of ['no-answer','busy','completed']){
  await pg.query("update icash_recorded_gate_terminal_receipts set receipt=jsonb_set(receipt,'{status}',to_jsonb($1::text))",[terminal]);
  assert.equal((await refresh()).snapshot.issueCount,0,'bound terminal attempt clears missing-start finding: '+terminal);
  assert.equal(await one('select icash_prepare_seller_responses(null)'),true,'response preparation uses the same receipt evidence');
 }
 for(const terminal of ['failed','canceled','in-progress']){
  await pg.query("update icash_recorded_gate_terminal_receipts set receipt=jsonb_set(receipt,'{status}',to_jsonb($1::text))",[terminal]);
  assert.equal((await refresh()).snapshot.issueCount,1,'failed/unknown/unfinished attempts remain visible');
 }
 await pg.query("update icash_recorded_gate_terminal_receipts set receipt=jsonb_set(receipt,'{status}','\"no-answer\"')");
 for(const [change,undo] of [
  ["update icash_recorded_gate_terminal_receipts set account_id='"+id(99)+"'","update icash_recorded_gate_terminal_receipts set account_id='"+account+"'"],
  ["update icash_call_recordings set operation_key='wrong'","update icash_call_recordings set operation_key='voice:fixture'"],
  ["update icash_call_recordings set start_claimed_at=now()","update icash_call_recordings set start_claimed_at=null"],
  ["update icash_voice_jobs set outcome='provider_outcome_unknown_no_retry'","update icash_voice_jobs set outcome='ended_before_recording'"],
 ]){await pg.exec(change);assert.equal((await refresh()).snapshot.issueCount,1,'invalid binding/uncertainty stays flagged');await pg.exec(undo);}
 assert.equal(await one('select state from icash_voice_jobs where id=$1',[job]),'held','monitor never requeues terminal calls');
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
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'public.icash_seller_sms_waiting_window(uuid,uuid,text)','EXECUTE')",[role]),false);
}
