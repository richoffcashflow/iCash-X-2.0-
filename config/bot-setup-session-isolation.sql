create or replace function public.icash_init_bot_setup(p_guest text,p_account uuid default null) returns jsonb language plpgsql set search_path='' as $$
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
