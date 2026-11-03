-- Disposable production-shaped contact UNION inputs. The view definition itself
-- is loaded verbatim from voice-configuration-target-lookup-before.json.
drop table public.icash_voice_contact_targets;
create table public.icash_contact_permissions(
 id uuid primary key,account_id uuid,screening_id uuid,party text default 'seller',phone text,
 contact_key text,timezone text,local_start_hour int,local_end_hour int,permission_evidence text,
 permission_until timestamptz default now()+interval '1 day',dnc_checked_at timestamptz,dnc_clear boolean,
 revoked_at timestamptz,buyer_id uuid,review_request_id uuid
);
create table public.icash_dnc_verification_receipts(id uuid primary key,checked_at timestamptz default now(),clear boolean default true);
create table public.icash_operational_contacts(
 id uuid primary key,account_id uuid,screening_id uuid,phone text,contact_key text,timezone text,
 local_start_hour int,local_end_hour int,eligibility_until timestamptz default now()+interval '1 day',
 revoked_at timestamptz,dnc_receipt_id uuid,channel text default 'voice'
);
create index icash_automation_voice_job_history on public.icash_automation_tickets(voice_job_id,created_at desc) where voice_job_id is not null;
create index fixture_screening_id on public.icash_screening_jobs(id);
create function public.fixture_configuration_id(a int,n int) returns uuid language sql immutable as $$select md5(a::text||':'||n::text)::uuid$$;
create function public.fixture_configuration_seed(a int,n int,legacy boolean default false,p_contact text default null) returns uuid language plpgsql as $$
declare account uuid:=public.fixture_configuration_id(a,0);job uuid:=public.fixture_configuration_id(a,n);
begin
 if not exists(select 1 from public.icash_accounts where id=account) then
  insert into public.icash_accounts(id) values(account);
  insert into public.icash_wallets(account_id) values(account);
  insert into public.icash_voice_configs(account_id,agent_config_hash) values(account,repeat('a',64));
 end if;
 insert into public.icash_screening_jobs(id,account_id) values(job,account);
 if legacy then
  insert into public.icash_contact_permissions(id,account_id,screening_id,contact_key) values(job,account,job,coalesce(p_contact,job::text));
 else
  insert into public.icash_dnc_verification_receipts(id) values(job);
  insert into public.icash_operational_contacts(id,account_id,screening_id,contact_key,dnc_receipt_id) values(job,account,job,coalesce(p_contact,job::text),job);
 end if;
 insert into public.icash_voice_jobs(id,account_id,permission_id,operational_contact_id,created_at)
  values(job,account,case when legacy then job end,case when not legacy then job end,now()-interval '1 day'+n*interval '1 second');
 insert into public.icash_automation_tickets(id,account_id,voice_job_id) values(job,account,job);
 return job;
end$$;
