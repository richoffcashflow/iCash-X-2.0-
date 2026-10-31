import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=new PGlite(),value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
try{
 await db.exec(`
 create role anon;create role authenticated;create role service_role;
 create table fixture_capacity(status text,quota boolean);insert into fixture_capacity values('export_busy',true);
 create table fixture_reads(kind text,account_id uuid);
 create table icash_operating_budget(id integer,enabled boolean);insert into icash_operating_budget values(1,true);
 create table icash_accounts(id uuid primary key,bot_paused boolean default false,member boolean default true,allowance bigint default 200,waiting boolean default false,candidate uuid,backlog integer default 0,search_due boolean default false);
 create table icash_wallets(account_id uuid,balance_cents bigint,reserved_cents bigint);
 create table icash_operation_rates(id uuid primary key,charge_cents bigint);
 create table icash_discovery_configs(account_id uuid primary key,enabled boolean default true,auto_enabled boolean default true,next_run_at timestamptz default now(),data_rights_until timestamptz default now()+interval '1 day',contacts_enabled boolean default true,contact_rate_id uuid,rate_id uuid,exhausted boolean default false,max_open_prospects integer default 10);
 create table icash_automation_tickets(id uuid primary key default gen_random_uuid(),account_id uuid,kind text,screening_id uuid unique,voice_job_id uuid,opener_message_id uuid,state text default 'issued',outcome text,expires_at timestamptz default now()+interval '2 minutes',created_at timestamptz default now(),completed_at timestamptz,prospecting_quote_cents bigint,token text default 'fixture-token',owner_preview_deferrals integer default 0,owner_preview_retry_until timestamptz,issue_attempts integer default 1);
 create table icash_operation_spend(operation_key text primary key);
 create table icash_live_conversations(operation_key text);
 create table icash_voice_jobs(id uuid,account_id uuid,state text,outcome text,operation_key text,conversation_id text,provider_call_sid text,permission_id uuid,operational_contact_id uuid);
 create table icash_voice_contact_targets(id uuid,account_id uuid,eligibility_source text,revoked_at timestamptz,permission_until timestamptz,timezone text);
 create table icash_operational_contacts(id uuid,account_id uuid,channel text,timezone_basis text);
 create table icash_text_messages(id uuid,account_id uuid,state text,provider_id text,last_delivery_at timestamptz);
 create function icash_settle_pending_dealmachine() returns void language sql as $$insert into public.fixture_reads values('settlement',null)$$;
 create function icash_owner_enrichment_unstarted(uuid,uuid,text) returns boolean language sql as $$select false$$;
 create function icash_daily_work_target(uuid) returns jsonb language sql as $$select '{"priorityRatio":0}'::jsonb$$;
 create function icash_refresh_opportunity_outcomes(uuid) returns void language sql as $$select null::void$$;
 create function icash_prepare_research_efficiency(uuid) returns void language sql as $$select null::void$$;
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select member from public.icash_accounts where id=$1$$;
 create function icash_prospecting_available(uuid) returns bigint language sql as $$select allowance from public.icash_accounts where id=$1$$;
 create function icash_research_admission_quote(uuid,text,bigint) returns bigint language sql as $$select $3$$;
 create function icash_enrichment_before_provider_quota(uuid) returns uuid language plpgsql as $$begin insert into public.fixture_reads values('enrichment',$1);return(select candidate from public.icash_accounts where id=$1);end$$;
 create function icash_dealmachine_capacity_available(integer default 2) returns boolean language sql stable as $$select quota from public.fixture_capacity$$;
 create function icash_owner_active_export_capacity() returns text language sql stable as $$select status from public.fixture_capacity$$;
 create function icash_pending_opportunity_count(uuid) returns integer language sql as $$select backlog from public.icash_accounts where id=$1$$;
 create function icash_outbound_search_due(uuid) returns boolean language sql as $$select search_due from public.icash_accounts where id=$1$$;
 create function icash_research_waiting_on_outreach(uuid) returns boolean language sql as $$select waiting from public.icash_accounts where id=$1$$;
 create function icash_wake_funded_outreach(uuid) returns void language sql as $$insert into public.fixture_reads values('wake',$1)$$;
 create function icash_outreach_window_open(text,text,timestamptz) returns boolean language sql as $$select false$$;
 create function icash_owner_demo_call_current(uuid,uuid) returns boolean language sql as $$select false$$;
 `);
 await db.exec(read('tests/fixtures/owner-export-scheduling-before.sql'));
 await db.exec('revoke all on function icash_next_acquisition(),icash_resume_prospecting_ticket(),icash_enrichment_candidate(uuid) from public;grant execute on function icash_next_acquisition(),icash_resume_prospecting_ticket(),icash_enrichment_candidate(uuid) to service_role;');
 const sql=read('config/owner-export-scheduling.sql');assert.equal(sql,read('supabase/migrations/20261031184213_owner_export_scheduling.sql'));await db.exec(sql);
 await db.query('insert into icash_accounts(id,candidate) values($1,$2)',[id(1),id(2)]);
 await db.query('insert into icash_wallets values($1,1000,100)',[id(1)]);
 await db.query('insert into icash_operation_rates values($1,100),($2,20)',[id(3),id(4)]);
 await db.query('insert into icash_discovery_configs(account_id,rate_id,contact_rate_id) values($1,$2,$3)',[id(1),id(3),id(4)]);
 for(const state of ['export_busy','quota_wait',null,'unexpected']){
  await db.query('update fixture_capacity set status=$1',[state]);
  assert.equal(await value('select icash_enrichment_candidate($1)',[id(1)]),null);
 }
 assert.equal(await value("select count(*)::int from fixture_reads where kind='enrichment'"),0,'Unavailable capacity never scans or consumes candidate retries');
 for(const state of ['ready','disabled']){
  await db.query('update fixture_capacity set status=$1',[state]);
  assert.equal(await value('select icash_enrichment_candidate($1)',[id(1)]),id(2),'Available export and legacy paths retain selection');
 }
 await db.exec("update fixture_capacity set status='ready',quota=false");assert.equal(await value('select icash_enrichment_candidate($1)',[id(1)]),null,'Existing request quota gate remains');
 await db.exec("update fixture_capacity set status='export_busy',quota=true;truncate fixture_reads;");
 for(let i=0;i<25;i++){
  await db.exec('update icash_discovery_configs set next_run_at=now()');
  assert.equal(await value('select icash_next_acquisition()'),null);
 }
 assert.equal(await value('select count(*)::int from icash_automation_tickets'),0,'Repeated worker polls do not create hopeless contact tickets');
 assert.equal(await value("select count(*)::int from fixture_reads where kind='enrichment'"),0);
 assert.equal(await value("select count(*)::int from fixture_reads where kind='settlement'"),25,'Receipt settlement remains available');
 await db.exec('update icash_accounts set search_due=true,allowance=50;update icash_discovery_configs set next_run_at=now()');
 assert.equal(await value('select icash_next_acquisition()'),null,'Cheap blocked contacts cannot admit an unaffordable discovery');
 await db.exec('update icash_accounts set allowance=200;update icash_discovery_configs set next_run_at=now()');
 assert.equal((await value('select icash_next_acquisition()')).token,'fixture-token');
 assert.equal(await value('select kind from icash_automation_tickets'),'discovery','Independent eligible discovery still runs');
 await db.exec("truncate icash_automation_tickets;update fixture_capacity set status='ready';update icash_discovery_configs set next_run_at=now()");
 assert.equal((await value('select icash_next_acquisition()')).token,'fixture-token');
 assert.equal(await value('select kind from icash_automation_tickets'),'contacts','Normal selection resumes after verified capacity recovery');
 await db.exec("truncate icash_automation_tickets;update fixture_capacity set status='export_busy'");
 await db.query("insert into icash_automation_tickets(account_id,kind,screening_id,state,outcome,expires_at,created_at,prospecting_quote_cents) select $1,'contacts',gen_random_uuid(),'held','prospecting_budget_held',now()-interval '1 minute',now()-interval '1 day',20 from generate_series(1,30)",[id(1)]);
 const original=await value("select jsonb_agg(to_jsonb(t) order by id) from icash_automation_tickets t where kind='contacts'");
 await db.query('insert into icash_text_messages values($1,$2,\'ready\',null,null)',[id(5),id(1)]);
 await db.query("insert into icash_automation_tickets(account_id,kind,opener_message_id,state,outcome,expires_at,created_at,prospecting_quote_cents) values($1,'seller_opener',$2,'held','prospecting_budget_held',now()-interval '1 minute',now()-interval '1 hour',20)",[id(1),id(5)]);
 assert.match((await value('select icash_resume_prospecting_ticket()')).token,/^[a-f0-9-]{72}$/,'Thirty blocked contacts cannot hide eligible text work behind the selection limit');
 assert.deepEqual(await value("select jsonb_agg(to_jsonb(t) order by id) from icash_automation_tickets t where kind='contacts'"),original,'Contact state, retry counters and operation keys remain unchanged');
 await db.exec("delete from icash_automation_tickets where kind='seller_opener';update fixture_capacity set status='ready';insert into icash_operation_spend select 'owners:'||account_id||':'||screening_id from icash_automation_tickets");
 assert.equal(await value('select icash_resume_prospecting_ticket()'),null,'Available capacity never releases an uncertain paid operation');
 assert.deepEqual((await db.query('select balance_cents,reserved_cents from icash_wallets')).rows,[{balance_cents:1000,reserved_cents:100}]);
 for(const role of ['anon','authenticated','service_role'])for(const fn of ['icash_next_acquisition()','icash_resume_prospecting_ticket()','icash_enrichment_candidate(uuid)'])assert.equal(await value('select has_function_privilege($1,$2,\'execute\')',[role,fn]),role==='service_role');
 await assert.rejects(db.exec(sql),/Owner export candidate prerequisite changed/);await db.exec('rollback');
 console.log('PASS export scheduling: repeated blocked polls create no tasks, discovery and text lanes continue, recovery resumes selection, unknown spending and private grants remain intact.');
}finally{await db.close();}
