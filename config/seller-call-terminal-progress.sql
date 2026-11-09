-- A settled, bound terminal carrier receipt is not an active conversation.
-- Read-only predicate: retain every original call, cost and delivery receipt.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function public.icash_seller_recorded_call_finished(p_account uuid,p_recording uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.icash_call_recordings r where r.id=p_recording and r.account_id=p_account
  and (r.call_ended_at is not null or exists(select 1 from icash_recording_private.terminal_cost_receipts receipt
     join public.icash_operation_spend spend on spend.operation_key=r.operation_key and spend.account_id=r.account_id and spend.state='settled'
     where receipt.recording_id=r.id and r.last_action='gate_settled'
      and r.state in ('failed','declined','expired')
      and r.conversation_id is null and r.recording_sid is null and r.start_claimed_at is null
      and receipt.receipt->>'status' in ('completed','busy','failed','no-answer','canceled')
      and row(receipt.receipt->>'providerAccountSid',receipt.receipt->>'callSid',receipt.receipt->>'fromPhone',receipt.receipt->>'toPhone')
        is not distinct from row(r.provider_account_sid,r.call_sid,r.from_phone,r.to_phone)
      and r.call_sid is not null and r.provider_account_sid is not null)));
$$;
revoke all on function public.icash_seller_recorded_call_finished(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_recorded_call_finished(uuid,uuid) to service_role;
do $patch$
declare d text;old text;
begin
 d:=pg_get_functiondef('public.icash_seller_text_offer_context(uuid,uuid)'::regprocedure);
 old:=$old$(select min(dial_claimed_at) from public.icash_call_recordings where account_id=p_account and screening_id=s.id and party='seller' and dial_claimed_at is not null and call_ended_at is null)$old$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Seller offer active-call prerequisite changed';end if;
 execute replace(d,old,$new$(select min(r.dial_claimed_at) from public.icash_call_recordings r
   where r.account_id=p_account and r.screening_id=s.id and r.party='seller'
    and r.dial_claimed_at is not null and r.call_ended_at is null
    and not public.icash_seller_recorded_call_finished(p_account,r.id))$new$);
end $patch$;
commit;
