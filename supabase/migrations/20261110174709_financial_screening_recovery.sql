-- Pure local screening retries only. No provider calls, refreshed timestamps or funds.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table icash_research_private.screening_attempts(
 screening_id uuid not null references public.icash_screening_jobs(id),attempt integer not null,
 lease_token uuid not null,created_at timestamptz not null default now(),error_code text,result jsonb,
 primary key(screening_id,attempt)
);
alter table icash_research_private.screening_attempts enable row level security;
revoke all on icash_research_private.screening_attempts from public,anon,authenticated,service_role;
create table icash_research_private.screening_recoveries(
 screening_id uuid primary key references public.icash_screening_jobs(id),snapshot_hash text not null,
 original_job jsonb not null,actor uuid not null,created_at timestamptz not null default now()
);
alter table icash_research_private.screening_recoveries enable row level security;
revoke all on icash_research_private.screening_recoveries from public,anon,authenticated,service_role;
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_finish_screening(uuid,uuid,jsonb,text)'::regprocedure);
 if md5(d)<>'31da54d6f2b6c689288d72709a506e3f' then raise exception 'Screening completion prerequisite changed';end if;
end $patch$;
create or replace function public.icash_finish_screening(p_id uuid,p_token uuid,p_result jsonb,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.icash_screening_jobs;retry boolean;
begin
 if p_error is not null and p_error not in('INVALID_SNAPSHOT','SCREENING_FAILED') then raise exception 'Invalid error code';end if;
 if p_error is null and(p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>65536) then raise exception 'Result required';end if;
 select * into j from public.icash_screening_jobs where id=p_id and state='running' and lease_token=p_token and lease_until>clock_timestamp() for update;
 if not found or j.lease_until<=clock_timestamp() then return false;end if;
 retry:=p_error='SCREENING_FAILED' and j.attempts<3;
 insert into icash_research_private.screening_attempts(screening_id,attempt,lease_token,error_code,result) values(j.id,j.attempts,p_token,p_error,p_result);
 update public.icash_screening_jobs set state=case when p_error is null then 'complete' when retry then 'queued' else 'failed' end,
  result=p_result,error_code=p_error,completed_at=case when retry then null else now() end,
  due_at=case when retry then now()+j.attempts*interval '30 seconds' else due_at end,lease_token=null,lease_until=null where id=j.id;
 return true;
end $$;
revoke all on function public.icash_finish_screening(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.icash_finish_screening(uuid,uuid,jsonb,text) to service_role;

-- Explicit reviewed recovery of one saved job; never resets attempts or data age.
create function public.icash_retry_saved_screening(p_actor uuid,p_id uuid,p_snapshot_hash text,p_error text) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.icash_screening_jobs;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required' using errcode='42501';end if;
 select * into j from public.icash_screening_jobs where id=p_id for update;
 if not found or j.state<>'failed' or j.attempts>=3 or j.error_code is distinct from p_error
  or p_error not in('INVALID_SNAPSHOT','SCREENING_FAILED') or md5(j.snapshot::text) is distinct from p_snapshot_hash
  or j.lease_token is not null or j.lease_until is not null then return false;end if;
 insert into icash_research_private.screening_recoveries(screening_id,snapshot_hash,original_job,actor)
  values(j.id,p_snapshot_hash,to_jsonb(j),p_actor) on conflict do nothing;
 if not found then return false;end if;
 update public.icash_screening_jobs set state='queued',due_at=now(),completed_at=null,error_code=null where id=j.id;
 return true;
end $$;
revoke all on function public.icash_retry_saved_screening(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.icash_retry_saved_screening(uuid,uuid,text,text) to service_role;
commit;
