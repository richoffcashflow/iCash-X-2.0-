-- pg-delta: transaction=false
-- Stage 1 only, standalone autocommit after release preflight; not a transaction.
-- Configure bounded session timeouts first. Inspect exact outcome before retrying.
create index concurrently icash_dnc_clear_phone_expiry
 on public.icash_dnc_verification_receipts(phone,expires_at)
 where clear and revoked_at is null;
