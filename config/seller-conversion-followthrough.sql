-- Install inactive; activate with a fresh source cutover after the matching
-- web/worker release. No historical job, contact receipt or spending is changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.icash_seller_progress_settings add column conversion_enabled_at timestamptz;

create function public.icash_seller_conversion_intent(p_body text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare b text:=lower(trim(regexp_replace(replace(replace(coalesce(p_body,''),'’',chr(39)),'‘',chr(39)),'[[:space:]]+',' ','g')));identity_question boolean;price_question boolean;
begin
 if b='' or length(b)>500 or public.icash_seller_response_disposition(b) is not null
  or b ~ '["“”]' or b ~ '\y(?:said|asked|wrote|example|ignore|instructions?|prompt|wire|bank account)\y' then return null;end if;
 identity_question:=b ~ $pattern$(?:^|[.!?;,] +|\yand +)(?:who (?:is this|are you)|who's this|what (?:is your name|company is this|business is this)|do you have a name)(?: exactly)?(?:[?!.,;]| +and\y| *$)$pattern$;
 price_question:=b ~ $pattern$(?:^|[.!?;,] +|\yand +)(?:what amount do you have in mind|what (?:price|amount) (?:are you offering|would you offer)|depends on (?:the|your) (?:offer|price)|(?:it )?depends (?:on )?(?:the|your) (?:offer|price))(?:[?!.,; ]|$)$pattern$
  or identity_question and b ~ '\y(?:how much|what.*offer|what.*pay)\y';
 if identity_question then return case when price_question then 'identity_price' else 'identity' end;end if;
 if price_question then return 'price';end if;
 if b ~ '^(?:are you (?:looking to (?:buy|purchase)|(?:buying|purchasing)(?: (?:it|the (?:house|property)))?)|(?:buying|purchasing))[?! .]*$' then return 'buying';end if;
 if b ~ '^(?:the )?(?:price|terms)(?: are)? as (?:listed|advertised)[.! ]*$' then return 'listed_terms';end if;
 return null;
end $$;

create function public.icash_seller_conversion_source(p_account uuid,p_message uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_text_messages m,public.icash_seller_progress_settings s
  where s.id=1 and s.enabled and s.dialogue_enabled and s.offer_enabled
   and s.conversion_enabled_at is not null and s.conversion_enabled_at<=now()
   and m.id=p_message and m.account_id=p_account and m.direction='incoming' and m.state='received'
   and (m.provider_id is not null or m.event_id is not null)
   and m.created_at between s.conversion_enabled_at and now()
   and public.icash_sms_reply_time(m.id) between extract(epoch from greatest(s.conversion_enabled_at,now()-interval '24 hours')) and extract(epoch from now()))
$$;

-- These variants are selected only from their exact delivered offer action.
-- They cannot enter the ordinary no-response experiment. No price is repeated.
insert into public.icash_seller_recovery_variants(key,reason,body,enabled) values
 ('context-condition-v1','context_no_response','To work out the cash proposal, what repairs or updates does the property need?',true),
 ('context-price-v1','context_no_response','What purchase price would you consider for the property?',true),
 ('context-offer-v1','context_no_response','What would need to change for the cash proposal to work for you?',true),
 ('context-terms-v1','context_no_response','Do you have questions about the proposed terms before deciding whether to sign?',true),
 ('context-name-v1','context_no_response','What full legal name should appear on the proposed purchase agreement?',true),
 ('context-owners-v1','context_no_response','Who else needs to agree to the sale or sign the purchase agreement?',true),
 ('context-date-v1','context_no_response','What exact closing date would work for you, including the year?',true),
 ('context-inspection-v1','context_no_response','Would you allow a property inspection before closing?',true),
 ('context-listing-v1','context_no_response','Is the property listed with an agent, or are you selling it yourself?',true),
 ('context-occupancy-v1','context_no_response','Is the property vacant, owner occupied, or rented?',true),
 ('context-timing-v1','context_no_response','When would you ideally like to sell the property?',true);

create function public.icash_seller_recovery_context_variant(p_account uuid,p_gap uuid) returns text
language sql stable security invoker set search_path='' as $$
 select case j.analysis->>'offerAction'
  when 'qualify_condition' then 'context-condition-v1'
  when 'seller_counterprice' then 'context-price-v1'
  when 'cash_offer' then 'context-offer-v1'
  when 'confirm_terms' then 'context-terms-v1'
  when 'legal_name' then 'context-name-v1'
  when 'owners' then 'context-owners-v1'
  when 'other_signers' then 'context-owners-v1'
  when 'closing_date' then 'context-date-v1'
  when 'inspection' then 'context-inspection-v1'
  when 'qualify_listing' then 'context-listing-v1'
  when 'clarify_listing_terms' then 'context-listing-v1'
  when 'qualify_occupancy' then 'context-occupancy-v1'
  when 'qualify_timing' then 'context-timing-v1' end
 from public.icash_seller_gaps g
 join public.icash_text_messages m on m.account_id=g.account_id and m.thread_id=g.thread_id and m.id=g.source_id
 join public.icash_text_ai_jobs j on j.account_id=m.account_id and j.thread_id=m.thread_id and j.outgoing_id=m.id
 join public.icash_seller_progress_settings settings on settings.id=1 and settings.enabled and settings.dialogue_enabled and settings.offer_enabled
  and settings.conversion_enabled_at is not null and settings.conversion_enabled_at<=now()
 where g.account_id=p_account and g.id=p_gap and g.reason='no_response' and g.stage='draft' and g.source='text'
  and g.created_at>=settings.conversion_enabled_at and g.source_at>=settings.conversion_enabled_at
  and m.created_at>=settings.conversion_enabled_at and m.direction='outgoing' and m.state='delivered'
  and m.provider_id is not null and m.customer_author_id is null and m.body=j.reply
  and j.analysis->>'offerPolicy'='seller-text-offer-v1'
  and j.analysis->'offerPlan'->>'kind'='message'
$$;

do $patch$
declare d text;old text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_seller_dialogue_context(uuid,uuid)'::regprocedure);
 old:=$old$ elsif owner_unknown and (b ~ '(how much|what.*offer|what.*pay)' or condition_answer=m.id) then$old$;
 replacement:=$new$ elsif public.icash_seller_conversion_source(p_account,m.id) and public.icash_seller_conversion_intent(m.body) is not null then
  -- The offer planner answers identity/purpose and resumes the actual next fact.
  action:=null;reply:=null;
$new$||old;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Seller dialogue conversion prerequisite changed';end if;
 execute replace(d,old,replacement);

 d:=pg_get_functiondef('public.icash_seller_text_offer_context(uuid,uuid)'::regprocedure);
 old:=$old$if o.state->>'textThreadId' is distinct from t.id::text and m.body !~*$old$;
 replacement:=$new$if o.state->>'textThreadId' is distinct from t.id::text
  and not (public.icash_seller_conversion_source(p_account,m.id) and public.icash_seller_conversion_intent(m.body) is not null) and m.body !~*$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Seller offer conversion prerequisite changed';end if;
 d:=replace(d,old,replacement);
 old:=$old$c:=jsonb_build_object('accountId',p_account,$old$;
 replacement:=$new$c:=jsonb_build_object('conversionEnabled',public.icash_seller_conversion_source(p_account,m.id),'accountId',p_account,$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Seller offer fingerprint prerequisite changed';end if;
 execute replace(d,old,replacement);

 d:=pg_get_functiondef('public.icash_prepare_seller_recovery(uuid,uuid)'::regprocedure);
 old:=$old$where enabled and key=coalesce($old$;
 replacement:=$new$where enabled and key=coalesce(public.icash_seller_recovery_context_variant(p_account,g.id),$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Seller followup choice prerequisite changed';end if;
 d:=replace(d,old,replacement);
 old:=$old$and source_channel=g.channel order by assigned_at,gap_id limit 1)$old$;
 replacement:=$new$and source_channel=g.channel and variant in (select key from public.icash_seller_recovery_variants where reason=g.reason) order by assigned_at,gap_id limit 1)$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Seller followup reuse prerequisite changed';end if;
 execute replace(d,old,replacement);

 d:=pg_get_functiondef('public.icash_seller_recovery_nonprice_current(uuid,uuid)'::regprocedure);
 old:='variant.reason=gap.reason and variant.enabled';
 replacement:='(variant.reason=gap.reason or (variant.reason=''context_no_response'' and variant.key=public.icash_seller_recovery_context_variant(p_account,gap.id))) and variant.enabled';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Seller followup variant binding prerequisite changed';end if;
 d:=replace(d,old,replacement);
 old:=$old$variant.key in ('no-response-v1','no-response-v2')$old$;
 replacement:=$new$(variant.key in ('no-response-v1','no-response-v2') or variant.key=public.icash_seller_recovery_context_variant(p_account,gap.id))$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Seller followup final admission prerequisite changed';end if;
 execute replace(d,old,replacement);
end $patch$;
revoke all on function public.icash_seller_conversion_intent(text),public.icash_seller_conversion_source(uuid,uuid),public.icash_seller_recovery_context_variant(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_conversion_intent(text),public.icash_seller_conversion_source(uuid,uuid),public.icash_seller_recovery_context_variant(uuid,uuid) to service_role;
commit;
