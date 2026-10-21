-- Staged shared-learning rollout: private helpers before policy activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Shared aggregate evidence; private records, budgets and permissions stay owned.


create table public.icash_learning_rollups(
 account_id uuid not null references public.icash_accounts(id),domain text not null,context text not null,market text not null,variant text not null,
 attempts bigint not null default 0,pending bigint not null default 0,positive bigint not null default 0,opted_out bigint not null default 0,
 contract_trials bigint not null default 0,contracts bigint not null default 0,closing_trials bigint not null default 0,closings bigint not null default 0,
 cost_cents bigint not null default 0,costs_complete boolean not null default false,updated_at timestamptz not null default now(),
 primary key(account_id,domain,context,market,variant),
 check(attempts>=0 and pending between 0 and attempts and positive between 0 and attempts and opted_out between 0 and attempts
  and contracts between 0 and contract_trials and closings between 0 and closing_trials and cost_cents>=0)
);
create index icash_shared_learning_rollups_cohort on public.icash_learning_rollups(domain,context,market,updated_at);
create table public.icash_learning_queue(
 account_id uuid primary key references public.icash_accounts(id),due_at timestamptz not null default now(),last_refreshed_at timestamptz,last_error_at timestamptz
);
create index icash_learning_due on public.icash_learning_queue(due_at);
create table public.icash_learning_assignments(
 account_id uuid not null references public.icash_accounts(id),domain text not null,subject text not null,context text not null,market text not null,
 variant text not null,policy_version text not null default 'shared-v1',mode text not null check(mode in ('explore','shared')),created_at timestamptz not null default now(),
 primary key(account_id,domain,subject)
);
create table public.icash_workspace_revisions(
 account_id uuid primary key references public.icash_accounts(id),revision bigint not null default 1,changed_at timestamptz not null default now()
);
create table public.icash_learning_conversion_cache(id integer primary key check(id=1),report jsonb not null,updated_at timestamptz not null default now());
alter table public.icash_learning_conversion_cache enable row level security;
revoke all on public.icash_learning_conversion_cache from public,anon,authenticated;
grant all on public.icash_learning_conversion_cache to service_role;
alter table public.icash_learning_rollups enable row level security;
alter table public.icash_learning_queue enable row level security;
alter table public.icash_learning_assignments enable row level security;
alter table public.icash_workspace_revisions enable row level security;
revoke all on public.icash_learning_rollups,public.icash_learning_queue,public.icash_learning_assignments,public.icash_workspace_revisions from public,anon,authenticated;
grant all on public.icash_learning_rollups,public.icash_learning_queue,public.icash_learning_assignments,public.icash_workspace_revisions to service_role;

-- Same provider/envelope/terms/recipient binding as verifiedSigningStatus in TS.
create function public.icash_learning_signature_verified(e public.icash_signing_envelopes) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare d jsonb:=e.provider_evidence;r jsonb;match jsonb;ordinal bigint;
begin
 if e.test_mode is distinct from false or e.state is distinct from 'completed' or e.provider_id is null
  or d->>'id' is distinct from e.provider_id or d->'test_mode' is distinct from 'false'::jsonb
  or lower(d->>'status') is distinct from 'completed' or d->'apply_signing_order' is distinct from 'true'::jsonb
  or d->'metadata'->>'icash_envelope' is distinct from e.id::text or d->'metadata'->>'terms_hash' is distinct from e.terms_hash
  or jsonb_typeof(e.recipients) is distinct from 'array' or jsonb_typeof(d->'recipients') is distinct from 'array' then return false;end if;
 if jsonb_array_length(e.recipients)<2 or jsonb_array_length(e.recipients)<>jsonb_array_length(d->'recipients')
  or (select count(distinct value->>'id') from jsonb_array_elements(e.recipients))<>jsonb_array_length(e.recipients)
  or (select count(distinct value->>'id') from jsonb_array_elements(d->'recipients'))<>jsonb_array_length(e.recipients) then return false;end if;
 for r,ordinal in select value,ordinality from jsonb_array_elements(e.recipients) with ordinality loop
  select value into match from jsonb_array_elements(d->'recipients') where value->>'id'=r->>'id';
  if match is null or lower(match->>'status') is distinct from 'signed' or match->'signing_order' is distinct from to_jsonb(ordinal)
   or (case when nullif(r->>'phone','') is not null then match->>'phone' is distinct from r->>'phone'
     else nullif(r->>'email','') is null or lower(match->>'email') is distinct from lower(r->>'email') end) then return false;end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create function public.icash_learning_deal_outcomes(p_account uuid)
returns table(deal_id uuid,screening_id uuid,purchase_at timestamptz,assignment_at timestamptz,closed_at timestamptz)
language sql stable security invoker set search_path='' as $$
 with signed as materialized (
  select e.deal_id,min(e.updated_at) filter(where e.kind='purchase') purchase_at,min(e.updated_at) filter(where e.kind='assignment') assignment_at
  from public.icash_signing_envelopes e where e.account_id=p_account and e.updated_at<=now() and public.icash_learning_signature_verified(e) group by e.deal_id
 ) select d.id,d.screening_id,s.purchase_at,s.assignment_at,
  (select min(u.created_at) from public.icash_closing_updates u join public.icash_title_replies r
   on r.id=u.reply_id and r.account_id=u.account_id and r.deal_id=u.deal_id and r.sender_verified
   where u.account_id=p_account and u.deal_id=d.id and u.kind='closed' and u.created_at between s.assignment_at and now()
    and r.received_at<=u.created_at and u.effective_date<=(now() at time zone 'America/Chicago')::date
    and (u.confirmed_by is not null or u.confirmation_source='verified_title_format')
    and s.purchase_at is not null and s.assignment_at is not null)
 from public.icash_deal_files d left join signed s on s.deal_id=d.id
 join public.icash_screening_jobs j on j.id=d.screening_id and j.account_id=d.account_id
 where d.account_id=p_account and coalesce(d.terms->>'practice','false')<>'true'
 and coalesce(j.snapshot->>'practice','false')<>'true' and coalesce(j.snapshot->>'propertyId','') not like 'practice_%';
$$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['icash_learning_signature_verified','icash_learning_deal_outcomes']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;end $$;
commit;
