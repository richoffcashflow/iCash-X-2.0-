-- Capture the first actual qualification request prospectively. Shared-directory
-- reuse never assigns the same provider operation to a second property.
do $$
begin
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=to_regprocedure('public.icash_queue_title_qualification(uuid,uuid)')
  and md5(p.prosrc)='c172ac244c10d7b8cec8a080b86bd45f' and not p.prosecdef and p.provolatile='v') then
  raise exception 'Reviewed title qualification queue source required';
 end if;
end $$;

create schema if not exists icash_learning_private;
create table icash_learning_private.title_qualification_origins (
 job_id uuid primary key references public.icash_title_qualification_jobs(id),
 account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),
 screening_id uuid references public.icash_screening_jobs(id),
 property_id text check(property_id is null or length(btrim(property_id))>0),
 assigned_at timestamptz not null default now()
);
create index title_qualification_origins_property on icash_learning_private.title_qualification_origins(account_id,property_id,assigned_at);
create table icash_learning_private.title_qualification_reuses (
 job_id uuid not null references public.icash_title_qualification_jobs(id),
 account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),
 screening_id uuid references public.icash_screening_jobs(id),
 property_id text check(property_id is null or length(btrim(property_id))>0),
 reused_at timestamptz not null default now(),primary key(job_id,deal_id)
);
create index title_qualification_reuses_property on icash_learning_private.title_qualification_reuses(account_id,property_id,reused_at);
alter table icash_learning_private.title_qualification_origins enable row level security;
alter table icash_learning_private.title_qualification_reuses enable row level security;
revoke all on icash_learning_private.title_qualification_origins,icash_learning_private.title_qualification_reuses from public,anon,authenticated,service_role;
grant usage on schema icash_learning_private to service_role;
grant select on icash_learning_private.title_qualification_origins,icash_learning_private.title_qualification_reuses to service_role;
create policy title_qualification_origins_service_read on icash_learning_private.title_qualification_origins for select to service_role using(true);
create policy title_qualification_reuses_service_read on icash_learning_private.title_qualification_reuses for select to service_role using(true);

create function icash_learning_private.keep_title_cost_attribution() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Title cost attribution is immutable';end $$;
revoke all on function icash_learning_private.keep_title_cost_attribution() from public,anon,authenticated,service_role;
create trigger keep_title_qualification_origin before update or delete on icash_learning_private.title_qualification_origins
for each row execute function icash_learning_private.keep_title_cost_attribution();
create trigger keep_title_qualification_reuse before update or delete on icash_learning_private.title_qualification_reuses
for each row execute function icash_learning_private.keep_title_cost_attribution();

-- Definer scope is needed only for append-only private attribution. Ordinary
-- roles cannot invoke this queue or write either attribution table.
create or replace function public.icash_queue_title_qualification(p_account uuid,p_deal uuid) returns void
language plpgsql security definer set search_path='' as $$
declare market_name text;st text;screen uuid;prop text;company uuid;job uuid;
begin
 select a.market,d.terms->>'state',s.id,
  case when jsonb_typeof(s.snapshot->'propertyId')='string' and nullif(btrim(s.snapshot->>'propertyId'),'') is not null then s.snapshot->>'propertyId' end
 into market_name,st,screen,prop
 from public.icash_deal_files d join public.icash_disposition_authorities a on a.deal_id=d.id and a.account_id=d.account_id
 left join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
 where d.id=p_deal and d.account_id=p_account and d.stage in ('under_contract','buyer_selected') and a.expires_at>now()
 and exists(select 1 from public.icash_signing_envelopes e where e.id=a.purchase_envelope_id and e.account_id=p_account and e.state='completed' and not e.test_mode);
 if market_name is null or length(market_name)>120 or st !~ '^[A-Z]{2}$' then return;end if;
 if exists(select 1 from public.icash_title_contacts where deal_id=p_deal and account_id=p_account and enabled and verified_until>now()) then return;end if;
 -- Serialize the original unique account/company/market identity before choosing
 -- its first originating deal; ON CONFLICT also preserves external/legacy jobs.
 perform pg_advisory_xact_lock(hashtextextended(p_account::text||':'||market_name,917406251));
 for company in select id from public.icash_title_directory
  where st=any(claimed_states) and status<>'rejected' and public_email is not null and contact_checked_until>now()
  order by case when status='qualified' and verified_until>now() then 0 else 1 end,id limit 2
 loop
  job:=null;
  insert into public.icash_title_qualification_jobs(account_id,company_id,market,state_code)
  values(p_account,company,market_name,st) on conflict do nothing returning id into job;
  if job is not null then
   insert into icash_learning_private.title_qualification_origins(job_id,account_id,deal_id,screening_id,property_id)
   values(job,p_account,p_deal,screen,prop);
  else
   select id into job from public.icash_title_qualification_jobs where account_id=p_account and company_id=company and market=market_name;
   -- A historical job stays originless. A later queue request proves reuse only,
   -- never where that already-created provider work originally belonged.
   if job is not null and not exists(select 1 from icash_learning_private.title_qualification_origins where job_id=job and account_id=p_account and deal_id=p_deal) then
    insert into icash_learning_private.title_qualification_reuses(job_id,account_id,deal_id,screening_id,property_id)
    values(job,p_account,p_deal,screen,prop) on conflict do nothing;
   end if;
  end if;
 end loop;
end $$;
revoke all on function public.icash_queue_title_qualification(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_queue_title_qualification(uuid,uuid) to service_role;
