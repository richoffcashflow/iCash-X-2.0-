-- Increase aggregate seller-opener scheduling from one per minute to one per
-- five seconds. Recipient frequency, eligibility, billing and provider receipts
-- remain unchanged. The shared scheduler lock serializes this global limit.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare signature text;definition text;
 needle text:=$old$kind='seller_opener' and created_at>now()-interval '1 minute'$old$;
 replacement text:=$new$kind='seller_opener' and created_at>now()-interval '5 seconds'$new$;
begin
 foreach signature in array array[
  'public.icash_recover_unstarted_seller_opener()',
  'public.icash_next_before_operational_sms()',
  'public.icash_next_before_unstarted_sms_recovery()',
  'public.icash_next_before_sms_inbound_campaign()'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))<>length(needle)
   or position('pg_advisory_xact_lock(726341927)' in definition)=0 then
   raise exception 'Seller opener cadence prerequisite changed: %',signature;
  end if;
  execute replace(definition,needle,replacement);
 end loop;
end $migration$;
commit;
