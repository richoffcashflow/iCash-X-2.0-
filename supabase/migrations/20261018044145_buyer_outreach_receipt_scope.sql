begin;
set local lock_timeout='5s';
-- Owner delivery tests have real provider receipts, but are not real buyer
-- outreach. Keep their history and dedicated test delivery path intact.
do $scope$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_buyer_outreach_status(uuid,uuid)'::regprocedure);
 needle:=$n$and party='buyer' and retired_at is null loop$n$;
 if position(needle in definition)=0 then raise exception 'Buyer diagnostic contact boundary changed';end if;
 definition:=replace(definition,needle,$n$and party='buyer' and retired_at is null and to_jsonb(icash_text_threads)->>'owner_buyer_test_id' is null loop$n$);
 needle:='th.id=p.thread_id and th.deal_id=p_deal';
 if position(needle in definition)=0 then raise exception 'Buyer diagnostic receipt boundary changed';end if;
 execute replace(definition,needle,needle||$n$ and to_jsonb(th)->>'owner_buyer_test_id' is null$n$);
 definition:=pg_get_functiondef('public.icash_buyer_package_text_targets(uuid,uuid)'::regprocedure);
 needle:=$n$and not t.paused and not t.manual_only and t.ai_mode='auto' and t.retired_at is null$n$;
 if position(needle in definition)=0 then raise exception 'Buyer automatic text target boundary changed';end if;
 execute replace(definition,needle,needle||$n$ and to_jsonb(t)->>'owner_buyer_test_id' is null$n$);
 definition:=pg_get_functiondef('public.icash_queue_fulfillment()'::regprocedure);
 needle:=$n$and t.retired_at is null and not t.manual_only$n$;
 if position(needle in definition)=0 then raise exception 'Buyer automatic scheduler boundary changed';end if;
 execute replace(definition,needle,$n$and t.retired_at is null and to_jsonb(t)->>'owner_buyer_test_id' is null and not t.manual_only$n$);
end $scope$;
commit;
