-- Reviewed configuration must explicitly permit a selected voice that differs from the agent default.
alter table public.icash_voice_configs add column approved_voice_ids text[] not null default '{}';
