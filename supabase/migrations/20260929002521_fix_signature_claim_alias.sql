create or replace function public.icash_claim_auto_signature(p_account uuid,p_envelope uuid,p_hash text) returns text
language plpgsql security invoker set search_path='' as $$
declare authrow public.icash_signature_authorizations;
begin
 update public.icash_signature_authorizations set state='claimed',claimed_at=now()
 where envelope_id=p_envelope and account_id=p_account and terms_hash=p_hash and state='authorized' and expires_at>now()
 and exists(select 1 from public.icash_signing_envelopes e join public.icash_signing_templates t on t.id=e.template_id where e.id=p_envelope and e.account_id=p_account and e.terms_hash=p_hash and e.state='customer_signature_needed' and exists(select 1 from public.icash_accounts a where a.id=e.account_id and not a.bot_paused) and exists(select 1 from public.icash_deal_files d join public.icash_screening_jobs j on j.id=d.screening_id where d.id=e.deal_id and d.terms=e.terms and not exists(select 1 from public.icash_property_controls pc where pc.account_id=e.account_id and pc.property_id=j.snapshot->>'propertyId' and pc.manual)) and t.provider='docuseal' and t.enabled and t.automated_signing_reviewed and t.reviewed_until>now())
 returning * into authrow;
 return authrow.signature_text;
end $$;
