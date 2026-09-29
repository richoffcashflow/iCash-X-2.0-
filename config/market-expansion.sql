-- Bounded, free metadata research. Does not authorize property purchases or outreach.
create table public.icash_market_research_scopes(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 city text not null check(length(city) between 2 and 80),state text not null check(state ~ '^[A-Z]{2}$'),
 location_query text check(length(location_query) between 1 and 80),
 enabled boolean not null default false,next_scan_at timestamptz not null default now(),unique(account_id,city,state)
);
create table public.icash_market_research_jobs(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.icash_market_research_scopes(id),
 account_id uuid not null references public.icash_accounts(id),cycle uuid not null,
 kind text not null check(kind in ('locations','counts')),city text not null,state_code text not null,
 zip text not null default '' check(zip='' or zip ~ '^[0-9]{5}$'),page integer not null default 1 check(page between 1 and 4),
 state text not null default 'pending' check(state in ('pending','issued','running','complete','held')),
 attempts integer not null default 0 check(attempts between 0 and 3),next_attempt_at timestamptz not null default now(),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(scope_id,cycle,kind,zip,page),check((kind='counts' and zip<>'') or (kind='locations' and zip=''))
);
create index icash_market_research_due on public.icash_market_research_jobs(next_attempt_at) where state<>'complete';
create table public.icash_market_research_usage(
 day date primary key,requests_reserved integer not null check(requests_reserved between 0 and 50)
);
create table public.icash_market_research_results(
 account_id uuid not null references public.icash_accounts(id),zip text not null check(zip ~ '^[0-9]{5}$'),
 city text not null,state text not null,total_properties bigint not null check(total_properties>=0),
 high_equity_properties bigint not null check(high_equity_properties>=0),potential_buyers bigint not null check(potential_buyers>=0),
 inventory_score numeric not null,checked_at timestamptz not null default now(),
 status text not null default 'research_candidate' check(status='research_candidate'),primary key(account_id,zip)
);
-- No raw owners, contact details, or cross-tenant conversations are collected.
alter table public.icash_market_research_scopes enable row level security;
alter table public.icash_market_research_jobs enable row level security;
alter table public.icash_market_research_usage enable row level security;
alter table public.icash_market_research_results enable row level security;
revoke all on public.icash_market_research_scopes,public.icash_market_research_jobs,public.icash_market_research_usage,public.icash_market_research_results from public,anon,authenticated;
grant all on public.icash_market_research_scopes,public.icash_market_research_jobs,public.icash_market_research_usage,public.icash_market_research_results to service_role;
alter table public.icash_automation_tickets add column market_research_job_id uuid references public.icash_market_research_jobs(id);
alter table public.icash_automation_tickets drop constraint icash_automation_tickets_kind_check;
alter table public.icash_automation_tickets add constraint icash_automation_tickets_kind_check check(kind in ('discovery','contacts','voice_result','signing_result','voice_dispatch','fulfillment','title_followup','text_ai','market_research'));

create function public.icash_claim_market_research(p_account uuid,p_job uuid) returns jsonb language plpgsql set search_path='' as $$
declare j public.icash_market_research_jobs;n integer;
begin
 select * into j from public.icash_market_research_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' or j.attempts>=3 or not exists(select 1 from public.icash_market_research_scopes s where s.id=j.scope_id and s.account_id=p_account and s.enabled) then return null;end if;
 n:=case when j.kind='locations' then 1 else 3 end;
 insert into public.icash_market_research_usage(day,requests_reserved) values((now() at time zone 'UTC')::date,n)
 on conflict(day) do update set requests_reserved=public.icash_market_research_usage.requests_reserved+n
 where public.icash_market_research_usage.requests_reserved+n<=50;
 if not found then return null;end if;
 update public.icash_market_research_jobs set state='running',attempts=attempts+1,updated_at=now(),next_attempt_at=now()+interval '15 minutes' where id=j.id;
 return jsonb_build_object('id',j.id,'kind',j.kind,'city',j.city,'query',coalesce((select scope.location_query from public.icash_market_research_scopes scope where scope.id=j.scope_id),j.city),'state',j.state_code,'zip',j.zip,'page',j.page);
end $$;
create function public.icash_save_market_research(p_account uuid,p_job uuid,p_result jsonb) returns void language plpgsql set search_path='' as $$
declare j public.icash_market_research_jobs;loc jsonb;n integer;total bigint;equity bigint;buyers bigint;
begin
 select * into j from public.icash_market_research_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'running' then return;end if;
 if j.kind='locations' then
 if jsonb_typeof(p_result->'locations')<>'array' or jsonb_array_length(p_result->'locations')>50 then raise exception 'Invalid locations';end if;
 for loc in select value from jsonb_array_elements(p_result->'locations') loop
 if coalesce(loc->>'code','') !~ '^[0-9]{5}$' or loc->>'state' is distinct from j.state_code then raise exception 'Invalid market scope';end if;
 insert into public.icash_market_research_jobs(scope_id,account_id,cycle,kind,city,state_code,zip)
 values(j.scope_id,p_account,j.cycle,'counts',j.city,j.state_code,loc->>'code') on conflict do nothing;
 end loop;
 n:=(p_result->>'nextPage')::integer;
 if n is not null then
 if n<>j.page+1 or n>4 then raise exception 'Invalid page';end if;
 insert into public.icash_market_research_jobs(scope_id,account_id,cycle,kind,city,state_code,page)
 values(j.scope_id,p_account,j.cycle,'locations',j.city,j.state_code,n) on conflict do nothing;
 end if;
 else
 total:=(p_result->>'total')::bigint;equity:=(p_result->>'highEquity')::bigint;buyers:=(p_result->>'potentialBuyers')::bigint;
 if total is null or equity is null or buyers is null or least(total,equity,buyers)<0 or equity>total then raise exception 'Invalid market counts';end if;
 insert into public.icash_market_research_results(account_id,zip,city,state,total_properties,high_equity_properties,potential_buyers,inventory_score)
 values(p_account,j.zip,j.city,j.state_code,total,equity,buyers,ln(1+equity::numeric)*ln(1+buyers::numeric))
 on conflict(account_id,zip) do update set total_properties=excluded.total_properties,high_equity_properties=excluded.high_equity_properties,potential_buyers=excluded.potential_buyers,inventory_score=excluded.inventory_score,checked_at=now();
 end if;
 update public.icash_market_research_jobs set state='complete',updated_at=now() where id=j.id;
end $$;

alter function public.icash_next_automation() rename to icash_next_before_market_research;
create function public.icash_next_automation() returns jsonb language plpgsql set search_path='' as $$
declare prior jsonb;s public.icash_market_research_scopes;j public.icash_market_research_jobs;t public.icash_automation_tickets;cycle uuid;
begin
 perform pg_advisory_xact_lock(726341927);
 -- Customer work always has priority over free research.
 prior:=public.icash_next_before_market_research();
 if prior->>'token' is not null then return prior;end if;
 if exists(select 1 from public.icash_market_research_usage where day=(now() at time zone 'UTC')::date and requests_reserved>=48)
 or exists(select 1 from public.icash_automation_tickets where kind='market_research' and created_at>now()-interval '1 minute') then return prior;end if;
 for s in select * from public.icash_market_research_scopes where enabled and next_scan_at<=now() order by next_scan_at limit 4 for update skip locked loop
 -- Finish the current scan before beginning another cycle.
 if not exists(select 1 from public.icash_market_research_jobs where scope_id=s.id and state<>'complete' and attempts<3) then
 cycle:=gen_random_uuid();
 insert into public.icash_market_research_jobs(scope_id,account_id,cycle,kind,city,state_code) values(s.id,s.account_id,cycle,'locations',s.city,s.state);
 -- Known candidates ensure useful screening even when the city-name search is sparse.
 insert into public.icash_market_research_jobs(scope_id,account_id,cycle,kind,city,state_code,zip)
 select s.id,s.account_id,cycle,'counts',s.city,s.state,z.zip from public.icash_market_shortlist z where z.city=s.city and z.state=s.state;
 update public.icash_market_research_scopes set next_scan_at=now()+interval '7 days' where id=s.id;
 end if;end loop;
 select q.* into j from public.icash_market_research_jobs q join public.icash_market_research_scopes scope on scope.id=q.scope_id and scope.enabled
 where q.state<>'complete' and q.attempts<3 and q.next_attempt_at<=now()
 order by case when q.kind='locations' then 0 else 1 end,q.next_attempt_at,q.created_at,q.id for update of q skip locked limit 1;
 if not found then return prior;end if;
 update public.icash_market_research_jobs set state='issued',updated_at=now(),next_attempt_at=now()+interval '15 minutes' where id=j.id;
 insert into public.icash_automation_tickets(account_id,kind,market_research_job_id) values(j.account_id,'market_research',j.id) returning * into t;
 return jsonb_build_object('token',t.token);
end $$;
create or replace function public.icash_consume_automation(p_token text) returns jsonb language plpgsql set search_path='' as $$
declare t public.icash_automation_tickets;
begin
 update public.icash_automation_tickets set state='consumed' where token=p_token and state='issued' and expires_at>now() returning * into t;
 if not found then return null;end if;
 return jsonb_build_object('id',t.id,'accountId',t.account_id,'kind',t.kind,'screeningId',t.screening_id,'liveCallId',t.live_call_id,'signingId',t.signing_id,'voiceJobId',t.voice_job_id,'fulfillmentJobId',t.fulfillment_job_id,'titleTaskId',t.title_task_id,'textAiJobId',t.text_ai_job_id,'marketResearchJobId',t.market_research_job_id);
end $$;
revoke all on function public.icash_claim_market_research(uuid,uuid),public.icash_save_market_research(uuid,uuid,jsonb),public.icash_next_automation() from public,anon,authenticated;
grant execute on function public.icash_claim_market_research(uuid,uuid),public.icash_save_market_research(uuid,uuid,jsonb),public.icash_next_automation() to service_role;
