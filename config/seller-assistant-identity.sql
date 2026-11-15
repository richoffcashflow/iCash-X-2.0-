-- Prospective assistant identity wording. Frozen original bodies remain valid
-- learning evidence; no messages, jobs, assignments or receipts are rewritten.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
alter table public.icash_seller_progress_settings add column identity_purpose_enabled_at timestamptz;

create function public.icash_seller_identity_purpose_current(p_account uuid,p_message uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_text_messages m
 join public.icash_seller_progress_settings s on s.id=1
 where m.account_id=p_account and m.id=p_message and m.direction='incoming' and m.state='received'
  and s.enabled and s.dialogue_enabled and s.identity_purpose_enabled_at is not null
  and s.identity_purpose_enabled_at<=now() and m.created_at>=s.identity_purpose_enabled_at
  and public.icash_sms_reply_time(m.id)>=extract(epoch from s.identity_purpose_enabled_at)
  and public.icash_seller_response_disposition(m.body) is null)
$$;

create function public.icash_seller_cash_assistant_reply(p_question text,p_address text)
returns text language plpgsql immutable security invoker set search_path='' as $$
declare original text;reply text;
begin
 original:=public.icash_seller_cash_identity_reply(p_question,p_address);
 if original is null then return null;end if;
 -- A direct AI question keeps the exact truthful answer. Ordinary identity
 -- questions explain the cash-purchase purpose without claiming to be the buyer.
 if original like 'I am a cash buyer reaching out about %' then
  reply:='I assist a cash buyer about '||trim(p_address)||'. Have you considered a cash sale?';
 else reply:=original;end if;
 if length(reply)>160 or reply ~ '[^A-Za-z0-9 .,!?&#/-]' then return null;end if;
 return reply;
end $$;

create function public.icash_seller_current_cash_identity_reply(p_account uuid,p_message uuid,p_address text)
returns text language plpgsql stable security invoker set search_path='' as $$
declare body text;
begin
 select m.body into body from public.icash_text_messages m where m.account_id=p_account and m.id=p_message and m.direction='incoming' and m.state='received';
 if not found then return null;end if;
 if public.icash_seller_identity_purpose_current(p_account,p_message) then
  return public.icash_seller_cash_assistant_reply(body,p_address);
 end if;
 return public.icash_seller_cash_identity_reply(body,p_address);
end $$;

do $patch$
declare d text;old text;replacement text;signature text;
begin
 -- Both reply generation and final revalidation use the exact same source-bound
 -- wording. Keep all existing route, contact, pause, latest-source and rate gates.
 for signature,old,replacement in select * from (values
 ('public.icash_seller_reply_before_viewings(uuid,uuid)',
  $old$public.icash_seller_cash_identity_reply(m.body,public.icash_conversation_street(ctx->>'address'))$old$,
  $new$public.icash_seller_current_cash_identity_reply(p_account,m.id,public.icash_conversation_street(ctx->>'address'))$new$),
 ('public.icash_seller_dialogue_context(uuid,uuid)',
  $old$public.icash_seller_cash_identity_reply(m.body,(select public.icash_conversation_street(d.terms->>'address') from public.icash_deal_files d where d.id=t.deal_id and d.account_id=p_account))$old$,
  $new$public.icash_seller_current_cash_identity_reply(p_account,m.id,(select public.icash_conversation_street(d.terms->>'address') from public.icash_deal_files d where d.id=t.deal_id and d.account_id=p_account))$new$)
 ) patch(signature,old,replacement) loop
  d:=pg_get_functiondef(to_regprocedure(signature));
  if (length(d)-length(replace(d,old,'')))/length(old)<>(case when signature like '%dialogue_context%' then 2 else 1 end) then raise exception 'Seller identity source boundary changed: %',signature;end if;
  execute replace(d,old,replacement);
 end loop;
 d:=pg_get_functiondef('public.icash_seller_post_call_identity_reply(uuid,uuid)'::regprocedure);
 old:=$old$ -- Preserve literal identity and address. Unsupported/long copy stays in review.$old$;
 replacement:=$new$ if public.icash_seller_identity_purpose_current(p_account,p_message) then
  reply:=case when spanish then 'Soy asistente de '||principal||'. Consultamos una compra en efectivo de '||address||'. Es usted el propietario?'
   else 'I assist '||principal||' with cash purchases. About '||address||'. Are you the owner?' end;
 end if;
 -- Preserve literal identity and address. Unsupported/long copy stays in review.$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Seller post-call identity boundary changed';end if;
 execute replace(d,old,replacement);
end $patch$;
do $learning$
declare d text;old text;replacement text;
begin
 -- Retain original bodies as immutable historical evidence. The new exact copy
 -- asks the same question; it never establishes ownership or signatures.
 d:=pg_get_functiondef('public.icash_seller_sms_interest_v6_at(uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure);
 old:=$old$m.body=public.icash_seller_cash_identity_reply(source.body,a.address)$old$;
 replacement:=$new$(m.body=public.icash_seller_cash_identity_reply(source.body,a.address)
    or m.body=public.icash_seller_cash_assistant_reply(source.body,a.address))$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Seller identity learning boundary changed';end if;
 execute replace(d,old,replacement);
end $learning$;
revoke all on function public.icash_seller_identity_purpose_current(uuid,uuid),public.icash_seller_cash_assistant_reply(text,text),public.icash_seller_current_cash_identity_reply(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_seller_identity_purpose_current(uuid,uuid),public.icash_seller_cash_assistant_reply(text,text),public.icash_seller_current_cash_identity_reply(uuid,uuid,text) to service_role;
-- Activate only after exact web/worker release verification with a fresh clock.
commit;
