-- Disposable extension to the existing configuration-recovery fixture.
-- Capacity wrappers and queue predicates are loaded verbatim from production.
alter table public.icash_call_recordings add call_sid text,add recording_sid text,
 add conversation_id text,add consent_at timestamptz,add recording_authorized_at timestamptz,
 add start_claimed_at timestamptz,add provider_started_at timestamptz,add final_provider_started_at timestamptz;
alter table public.icash_live_conversations add state text,add contact_key text;
create table public.icash_voice_capacity_policy(id int,workspace_limit int,verified_at timestamptz,credit_state text);
insert into public.icash_voice_capacity_policy values(1,20,now(),null);
create table public.icash_voice_agent_capacity(agent_id text,concurrent_limit int,verified_at timestamptz);
insert into public.icash_voice_agent_capacity values('agent_fixture',20,now());
create table icash_recording_private.capacity_quarantines(operation_key text,account_id uuid,voice_job_id uuid,contact_key text);
create table public.fixture_holds(operation_key text,account_id uuid,agent_id text,contact_key text);
create sequence public.fixture_capacity_scans;
create function public.icash_voice_contact_holds() returns table(operation_key text,account_id uuid,agent_id text,contact_key text)
 language plpgsql as $$begin perform nextval('public.fixture_capacity_scans');return query select * from public.fixture_holds;end$$;
create function public.icash_voice_capacity_targets() returns jsonb language sql stable as $$select '[{"agentId":"agent_fixture","branchId":"branch_fixture"}]'::jsonb$$;
create function public.icash_daily_allowance(uuid) returns jsonb language sql stable as $$select jsonb_build_object('remainingCents',balance_cents) from public.icash_wallets where account_id=$1$$;
-- Remove fixture-only stubs before installing their real named signatures.
drop function public.icash_voice_capacity_available(uuid,text,text,text,boolean);
drop function public.icash_voice_queue_slot_open(uuid,uuid);
