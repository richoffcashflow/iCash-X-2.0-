-- pg-delta: transaction=false
-- Stage 2 only, standalone autocommit after stage 1 is verified valid and ready.
-- Configure bounded session timeouts first. Inspect exact outcome before retrying.
create index concurrently icash_dnc_clear_national_screening_expiry
 on public.icash_dnc_verification_receipts((observation_provenance->>'screeningId'),expires_at)
 where evidence_kind='national_provider_observation' and clear and revoked_at is null;
