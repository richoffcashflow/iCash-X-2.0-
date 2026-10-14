begin;
-- A worker can stop after the provider receipt is saved but before the recovery
-- row is finalized. Reconcile existing evidence only: never dispatch, re-arm a
-- message, create an envelope, sign, or manufacture a receipt here.
create or replace function public.icash_reconcile_agreement_delivery_receipts() returns integer
language plpgsql security definer set search_path='' as $$
declare item record;reconciled integer:=0;
begin
 for item in
  select j.id,e.id as envelope_id,m.state as delivery_state
  from icash_seller_agreement_private.delivery_recovery j
  join public.icash_signing_envelopes e on e.account_id=j.account_id and e.deal_id=j.deal_id
   and e.kind='purchase' and not e.test_mode and e.provider_id is not null
   and e.state in ('awaiting_counterparty','customer_signature_needed','completed')
   and jsonb_array_length(e.recipients)=2
   and e.recipients->0->>'name'=j.seller_name and e.recipients->0->>'phone'=j.phone
  join public.icash_contract_text_deliveries x on x.account_id=j.account_id and x.envelope_id=e.id
   and x.signer_id=e.recipients->0->>'id'
  join public.icash_text_threads t on t.id=x.thread_id and t.account_id=j.account_id
   and t.deal_id=j.deal_id and t.party='seller' and t.recipient=j.phone
  join public.icash_text_messages m on m.id=x.message_id and m.account_id=j.account_id
   and m.thread_id=t.id and m.direction='outgoing' and m.state in ('accepted','delivered')
   and nullif(m.provider_id,'') is not null
  where j.state='claimed' and j.claimed_at<now()-interval '1 minute'
   and (j.envelope_id is null or j.envelope_id=e.id)
  order by j.claimed_at,j.id limit 10
 loop
  -- The finalizer locks the deal before the job and rechecks the exact seller
  -- terms and recipients. Concurrent ticks are harmless; no receipt is replaced.
  if public.icash_finish_agreement_delivery_recovery(item.id,item.envelope_id,
    jsonb_build_object('sent',true,'status',item.delivery_state)) then reconciled:=reconciled+1;end if;
 end loop;
 return reconciled;
end $$;
revoke all on function public.icash_reconcile_agreement_delivery_receipts() from public,anon,authenticated;
grant execute on function public.icash_reconcile_agreement_delivery_receipts() to service_role;
commit;
