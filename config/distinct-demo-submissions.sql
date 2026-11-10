-- Each intentional demo form submission is a new run. Only an exact retry of
-- the same request remains idempotent. Do not reset historical work or consent.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_submit_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text)'::regprocedure);
 needle:=$old$ perform pg_advisory_xact_lock(hashtextextended(p_duplicate,0));$old$;
 replacement:=$new$ -- Request identity, not address/phone identity, owns a demo run. Serialize
 -- retries even when a conflicting payload supplied a different duplicate key.
 perform pg_advisory_xact_lock(hashtextextended('demo-request:'||p_request::text,0));$new$;
 if position(replacement in definition)>0 then null;
 elsif (length(definition)-length(replace(definition,needle,'')))/length(needle)=1 then
  definition:=replace(definition,needle,replacement);
 else raise exception 'Demo request lock prerequisite changed';end if;
 needle:=$old$ select id into canonical from public.icash_seller_intakes where duplicate_key=p_duplicate and state<>'duplicate'
  and public.icash_demo_intake_current(icash_seller_intakes.id,p_account)
  and created_at>now()-interval '90 days' order by created_at limit 1;$old$;
 replacement:=$new$ -- A new request ID explicitly starts a new demo, including the same
 -- address/phone while an earlier run is still visible. Prior receipts stay as-is.
 canonical:=null;$new$;
 if position(replacement in definition)>0 then null;
 elsif (length(definition)-length(replace(definition,needle,'')))/length(needle)=1 then
  definition:=replace(definition,needle,replacement);
 else raise exception 'Demo submission deduplication prerequisite changed';end if;
 execute definition;
end $patch$;

do $patch$
declare definition text;target regprocedure;needle text;replacement text;
begin
 -- The current public RPC wraps the original finalizer for Meta promotion.
 -- Modify only the underlying duplicate predicate, preserving the wrapper.
 target:=to_regprocedure('public.icash_finish_seller_lookup_before_meta(uuid,uuid,jsonb)');
 if target is null then target:='public.icash_finish_seller_lookup(uuid,uuid,jsonb)'::regprocedure;
 elsif position('public.icash_finish_seller_lookup_before_meta(p_id,p_token,p_output)' in
  pg_get_functiondef('public.icash_finish_seller_lookup(uuid,uuid,jsonb)'::regprocedure))=0 then
  raise exception 'Seller lookup Meta wrapper prerequisite changed';
 end if;
 definition:=pg_get_functiondef(target);
 needle:=$old$and case when l.contact_consent_scope='icash_x_demo'
    then public.icash_demo_intake_current(candidate.id,(l.attribution->>'demoAccountId')::uuid)
    else candidate.contact_consent_scope is distinct from 'icash_x_demo' end$old$;
 replacement:=$new$and l.contact_consent_scope is distinct from 'icash_x_demo'
   and candidate.contact_consent_scope is distinct from 'icash_x_demo'$new$;
 if position(replacement in definition)>0 then null;
 elsif (length(definition)-length(replace(definition,needle,'')))/length(needle)=1 then
  execute replace(definition,needle,replacement);
 else raise exception 'Demo property deduplication prerequisite changed';end if;
end $patch$;

commit;
