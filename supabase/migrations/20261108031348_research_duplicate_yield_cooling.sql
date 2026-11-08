-- Cool consistently low-yield audiences using original, settled supply receipts.
-- Selection only: no provider request, new purchase, price or historical mutation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $patch$
declare d text;old text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_market_duplicate_supply(text,text,integer,jsonb)'::regprocedure);
 if md5(d)<>'8d61f34192f3f963b4c4afde3ad6cd77' then
  raise exception 'Duplicate supply prerequisite changed';
 end if;
 old:=E'and r.returned_properties>0 and r.queued_properties=0\n  and r.duplicate_properties=r.returned_properties';
 replacement:=$predicate$and r.returned_properties>0 and r.queued_properties>=0 and r.duplicate_properties>=0
  and r.queued_properties::bigint+r.duplicate_properties::bigint=r.returned_properties
  and r.duplicate_properties::bigint*5>=r.returned_properties::bigint*4$predicate$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then
  raise exception 'Duplicate supply predicate changed';
 end if;
 -- Keep the three latest original attempts, exact source/account/query/size,
 -- complete costs, 24-hour expiry, bounded index scan and private ACL unchanged.
 -- Each of the three pages must be at least 80% duplicates; averaging cannot
 -- hide a productive newer page. Existing one-in-five probes remain in place.
 execute replace(d,old,replacement);
end $patch$;
commit;
