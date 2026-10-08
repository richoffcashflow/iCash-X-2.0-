-- Conditional verbal prices never authorize contract creation. Preserve the
-- existing transaction locks, call binding and service-only access.
begin;
create or replace function public.icash_claim_seller_agreement(p_hash text,p_conversation text,p_confirmation jsonb,p_expected_terms jsonb,p_terms jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare scope jsonb;d public.icash_deal_files;o icash_call_offer_private.offers;snapshot jsonb;
begin
 scope:=public.icash_seller_agreement_call_context(p_hash,p_conversation);if scope is null then return null;end if;
 select * into d from public.icash_deal_files where id=(scope->>'dealId')::uuid and account_id=(scope->>'accountId')::uuid for update;
 if not found then return null;end if;
 select * into o from icash_call_offer_private.offers where deal_id=d.id and account_id=d.account_id for share;
 if found then
  select s.snapshot into snapshot from public.icash_screening_jobs s where s.id=d.screening_id and s.account_id=d.account_id for share;
  if snapshot is distinct from o.snapshot or coalesce(o.state->>'acceptedPriceCents','') !~ '^[1-9][0-9]*$'
   or o.state->'acceptedPriceCents' is distinct from p_terms->'priceCents' or o.state->'quotedPriceCents' is distinct from p_terms->'priceCents'
   or o.state->'factsPending'='true'::jsonb or o.state->'conditionPending'='true'::jsonb or o.state->'agreementRevisionRequired'='true'::jsonb
   or o.state->'contractBlocked'='true'::jsonb or o.state->'acceptanceConditional'='true'::jsonb or o.state->'payoffPending'='true'::jsonb then return null;end if;
 end if;
 return public.icash_claim_seller_agreement_before_offer(p_hash,p_conversation,p_confirmation,p_expected_terms,p_terms);
end $$;
revoke all on function public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb) to service_role;
commit;
