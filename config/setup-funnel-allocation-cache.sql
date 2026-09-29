create table public.icash_setup_allocation(id integer primary key check(id=1),winner text check(winner in ('ownership','outcome')),checked_at timestamptz not null default '-infinity');
insert into public.icash_setup_allocation(id) values(1);
alter table public.icash_setup_allocation enable row level security;
revoke all on public.icash_setup_allocation from public,anon,authenticated;
grant all on public.icash_setup_allocation to service_role;
create index icash_bot_setup_created on public.icash_bot_setups(created_at);
create index icash_setup_paid_cohort on public.icash_funding_orders(guest_hash,paid_at) where mode='live' and state='paid';
create function public.icash_choose_setup_variant() returns text language plpgsql set search_path='' as $$
declare c public.icash_setup_allocation;report jsonb;winner text;loser text;n1 numeric;n2 numeric;r1 numeric;r2 numeric;
begin
 select * into c from public.icash_setup_allocation where id=1;
 -- Evaluate at most once per 15 minutes, not once per visitor. Others keep using the cache.
 if c.checked_at<now()-interval '15 minutes' and pg_try_advisory_xact_lock(71620414) then
  select * into c from public.icash_setup_allocation where id=1 for update;
  if c.checked_at<now()-interval '15 minutes' then
   report:=public.icash_setup_funnel_report();
   if jsonb_array_length(report)=2 then
    select x->>'variant',(x->>'visitors')::numeric,(x->>'buyers')::numeric/greatest(1,(x->>'visitors')::numeric) into winner,n1,r1 from jsonb_array_elements(report) x order by (x->>'buyers')::numeric/greatest(1,(x->>'visitors')::numeric) desc limit 1;
    select x->>'variant',(x->>'visitors')::numeric,(x->>'buyers')::numeric/greatest(1,(x->>'visitors')::numeric) into loser,n2,r2 from jsonb_array_elements(report) x where x->>'variant'<>winner;
   end if;
   if n1>=200 and n2>=200 and r1-2*sqrt(greatest(0.0001,r1*(1-r1))/n1)>r2+2*sqrt(greatest(0.0001,r2*(1-r2))/n2) then c.winner:=winner;else c.winner:=null;end if;
   update public.icash_setup_allocation set winner=c.winner,checked_at=now() where id=1;
  end if;
 end if;
 if c.winner is null then return case when random()<0.5 then 'ownership' else 'outcome' end;end if;
 return case when random()<0.8 then c.winner when c.winner='ownership' then 'outcome' else 'ownership' end;
end $$;
revoke all on function public.icash_choose_setup_variant() from public,anon,authenticated;
grant execute on function public.icash_choose_setup_variant() to service_role;
create or replace function public.icash_init_bot_setup(p_guest text,p_account uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare s public.icash_bot_setups;
begin
 if p_guest !~ '^[a-f0-9]{64}$' then raise exception 'Invalid session';end if;
 select * into s from public.icash_bot_setups where (guest_hash=p_guest and account_id is null) or (p_account is not null and account_id=p_account) order by (account_id=p_account) desc nulls last limit 1;
 if found then return to_jsonb(s)-'guest_hash'-'account_id';end if;
 insert into public.icash_bot_setups(guest_hash,account_id,variant) values(p_guest,p_account,public.icash_choose_setup_variant()) on conflict(guest_hash) do nothing;
 select * into s from public.icash_bot_setups where guest_hash=p_guest and (account_id is null or account_id=p_account);
 if not found then raise exception 'Session already claimed';end if;
 return to_jsonb(s)-'guest_hash'-'account_id';
end $$;
