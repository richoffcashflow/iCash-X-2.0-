-- First-party, server-attributed funnel measurement. No contact or spend settings change.
create table public.icash_seller_optin_visits (
 id uuid primary key default gen_random_uuid(),
 experiment text not null default 'homeoffer-optin-v1' check(experiment='homeoffer-optin-v1'),
 guest_hash text not null check(guest_hash ~ '^[a-f0-9]{64}$'),
 variant text not null check(variant in ('fast_cash','as_is','ready')),
 source text not null check(source in ('meta','google','youtube','tiktok','direct','other')),
 campaign text not null default '' check(length(campaign)<=100 and campaign ~ '^[a-zA-Z0-9_-]*$'),
 device text not null check(device in ('mobile','desktop')),
 created_at timestamptz not null default now(),
 viewed_at timestamptz,started_at timestamptz,contact_at timestamptz,submitted_at timestamptz,
 lead_id uuid references public.icash_seller_intakes(id) on delete set null,
 unique(experiment,guest_hash)
);
create index icash_seller_optin_cohorts on public.icash_seller_optin_visits(created_at,source,device,variant);
create unique index icash_seller_optin_lead on public.icash_seller_optin_visits(lead_id) where lead_id is not null;
alter table public.icash_seller_optin_visits enable row level security;
revoke all on public.icash_seller_optin_visits from public,anon,authenticated;
grant select,insert,update,delete on public.icash_seller_optin_visits to service_role;

create function public.icash_open_seller_optin(p_guest text,p_variant text,p_source text,p_campaign text,p_device text)
returns text language plpgsql security invoker set search_path='' as $$
declare chosen text;
begin
 insert into public.icash_seller_optin_visits(guest_hash,variant,source,campaign,device)
 values(p_guest,p_variant,p_source,p_campaign,p_device)
 on conflict(experiment,guest_hash) do nothing;
 select variant into chosen from public.icash_seller_optin_visits where experiment='homeoffer-optin-v1' and guest_hash=p_guest;
 return chosen;
end $$;

create function public.icash_record_seller_optin_event(p_guest text,p_event text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_event not in ('view','start','contact') then raise exception 'Unknown opt-in event';end if;
 update public.icash_seller_optin_visits set
  viewed_at=case when p_event='view' then coalesce(viewed_at,now()) else viewed_at end,
  started_at=case when p_event='start' and viewed_at is not null then coalesce(started_at,now()) else started_at end,
  contact_at=case when p_event='contact' and viewed_at is not null then coalesce(contact_at,now()) else contact_at end
 where guest_hash=p_guest and experiment='homeoffer-optin-v1';
 return found;
end $$;

-- The browser cannot claim a submission, qualified result, or another visitor's version.
-- Lead persistence and attribution occur in the same transaction; retries do not add events.
create function public.icash_attribute_seller_optin()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.state='duplicate' or coalesce(new.attribution->>'measurementOptOut','false')='true' then return new;end if;
 update public.icash_seller_optin_visits set lead_id=new.id,submitted_at=new.created_at
 where experiment='homeoffer-optin-v1' and guest_hash=new.attribution->>'optinGuest'
 and lead_id is null and viewed_at is not null and viewed_at<=new.created_at;
 return new;
end $$;
create trigger icash_seller_optin_attribution after insert on public.icash_seller_intakes
for each row execute function public.icash_attribute_seller_optin();

create function public.icash_seller_optin_report()
returns jsonb language sql stable security invoker set search_path='' as $$
 with cohort as (
  select v.*,
   (l.state in ('qualified','assigned') and l.numbers_passed and l.market_qualified and l.checked_at is not null) as is_qualified,
   (v.viewed_at<(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')-interval '1 day') as mature,
   (l.checked_at<=v.viewed_at+interval '24 hours') as within_window
  from public.icash_seller_optin_visits v
  left join public.icash_seller_intakes l on l.id=v.lead_id
  where v.experiment='homeoffer-optin-v1' and v.created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')-interval '31 days'
 ), grouped as (
  select variant,source,device,
   count(*) filter(where viewed_at is not null) as views,
   count(*) filter(where started_at is not null) as starts,
   count(*) filter(where contact_at is not null) as contacts,
   count(*) filter(where lead_id is not null) as submissions,
   count(*) filter(where is_qualified) as qualified,
   count(*) filter(where mature) as "matureViews",
   count(*) filter(where mature and is_qualified and within_window) as "matureQualified"
  from cohort group by variant,source,device
 ) select coalesce(jsonb_agg(to_jsonb(grouped) order by source,device,variant),'[]'::jsonb) from grouped;
$$;

revoke all on function public.icash_open_seller_optin(text,text,text,text,text),public.icash_record_seller_optin_event(text,text),public.icash_attribute_seller_optin(),public.icash_seller_optin_report() from public,anon,authenticated;
grant execute on function public.icash_open_seller_optin(text,text,text,text,text),public.icash_record_seller_optin_event(text,text),public.icash_attribute_seller_optin(),public.icash_seller_optin_report() to service_role;
