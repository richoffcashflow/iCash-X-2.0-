-- Read-only service check. Configuration is not proof that the whole pipeline has shipped.
create function public.icash_launch_checks(p_account uuid default null) returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object(
 'cashReserve',exists(select 1 from public.icash_operating_budget where id=1 and enabled and funded_micros::numeric-spent_micros-protected_micros-reserved_micros>0),
 'discovery',exists(select 1 from public.icash_discovery_configs d join public.icash_operation_rates r on r.id=d.rate_id join public.icash_operation_rates e on e.id=d.contact_rate_id where (p_account is null or d.account_id=p_account) and d.enabled and d.auto_enabled and not d.exhausted and d.contacts_enabled and d.data_rights_until>now() and r.enabled and r.operation='property_search' and r.expires_at>now() and e.enabled and e.operation='owner_enrichment' and e.expires_at>now()),
 'voice',exists(select 1 from public.icash_voice_configs c join public.icash_operation_rates r on r.id=c.seller_rate_id where (p_account is null or c.account_id=p_account) and c.enabled and c.reviewed_until>now() and r.enabled and r.expires_at>now() and r.operation='seller_call' and r.voice_max_duration_seconds>=c.max_duration_seconds),
 'contactPermission',exists(select 1 from public.icash_contact_permissions p where (p_account is null or p.account_id=p_account) and p.revoked_at is null and p.permission_until>now() and p.dnc_clear and p.dnc_checked_at between now()-interval '30 days' and now() and not exists(select 1 from public.icash_contact_suppressions s where s.contact_key=p.contact_key)),
 'productionContracts',(select count(distinct kind)>=2 from public.icash_signing_templates t join public.icash_operation_rates r on r.id=t.rate_id where t.enabled and not t.test_mode and t.reviewed_until>now() and r.enabled and r.expires_at>now()),
 'unresolvedDispatches',exists(select 1 from public.icash_voice_jobs where (p_account is null or account_id=p_account) and ((state='held' and outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')) or (state='dispatching' and updated_at<now()-interval '2 minutes')))
);
$$;
revoke all on function public.icash_launch_checks(uuid) from public,anon,authenticated;
grant execute on function public.icash_launch_checks(uuid) to service_role;
