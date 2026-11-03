-- Disposable fixture only; downstream admission functions expose explicit test controls.
 do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end$$;create schema icash_recording_private;
 revoke all on schema icash_recording_private from public,anon,authenticated,service_role;
 create table icash_recording_private.original_receipts(id int);
 revoke all on icash_recording_private.original_receipts from public,anon,authenticated,service_role;
 create function icash_recording_private.audit_immutable() returns trigger language plpgsql as $$begin raise exception 'Append only';end$$;
 create table icash_operating_budget(id int primary key,enabled boolean);insert into icash_operating_budget values(1,true);
 create table icash_accounts(id uuid primary key,bot_paused boolean default false);
 create table icash_wallets(account_id uuid,balance_cents bigint default 10000,reserved_cents bigint default 0);
 create table icash_voice_configs(account_id uuid,enabled boolean default true,agent_id text default 'agent_fixture',agent_config_hash text,reviewed_until timestamptz default now()+interval '1 day');
 create table icash_voice_production_template(id int,enabled boolean default true,agent_id text default 'agent_fixture',agent_config_hash text,reviewed_until timestamptz default now()+interval '1 day');
 create table icash_screening_jobs(id uuid,account_id uuid,state text default 'complete',result jsonb default '{"financialCheck":{"status":"eligible"}}',snapshot jsonb default jsonb_build_object('fetchedAt',now()));
 create table icash_voice_contact_targets(id uuid,account_id uuid,screening_id uuid,contact_key text,party text default 'seller',revoked_at timestamptz,permission_until timestamptz default now()+interval '1 day',eligibility_source text default 'operational_checks_only');
 create table icash_voice_jobs(id uuid primary key,account_id uuid,permission_id uuid,operational_contact_id uuid,callback_id uuid,sms_source_message_id uuid,cancellation_notice_id uuid,meta_offer_lead_id uuid,meta_retry_of uuid,meta_followup_lead_id uuid,
  state text default 'held',outcome text default 'production_agent_review_required',operation_key text,provider_call_sid text,conversation_id text,due_at timestamptz default now()-interval '1 day',created_at timestamptz default now()-interval '1 day',updated_at timestamptz default now()-interval '1 hour');
 create table icash_automation_tickets(id uuid primary key,voice_job_id uuid,account_id uuid,kind text default 'voice_dispatch',state text default 'held',outcome text default 'production_agent_review_required',created_at timestamptz default now()-interval '1 hour',completed_at timestamptz default now()-interval '59 minutes',expires_at timestamptz default now()-interval '58 minutes');
 create table icash_operation_spend(operation_key text,state text);create table icash_call_recordings(voice_job_id uuid,operation_key text);create table icash_live_conversations(operation_key text);
 create table fixture_policy(kind text primary key,allowed boolean);insert into fixture_policy values('membership',true),('channel',true),('operational',true),('permission',true),('hours',true),('spacing',true),('capacity',true),('slot',true);
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select allowed from public.fixture_policy where kind='membership'$$;
 create function icash_outreach_voice_current(uuid) returns boolean language sql as $$select allowed from public.fixture_policy where kind='channel'$$;
 create function icash_operational_contact_current(uuid,uuid,text,boolean) returns boolean language sql as $$select allowed from public.fixture_policy where kind='operational'$$;
 create function icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql as $$select allowed from public.fixture_policy where kind='permission'$$;
 create function icash_voice_outreach_hours_current(uuid,uuid) returns boolean language sql as $$select allowed from public.fixture_policy where kind='hours'$$;
 create function icash_seller_phone_call_current(uuid,uuid) returns boolean language sql as $$select allowed from public.fixture_policy where kind='spacing'$$;
 create function icash_voice_capacity_available(uuid,text,text,text,boolean) returns boolean language sql as $$select allowed from public.fixture_policy where kind='capacity'$$;
 create function icash_outgoing_voice_capacity_open() returns boolean language sql as $$select allowed from public.fixture_policy where kind='capacity'$$;
 create function icash_voice_queue_slot_open(a uuid,j uuid) returns boolean language sql as $$select exists(select 1 from public.icash_voice_jobs where id=j and account_id=a and state='ready') and (select allowed from public.fixture_policy where kind='slot')$$;
