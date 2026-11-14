begin;

-- Supabase's default table grants include mutation permissions for service_role.
-- Replace those inherited grants explicitly; engagement remains append-only and
-- the installed singleton policy may be read/updated, never inserted/deleted.
revoke all on public.icash_purchase_email_engagement from public,anon,authenticated,service_role;
grant select,insert on public.icash_purchase_email_engagement to service_role;
revoke all on public.icash_purchase_access_reminder_policy from public,anon,authenticated,service_role;
grant select,update on public.icash_purchase_access_reminder_policy to service_role;

commit;
