set local lock_timeout='2s';
set local statement_timeout='8s';
create function public.icash_seller_communication_intent(p_body text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare b text:=lower(trim(regexp_replace(replace(p_body,'’',chr(39)),'[[:space:]]+',' ','g')));
begin
 if b is null or length(b)>300 or public.icash_seller_response_disposition(b) is not null then return null;end if;
 if b ~ '^(?:can|could|may) i call (?:you |back )?(?:back )?later[?! .]*$' then return 'return_call';end if;
 if b ~ '^(?:email|e-mail)(?: me| it| the (?:offer|details|agreement))?(?: please)?[.! ]*$' then return 'email';end if;
 if b ~ '^(?:i (?:do not|don''t|cannot|can''t) (?:speak|understand) english|no (?:hablo|entiendo) ingl[eé]s)[.! ]*$' then return 'language';end if;
 return null;
end $$;
revoke all on function public.icash_seller_communication_intent(text) from public,anon,authenticated;
grant execute on function public.icash_seller_communication_intent(text) to service_role;

create function public.icash_seller_memory_interest_reply(p_account uuid,p_message uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id and t.party='seller' and t.retired_at is null
  cross join lateral (select o.body from public.icash_text_messages o
   where o.account_id=m.account_id and o.thread_id=m.thread_id and o.direction='outgoing' and o.state='delivered' and o.provider_id is not null
    and o.created_at between to_timestamp(public.icash_sms_reply_time(m.id))-interval '24 hours' and to_timestamp(public.icash_sms_reply_time(m.id))
   order by o.created_at desc,o.id desc limit 1) question
  where m.id=p_message and m.account_id=p_account and m.direction='incoming' and m.state='received'
  and exists(select 1 from icash_seller_memory_private.settings where id=1 and public.icash_seller_memory_enabled(p_account) and enabled_at<=to_timestamp(public.icash_sms_reply_time(m.id)))
  and m.body ~* '^(yes|yeah|yep|yup|y|sure|i would|i am interested)[.! ,]*$'
  and question.body ~* '(interested in selling|looking to sell|open to a cash offer|consider selling|considered a cash sale)'
  and position('?' in question.body)>0
  and not question.body ~* '(\$|[0-9]+[,0-9]* (dollars|thousand)|sign|agreement|accept|owner)')
$$;
revoke all on function public.icash_seller_memory_interest_reply(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_memory_interest_reply(uuid,uuid) to service_role;

do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_seller_dialogue_context(uuid,uuid)'::regprocedure);
 if md5(d)<>'36f1940f71735b2ae392d94a262d36d3' then raise exception 'Seller dialogue memory prerequisite changed';end if;
 -- A seller offering to return the call is not a request for us to schedule
 -- an outbound callback. Keep every other callback/safety exclusion unchanged.
 needle:=$n$or b ~ '\m(call me|callback|call back|phone call|ignore (previous|all|the)|system prompt|developer message|wire|bank account|deposit|lawsuit|attorney)\M' then return null;end if;$n$;
 replacement:=$n$or (b ~ '\m(call me|callback|call back|phone call|ignore (previous|all|the)|system prompt|developer message|wire|bank account|deposit|lawsuit|attorney)\M'
  and not coalesce(public.icash_seller_memory_enabled(p_account)
   and exists(select 1 from icash_seller_memory_private.settings where id=1 and enabled_at<=to_timestamp(source_at))
   and public.icash_seller_communication_intent(m.body)='return_call',false)) then return null;end if;$n$;
 if position(needle in d)=0 then raise exception 'Dialogue callback exclusion changed';end if;
 d:=replace(d,needle,replacement);
 needle:=$n$ elsif public.icash_seller_conversion_source(p_account,m.id) and public.icash_seller_conversion_intent(m.body) is not null then$n$;
 replacement:=$n$ elsif public.icash_seller_memory_enabled(p_account)
  and exists(select 1 from icash_seller_memory_private.settings where id=1 and enabled_at<=to_timestamp(source_at))
  and prior.body='What language would you prefer? / Que idioma prefiere?' then
  reason:='seller_language_support_required';
 elsif public.icash_seller_memory_enabled(p_account)
  and exists(select 1 from icash_seller_memory_private.settings where id=1 and enabled_at<=to_timestamp(source_at))
  and prior.body='Would you like the offer details or the agreement by email?'
  and public.icash_seller_communication_intent(m.body) is null then
  reason:='seller_email_delivery_required';
 elsif public.icash_seller_memory_enabled(p_account)
  and exists(select 1 from icash_seller_memory_private.settings where id=1 and enabled_at<=to_timestamp(source_at))
  and public.icash_seller_communication_intent(m.body) is not null then
  action:='communication_'||public.icash_seller_communication_intent(m.body);
  reply:=case public.icash_seller_communication_intent(m.body)
   when 'return_call' then 'Yes, you can call back when you''re ready.'
   when 'email' then 'Would you like the offer details or the agreement by email?'
   when 'language' then 'What language would you prefer? / Que idioma prefiere?' end;
$n$||needle;
 if position(needle in d)=0 then raise exception 'Dialogue memory insertion missing';end if;
 execute replace(d,needle,replacement);

 d:=pg_get_functiondef('public.icash_seller_conversion_intent(text)'::regprocedure);
 if md5(d)<>'fe1640b4b1c01d6b616666369dbbe50a' then raise exception 'Seller intent memory prerequisite changed';end if;
 -- Both narrow spellings are still informational intent only, not acceptance.
 d:=replace(d,'depends on (?:the|your)','depen[dt]s (?:on|of) (?:the|your)');
 d:=replace(d,'(?:it )?depends (?:on )?','(?:it )?depen[dt]s (?:(?:on|of) )?');
 execute d;

 d:=pg_get_functiondef('public.icash_seller_text_offer_context(uuid,uuid)'::regprocedure);
 if md5(d)<>'12dba125513c8941f774a60028774538' then raise exception 'Seller offer memory prerequisite changed';end if;
 needle:=$n$if o.state->>'textThreadId' is distinct from t.id::text$n$;
 replacement:=needle||$n$
  and not (public.icash_seller_memory_enabled(p_account)
   and (public.icash_seller_memory_interest_reply(p_account,m.id) or o.state->>'acceptedPriceCents' is not null))$n$;
 if position(needle in d)=0 then raise exception 'Offer memory insertion missing';end if;
 -- Complete original history remains required by the offer evidence validators.
 -- Raise the explicit cap consistently; no first-200 partial read is allowed.
 d:=replace(d,needle,replacement);
 d:=replace(d,')>200 then return null;',')>1000 then return null;');
 d:=replace(d,'''updatedAt'',x.updated_at,','''updatedAt'',x.updated_at,''at'',to_timestamp(case when x.direction=''incoming'' then public.icash_sms_reply_time(x.id) else extract(epoch from x.created_at) end),');
 needle:=$n$ return c||jsonb_build_object('fingerprint',md5(c::text)$n$;
 replacement:=$n$ if exists(select 1 from icash_seller_memory_private.settings where id=1 and public.icash_seller_memory_enabled(p_account) and enabled_at<=to_timestamp(source_at)) then
  c:=c||jsonb_build_object('memoryFingerprint',public.icash_seller_memory_context(p_account,s.id,t.recipient)->>'fingerprint');
 end if;
$n$||needle;
 if position(needle in d)=0 then raise exception 'Offer memory fingerprint insertion missing';end if;
 d:=replace(d,needle,replacement);
 execute d;

 d:=pg_get_functiondef('public.icash_recorded_reception_property_context(uuid,text)'::regprocedure);
 if md5(d)<>'0beaa92dbaa2ae99eb0ed9306b4c5cff' then raise exception 'Reception memory prerequisite changed';end if;
 needle:=$n$ if context is null or context->>'status'<>'ambiguous' then return context;end if;$n$;
 replacement:=$n$ if context->>'status'='matched' then
  context:=context||coalesce((select jsonb_build_object('sellerMemoryBinding',jsonb_build_object('accountId',r.account_id,'screeningId',d.screening_id,'dealId',d.id,'phone',r.from_phone))
   from icash_recorded_reception_private.sessions r
   cross join lateral (select min(f.id::text)::uuid id,min(f.screening_id::text)::uuid screening_id from public.icash_deal_files f
    where f.account_id=r.account_id and f.terms->>'address'=context->>'address' and f.stage not in ('closed','cancelled')
    and coalesce(f.terms->>'practice','false')<>'true' having count(*)=1) d
   where r.id=p_id and r.nonce_hash=p_nonce_hash and d.id is not null and public.icash_seller_memory_enabled(r.account_id)),'{}'::jsonb);
 end if;
$n$||needle;
 if position(needle in d)=0 then raise exception 'Reception memory insertion missing';end if;
 execute replace(d,needle,replacement);
end $patch$;
