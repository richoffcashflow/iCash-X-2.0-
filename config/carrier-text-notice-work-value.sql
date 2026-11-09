-- Derived response/next-step interpretation only. Financial receipts, paused
-- controls, original priority windows and every provider gate remain unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $patch$
declare p record;definition text;
begin
 for p in select * from (values
  ($sig$icash_work_private.warm_seller_due(uuid)$sig$,$old$join public.icash_text_messages$old$,$new$join public.icash_response_text_messages$new$,1),
  ($sig$icash_work_private.warm_seller_due(uuid)$sig$,$old$and (j.callback_id is not null or j.sms_source_message_id is not null)$old$,$new$and (j.callback_id is not null or j.sms_source_message_id is not null)
   and not exists(select 1 from public.icash_text_messages source where source.id=j.sms_source_message_id and source.account_id=j.account_id and source.direction='incoming' and public.icash_is_carrier_text_notice(source.body,source.attachments))$new$,1),
  ($sig$icash_work_private.value_sellers(uuid,timestamp with time zone,timestamp with time zone)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,2),
  ($sig$icash_work_private.value_receipt(uuid,timestamp with time zone,timestamp with time zone)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,2),
  ($sig$icash_work_private.value_receipt(uuid,timestamp with time zone,timestamp with time zone)$sig$,$old$join public.icash_text_messages$old$,$new$join public.icash_response_text_messages$new$,2)
 ) patches(signature,needle,replacement,expected_count) loop
  definition:=pg_get_functiondef(p.signature::regprocedure);
  if (length(definition)-length(replace(definition,p.needle,'')))/length(p.needle)<>p.expected_count then
   raise exception 'Carrier notice work-value prerequisite changed: %',p.signature;
  end if;
  execute replace(definition,p.needle,p.replacement);
 end loop;
end $patch$;
commit;
