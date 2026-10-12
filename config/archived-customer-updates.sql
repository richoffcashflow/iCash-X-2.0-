begin;
set local lock_timeout='3s';

-- Filter archived properties before both source limits. This same source feeds
-- the in-app inbox, notification claims and the final send authorization check.
-- Keep the outer signature and account-credit reminder wrappers unchanged.
do $patch$
declare signature text;definition text;needle text;replacement text;
begin
 for signature,needle,replacement in select * from (values
  ('public.icash_customer_update_sources_before_seller_journey(uuid)',
   'p.id=r.screening_id and p.account_id=p_account',
   'p.id=r.screening_id and p.account_id=p_account and p.state<>''archived'''),
  ('public.icash_customer_update_sources_before_credit_reminders(uuid)',
   's.id=e.screening_id and s.account_id=p_account',
   's.id=e.screening_id and s.account_id=p_account and s.state<>''archived''')
 ) as patches(signature,needle,replacement) loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if strpos(definition,replacement)>0 then continue;
  elsif strpos(definition,needle)>0 then execute replace(definition,needle,replacement);
  else raise exception 'Expected customer update source prerequisite missing: %',signature;end if;
 end loop;
end $patch$;

commit;
