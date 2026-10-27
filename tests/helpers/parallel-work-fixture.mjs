import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
export async function parallelWorkFixture(){
 const pg=await PGlite.create();
 await pg.exec(`
 create role anon;create role authenticated;create role service_role;
 create table icash_operating_budget(id int primary key,enabled boolean);insert into icash_operating_budget values(1,true);
 create table icash_accounts(id uuid primary key,bot_paused boolean default false);
 create table icash_wallets(account_id uuid primary key,balance_cents bigint default 10000,reserved_cents bigint default 0);
 create table icash_voice_configs(account_id uuid primary key,enabled boolean default true);
 create table icash_voice_jobs(id uuid primary key,account_id uuid,permission_id uuid,operational_contact_id uuid,state text default 'ready',due_at timestamptz default now(),created_at timestamptz default now(),updated_at timestamptz default now(),callback_id uuid,sms_source_message_id uuid,cancellation_notice_id uuid,meta_offer_lead_id uuid,meta_followup_lead_id uuid,outcome text,operation_key text,provider_call_sid text,conversation_id text);
 create table icash_voice_scheduler(id int primary key,last_dispatch_at timestamptz);insert into icash_voice_scheduler(id) values(1);
 create table icash_automation_tickets(id uuid primary key default gen_random_uuid(),account_id uuid references icash_accounts,kind text constraint icash_automation_tickets_kind_check check(kind<>'account_reconcile'),voice_job_id uuid,token text unique default gen_random_uuid()::text||gen_random_uuid()::text,created_at timestamptz default now(),state text default 'issued',outcome text,expires_at timestamptz default now()+interval '2 minutes',completed_at timestamptz,screening_id uuid unique,opener_message_id uuid,prospecting_quote_cents bigint,owner_preview_deferrals int default 0,owner_preview_retry_until timestamptz,owner_preview_retry_after timestamptz,owner_preview_screening_hash text,issue_attempts int default 1,live_call_id uuid,signing_id uuid,fulfillment_job_id uuid,title_task_id uuid,text_ai_job_id uuid,market_research_job_id uuid);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text);
 create table icash_meta_leads(lead_id uuid primary key,account_id uuid,screening_id uuid,voice_job_id uuid);
 create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,contact_key text,party text default 'seller',seller_intake_id uuid,revoked_at timestamptz,permission_until timestamptz default now()+interval '1 day',timezone text default 'open');
 create table icash_operational_contacts(id uuid primary key,account_id uuid,screening_id uuid,contact_key text,party text default 'seller',revoked_at timestamptz,permission_until timestamptz default now()+interval '1 day',timezone text default 'open',timezone_basis text default 'known',channel text default 'voice');
 create view icash_voice_contact_targets as select id,account_id,screening_id,contact_key,party,'operator_record'::text eligibility_source,revoked_at,permission_until,timezone from icash_contact_permissions union all select id,account_id,screening_id,contact_key,party,'operational_checks_only',revoked_at,permission_until,timezone from icash_operational_contacts where channel='voice';
 create table icash_live_callbacks(id uuid primary key,account_id uuid,screening_id uuid,conversation_id uuid,state text,due_at timestamptz);
 create table icash_live_conversations(id uuid primary key,account_id uuid,screening_id uuid,contact_key text,party text,state text,result jsonb,completed_at timestamptz,operation_key text);
 create table icash_operation_spend(operation_key text primary key,account_id uuid references icash_accounts,state text,actual_micros bigint,charged_cents bigint);
 create table icash_text_messages(id uuid,account_id uuid,state text,provider_id text,last_delivery_at timestamptz);
 create table icash_text_threads(id uuid,account_id uuid);
 create table fixture_capacity(open boolean);insert into fixture_capacity values(true);
 create function icash_outgoing_voice_capacity_open() returns boolean language sql as $$select open from public.fixture_capacity$$;
 create function icash_voice_queue_slot_open(uuid,uuid) returns boolean language sql as $$select open from public.fixture_capacity$$;
 create function icash_queue_voice_jobs() returns void language sql as $$select$$;
 create function icash_requested_seller_call_current(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_cancellation_voice_current(uuid,text) returns boolean language sql as $$select true$$;
 create function icash_call_has_seller_response(jsonb) returns boolean language sql as $$select true$$;
 create function icash_seller_phone_call_current(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select true$$;
 create function icash_prospecting_available(uuid) returns bigint language sql as $$select 10000::bigint$$;
 create function icash_research_waiting_on_outreach(uuid) returns boolean language sql as $$select false$$;
 create function icash_dealmachine_capacity_available() returns boolean language sql as $$select true$$;
 create function icash_wake_funded_outreach(uuid) returns void language sql as $$select$$;
 -- Only the clock is a fixture. Existing time-zone/DST policy suites exercise
 -- the real window function; this integration tests the exact selector inputs.
 create function icash_outreach_window_open(zone text,basis text,stamp timestamptz) returns boolean language sql as $$select case when basis='business_operating_clock' or zone is null then false else zone='open' end$$;
 create function icash_next_automation() returns jsonb language sql as $$select '{"token":"general"}'::jsonb$$;
 create function icash_next_acquisition() returns jsonb language sql as $$select '{"token":"research"}'::jsonb$$;
 create function icash_issue_due_signing_result() returns jsonb language sql as $$select null::jsonb$$;
 create function icash_issue_due_voice_result() returns jsonb language sql as $$select null::jsonb$$;
 create function icash_issue_due_text_ai() returns jsonb language sql as $$select null::jsonb$$;
 create function icash_next_seller_followup() returns jsonb language sql as $$select null::jsonb$$;
 create function icash_recover_unstarted_seller_opener() returns jsonb language sql as $$select null::jsonb$$;
 `);
 const baseline=JSON.parse(read('tests/fixtures/parallel-work-baseline.json'));
 for(const f of baseline.filter(f=>['icash_issue_ready_voice_ticket','icash_next_before_unstarted_sms_recovery','icash_resume_prospecting_ticket','icash_consume_automation','icash_finish_automation','icash_finish_owner_enrichment'].includes(f.proname)))await pg.exec(f.definition);
 for(const n of [1,2,3]){
  await pg.query('insert into icash_accounts(id) values($1)',[uid(n)]);
  await pg.query('insert into icash_wallets(account_id) values($1)',[uid(n)]);
  await pg.query('insert into icash_voice_configs(account_id) values($1)',[uid(n)]);
 }
 return pg;
}
