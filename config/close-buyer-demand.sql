begin;
set local lock_timeout='5s';
-- Unknown capacity stays unknown until the buyer explicitly supplies it.
alter table public.icash_network_buyers add column available_deals integer check(available_deals between 0 and 100);
alter function public.icash_network_save_buyer(uuid,jsonb) rename to icash_network_save_buyer_before_capacity;
create function public.icash_network_save_buyer(p_user uuid,p_profile jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare buyer uuid;
begin
 if p_profile ? 'availableDeals' and p_profile->'availableDeals'<>'null'::jsonb and
 (jsonb_typeof(p_profile->'availableDeals')<>'number' or (p_profile->>'availableDeals')::numeric<>trunc((p_profile->>'availableDeals')::numeric) or (p_profile->>'availableDeals')::integer not between 0 and 100) then raise exception 'Invalid buying capacity';end if;
 buyer:=public.icash_network_save_buyer_before_capacity(p_user,p_profile);
 if p_profile ? 'availableDeals' then update public.icash_network_buyers set available_deals=(p_profile->>'availableDeals')::integer where id=buyer and user_id=p_user;end if;
 return buyer;
end $$;
alter function public.icash_network_profile(uuid) rename to icash_network_profile_before_capacity;
create function public.icash_network_profile(p_user uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.icash_network_profile_before_capacity(p_user)||jsonb_build_object('availableDeals',b.available_deals)
 from public.icash_network_buyers b where b.user_id=p_user
$$;
create function public.icash_current_buyer_demand(p_zip text,p_price bigint default null,p_repairs bigint default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 with buyers as (
 select b.* from public.icash_network_buyers b join auth.users u on u.id=b.user_id and u.email_confirmed_at is not null and lower(btrim(u.email))=b.email
 where not b.paused and b.expires_at>now() and b.zips @> array[p_zip] and 'house'=any(b.property_types)
 and (b.available_deals is null or b.available_deals>0)
 and (p_price is null or b.max_price_cents>=p_price) and (p_repairs is null or b.max_repairs_cents>=p_repairs)
 and not exists(select 1 from public.icash_email_suppressions s where lower(s.email)=b.email)
 ) select case when count(*)<3 then jsonb_build_object('buyers',0,'capacityBuyers',0,'score',0) else
 jsonb_build_object('buyers',count(*),'capacityBuyers',count(*) filter(where available_deals>0),
 'budgetCents',floor(percentile_cont(0.5) within group(order by max_price_cents)/1000000)*1000000,
 'repairBudgetCents',floor(percentile_cont(0.5) within group(order by max_repairs_cents)/100000)*100000,
 'score',least(1,(count(*)+count(*) filter(where available_deals>0))::numeric/20)) end from buyers
$$;
alter function public.icash_opportunity_market_score(uuid,text) rename to icash_opportunity_market_score_before_demand;
create function public.icash_opportunity_market_score(p_account uuid,p_zip text) returns numeric
language sql stable security invoker set search_path='' as $$
 select 0.8*public.icash_opportunity_market_score_before_demand(p_account,p_zip)
  +0.2*coalesce((public.icash_current_buyer_demand(p_zip)->>'score')::numeric,0)
$$;
alter function public.icash_opportunity_score(uuid,jsonb,text) rename to icash_opportunity_score_before_demand;
create function public.icash_opportunity_score(p_account uuid,p_result jsonb,p_zip text) returns numeric
language sql stable security invoker set search_path='' as $$
 select case when p_result->'financialCheck'->>'status'='eligible' then
 0.8*public.icash_opportunity_score_before_demand(p_account,p_result,p_zip)
 +0.2*case when jsonb_typeof(p_result->'property'->'offerCalculation'->'buyerCeilingCents')='number'
 and jsonb_typeof(p_result->'property'->'offerCalculation'->'repairCents')='number' then
 coalesce((public.icash_current_buyer_demand(p_zip,(p_result->'property'->'offerCalculation'->>'buyerCeilingCents')::bigint,
 (p_result->'property'->'offerCalculation'->>'repairCents')::bigint)->>'score')::numeric,0) else 0 end else -1 end
$$;
-- The existing source selector already orders by these functions before buying
-- contact research or rotating an authorized inventory market.
alter function public.icash_network_demand(uuid) rename to icash_network_demand_before_capacity;
create function public.icash_network_demand(p_account uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;markets jsonb;
begin
 result:=public.icash_network_demand_before_capacity(p_account);
 select coalesce(jsonb_agg(m||jsonb_build_object('matchingHouses',d->'buyers','capacityBuyers',d->'capacityBuyers',
 'budgetCents',d->'budgetCents','repairBudgetCents',d->'repairBudgetCents') order by (d->>'score')::numeric desc,m->>'zip'),'[]')
 into markets from jsonb_array_elements(result->'markets') m cross join lateral public.icash_current_buyer_demand(m->>'zip') as demand(d);
 return result||jsonb_build_object('markets',markets);
end $$;

create table public.icash_buyer_deal_feedback(
 id uuid primary key,match_id uuid not null references public.icash_network_matches(id),
 reason text not null check(reason in ('price','repairs','timing','location','capacity','other')),
 counteroffer_cents bigint check(counteroffer_cents between 100000 and 10000000000 and counteroffer_cents%100000=0),
 created_at timestamptz not null default now(),check(counteroffer_cents is null or reason='price')
);
create index icash_buyer_deal_feedback_match on public.icash_buyer_deal_feedback(match_id,created_at desc);
alter table public.icash_buyer_deal_feedback enable row level security;
revoke all on public.icash_buyer_deal_feedback from public,anon,authenticated;
grant select,insert on public.icash_buyer_deal_feedback to service_role;
create function public.icash_network_feedback(p_user uuid,p_match uuid,p_state text,p_key uuid,p_reason text,p_price bigint default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_network_matches m join public.icash_network_buyers b on b.id=m.buyer_id
 where m.id=p_match and b.user_id=p_user for update of m;
 if not found then raise exception 'Match unavailable';end if;
 if exists(select 1 from public.icash_buyer_deal_feedback where id=p_key and match_id=p_match and reason=p_reason and counteroffer_cents is not distinct from p_price) then return;end if;
 perform public.icash_network_respond(p_user,p_match,p_state);
 insert into public.icash_buyer_deal_feedback(id,match_id,reason,counteroffer_cents) values(p_key,p_match,p_reason,p_price);
end $$;
revoke all on function public.icash_network_save_buyer(uuid,jsonb),public.icash_network_profile(uuid),public.icash_current_buyer_demand(text,bigint,bigint),public.icash_opportunity_market_score(uuid,text),public.icash_opportunity_score(uuid,jsonb,text),public.icash_network_demand(uuid),public.icash_network_feedback(uuid,uuid,text,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.icash_network_save_buyer(uuid,jsonb),public.icash_network_profile(uuid),public.icash_current_buyer_demand(text,bigint,bigint),public.icash_opportunity_market_score(uuid,text),public.icash_opportunity_score(uuid,jsonb,text),public.icash_network_demand(uuid),public.icash_network_feedback(uuid,uuid,text,uuid,text,bigint) to service_role;
commit;
