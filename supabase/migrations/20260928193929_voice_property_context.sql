-- Private test snapshots inherit service-role-only access and existing session limits.
alter table public.icash_voice_test_sessions add column property_context jsonb;
alter table public.icash_voice_test_sessions add column property_lookup_status text
 check(property_lookup_status is null or property_lookup_status in ('reserved','complete','unknown'));
comment on column public.icash_voice_test_sessions.property_context is
 'Unreviewed provider facts for this private session only; not an authorized offer or tenant-shared cache.';
