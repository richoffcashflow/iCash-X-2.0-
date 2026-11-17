-- App-first informational reply correction. Reuse the existing conversion
-- source/cutover gate; no new activation, callback or historical replay.
-- The migration runner owns the transaction and schema-history entry.
set local lock_timeout='2s';
set local statement_timeout='8s';
do $guard$
declare item record;
begin
 for item in select * from (values
  ('icash_seller_dialogue_context(uuid,uuid)','c8184bec64e238638cf45430ab204a2b',false,'v'),
  ('icash_seller_text_offer_context(uuid,uuid)','5f6e0a4049af7b8ca40b1bcb599f3547',true,'v'),
  ('icash_seller_information_action(text)','e408e8ad817d0947e81ae215cd55f821',false,'i'),
  ('icash_seller_conversion_source(uuid,uuid)','50869661c2d8d43b48bdc197c395ac8a',false,'s')
 ) pins(signature,source_hash,definer,volatility) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.'||item.signature)
   and md5(pg_get_functiondef(p.oid))=item.source_hash and pg_get_userbyid(p.proowner)='postgres'
   and p.prosecdef=item.definer and p.provolatile::text=item.volatility
   and p.proconfig=array['search_path=""']::text[]
   and to_jsonb(p.proacl)='["postgres=X/postgres","service_role=X/postgres"]'::jsonb) then
   raise exception 'Seller intent clarity prerequisite changed: %',item.signature;
  end if;
 end loop;
end $guard$;

create function public.icash_seller_intent_clarity(p_body text) returns text
language plpgsql immutable security invoker set search_path='' as $function$
declare b text:=lower(trim(regexp_replace(replace(replace(coalesce(p_body,''),'’',chr(39)),'‘',chr(39)),'[[:space:]]+',' ','g')));
begin
 if length(b)>300 or public.icash_seller_response_disposition(b) is not null then return null;end if;
 if b ~ $pattern$^i(?:'ll| will) call (?:you )?(?:back(?: later)?|later)[.! ]*$$pattern$ then return 'caller_returning';end if;
 if b ~ $pattern$^who (?:owns (?:it|this|that|the (?:house|home|property))|is the owner(?: of (?:it|this|that|the (?:house|home|property)))?)[?!. ]*$$pattern$ then return 'ownership_question';end if;
 return null;
end $function$;
revoke all on function public.icash_seller_intent_clarity(text) from public,anon,authenticated;
grant execute on function public.icash_seller_intent_clarity(text) to service_role;

create function public.icash_seller_intent_clarity_source(p_account uuid,p_message uuid) returns text
language sql stable security invoker set search_path='' as $$
 select public.icash_seller_intent_clarity(m.body) from public.icash_text_messages m
 where m.id=p_message and m.account_id=p_account
  and public.icash_seller_conversion_source(p_account,p_message)
$$;
revoke all on function public.icash_seller_intent_clarity_source(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_intent_clarity_source(uuid,uuid) to service_role;

do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_seller_dialogue_context(uuid,uuid)'::regprocedure);
 needle:=$n$  and not coalesce(public.icash_seller_memory_enabled(p_account)$n$;
 replacement:=$r$  and not coalesce(public.icash_seller_intent_clarity_source(p_account,m.id)='caller_returning',false)
  and not coalesce(public.icash_seller_memory_enabled(p_account)$r$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Seller return-call exclusion changed';end if;
 d:=replace(d,needle,replacement);
 needle:=$n$ elsif public.icash_seller_conversion_source(p_account,m.id) and public.icash_seller_conversion_intent(m.body) is not null then$n$;
 replacement:=$r$ elsif public.icash_seller_intent_clarity_source(p_account,m.id)='caller_returning' then
  action:='intent_caller_returning';reply:='Okay, call back when you''re ready.';
 elsif public.icash_seller_intent_clarity_source(p_account,m.id)='ownership_question' then
  owner_unknown:=true;action:='clarify_ownership';reply:='I can''t confirm ownership from this text. Are you the owner of the property we texted about?';
$r$||needle;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Seller intent dialogue insertion changed';end if;
 execute replace(d,needle,replacement);

 d:=pg_get_functiondef('public.icash_seller_text_offer_context(uuid,uuid)'::regprocedure);
 needle:=$n$or m.body ~* '\m(call me|callback|call back|phone call|ignore (previous|all)|system prompt|wire|bank account|lawsuit)\M' then return null;end if;$n$;
 replacement:=$r$or (m.body ~* '\m(call me|callback|call back|phone call|ignore (previous|all)|system prompt|wire|bank account|lawsuit)\M'
   and not coalesce(public.icash_seller_intent_clarity_source(p_account,m.id)='caller_returning',false)) then return null;end if;$r$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Seller intent offer exclusion changed';end if;
 d:=replace(d,needle,replacement);
 needle:=$n$if o.state->>'textThreadId' is distinct from t.id::text$n$;
 replacement:=needle||$r$
  and public.icash_seller_intent_clarity_source(p_account,m.id) is null$r$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Seller intent offer-entry condition changed';end if;
 d:=replace(d,needle,replacement);
 needle:=$n$ return c||jsonb_build_object('fingerprint',md5(c::text)$n$;
 replacement:=$r$ if public.icash_seller_intent_clarity_source(p_account,m.id) is not null then
  c:=c||jsonb_build_object('intentClarity',public.icash_seller_intent_clarity_source(p_account,m.id));
 end if;
$r$||needle;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Seller intent fingerprint condition changed';end if;
 execute replace(d,needle,replacement);

 d:=pg_get_functiondef('public.icash_seller_information_action(text)'::regprocedure);
 needle:=$n$'cash_identity_v6'),false)$n$;
 replacement:=$r$'cash_identity_v6','intent_caller_returning'),false)$r$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Seller intent information action changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

do $verify$
declare item record;
begin
 for item in select * from (values
  ('icash_seller_dialogue_context(uuid,uuid)','bee46c11ac1b8f40e4c0e8ec6b1b586a',false,'v'),
  ('icash_seller_text_offer_context(uuid,uuid)','d8ed972f7edfe536ba06158849c889ef',true,'v'),
  ('icash_seller_information_action(text)','291228d4fb3298c25ace9b3ac3f56af5',false,'i'),
  ('icash_seller_conversion_source(uuid,uuid)','50869661c2d8d43b48bdc197c395ac8a',false,'s'),
  ('icash_seller_intent_clarity(text)','fef110ec8ccbabff7e898af973a5c92b',false,'i'),
  ('icash_seller_intent_clarity_source(uuid,uuid)','cc8bbca206a5e83e3e4f65cac5094893',false,'s')
 ) pins(signature,source_hash,definer,volatility) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.'||item.signature)
   and md5(pg_get_functiondef(p.oid))=item.source_hash and pg_get_userbyid(p.proowner)='postgres'
   and p.prosecdef=item.definer and p.provolatile::text=item.volatility
   and p.proconfig=array['search_path=""']::text[]
   and to_jsonb(p.proacl)='["postgres=X/postgres","service_role=X/postgres"]'::jsonb) then
   raise exception 'Seller intent clarity result changed: %',item.signature;
  end if;
 end loop;
end $verify$;
