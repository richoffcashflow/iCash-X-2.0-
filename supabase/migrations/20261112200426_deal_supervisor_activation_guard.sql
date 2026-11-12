-- SQL CHECK permits UNKNOWN. A missing release SHA must fail closed explicitly.
alter table public.icash_deal_supervisor_settings
 drop constraint icash_deal_supervisor_settings_check,
 add constraint icash_deal_supervisor_settings_check check(not enabled or (
  activated_at is not null and release_sha is not null and release_sha ~ '^[0-9a-f]{40}$'
 ));
