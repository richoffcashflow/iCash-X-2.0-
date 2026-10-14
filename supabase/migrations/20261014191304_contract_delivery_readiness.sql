begin;
-- Delivery setup can fail before a text thread exists. Preserve a visible,
-- account-bound request instead of silently losing the seller's send request.
create or replace function public.icash_record_seller_tool_gap(p_hash text,p_conversation text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare scope jsonb;thread uuid;reason text;call_id uuid;handoff_id uuid;
begin
 scope:=public.icash_seller_agreement_call_context(p_hash,p_conversation);
 if scope is null then return null;end if;
 reason:=case when p_reason='all_owners_required' then 'owners'
  when p_reason in ('updated_property_review_required','payoff_review_required','price_review_required','agreement_changed','existing_price_changed','property_binding_changed') then 'material_facts'
  else 'delivery_unknown' end;
 select t.id into thread from public.icash_text_threads t
 where t.account_id=(scope->>'accountId')::uuid and t.deal_id=(scope->>'dealId')::uuid
 and t.party='seller' and t.recipient=scope->>'phone' and t.retired_at is null;
 if thread is not null then
  return public.icash_open_seller_gap((scope->>'accountId')::uuid,thread,'tool',md5(p_hash||p_conversation)::uuid,reason,p_reason,now());
 end if;
 -- Only the live, verified outbound call may create this fallback. Inbound
 -- contexts retain their existing thread-bound review path; no guessed contact.
 select c.id into call_id from public.icash_live_conversations c
 where c.conversation_id=p_conversation and c.account_id=(scope->>'accountId')::uuid
 and c.screening_id=(scope->>'screeningId')::uuid and c.party='seller'
 and scope->>'callKey'='outbound:'||c.id::text;
 if call_id is null then return null;end if;
 insert into public.icash_handoffs(conversation_id,account_id,screening_id,party,reason,summary,next_action)
 values(call_id,(scope->>'accountId')::uuid,(scope->>'screeningId')::uuid,'seller',
  'Agreement delivery needs attention',
  'The seller agreement could not proceed because its text conversation is unavailable. No contract delivery is confirmed.',
  'Restore texting for this property, then send the exact confirmed agreement. Check the delivery receipt before marking this resolved.')
 on conflict(conversation_id) do nothing returning id into handoff_id;
 if handoff_id is null then select id into handoff_id from public.icash_handoffs where conversation_id=call_id and account_id=(scope->>'accountId')::uuid;end if;
 return handoff_id;
end $$;
revoke all on function public.icash_record_seller_tool_gap(text,text,text) from public,anon,authenticated;
grant execute on function public.icash_record_seller_tool_gap(text,text,text) to service_role;
commit;

begin;
-- An already verified seller request survives a temporary delivery outage. The
-- existing claim performs the same call/price/identity checks as immediate send.
create or replace function public.icash_defer_seller_agreement(p_hash text,p_conversation text,p_confirmation jsonb,p_expected_terms jsonb,p_terms jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare scope jsonb;claim jsonb;c icash_seller_agreement_private.confirmations;d public.icash_deal_files;r icash_seller_agreement_private.delivery_recovery;
begin
 scope:=public.icash_seller_agreement_call_context(p_hash,p_conversation);
 if scope is null then return null;end if;
 if not exists(
  select 1 from public.icash_accounts a
  join public.icash_deal_files df on df.account_id=a.id and df.id=(scope->>'dealId')::uuid and df.stage='draft'
  join public.icash_screening_jobs s on s.id=df.screening_id and s.account_id=a.id and s.state='complete'
  join auth.users u on u.id=a.owner_user_id and u.email is not null and u.email_confirmed_at is not null
  where a.id=(scope->>'accountId')::uuid and a.owner_user_id=(scope->>'ownerUserId')::uuid and not a.bot_paused
   and public.icash_membership_work_allowed(a.id)
   and not exists(select 1 from public.icash_property_controls pc where pc.account_id=a.id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
   and not exists(select 1 from public.icash_text_suppressions x where x.phone=scope->>'phone')
   and not exists(select 1 from public.icash_contact_suppressions x where x.contact_key=encode(sha256(convert_to(scope->>'phone','UTF8')),'hex'))
 ) then return null;end if;
 claim:=public.icash_claim_seller_agreement(p_hash,p_conversation,p_confirmation,p_expected_terms,p_terms);
 if claim is null then return null;end if;
 select * into c from icash_seller_agreement_private.confirmations
 where id=(claim->>'id')::uuid and account_id=(scope->>'accountId')::uuid and deal_id=(scope->>'dealId')::uuid for update;
 if not found or c.confirmation is distinct from p_confirmation
  or (c.terms-array['assignmentFeeCents','assignmentDepositCents']) is distinct from (p_terms-array['assignmentFeeCents','assignmentDepositCents']) then return null;end if;
 select * into d from public.icash_deal_files where id=c.deal_id and account_id=c.account_id and stage='draft' for update;
 -- These two fields are buyer-side economics, absent from the seller purchase
 -- document. They can be recalculated without changing any seller-agreed term.
 if not found or (d.terms-array['assignmentFeeCents','assignmentDepositCents']) is distinct from (c.terms-array['assignmentFeeCents','assignmentDepositCents']) then return null;end if;
 select * into r from icash_seller_agreement_private.delivery_recovery where request_key='seller-confirmed:'||c.id::text for update;
 if found then return jsonb_build_object('queued',r.state in ('queued','claimed') and r.expires_at>now(),'id',r.id);end if;
 -- Provider creation always has an envelope first. Any envelope, including an
 -- uncertain/failed one, blocks automatic recreation. Never retry ambiguity.
 if c.envelope_id is not null or exists(select 1 from public.icash_signing_envelopes where account_id=c.account_id and deal_id=c.deal_id and kind='purchase' and not test_mode) then return null;end if;
 insert into icash_seller_agreement_private.delivery_recovery(request_key,account_id,requested_by,deal_id,phone,seller_name,expected_terms,authorization_reference,expires_at)
 values('seller-confirmed:'||c.id::text,c.account_id,(scope->>'ownerUserId')::uuid,c.deal_id,scope->>'phone',p_confirmation->>'sellerLegalName',d.terms,
  'Automatic recovery of call-bound seller text authorization; confirmation '||c.id::text,
  least(now()+interval '24 hours',((p_confirmation->>'closingDate')::date)::timestamptz)) returning * into r;
 return jsonb_build_object('queued',true,'id',r.id);
end $$;
revoke all on function public.icash_defer_seller_agreement(text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.icash_defer_seller_agreement(text,text,jsonb,jsonb,jsonb) to service_role;

-- Internal fee refreshes must not strand a seller-approved purchase. Every
-- seller-visible term is still compared. Preserve live signing's exact envelope
-- and signer validation and the existing worker's at-most-one provider attempt.
create or replace function public.icash_claim_agreement_delivery_recovery() returns jsonb
language plpgsql security definer set search_path='' as $$
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
end $$;
revoke all on function public.icash_claim_agreement_delivery_recovery() from public,anon,authenticated;
grant execute on function public.icash_claim_agreement_delivery_recovery() to service_role;

-- A fee calculation may update internal economics after the seller's terms
-- were confirmed. The purchase agreement does not contain these two fields.
-- Every other term and every prior finalization guard remains exact.
create or replace function public.icash_finish_seller_agreement(p_id uuid,p_account uuid,p_envelope uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update icash_seller_agreement_private.confirmations c set envelope_id=e.id,state='ready' from public.icash_signing_envelopes e
 where c.id=p_id and c.account_id=p_account and c.state='preparing' and e.id=p_envelope and e.account_id=c.account_id and e.deal_id=c.deal_id
 and e.kind='purchase' and e.state='awaiting_counterparty' and not e.test_mode and e.provider_id is not null
 and (e.terms-array['assignmentFeeCents','assignmentDepositCents'])=(c.terms-array['assignmentFeeCents','assignmentDepositCents']);
 return found;
end $$;
revoke all on function public.icash_finish_seller_agreement(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_finish_seller_agreement(uuid,uuid,uuid) to service_role;

create or replace function public.icash_finish_agreement_delivery_recovery(p_id uuid,p_envelope uuid,p_result jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r icash_seller_agreement_private.delivery_recovery;e public.icash_signing_envelopes;prepared boolean:=false;
begin
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
