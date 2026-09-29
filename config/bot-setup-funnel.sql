create table public.icash_bot_setups(
 id uuid primary key default gen_random_uuid(),guest_hash text not null unique check(guest_hash ~ '^[a-f0-9]{64}$'),
 account_id uuid unique references public.icash_accounts(id),profile jsonb not null default '{}',stage integer not null default 0 check(stage between 0 and 4),
 revision integer not null default 0,variant text not null check(variant in ('ownership','outcome')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.icash_setup_events(
 setup_id uuid not null references public.icash_bot_setups(id),event text not null,
 created_at timestamptz not null default now(),primary key(setup_id,event),
 check(event in ('name_viewed','style_viewed','voice_viewed','market_viewed','funding_viewed','name_saved','style_saved','voice_saved','market_saved','setup_completed','voice_played','checkout_clicked','checkout_opened','checkout_failed','returned'))
);
alter table public.icash_bot_setups enable row level security;
alter table public.icash_setup_events enable row level security;
revoke all on public.icash_bot_setups,public.icash_setup_events from public,anon,authenticated;
grant all on public.icash_bot_setups,public.icash_setup_events to service_role;
create function public.icash_record_setup_event(p_setup uuid,p_event text) returns void language sql set search_path='' as $$
 insert into public.icash_setup_events(setup_id,event) values(p_setup,p_event) on conflict do nothing;
$$;
-- Mature 24-hour cohorts only. Purchases come exclusively from settled live orders.
create function public.icash_setup_funnel_report() returns jsonb language sql stable set search_path='' as $$
 with cohort as (select s.* from public.icash_bot_setups s where s.created_at<now()-interval '24 hours' and s.created_at>=now()-interval '31 days'),
 rows as (select s.id,s.variant,
  exists(select 1 from public.icash_setup_events e where e.setup_id=s.id and e.event='name_saved' and e.created_at<=s.created_at+interval '24 hours') as named,
  exists(select 1 from public.icash_setup_events e where e.setup_id=s.id and e.event='style_saved' and e.created_at<=s.created_at+interval '24 hours') as styled,
  exists(select 1 from public.icash_setup_events e where e.setup_id=s.id and e.event='voice_saved' and e.created_at<=s.created_at+interval '24 hours') as voiced,
  exists(select 1 from public.icash_setup_events e where e.setup_id=s.id and e.event='setup_completed' and e.created_at<=s.created_at+interval '24 hours') as ready,
  exists(select 1 from public.icash_setup_events e where e.setup_id=s.id and e.event='checkout_opened' and e.created_at<=s.created_at+interval '24 hours') as checkout,
  coalesce((select sum(o.price_cents) from public.icash_funding_orders o where o.guest_hash=s.guest_hash and o.mode='live' and o.state='paid' and o.paid_at between s.created_at and s.created_at+interval '24 hours'),0) as revenue
 from cohort s),stats as (
 select variant,count(*) as visitors,count(*) filter(where named) as name_saved,count(*) filter(where styled) as style_saved,count(*) filter(where voiced) as voice_saved,count(*) filter(where ready) as setup_completed,count(*) filter(where checkout) as checkout_opened,count(*) filter(where revenue>0) as buyers,sum(revenue) as revenue_cents from rows group by variant)
 select coalesce(jsonb_agg(to_jsonb(stats)),'[]'::jsonb) from stats;
$$;
create function public.icash_init_bot_setup(p_guest text,p_account uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare s public.icash_bot_setups;v text;report jsonb;winner text;loser text;n1 numeric;n2 numeric;r1 numeric;r2 numeric;
begin
 if p_guest !~ '^[a-f0-9]{64}$' then raise exception 'Invalid session';end if;
 select * into s from public.icash_bot_setups where (guest_hash=p_guest and account_id is null) or (p_account is not null and account_id=p_account) order by (account_id=p_account) desc nulls last limit 1;
 if found then return to_jsonb(s)-'guest_hash'-'account_id';end if;
 v:=case when random()<0.5 then 'ownership' else 'outcome' end;
 report:=public.icash_setup_funnel_report();
 -- Only optimize between two reviewed CTA variants. Preserve 20% exploration.
 if jsonb_array_length(report)=2 then
  select x->>'variant',(x->>'visitors')::numeric,(x->>'buyers')::numeric/greatest(1,(x->>'visitors')::numeric) into winner,n1,r1 from jsonb_array_elements(report) x order by (x->>'buyers')::numeric/greatest(1,(x->>'visitors')::numeric) desc limit 1;
  select x->>'variant',(x->>'visitors')::numeric,(x->>'buyers')::numeric/greatest(1,(x->>'visitors')::numeric) into loser,n2,r2 from jsonb_array_elements(report) x where x->>'variant'<>winner;
  if n1>=200 and n2>=200 and r1-2*sqrt(greatest(0.0001,r1*(1-r1))/n1)>r2+2*sqrt(greatest(0.0001,r2*(1-r2))/n2) then
   v:=case when random()<0.8 then winner else loser end;
  end if;
 end if;
 insert into public.icash_bot_setups(guest_hash,account_id,variant) values(p_guest,p_account,v) on conflict(guest_hash) do nothing;
 select * into s from public.icash_bot_setups where guest_hash=p_guest and (account_id is null or account_id=p_account);
 if not found then raise exception 'Session already claimed';end if;
 return to_jsonb(s)-'guest_hash'-'account_id';
end $$;
create function public.icash_save_bot_setup(p_setup uuid,p_revision integer,p_profile jsonb,p_stage integer) returns jsonb language plpgsql set search_path='' as $$
declare s public.icash_bot_setups;e text;
begin
 select * into s from public.icash_bot_setups where id=p_setup for update;
 if not found or s.revision<>p_revision then return null;end if;
 if p_stage not between 0 and 4 or length(trim(p_profile->>'displayName')) not between 1 and 64 then raise exception 'Invalid setup';end if;
 update public.icash_bot_setups set profile=p_profile,stage=p_stage,revision=revision+1,updated_at=now() where id=p_setup returning * into s;
 e:=case p_stage when 1 then 'name_saved' when 2 then 'style_saved' when 3 then 'voice_saved' when 4 then 'market_saved' else null end;
 if e is not null then perform public.icash_record_setup_event(s.id,e);end if;
 if p_stage=4 then perform public.icash_record_setup_event(s.id,'setup_completed');end if;
 return to_jsonb(s)-'guest_hash'-'account_id';
end $$;
create function public.icash_claim_bot_setup(p_account uuid) returns void language plpgsql set search_path='' as $$
begin
 perform 1 from public.icash_accounts where id=p_account for update;
 if not found or exists(select 1 from public.icash_bot_setups where account_id=p_account) then return;end if;
 update public.icash_bot_setups set account_id=p_account where id=(
  select s.id from public.icash_bot_setups s join public.icash_funding_orders o on o.guest_hash=s.guest_hash
  where s.account_id is null and o.account_id=p_account and o.state='paid' order by o.paid_at desc limit 1);
end $$;
revoke all on function public.icash_record_setup_event(uuid,text),public.icash_setup_funnel_report(),public.icash_init_bot_setup(text,uuid),public.icash_save_bot_setup(uuid,integer,jsonb,integer),public.icash_claim_bot_setup(uuid) from public,anon,authenticated;
grant execute on function public.icash_record_setup_event(uuid,text),public.icash_setup_funnel_report(),public.icash_init_bot_setup(text,uuid),public.icash_save_bot_setup(uuid,integer,jsonb,integer),public.icash_claim_bot_setup(uuid) to service_role;
