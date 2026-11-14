-- A delivered reminder may carry only the exact nonfinancial answer action
-- that its original delivered question established. Price/terms acceptance
-- continues to require the actual quoted/read-back question.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function public.icash_seller_recovery_reply_action(p_account uuid,p_message uuid) returns text
language sql stable security invoker set search_path='' as $$
 select original_job.analysis->>'offerAction'
 from public.icash_text_messages reminder
 join public.icash_seller_recovery_attempts attempt on attempt.account_id=reminder.account_id
  and attempt.thread_id=reminder.thread_id and attempt.message_id=reminder.id
 join public.icash_seller_gaps gap on gap.id=attempt.gap_id and gap.account_id=reminder.account_id
  and gap.thread_id=reminder.thread_id and gap.deal_id=attempt.deal_id and gap.outgoing_id=reminder.id
  and gap.reason=attempt.reason and reminder.request_key=gap.id
 join public.icash_seller_recovery_variants variant on variant.key=attempt.variant
  and variant.enabled and variant.reason='context_no_response' and reminder.body=variant.body
 join public.icash_text_ai_jobs original_job on original_job.account_id=gap.account_id
  and original_job.thread_id=gap.thread_id and original_job.outgoing_id=gap.source_id
 where reminder.account_id=p_account and reminder.id=p_message and reminder.direction='outgoing'
  and reminder.state='delivered' and reminder.provider_id is not null
  and reminder.customer_author_id is null and cardinality(reminder.asset_ids)=0 and reminder.attachments='[]'::jsonb
  and variant.key=public.icash_seller_recovery_context_variant(p_account,gap.id)
  and original_job.analysis->>'offerAction' in ('legal_name','closing_date','inspection')
$$;
revoke all on function public.icash_seller_recovery_reply_action(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_recovery_reply_action(uuid,uuid) to service_role;
do $patch$
declare d text;old text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_seller_text_offer_context(uuid,uuid)'::regprocedure);
 old:=$old$'action',a.analysis->>'offerAction','quoteRevision'$old$;
 replacement:=$new$'action',coalesce(a.analysis->>'offerAction',public.icash_seller_recovery_reply_action(p_account,x.id)),'quoteRevision'$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Seller reminder answer context prerequisite changed';end if;
 execute replace(d,old,replacement);
end $patch$;
commit;
