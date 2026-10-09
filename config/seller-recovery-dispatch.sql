begin;
set local lock_timeout='3s';
-- An approved continuation/viewing question has no price or contract authority.
-- Match the queue's existing non-price scope at the final dispatch boundary.
create function public.icash_seller_recovery_nonprice_current(p_account uuid,p_message uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare g public.icash_seller_gaps;
begin
 select gap.* into g from public.icash_seller_gaps gap
 join public.icash_seller_recovery_attempts attempt on attempt.gap_id=gap.id and attempt.account_id=gap.account_id
  and attempt.deal_id=gap.deal_id and attempt.thread_id=gap.thread_id and attempt.message_id=gap.outgoing_id and attempt.reason=gap.reason
 join public.icash_seller_recovery_variants variant on variant.key=attempt.variant and variant.reason=gap.reason and variant.enabled
 join public.icash_text_messages message on message.id=attempt.message_id and message.account_id=gap.account_id
  and message.thread_id=gap.thread_id and message.request_key=gap.id and message.body=variant.body
  and message.direction='outgoing' and message.state='ready' and message.customer_author_id is null
  and cardinality(message.asset_ids)=0 and message.attachments='[]'::jsonb
 where gap.account_id=p_account and gap.outgoing_id=p_message and gap.state='queued' and gap.due_at<=now()
  and ((gap.reason='no_response' and gap.stage='draft' and variant.key in ('no-response-v1','no-response-v2'))
    or (gap.reason='viewing' and gap.stage in ('under_contract','buyer_selected','title_open','closing') and variant.key in ('viewing-v1','viewing-v2')));
 if not found or not public.icash_seller_recovery_current(g.id) then return false;end if;
 if g.reason='no_response' then
  -- A fresh purchase evaluation is unnecessary for this exact unpriced reminder.
  -- A known disqualification, absent evaluation or future-dated result still holds.
  return exists(select 1 from public.icash_screening_jobs where id=g.screening_id and account_id=p_account
   and state='complete' and result->'financialCheck'->>'status'='eligible'
   and completed_at<=now() and completed_at>now()-interval '7 days');
 end if;
 -- Viewing is grounded in the completed, provider-backed seller agreement.
 return public.icash_seller_viewing_context(p_account,g.thread_id) is not null;
end $$;
revoke all on function public.icash_seller_recovery_nonprice_current(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_recovery_nonprice_current(uuid,uuid) to service_role;

do $patch$
declare definition text;needle text:='else if not public.icash_customer_authored_text(p_account,p_message) and not (';
begin
 definition:=pg_get_functiondef('public.icash_claim_text_before_owner_question(uuid,uuid,text)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Seller final dispatch boundary changed';end if;
 execute replace(definition,needle,'else if not public.icash_customer_authored_text(p_account,p_message) and not public.icash_seller_recovery_nonprice_current(p_account,p_message) and not (');
end $patch$;
-- Routing, seller consent, opt-out, callback/stage freshness, account pause,
-- quiet hours, active membership, positive credits and actual billing remain
-- in the existing final claim chain. No variants are enabled by this migration.
commit;
