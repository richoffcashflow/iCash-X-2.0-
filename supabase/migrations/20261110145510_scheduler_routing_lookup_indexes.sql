-- Preserve all routing history and original financial evidence. These indexes
-- change lookup cost only, including retired conversations and unknown calls.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';

-- The continuity check includes retired threads belonging to other accounts;
-- the existing active-thread partial index cannot serve that predicate.
create index icash_text_threads_all_number_pairs
 on public.icash_text_threads(sender,recipient);

create index icash_customer_update_authorized_sms_pair
 on public.icash_customer_update_deliveries(sender,recipient)
 where channel='sms' and authorized_at is not null;

-- Match the existing text comparison exactly; do not cast untrusted batch IDs
-- to UUID or change which original completed export proves the manifest.
create index owner_export_completed_text_identity
 on icash_research_private.owner_exports((id::text))
 where completed_at is not null;
commit;
