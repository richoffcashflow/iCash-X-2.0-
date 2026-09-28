-- Deterministic screening only. No provider calls, credit charges or dispatch permissions.
create table public.icash_screening_control (
 id integer primary key check(id=1), enabled boolean not null default true,
 max_concurrency integer not null default 2 check(max_concurrency between 1 and 32)
);
insert into public.icash_screening_control(id) values(1);
create table public.icash_screening_jobs (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.icash_accounts(id),
 event_key text not null unique check(length(event_key) between 1 and 200),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=65536),
 due_at timestamptz not null default now(),
 state text not null default 'queued' check(state in ('queued','running','complete','failed')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 lease_token uuid, lease_until timestamptz, result jsonb,
 error_code text, created_at timestamptz not null default now(), completed_at timestamptz
);
create index icash_screening_due on public.icash_screening_jobs(due_at,id) where state='queued';
create index icash_screening_leases on public.icash_screening_jobs(lease_until) where state='running';
create index icash_screening_account on public.icash_screening_jobs(account_id,created_at desc);
alter table public.icash_screening_control enable row level security;
alter table public.icash_screening_jobs enable row level security;
revoke all on public.icash_screening_control,public.icash_screening_jobs from public,anon,authenticated;
grant all on public.icash_screening_control,public.icash_screening_jobs to service_role;

create function public.icash_enqueue_screening(p_account uuid,p_event text,p_snapshot jsonb,p_due timestamptz default now()) returns uuid
language plpgsql security invoker set search_path='' as $$
declare j public.icash_screening_jobs; new_id uuid;
begin
 if p_due is null then raise exception 'Due time required'; end if;
 -- Serializes duplicate insertion for one tenant and bounds its outstanding queue.
 perform 1 from public.icash_accounts where id=p_account for update;
 if not found then raise exception 'Account missing'; end if;
 select * into j from public.icash_screening_jobs where event_key=p_event;
 if found then
  if j.account_id<>p_account or j.snapshot<>p_snapshot or j.due_at<>p_due then raise exception 'Screening idempotency conflict'; end if;
  return j.id;
 end if;
 if (select count(*) from public.icash_screening_jobs where account_id=p_account and state in ('queued','running'))>=100 then raise exception 'Screening queue full'; end if;
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,due_at) values(p_account,p_event,p_snapshot,p_due) returning id into new_id;
 return new_id;
end $$;
create function public.icash_claim_screening() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.icash_screening_control; j public.icash_screening_jobs; token uuid:=gen_random_uuid();
begin
 select * into c from public.icash_screening_control where id=1 for update;
 if not found or not c.enabled then return null; end if;
 -- Safe to retry only because this queue cannot perform any provider side effects.
 update public.icash_screening_jobs set state=case when attempts>=3 then 'failed' else 'queued' end,
 error_code=case when attempts>=3 then 'LEASE_EXHAUSTED' else null end,lease_token=null,lease_until=null
 where state='running' and lease_until<=now();
 if (select count(*) from public.icash_screening_jobs where state='running')>=c.max_concurrency then return null; end if;
 select q.* into j from public.icash_screening_jobs q
 join public.icash_accounts a on a.id=q.account_id
 join public.icash_wallets w on w.account_id=q.account_id
 where q.state='queued' and q.due_at<=now() and not a.bot_paused and w.balance_cents>w.reserved_cents
 order by q.due_at,q.id for update of q skip locked limit 1;
 if not found then return null; end if;
 update public.icash_screening_jobs set state='running',attempts=attempts+1,lease_token=token,lease_until=now()+interval '60 seconds' where id=j.id;
 return jsonb_build_object('id',j.id,'leaseToken',token,'snapshot',j.snapshot);
end $$;
create function public.icash_finish_screening(p_id uuid,p_token uuid,p_result jsonb,p_error text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_error is not null and p_error not in ('INVALID_SNAPSHOT','SCREENING_FAILED') then raise exception 'Invalid error code'; end if;
 if p_error is null and (p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>65536) then raise exception 'Result required'; end if;
 update public.icash_screening_jobs set state=case when p_error is null then 'complete' else 'failed' end,
 result=p_result,error_code=p_error,completed_at=now(),lease_token=null,lease_until=null
 where id=p_id and state='running' and lease_token=p_token and lease_until>now();
 return found;
end $$;
revoke all on function public.icash_enqueue_screening(uuid,text,jsonb,timestamptz),public.icash_claim_screening(),public.icash_finish_screening(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.icash_enqueue_screening(uuid,text,jsonb,timestamptz),public.icash_claim_screening(),public.icash_finish_screening(uuid,uuid,jsonb,text) to service_role;
