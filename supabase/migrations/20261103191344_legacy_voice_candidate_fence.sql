-- Exclude existing legacy voice routes before expensive contact evidence.
-- Preserve the complete eligibility predicate and final LIMIT 100. No cursor,
-- job state, callback path, permission or financial evidence changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $migration$
declare definition text;
 original_query text:=$old$ select p.account_id,p.id from public.icash_contact_permissions p join public.icash_voice_configs c on c.account_id=p.account_id and c.enabled join public.icash_accounts a on a.id=p.account_id and not a.bot_paused join public.icash_screening_jobs s on s.id=p.screening_id and s.account_id=p.account_id and s.state='complete'
 where public.icash_outreach_voice_current(p.account_id) and p.revoked_at is null and p.permission_until>now() and (p.dnc_clear or public.icash_seller_voice_permission_current(p.account_id,p.id)) and (s.result->'financialCheck'->>'status'='eligible' or public.icash_seller_limited_contact(p.account_id,p.screening_id)) and p.party='seller' and not exists(select 1 from public.icash_voice_jobs prior join public.icash_operational_contacts oc on oc.id=prior.operational_contact_id where prior.account_id=p.account_id and oc.account_id=p.account_id and oc.screening_id=p.screening_id and oc.contact_key=p.contact_key and prior.callback_id is null)
 and not exists(select 1 from public.icash_voice_jobs v where v.permission_id=p.id and v.callback_id is null) limit 100$old$;
 replacement_query text:=$new$ with candidates as materialized (
 select p.id,p.account_id,p.screening_id,p.dnc_clear,s.result
 from public.icash_contact_permissions p
 join public.icash_voice_configs c on c.account_id=p.account_id and c.enabled
 join public.icash_accounts a on a.id=p.account_id and not a.bot_paused
 join public.icash_screening_jobs s on s.id=p.screening_id and s.account_id=p.account_id and s.state='complete'
 where p.revoked_at is null and p.permission_until>now() and p.party='seller'
 and not exists(select 1 from public.icash_voice_jobs prior join public.icash_operational_contacts oc on oc.id=prior.operational_contact_id where prior.account_id=p.account_id and oc.account_id=p.account_id and oc.screening_id=p.screening_id and oc.contact_key=p.contact_key and prior.callback_id is null)
 and not exists(select 1 from public.icash_voice_jobs v where v.permission_id=p.id and v.callback_id is null)
 )
 select p.account_id,p.id from candidates p
 where public.icash_outreach_voice_current(p.account_id)
 and (p.dnc_clear or public.icash_seller_voice_permission_current(p.account_id,p.id))
 and (p.result->'financialCheck'->>'status'='eligible' or public.icash_seller_limited_contact(p.account_id,p.screening_id))
 limit 100$new$;
begin
 definition:=pg_get_functiondef('public.icash_queue_voice_jobs_before_operational()'::regprocedure);
 if md5(definition)<>'a8eb1f89eb58fa1cd9aac427af6e7252'
  or (length(definition)-length(replace(definition,original_query,'')))<>length(original_query) then
  raise exception 'Legacy voice candidate fence prerequisite changed';
 end if;
 execute replace(definition,original_query,replacement_query);
end $migration$;
commit;
