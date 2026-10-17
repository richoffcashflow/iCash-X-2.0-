-- Owner-managed ad links and first-party creative attribution. No provider work.
create table public.icash_seller_ad_links (
 slug text primary key check(slug ~ '^[a-z0-9][a-z0-9_-]{2,79}$'),
 label text not null check(length(label) between 2 and 100),
 format text not null check(format in ('image','video')),
 source text not null check(source in ('meta','google','youtube','tiktok','other','direct')),
 campaign text not null check(length(campaign) between 1 and 100 and campaign ~ '^[a-zA-Z0-9_-]+$'),
 legacy_campaign text unique,
 asset_url text not null default '' check(length(asset_url)<=2000 and (asset_url='' or asset_url like 'https://%')),
 created_at timestamptz not null default now()
);
create table public.icash_seller_ad_visits (
 ad_slug text not null references public.icash_seller_ad_links(slug),
 guest_hash text not null check(guest_hash ~ '^[a-f0-9]{64}$'),
 first_seen_at timestamptz not null default clock_timestamp(),
 last_seen_at timestamptz not null default clock_timestamp(),
 lead_id uuid references public.icash_seller_intakes(id) on delete set null,
 submitted_at timestamptz,
 primary key(ad_slug,guest_hash)
);
create index icash_seller_ad_last_touch on public.icash_seller_ad_visits(guest_hash,last_seen_at desc);
create unique index icash_seller_ad_lead on public.icash_seller_ad_visits(lead_id) where lead_id is not null;
alter table public.icash_seller_ad_links enable row level security;
alter table public.icash_seller_ad_visits enable row level security;
revoke all on public.icash_seller_ad_links,public.icash_seller_ad_visits from public,anon,authenticated;
grant select,insert,update,delete on public.icash_seller_ad_links,public.icash_seller_ad_visits to service_role;
create policy icash_seller_ad_links_service on public.icash_seller_ad_links for all to service_role using(true) with check(true);
create policy icash_seller_ad_visits_service on public.icash_seller_ad_visits for all to service_role using(true) with check(true);

create function public.icash_visit_seller_ad(p_guest text,p_slug text,p_legacy_campaign text default '')
returns boolean language plpgsql security invoker set search_path='' as $$
declare matched text;
begin
 if p_guest is null or p_guest !~ '^[a-f0-9]{64}$' then return false;end if;
 -- An explicit but unknown ad never falls back to another campaign.
 select slug into matched from public.icash_seller_ad_links
 where (p_slug<>'' and slug=p_slug) or (p_slug='' and p_legacy_campaign<>'' and legacy_campaign=p_legacy_campaign);
 if matched is null then return false;end if;
 insert into public.icash_seller_ad_visits(ad_slug,guest_hash) values(matched,p_guest)
 on conflict(ad_slug,guest_hash) do update set last_seen_at=clock_timestamp();
 return true;
end $$;

-- A browser cannot submit a conversion event. Only a newly persisted, valid intake
-- can credit one visitor, to their last measured ad within the attribution window.
create function public.icash_attribute_seller_ad()
returns trigger language plpgsql security invoker set search_path='' as $$
declare matched text;
begin
 if new.state='duplicate' or coalesce(new.attribution->>'measurementOptOut','false')='true' then return new;end if;
 select ad_slug into matched from public.icash_seller_ad_visits
 where guest_hash=new.attribution->>'optinGuest'
 and last_seen_at<=new.created_at and last_seen_at>=new.created_at-interval '30 days'
 order by last_seen_at desc,ad_slug limit 1;
 if matched is not null then
  update public.icash_seller_ad_visits set lead_id=new.id,submitted_at=new.created_at
  where ad_slug=matched and guest_hash=new.attribution->>'optinGuest' and lead_id is null;
 end if;
 return new;
end $$;
create trigger icash_seller_ad_attribution after insert on public.icash_seller_intakes
for each row execute function public.icash_attribute_seller_ad();

create function public.icash_seller_ad_report()
returns jsonb language sql stable security invoker set search_path='' as $$
 with counts as (
  select v.ad_slug,count(*) as visitors,
   count(*) filter(where v.lead_id is not null and l.state<>'duplicate') as responses,
   count(*) filter(where l.state in ('qualified','assigned') and l.numbers_passed and l.market_qualified and l.checked_at is not null) as qualified
  from public.icash_seller_ad_visits v left join public.icash_seller_intakes l on l.id=v.lead_id group by v.ad_slug
 ), report as (
  select a.slug,a.label,a.format,a.source,a.campaign,a.asset_url as "assetUrl",a.created_at as "createdAt",
   coalesce(c.visitors,0) as visitors,coalesce(c.responses,0) as responses,coalesce(c.qualified,0) as qualified
  from public.icash_seller_ad_links a left join counts c on c.ad_slug=a.slug
 ) select coalesce(jsonb_agg(to_jsonb(report) order by "createdAt",slug),'[]'::jsonb) from report;
$$;
revoke all on function public.icash_visit_seller_ad(text,text,text),public.icash_attribute_seller_ad(),public.icash_seller_ad_report() from public,anon,authenticated;
grant execute on function public.icash_visit_seller_ad(text,text,text),public.icash_attribute_seller_ad(),public.icash_seller_ad_report() to service_role;

-- Keep the ten links already delivered in the ad pack working. Video rows are
-- tracking slots, not a claim that the video assets have been produced.
insert into public.icash_seller_ad_links(slug,label,format,source,campaign,legacy_campaign)
select 'hon-'||f.prefix||c.num,f.title||' '||c.num||' · '||c.label,f.format,'meta','hon_fast_cash_cbo_20261016','hon_'||f.format||'_'||c.num||'_'||c.code||'_20261016'
from (values ('i','Image','image'),('v','Video','video')) as f(prefix,title,format)
cross join (values ('01','Fast cash','fast_cash'),('02','Sell as-is','sell_as_is'),('03','Before you list','before_you_list'),('04','Cash offer','cash_offer_curiosity'),('05','Next chapter','next_chapter')) as c(num,label,code);
