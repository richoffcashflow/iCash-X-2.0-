set local lock_timeout='2s';
set local statement_timeout='8s';
-- Keep five oldest due checks and all fifteen fresh-event slots. Prefer active
-- agreements/buyers/title in the remaining five; ordinary accounts cannot starve.
do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_run_deal_supervisor()'::regprocedure);
 if md5(d)<>'0a2e2e005bee1bbfb720d5e632bd93a6' then raise exception 'Seller memory supervisor prerequisite changed';end if;
 needle:=$n$with due as materialized (select account_id,deal_id from public.icash_deal_supervisor where next_check_at<=now() order by next_check_at,deal_id limit 10),$n$;
 replacement:=$n$with due_window as materialized (
   select account_id,deal_id,milestone,next_check_at from public.icash_deal_supervisor where next_check_at<=now() order by next_check_at,deal_id limit 50
  ), fair as materialized (select account_id,deal_id from due_window order by next_check_at,deal_id limit 5),
  active as materialized (select account_id,deal_id from due_window w where not exists(select 1 from fair f where f.deal_id=w.deal_id)
   order by case when public.icash_seller_memory_enabled(w.account_id)
     and w.milestone in ('purchase','buyer','title','proceeds') then 0 else 1 end,w.next_check_at,w.deal_id limit 5),
  due as materialized (select * from fair union select * from active),$n$;
 if position(needle in d)=0 then raise exception 'Supervisor due selector missing';end if;
 execute replace(d,needle,replacement);
end $patch$;
