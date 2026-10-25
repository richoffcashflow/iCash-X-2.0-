-- Synthetic local database; provider, wallet and recipient checks are fixtures.
create role anon;create role authenticated;create role service_role;
 create schema icash_recording_private;create schema icash_recorded_reception_private;
 create table icash_accounts(id uuid primary key,bot_paused boolean default false);
 create table icash_operating_budget(id integer primary key,reserved_micros bigint,spent_micros bigint,enabled boolean,hold_reason text);
 create table icash_operation_spend(rate_id uuid,dispatched_at timestamptz,permission_until timestamptz,customer_price_micros bigint,operation_key text primary key,account_id uuid,state text,reserved_micros bigint,charge_cap_cents bigint,charged_cents bigint,actual_micros bigint,settlement_evidence text,settled_at timestamptz,unique(operation_key,account_id));
 create table fixture_credits(account_id uuid primary key,held_cents bigint,charged_cents bigint);
 create function icash_finish_credit(a uuid,o text,c bigint,e text) returns void language plpgsql as $$ begin
  update public.fixture_credits set held_cents=held_cents-(select charge_cap_cents from public.icash_operation_spend where operation_key=o),charged_cents=charged_cents+c where account_id=a;
 end $$;
 create function icash_account_margin_ok(uuid,bigint,bigint,boolean) returns boolean language sql as $$select true$$;
 create table icash_voice_jobs(id uuid primary key,account_id uuid,state text,outcome text,permission_id uuid,operational_contact_id uuid,operation_key text,conversation_id text,provider_call_sid text,updated_at timestamptz);
 create table icash_voice_configs(account_id uuid,agent_id text,enabled boolean default true,reviewed_until timestamptz default now()+interval '1 day',max_duration_seconds integer default 600,seller_rate_id uuid,buyer_rate_id uuid);
 create table icash_voice_contact_targets(id uuid,account_id uuid,contact_key text,party text default 'seller',eligibility_source text default 'operational_checks_only',screening_id uuid,phone text,revoked_at timestamptz,permission_until timestamptz default now()+interval '1 day',dnc_clear boolean default true);
 create table icash_automation_tickets(id uuid,account_id uuid,voice_job_id uuid,kind text,state text,outcome text,created_at timestamptz,expires_at timestamptz,completed_at timestamptz);
 create table icash_call_recordings(consent_deadline_at timestamptz,max_total_seconds integer,final_provider_started_at timestamptz,permission_id uuid,operational_contact_id uuid,screening_id uuid,party text,call_context jsonb,branch_id text,version_id text,rate_id uuid,charge_cap_cents bigint,stop_token_hash text,disclosure_version text,pricing_policy jsonb,consent_evidence jsonb,ended_at timestamptz,duration_seconds integer,audio_expires_at timestamptz,next_delete_at timestamptz,provider_recording_price_micros bigint,price_is_estimate boolean,id uuid primary key,account_id uuid,operation_key text,voice_job_id uuid,agent_id text,contact_key text,entry_policy text,
  provider_account_sid text,from_phone text,to_phone text,nonce_hash text,state text,call_sid text,recording_sid text,conversation_id text,start_claimed_at timestamptz,consent_at timestamptz,recording_authorized_at timestamptz,provider_started_at timestamptz,
  call_ended_at timestamptz,end_requested_at timestamptz,dial_claimed_at timestamptz,created_at timestamptz,last_error text,last_action text,row_version bigint,updated_at timestamptz,
  next_reconcile_at timestamptz check(isfinite(next_reconcile_at)),reconcile_lease_token uuid,reconcile_lease_expires_at timestamptz);
 create table icash_live_conversations(operation_key text,account_id uuid,agent_id text,contact_key text,state text);
 create table icash_recorded_reception_private.sessions(operation_key text,account_id uuid,agent_id text,contact_key text,call_ended_at timestamptz);
 create table icash_recorded_gate_terminal_receipts(recording_id uuid,account_id uuid,call_sid text,receipt jsonb);
 create table icash_recording_private.terminal_cost_receipts(recording_id uuid,receipt jsonb);
 create function icash_recording_private.audit_immutable() returns trigger language plpgsql as $$begin raise exception 'Recording audit is append only';end$$;
 create function icash_recording_private.keys(p_value jsonb,p_required text[],p_optional text[] default '{}') returns boolean language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p_value) is distinct from 'object' then false else p_value ?& p_required and not exists(select 1 from jsonb_object_keys(p_value) k where not k=any(p_required||p_optional)) end;
 $$;

 create table icash_operation_rates(id uuid primary key,operation text,voice_max_duration_seconds integer,charge_cents bigint);
 create table icash_voice_capacity_policy(id integer,workspace_limit integer,verified_at timestamptz);
 create table icash_voice_agent_capacity(agent_id text,concurrent_limit integer,verified_at timestamptz);
 create table icash_wallets(account_id uuid,balance_cents bigint,reserved_cents bigint);
 create table icash_recording_private.call_creation_rejections(recording_id uuid,account_id uuid,operation_key text);
 create function icash_daily_allowance(uuid) returns jsonb language sql as $$select '{"remainingCents":30000}'::jsonb$$;
 create function icash_voice_capacity_targets() returns jsonb language sql as $$select '[]'::jsonb$$;
 create function icash_recording_private.clock_now() returns timestamptz language sql volatile as $$select clock_timestamp()$$;
 create function icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_operational_contact_current(uuid,uuid,text,boolean) returns boolean language sql as $$select true$$;
 create function icash_seller_phone_call_current(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_seller_response_operation_allowed(uuid,text) returns boolean language sql as $$select true$$;
 create function icash_voice_outreach_hours_current(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_recover_unstarted_seller_opener() returns jsonb language sql as $$select null::jsonb$$;
 create function icash_resume_prospecting_ticket() returns jsonb language sql as $$select null::jsonb$$;
 create function icash_next_before_prospecting_budget() returns jsonb language sql as $$select '{"next":"unrelated_work"}'::jsonb$$;
