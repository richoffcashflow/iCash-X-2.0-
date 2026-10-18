begin;
set local lock_timeout='3s';
create table public.icash_seller_meta_sources (
 id uuid primary key default gen_random_uuid(),campaign text not null unique check(campaign ~ '^[a-zA-Z0-9_-]{1,100}$'),
 ad_account text not null check(ad_account ~ '^act_[0-9]{5,30}$'),meta_campaign text not null check(meta_campaign ~ '^[0-9]{5,30}$'),
 enabled boolean not null default true,created_at timestamptz not null default now(),updated_by uuid not null,
 next_sync_at timestamptz not null default now(),claim_token uuid,claimed_until timestamptz,
 last_status text not null default 'pending' check(last_status in ('pending','synced','connection_required','invalid_report','unavailable')),
 last_checked_at timestamptz,last_synced_at timestamptz,unique(ad_account,meta_campaign)
);
create table public.icash_seller_meta_spend (
 id bigint generated always as identity primary key,source_id uuid not null references public.icash_seller_meta_sources(id),
 claim_token uuid not null,spend_day date not null,spend_micros bigint not null check(spend_micros between 0 and 1000000000000),
 currency text not null check(currency='USD'),timezone text not null,received_at timestamptz not null default now(),
 unique(source_id,claim_token,spend_day)
);
create index icash_seller_meta_spend_latest_idx on public.icash_seller_meta_spend(source_id,spend_day,id desc);
alter table public.icash_seller_meta_sources enable row level security;
alter table public.icash_seller_meta_spend enable row level security;
create policy service_only on public.icash_seller_meta_sources for all to service_role using(true) with check(true);
create policy service_only on public.icash_seller_meta_spend for all to service_role using(true) with check(true);
revoke all on public.icash_seller_meta_sources,public.icash_seller_meta_spend from public,anon,authenticated;
grant select,insert,update on public.icash_seller_meta_sources to service_role;
grant select,insert on public.icash_seller_meta_spend to service_role;
grant usage,select on sequence public.icash_seller_meta_spend_id_seq to service_role;

create function public.icash_save_seller_meta_source(p_actor uuid,p_campaign text,p_account text,p_meta_campaign text,p_enabled boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare existing public.icash_seller_meta_sources;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into existing from public.icash_seller_meta_sources where campaign=p_campaign for update;
 if found then
  if existing.ad_account is distinct from p_account or existing.meta_campaign is distinct from p_meta_campaign then raise exception 'Use a new tracking campaign to preserve spend attribution';end if;
  update public.icash_seller_meta_sources set enabled=p_enabled,updated_by=p_actor,next_sync_at=now(),claim_token=null,claimed_until=null where id=existing.id;
 else
  if (select count(*) from public.icash_seller_meta_sources)>=20 then raise exception 'Campaign limit reached';end if;
  insert into public.icash_seller_meta_sources(campaign,ad_account,meta_campaign,enabled,updated_by) values(p_campaign,p_account,p_meta_campaign,p_enabled,p_actor);
 end if;
 return jsonb_build_object('saved',true);
end $$;

create function public.icash_claim_seller_cost_sync() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.icash_seller_meta_sources;token uuid:=gen_random_uuid();
begin
 select * into s from public.icash_seller_meta_sources where enabled and next_sync_at<=now() and (claimed_until is null or claimed_until<=now()) order by next_sync_at,id limit 1 for update skip locked;
 if not found then return null;end if;
 update public.icash_seller_meta_sources set claim_token=token,claimed_until=now()+interval '2 minutes',next_sync_at=now()+interval '1 hour' where id=s.id;
 return jsonb_build_object('id',s.id,'token',token,'campaign',s.campaign,'accountId',s.ad_account,'metaCampaignId',s.meta_campaign);
end $$;

create function public.icash_finish_seller_cost_sync(p_id uuid,p_token uuid,p_status text,p_timezone text,p_days jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare s public.icash_seller_meta_sources;entry jsonb;day date;today date;seen date[]:='{}';
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into s from public.icash_seller_meta_sources where id=p_id and enabled and claim_token=p_token and claimed_until>now() for update;
 if not found then return false;end if;
 if p_status is null or p_status not in ('synced','connection_required','invalid_report','unavailable') then raise exception 'Invalid sync status';end if;
 if p_status='synced' then
  if p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone) or jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days)<>7 then raise exception 'Complete seven-day report required';end if;
  today:=(now() at time zone p_timezone)::date;
  for entry in select value from jsonb_array_elements(p_days) loop
   day:=(entry->>'day')::date;
   if day is null or day<today-7 or day>=today or day=any(seen) or entry->>'currency' is distinct from 'USD' or (entry->>'spendMicros') !~ '^[0-9]+$' then raise exception 'Invalid spend day';end if;
   seen:=array_append(seen,day);
   insert into public.icash_seller_meta_spend(source_id,claim_token,spend_day,spend_micros,currency,timezone) values(s.id,p_token,day,(entry->>'spendMicros')::bigint,'USD',p_timezone);
  end loop;
  update public.icash_seller_intakes set next_assignment_at=least(next_assignment_at,now()) where customer_costs is null and state in ('qualified','numbers_review') and attribution->>'source'='meta' and attribution->>'campaign'=s.campaign;
 end if;
 update public.icash_seller_meta_sources set claim_token=null,claimed_until=null,last_status=p_status,last_checked_at=now(),last_synced_at=case when p_status='synced' then now() else last_synced_at end where id=s.id;
 return true;
end $$;

-- Latest revision per day. Spend is counted once, regardless of recipient count.
create function public.icash_seller_meta_daily_costs(p_source uuid) returns table(day date,spend_micros bigint,lead_count bigint,timezone text,received_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select r.spend_day,r.spend_micros,(select count(*) from public.icash_seller_intakes l where l.canonical_id is null and l.state<>'duplicate' and l.contact_consent_scope is distinct from 'icash_x_demo'
  and l.attribution->>'source'='meta' and l.attribution->>'campaign'=s.campaign and l.created_at>=r.spend_day::timestamp at time zone r.timezone and l.created_at<(r.spend_day+1)::timestamp at time zone r.timezone),r.timezone,r.received_at
 from (select distinct on(spend_day) * from public.icash_seller_meta_spend where source_id=p_source order by spend_day,id desc) r
 join public.icash_seller_meta_sources s on s.id=r.source_id
$$;

create function public.icash_seller_meta_cost_quote(p_lead uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare l public.icash_seller_intakes;s public.icash_seller_meta_sources;d record;spend bigint;leads bigint;
begin
 select * into l from public.icash_seller_intakes where id=p_lead and attribution->>'source'='meta' and contact_consent_scope is distinct from 'icash_x_demo';if not found then return null;end if;
 select * into s from public.icash_seller_meta_sources where campaign=l.attribution->>'campaign';if not found then return null;end if;
 select * into d from public.icash_seller_meta_daily_costs(s.id) where day=(l.created_at at time zone timezone)::date;
 if found and d.lead_count>0 then return jsonb_build_object('costMicros',ceil(d.spend_micros::numeric/d.lead_count),'kind','meta_report','note','Meta campaign spend divided by unique leads received','spendDay',d.day,'syncedAt',d.received_at);end if;
 -- Price new work from a recent seven-day average; never label it an individual invoice.
 if l.customer_costs is not null or not s.enabled or s.last_synced_at is null or s.last_synced_at<now()-interval '48 hours' then return null;end if;
 select sum(spend_micros),sum(lead_count) into spend,leads from public.icash_seller_meta_daily_costs(s.id) where received_at=s.last_synced_at;
 if leads>0 then return jsonb_build_object('costMicros',ceil(spend::numeric/leads),'kind','meta_estimate','note','Automatic seven-day campaign average','syncedAt',s.last_synced_at);end if;
 return null;
end $$;

do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_seller_acquisition_quote(uuid)'::regprocedure);
 needle:='-- Preserve the acquisition estimate actually used when this lead was priced.';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Acquisition quote changed';end if;
 definition:=replace(definition,'campaign_name text;','campaign_name text;meta_quote jsonb;');
 definition:=replace(definition,needle,'meta_quote:=public.icash_seller_meta_cost_quote(l.id);if meta_quote is not null then return meta_quote;end if;'||chr(10)||needle);
 execute definition;
end $patch$;

create function public.icash_owner_seller_meta_costs(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'campaign',s.campaign,'accountId',s.ad_account,'metaCampaignId',s.meta_campaign,'enabled',s.enabled,'status',s.last_status,'checkedAt',s.last_checked_at,'syncedAt',s.last_synced_at,
 'spendMicros',coalesce(d.spend,0),'leadCount',coalesce(d.leads,0),'unallocatedMicros',coalesce(d.unallocated,0),'averageMicros',case when d.leads>0 then ceil(d.spend/d.leads) else null end) order by s.campaign),'[]'::jsonb) into result
 from public.icash_seller_meta_sources s left join lateral (select sum(spend_micros) spend,sum(lead_count) leads,sum(case when lead_count=0 then spend_micros else 0 end) unallocated from public.icash_seller_meta_daily_costs(s.id) where received_at=s.last_synced_at) d on true;
 return result;
end $$;
revoke all on function public.icash_save_seller_meta_source(uuid,text,text,text,boolean),public.icash_claim_seller_cost_sync(),public.icash_finish_seller_cost_sync(uuid,uuid,text,text,jsonb),public.icash_seller_meta_daily_costs(uuid),public.icash_seller_meta_cost_quote(uuid),public.icash_owner_seller_meta_costs(uuid) from public,anon,authenticated;
grant execute on function public.icash_save_seller_meta_source(uuid,text,text,text,boolean),public.icash_claim_seller_cost_sync(),public.icash_finish_seller_cost_sync(uuid,uuid,text,text,jsonb),public.icash_seller_meta_daily_costs(uuid),public.icash_seller_meta_cost_quote(uuid),public.icash_owner_seller_meta_costs(uuid) to service_role;
commit;
