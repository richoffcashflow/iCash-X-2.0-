-- A first-party title/payoff review may clarify ownership and then collect the
-- existing bounded payoff details. It still cannot offer or send an agreement.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare d text;signature text;needle text;replacement text;
begin
 for signature,needle,replacement in values
 ('public.icash_seller_dialogue_reply(uuid,uuid)',
  'and result->''financialCheck''->>''status''=''eligible'';',
  'and (result->''financialCheck''->>''status''=''eligible'' or (j.analysis->>''dialogueAction''=''clarify_ownership'' and public.icash_seller_limited_contact(p_account,id)));'),
 ('public.icash_claim_text_before_owner_question(uuid,uuid,text)',
  'or public.icash_limited_seller_text_current(p_account,p_message)',
  E'or public.icash_limited_seller_text_current(p_account,p_message)\n   or (exists(select 1 from public.icash_text_ai_jobs j where j.account_id=p_account and j.thread_id=t.id and j.outgoing_id=m.id and j.analysis->>''dialoguePolicy''=''seller-dialogue-v1'' and j.analysis->>''dialogueAction''=''clarify_ownership'') and public.icash_seller_conversation_message_current(p_account,p_message))'),
 ('public.icash_prepare_limited_seller_text(uuid,uuid,uuid)',
  'or not exists(select 1 from public.icash_sms_seller_openings o join public.icash_text_messages sent on sent.id=o.owner_question_id where o.thread_id=t.id and o.account_id=p_account and sent.state in (''accepted'',''delivered'') and sent.provider_id is not null and sent.created_at<=m.created_at)',
  E'or not (exists(select 1 from public.icash_sms_seller_openings o join public.icash_text_messages sent on sent.id=o.owner_question_id where o.thread_id=t.id and o.account_id=p_account and sent.state in (''accepted'',''delivered'') and sent.provider_id is not null and sent.created_at<=m.created_at)\n   or exists(select 1 from public.icash_text_ai_jobs j join public.icash_text_messages sent on sent.id=j.outgoing_id and sent.account_id=j.account_id and sent.thread_id=j.thread_id\n    where j.account_id=p_account and j.thread_id=t.id and j.analysis->>''dialoguePolicy''=''seller-dialogue-v1'' and j.analysis->>''dialogueAction''=''clarify_ownership''\n     and sent.direction=''outgoing'' and sent.state=''delivered'' and sent.provider_id is not null and extract(epoch from sent.created_at)<public.icash_sms_reply_time(m.id)))')
 loop
  d:=pg_get_functiondef(signature::regprocedure);
  if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Limited ownership prerequisite changed: %',signature;end if;
  execute replace(d,needle,replacement);
 end loop;
end $patch$;
-- No financial status, price authority, signature or previous delivery is changed.
commit;
