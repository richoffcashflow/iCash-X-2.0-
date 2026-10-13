begin;
create schema if not exists icash_efficiency_private;
revoke all on schema icash_efficiency_private from public,anon,authenticated;
grant usage on schema icash_efficiency_private to service_role;
create table icash_efficiency_private.photo_cache (
 account_id uuid not null references public.icash_accounts(id) on delete cascade,
 screening_id uuid not null references public.icash_screening_jobs(id) on delete cascade,
 photo jsonb,
 expires_at timestamptz not null default '-infinity',
 lease uuid,
 lease_until timestamptz not null default '-infinity',
 updated_at timestamptz not null default now(),
 primary key(account_id,screening_id),
 check(photo is null or (jsonb_typeof(photo)='object' and octet_length(photo::text)<=8192))
);
create index icash_photo_cache_screening on icash_efficiency_private.photo_cache(screening_id);
create index icash_photo_cache_cleanup on icash_efficiency_private.photo_cache(updated_at);
alter table icash_efficiency_private.photo_cache enable row level security;
revoke all on icash_efficiency_private.photo_cache from public,anon,authenticated;
grant select,insert,update,delete on icash_efficiency_private.photo_cache to service_role;

create function public.icash_claim_photo_cache(p_account uuid,p_screening uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c icash_efficiency_private.photo_cache; token uuid;
begin
 if not exists(select 1 from public.icash_screening_jobs where id=p_screening and account_id=p_account and state='complete') then return jsonb_build_object('state','unavailable');end if;
 insert into icash_efficiency_private.photo_cache(account_id,screening_id) values(p_account,p_screening) on conflict do nothing;
 select * into c from icash_efficiency_private.photo_cache where account_id=p_account and screening_id=p_screening for update;
 if c.expires_at>now() then return jsonb_build_object('state','cached','photo',c.photo);end if;
 if c.lease_until>now() then return jsonb_build_object('state','loading');end if;
 token:=gen_random_uuid();
 update icash_efficiency_private.photo_cache set lease=token,lease_until=now()+interval '45 seconds',updated_at=now() where account_id=p_account and screening_id=p_screening;
 return jsonb_build_object('state','claimed','lease',token);
end $$;
create function public.icash_finish_photo_cache(p_account uuid,p_screening uuid,p_lease uuid,p_photo jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_photo is not null and (jsonb_typeof(p_photo)<>'object' or octet_length(p_photo::text)>8192 or
  (p_photo->>'source') is distinct from 'DealMachine' or coalesce(p_photo->>'view','') not in ('street_view','satellite') or
  coalesce(p_photo->>'url','') !~ '^https://img[.]dealmachine[.]com/(sv|sat)/') then raise exception 'Invalid property photo';end if;
 update icash_efficiency_private.photo_cache set photo=p_photo,lease=null,lease_until='-infinity',
  expires_at=now()+case when p_photo is null then interval '1 minute' else interval '15 minutes' end,updated_at=now()
 where account_id=p_account and screening_id=p_screening and lease=p_lease and lease_until>now();
 return found;
end $$;
revoke all on function public.icash_claim_photo_cache(uuid,uuid),public.icash_finish_photo_cache(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_claim_photo_cache(uuid,uuid),public.icash_finish_photo_cache(uuid,uuid,uuid,jsonb) to service_role;

-- Aged-cost visibility never fabricates a receipt, replays a provider request,
-- modifies balances, or labels an unreconciled observation as a settled cost.
create index if not exists icash_operation_spend_pending_age on public.icash_operation_spend(dispatched_at) where state='dispatched';
create function public.icash_cost_health() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'checkedAt',now(),
  'pendingCount',count(*),
  'agedCount',count(*) filter(where dispatched_at<now()-interval '24 hours'),
  'oldestAt',min(dispatched_at),
  'unreconciledObservations',(select count(*) from public.icash_cost_observations where not reconciled)
 ) from public.icash_operation_spend where state='dispatched';
$$;
create function public.icash_refresh_cost_health() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare report jsonb;
begin
 report:=public.icash_cost_health();
 insert into public.icash_integration_checks(provider,checked_at,result) values('operating_cost_health',now(),report)
 on conflict(provider) do update set checked_at=excluded.checked_at,result=excluded.result;
 delete from icash_efficiency_private.photo_cache where (account_id,screening_id) in (
  select account_id,screening_id from icash_efficiency_private.photo_cache where updated_at<now()-interval '7 days' and lease_until<now() order by updated_at limit 500
 );
 return report;
end $$;
revoke all on function public.icash_cost_health(),public.icash_refresh_cost_health() from public,anon,authenticated;
grant execute on function public.icash_cost_health(),public.icash_refresh_cost_health() to service_role;
commit;
