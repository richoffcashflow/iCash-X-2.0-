-- Attribute unresolved reservations to the hour in which they were reserved or
-- dispatched. Every pending cap still counts against the total allowance,
-- cumulative release, rolling daily limit and protected wallet capacity.
-- This changes no charge, reservation, provider receipt or numeric limit.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare definition text;
 needle text:=$old$when o.state in ('reserved','dispatched') and (o.prospecting_budget_id is not null or public.icash_new_prospect_operation(p_account,o.operation_key,o.rate_id)) then o.charge_cap_cents else 0 end),0) hour_amount$old$;
 replacement text:=$new$when o.state in ('reserved','dispatched') and coalesce(o.dispatched_at,o.created_at)>now()-interval '1 hour'
   and (o.prospecting_budget_id is not null or public.icash_new_prospect_operation(p_account,o.operation_key,o.rate_id)) then o.charge_cap_cents else 0 end),0) hour_amount$new$;
begin
 definition:=pg_get_functiondef('public.icash_prospecting_available(uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then
  raise exception 'Hourly reservation pacing prerequisite changed';
 end if;
 execute replace(definition,needle,replacement);
end $migration$;
commit;
