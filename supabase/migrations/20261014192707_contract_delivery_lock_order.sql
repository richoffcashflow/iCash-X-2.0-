begin;
create or replace function public.icash_finish_agreement_delivery_recovery(p_id uuid,p_envelope uuid,p_result jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r icash_seller_agreement_private.delivery_recovery;e public.icash_signing_envelopes;prepared boolean:=false;
begin
 -- Serialize with claim/defer's deal-first locking before locking the recovery
 -- row. A simultaneous tool retry cannot deadlock with final reconciliation.
 select * into r from icash_seller_agreement_private.delivery_recovery where id=p_id and state in ('claimed','sent');
 if not found then return false;end if;
 perform 1 from public.icash_deal_files d where d.id=r.deal_id and d.account_id=r.account_id for update;
 if not found then return false;end if;
 select * into r from icash_seller_agreement_private.delivery_recovery where id=p_id and state in ('claimed','sent') for update;
 if not found then return false;end if;
 if r.state='sent' and (r.envelope_id is distinct from p_envelope or r.result is distinct from p_result) then return false;end if;
 if p_envelope is not null then
  select * into e from public.icash_signing_envelopes where id=p_envelope and account_id=r.account_id and deal_id=r.deal_id and kind='purchase' and not test_mode;
  if not found then return false;end if;
  prepared:=e.state in ('awaiting_counterparty','customer_signature_needed','completed') and e.provider_id is not null
   and (e.terms-array['assignmentFeeCents','assignmentDepositCents'])=(r.expected_terms-array['assignmentFeeCents','assignmentDepositCents'])
   and jsonb_array_length(e.recipients)=2 and e.recipients->0->>'name'=r.seller_name and e.recipients->0->>'phone'=r.phone;
 end if;
 if p_result->'sent'='true'::jsonb and not coalesce(prepared,false) then return false;end if;
 -- Preserve the worker's actual text result. Preparing an envelope is not
 -- evidence that a text was accepted, delivered, or read by the seller.
 update icash_seller_agreement_private.delivery_recovery set envelope_id=p_envelope,result=p_result,
  state=case when p_result->'sent'='true'::jsonb then 'sent' else 'needs_review' end where id=r.id and state='claimed';
 if prepared then
  update icash_seller_agreement_private.confirmations c set envelope_id=e.id,state='ready'
  where c.account_id=r.account_id and c.deal_id=r.deal_id and c.state in ('preparing','needs_review')
   and (c.envelope_id is null or c.envelope_id=e.id)
   and c.confirmation->>'sellerLegalName'=r.seller_name and c.confirmation->'sendTextRequested'='true'::jsonb
   and (c.terms-array['assignmentFeeCents','assignmentDepositCents'])=(e.terms-array['assignmentFeeCents','assignmentDepositCents']);
 end if;
 return true;
end $$;
revoke all on function public.icash_finish_agreement_delivery_recovery(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_finish_agreement_delivery_recovery(uuid,uuid,jsonb) to service_role;
commit;
