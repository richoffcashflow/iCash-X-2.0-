begin;
-- A returning-customer trial and its later payments stay outside the ordinary
-- webinar/ad reports even if the same email visited an ad webinar previously.
-- Preserve every existing private-campaign exclusion and the paid receipts.
create or replace function public.icash_legacy_meta_excluded(p_payment text,p_session uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_webinar_sessions s where s.id=p_session and nullif(s.config->>'legacyCampaignId','') is not null)
 or exists(select 1 from public.icash_membership_invoices i join public.icash_legacy_checkouts b on b.membership_id=i.membership_id and b.created_at<=i.recorded_at where i.stripe_payment_id=p_payment)
 or exists(select 1 from public.icash_plan_changes c join public.icash_legacy_checkouts b on b.membership_id=c.membership_id and b.created_at<=c.applied_at where c.payment_id=p_payment)
 or exists(select 1 from public.icash_membership_invoices i join public.icash_memberships m on m.id=i.membership_id where i.stripe_payment_id=p_payment and m.legacy_trial_offer='legacy-trial-2026-10-25.1')
 or exists(select 1 from public.icash_plan_changes c join public.icash_memberships m on m.id=c.membership_id where c.payment_id=p_payment and m.legacy_trial_offer='legacy-trial-2026-10-25.1');
$$;
revoke all on function public.icash_legacy_meta_excluded(text,uuid) from public,anon,authenticated;
grant execute on function public.icash_legacy_meta_excluded(text,uuid) to service_role;
commit;
