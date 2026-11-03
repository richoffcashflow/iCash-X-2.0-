-- Isolated request-denial ledger and current-account gates; no provider calls.
create table icash_research_private.requests(id uuid primary key,kind text,account_id uuid,operation_key text,admitted boolean,created_at timestamptz default clock_timestamp(),finished_at timestamptz,result jsonb);
create table public.icash_operating_budget(id int primary key,enabled boolean default true);insert into public.icash_operating_budget values(1,true);
create table fixture_recovery_gates(account_id uuid primary key,eligible boolean default true,balance_cents int default 100,reserved_cents int default 0,membership boolean default true);
create function public.icash_owner_enrichment_retry_current(p_account uuid,p_screening uuid) returns boolean language sql stable as $$
 select coalesce((select eligible and balance_cents>reserved_cents and membership from public.fixture_recovery_gates where account_id=p_account),false)
 and public.icash_owner_enrichment_unstarted(p_account,p_screening,'owners:'||p_account||':'||p_screening);
$$;

create or replace function public.icash_membership_work_allowed(p_account uuid) returns boolean language sql stable as $$select coalesce((select membership from public.fixture_recovery_gates where account_id=p_account),false)$$;

create function public.icash_prune_research_requests() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 delete from icash_research_private.requests where id in (select id from icash_research_private.requests where created_at<now()-interval '30 days' order by created_at limit 10000);
 get diagnostics n=row_count;return n;
end $$;
