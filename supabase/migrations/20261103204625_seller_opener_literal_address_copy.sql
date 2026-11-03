-- Preserve exact saved GSM-basic address/identity punctuation and reject
-- impossible copy before the unchanged mandatory full contact-proof review.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $patch$
declare item record;d text;
 needle text:='[^A-Za-z0-9 .,!?&]';replacement text:='[^A-Za-z0-9 .,!?&#/-]';
 original_select text:=$old$select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' and not paused and ai_mode='auto' and public.icash_sms_thread_review_current(p_account,id,false);$old$;
 replacement_select text:=$new$select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' and not paused and ai_mode='auto';$new$;
 original_return text:=$return$ return message_body;$return$;
 replacement_return text:=$review$ -- Copy is only a candidate. Keep the exact full source/consent/cost review
 -- mandatory before returning it; unknown review results also stay rejected.
 if public.icash_sms_thread_review_current(p_account,t.id,false) is distinct from true then return null;end if;
 return message_body;$review$;
begin
 for item in select * from(values
  ('icash_seller_identity_opener(text,text)','8427d17b5b19021752516909317bb699',1),
  ('icash_seller_recipient_opener(uuid,uuid,text,text,text)','af80789bc718b5a199db87340c7fb5d8',1),
  ('icash_seller_opener_candidate_body(uuid,uuid)','aa05d7bf303ec05a9a53ebfa603fb2cf',1),
  ('icash_queue_seller_opener(uuid,uuid)','c20ee419b11e011c52a6b4379a5d7ef4',2)
 ) expected(signature,checksum,occurrences) loop
  d:=pg_get_functiondef(('public.'||item.signature)::regprocedure);
  if md5(d)<>item.checksum or (length(d)-length(replace(d,needle,'')))<>length(needle)*item.occurrences then
   raise exception 'Literal opener copy prerequisite changed: %',item.signature;
  end if;
  if item.signature='icash_seller_opener_candidate_body(uuid,uuid)' then
   if (length(d)-length(replace(d,original_select,'')))<>length(original_select)
    or (length(d)-length(replace(d,original_return,'')))<>length(original_return) then
    raise exception 'Seller opener copy-before-proof prerequisite changed';
   end if;
   d:=replace(replace(d,original_select,replacement_select),original_return,replacement_return);
  end if;
  execute replace(d,needle,replacement);
 end loop;
end $patch$;
commit;
