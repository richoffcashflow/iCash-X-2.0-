begin;
-- Production-specific capability selection. The existing provider documents were
-- independently read and contain dynamic state fields. This changes routing only:
-- no document wording, legal-review record, expiration, signer mapping, rate or enablement changes.
-- Apply only after standard-contract-routing.sql and independent candidate review.
do $$
declare n integer;
begin
 select count(*) into n from public.icash_signing_templates
 where provider='docuseal' and not test_mode and signer_count=1
 and ((kind='purchase' and provider_template_id='6101264') or (kind='assignment' and provider_template_id='6101265'));
 if n<>2 then raise exception 'Expected exact existing standard purchase/assignment pair';end if;
 update public.icash_signing_templates set template_scope='standard'
 where provider='docuseal' and not test_mode and signer_count=1
 and ((kind='purchase' and provider_template_id='6101264') or (kind='assignment' and provider_template_id='6101265'));
end $$;
commit;
