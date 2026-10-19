-- Build existing first-call routes once instead of rescanning the target view
-- for every candidate. Preserve every duplicate exclusion, including held and
-- cancelled jobs; eligibility gates, ordered batch and locked recheck stay exact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare definition text;
 original_head text:=$head$for c in with candidates as materialized ($head$;
 replacement_head text:=$new_head$for c in with prior_first_routes as materialized (
 select prior.account_id,target.screening_id,target.contact_key
 from public.icash_voice_jobs prior join public.icash_voice_contact_targets target
  on target.id=coalesce(prior.permission_id,prior.operational_contact_id) and target.account_id=prior.account_id
 where prior.callback_id is null
), candidates as materialized ($new_head$;
 original_routes text:=$routes$and not exists(select 1 from public.icash_voice_jobs prior join public.icash_voice_contact_targets target on target.id=coalesce(prior.permission_id,prior.operational_contact_id)
  where prior.account_id=op.account_id and target.account_id=op.account_id and target.screening_id=op.screening_id and target.contact_key=op.contact_key and prior.callback_id is null)$routes$;
 replacement_routes text:=$new_routes$and not exists(select 1 from prior_first_routes prior
  where prior.account_id=op.account_id and prior.screening_id=op.screening_id and prior.contact_key=op.contact_key)$new_routes$;
begin
 definition:=pg_get_functiondef('public.icash_queue_voice_jobs()'::regprocedure);
 if (length(definition)-length(replace(definition,original_head,'')))<>length(original_head)
  or (length(definition)-length(replace(definition,original_routes,'')))<>length(original_routes) then
  raise exception 'Voice queue prior-route prerequisite changed';
 end if;
 execute replace(replace(definition,original_head,replacement_head),original_routes,replacement_routes);
end $migration$;
commit;

