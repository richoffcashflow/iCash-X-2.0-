-- Isolated disposable database only. Provider responses and account funds are fixtures.
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
end $$;
create schema icash_recording_private;
create table icash_operating_budget(id integer primary key,enabled boolean);
insert into icash_operating_budget values(1,true);
create table icash_voice_capacity_policy(id integer primary key,workspace_limit integer check(workspace_limit between 1 and 40),verified_at timestamptz,source text,credit_state text,credit_verified_at timestamptz,pro_change_claimed_at timestamptz,pro_change_applied_at timestamptz);
alter table icash_voice_capacity_policy enable row level security;
create table icash_voice_agent_capacity(agent_id text primary key,concurrent_limit integer check(concurrent_limit between 1 and 40),verified_at timestamptz);
create table icash_voice_configs(account_id uuid,agent_id text,enabled boolean);
create table icash_voice_jobs(id uuid,state text,provider_call_sid text,conversation_id text);
create table icash_wallets(account_id uuid primary key,balance_cents bigint);
create table icash_recording_private.capacity_quarantines(account_id uuid,operation_key text,contact_key text,voice_job_id uuid);
create table icash_call_recordings(operation_key text,call_sid text,recording_sid text,conversation_id text,consent_at timestamptz,recording_authorized_at timestamptz,start_claimed_at timestamptz,provider_started_at timestamptz,final_provider_started_at timestamptz);
create table icash_live_conversations(operation_key text);
create table fixture_slots(account_id uuid,operation_key text,agent_id text,contact_key text);
create table fixture_holds(like fixture_slots);
create function icash_voice_contact_holds() returns setof fixture_slots language sql stable as $$select * from public.fixture_slots union all select * from public.fixture_holds$$;
create function icash_active_voice_slots() returns setof fixture_slots language plpgsql stable as $$begin
 return query select s.account_id,s.operation_key,s.agent_id,s.contact_key from jsonb_to_recordset(icash_recording_private.voice_capacity_snapshot()->'slots') as s(account_id uuid,operation_key text,agent_id text,contact_key text);
end $$;
create function icash_voice_capacity_targets() returns jsonb language sql stable as $$select '[{"agentId":"agent_outgoing","branchId":null},{"agentId":"agent_incoming","branchId":"agtbrch_incoming"}]'::jsonb$$;
create function icash_daily_allowance(uuid) returns jsonb language sql stable as $$select jsonb_build_object('remainingCents',balance_cents) from public.icash_wallets where account_id=$1$$;
