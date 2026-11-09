-- New source-word variants and exact delivered-question refusals. No replay.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;old text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_seller_response_disposition(text)'::regprocedure);
 old:=$old$(?:^|[.!?;] +)(?:please )?stop(?: please)?[.! ,]*$|\y(?:stop|quit) (?:asking|bothering|harassing) (?:me|us)\y|\yplease unsubscribe(?: me)?\y|(?:^|[,;.!] +)(?:please )?(?:unsubscribe|dnc)(?: me)?[.! ,]*$|^(?:please )?(?:stop|stopall|unsubscribe|cancel|end|quit|revoke|opt out|dnc)(?: please)?(?:[.! ,]*$|\s*[,;.!]\s*(?:please\y|call\y|text\y|but\y))|\y(?:(?:do not|don't|dont) want (?:you|your (?:company|business)) to (?:ever )?(?:call|text|email|contact)\y|(?:do not|don't|dont|never) (?:ever )?(?:call|text|email|message|contact)(?:ing)?(?: (?:me|us))?\y(?! (?:it|that|the house|the property)\y)|(?:stop|quit) (?:(?:calling|texting|emailing|messaging|contacting)\y|(?:call|text|email|message|contact)\y(?! (?:it|that|the house|the property)\y))|(?:unsubscribe|remove|delete) (?:me|my number)\y|take (?:me|my number) off\y|leave (?:me|us) alone\y|(?:put|add|place) (?:me|my number) (?:on|in) (?:your |the )?(?:dnc|do not call)(?: list)?\y|(?:i am|i'm) (?:already )?on (?:the |your )?(?:dnc|do not call) list\y)$old$;replacement:=$new$\y(?:do not|don't|dont) send (?:me|us) (?:any |more |any more )?(?:texts?|messages?|emails?)(?: again)?\y|(?:^|[.!?;] +)(?:please )?stop(?: please)?[.! ,]*$|\y(?:stop|quit) (?:asking|bothering|harassing) (?:me|us)\y|\yplease unsubscribe(?: me)?\y|(?:^|[,;.!] +)(?:please )?(?:unsubscribe|dnc)(?: me)?[.! ,]*$|^(?:please )?(?:stop|stopall|unsubscribe|cancel|end|quit|revoke|opt out|dnc)(?: please)?(?:[.! ,]*$|\s*[,;.!]\s*(?:please\y|call\y|text\y|but\y))|\y(?:(?:do not|don't|dont) want (?:you|your (?:company|business)) to (?:ever )?(?:call|text|email|contact)\y|(?:do not|don't|dont|never) (?:ever )?(?:call|text|email|message|contact)(?:ing)?(?: (?:me|us))?\y(?! (?:it|that|the house|the property)\y)|(?:stop|quit) (?:(?:calling|texting|emailing|messaging|contacting)\y|(?:call|text|email|message|contact)\y(?! (?:it|that|the house|the property)\y))|(?:unsubscribe|remove|delete) (?:me|us|(?:my|our|this) (?:phone )?number)\y|take (?:me|us|(?:my|our|this) (?:phone )?number) off\y|leave (?:me|us) alone\y|(?:put|add|place) (?:me|us|(?:my|our|this) (?:phone )?number) (?:on|in) (?:your |the )?(?:dnc|do not call)(?: list)?\y|(?:i am|i'm) (?:already )?on (?:the |your )?(?:dnc|do not call) list\y)$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Source disposition prerequisite changed';end if;
 d:=replace(d,old,replacement);
 old:=$old$\y(?:i|we)(?:'ve)? (?:(?:have|already) ){0,2}told (?:you|yall|y'all|you all) no\y|\y(?:i|we) (?:will not|won't|wont) (?:ever )?sell\y|\y(?:no thanks|no thank you|wrong number|not (?:(?:super|very|really|that|at all) )?interested|(?:do not|don't|dont) want to sell|not selling(?: (?:my|our|the) (?:house|home|property))?|no quiero vender|no me interesa vender)\y$old$;replacement:=$new$\y(?:i|we)(?:'ve)? (?:(?:have|already) ){0,2}told (?:you|yall|y'all|you all) no\y|\y(?:i|we) (?:will not|won't|wont) (?:ever )?sell\y|\y(?:no thanks|no thank you|wrong (?:phone )?number|not for sale|not (?:(?:super|very|really|that|at all) )?interested|(?:do not|don't|dont) want to sell|not selling(?: (?:my|our|the) (?:house|home|property))?|no quiero vender|no me interesa vender)\y$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Source disposition prerequisite changed';end if;
 d:=replace(d,old,replacement);
 execute d;
end $patch$;

-- A bare no is a refusal only to the exact last delivered ownership/interest
-- question. A no to repairs, liens, tenants or a quoted question is not one.
create function public.icash_seller_sms_disposition(p_account uuid,p_message uuid)
returns text language plpgsql stable security invoker set search_path='' as $$
declare m public.icash_text_messages;q public.icash_text_messages;answer text;d text;
begin
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and direction='incoming' and state='received';
 if not found then return null;end if;
 d:=public.icash_seller_response_disposition(m.body);if d is not null then return d;end if;
 answer:=lower(btrim(regexp_replace(replace(m.body,'’',chr(39)),'[[:space:]]+',' ','g')));
 if answer !~ '^(no|nope|nah|naw|no[, ]+i (do not|don''t|dont)( own it)?|i (do not|don''t|dont) own (it|that (house|property))|sold|already sold)[.! ,]*$'
  or (m.event_id is null and m.provider_id is null) then return null;end if;
 select sent.* into q from public.icash_text_messages sent
 where sent.account_id=p_account and sent.thread_id=m.thread_id and sent.direction='outgoing'
  and sent.created_at<to_timestamp(public.icash_sms_reply_time(m.id)::double precision)
 order by sent.created_at desc,sent.id desc limit 1;
 if q.id is null or q.state<>'delivered' or q.provider_id is null or q.customer_author_id is not null then return null;end if;
 if exists(select 1 from public.icash_sms_seller_openings o where o.account_id=p_account and o.thread_id=m.thread_id
  and (o.owner_question_id=q.id or o.interest_message_id=q.id))
 or exists(select 1 from public.icash_text_ai_jobs j where j.account_id=p_account and j.thread_id=m.thread_id and j.outgoing_id=q.id
  and j.analysis->>'dialoguePolicy'='seller-dialogue-v1' and j.analysis->>'dialogueAction'='clarify_ownership') then return 'declined';end if;
 return null;
end $$;
revoke all on function public.icash_seller_sms_disposition(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_sms_disposition(uuid,uuid) to service_role;

do $patch$
declare d text;old text;
begin
 d:=pg_get_functiondef('public.icash_apply_seller_response(text,uuid)'::regprocedure);
 old:=$old$  disposition:=public.icash_seller_response_disposition(source_text);
 elsif p_source='call' then$old$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Seller response observer prerequisite changed';end if;
 execute replace(d,old,$new$  disposition:=public.icash_seller_sms_disposition(a,p_id);
 elsif p_source='call' then$new$);
 d:=pg_get_functiondef('public.icash_refresh_seller_reply_progress(uuid,uuid,text)'::regprocedure);
 old:='public.icash_seller_response_disposition(m.body)';
 if (length(d)-length(replace(d,old,'')))/length(old)<>2 then raise exception 'Seller progress disposition prerequisite changed';end if;
 execute replace(d,old,'public.icash_seller_sms_disposition(p_account,m.id)');
end $patch$;
commit;
