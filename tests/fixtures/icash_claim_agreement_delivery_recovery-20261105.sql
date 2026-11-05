CREATE OR REPLACE FUNCTION public.icash_claim_agreement_delivery_recovery()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r icash_seller_agreement_private.delivery_recovery;email text;current_terms jsonb;
begin
 select j.* into r from icash_seller_agreement_private.delivery_recovery j
 join public.icash_accounts a on a.id=j.account_id and a.owner_user_id=j.requested_by and not a.bot_paused
 join public.icash_deal_files d on d.id=j.deal_id and d.account_id=j.account_id and d.stage='draft'
  and (d.terms-array['assignmentFeeCents','assignmentDepositCents'])=(j.expected_terms-array['assignmentFeeCents','assignmentDepositCents']) and d.terms->>'seller'=j.seller_name
 join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=j.account_id and s.state='complete'
 join auth.users u on u.id=j.requested_by and u.email is not null and u.email_confirmed_at is not null
 where j.state='queued' and j.expires_at>now() and public.icash_membership_work_allowed(j.account_id)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=j.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
 and exists(select 1 from public.icash_text_threads t where t.account_id=j.account_id and t.deal_id=j.deal_id and t.recipient=j.phone and t.party='seller'
  and t.retired_at is null and not t.paused and not t.manual_only and public.icash_sms_thread_review_current(j.account_id,t.id,true))
 and not exists(select 1 from public.icash_text_suppressions x where x.phone=j.phone)
 and not exists(select 1 from public.icash_contact_suppressions x where x.contact_key=encode(sha256(convert_to(j.phone,'UTF8')),'hex'))
 -- Automatic recovery retains the current offer-authority guards. A later
 -- withdrawal, changed property facts or revised quote invalidates old consent.
 and (j.request_key not like 'seller-confirmed:%' or not exists(
  select 1 from icash_call_offer_private.offers o where o.account_id=j.account_id and o.deal_id=j.deal_id
  and (o.snapshot is distinct from s.snapshot or coalesce(o.state->>'acceptedPriceCents','') !~ '^[1-9][0-9]*$'
   or o.state->'acceptedPriceCents' is distinct from d.terms->'priceCents' or o.state->'quotedPriceCents' is distinct from d.terms->'priceCents'
   or o.state->'factsPending'='true'::jsonb or o.state->'conditionPending'='true'::jsonb or o.state->'agreementRevisionRequired'='true'::jsonb
   or o.state->'contractBlocked'='true'::jsonb or o.state->'acceptanceConditional'='true'::jsonb or o.state->'payoffPending'='true'::jsonb)))
 order by j.created_at for update of j,d skip locked limit 1;
 if not found then return null;end if;
 select u.email into email from auth.users u where u.id=r.requested_by;
 select d.terms into current_terms from public.icash_deal_files d where d.id=r.deal_id and d.account_id=r.account_id;
 update icash_seller_agreement_private.delivery_recovery set state='claimed',claimed_at=now(),expected_terms=current_terms where id=r.id;
 return jsonb_build_object('id',r.id,'accountId',r.account_id,'userId',r.requested_by,'customerEmail',email,'dealId',r.deal_id,'phone',r.phone,'sellerName',r.seller_name,'expectedTerms',current_terms);
end $function$
