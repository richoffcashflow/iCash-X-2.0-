begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Admit exactly the two owner-selected leases to the existing forwarding setup.
-- Keep all prior leases, provider verification and service-role permissions intact.
alter table public.icash_business_voice_numbers drop constraint icash_business_voice_numbers_phone_check;
alter table public.icash_business_voice_numbers add constraint icash_business_voice_numbers_phone_check
 check(phone in ('+14244377030','+17208134296','+14154208230','+16195364770'));

-- Connecting forwarding must not enroll these incoming-only leases in SMS.
-- The existing save RPC uses ON CONFLICT DO NOTHING, preserving these disabled
-- rows on every connect/refresh. Do not rewrite any previously chosen state.
insert into public.icash_text_senders(phone,enabled)
values('+14154208230',false),('+16195364770',false)
on conflict(phone) do nothing;
commit;
