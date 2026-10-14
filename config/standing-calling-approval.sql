-- Owner instruction, 2026-10-14: automatic production calling approval stays on
-- for every account. No routine renewal. The finite sentinel is compatible with
-- PostgreSQL snapshot guards and JavaScript Date.parse (unlike 'infinity').
-- This changes authorization duration, not provider identity, pricing or consent.
-- Run with owner/service database authority; not from a customer request.
-- Keep RECORDED_OUTBOUND_REVIEW_JSON.reviewedUntil in sync, then redeploy.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$
declare
 standing_until constant timestamptz := '9999-12-31T23:59:59Z';
 authority constant text := 'Owner instruction 2026-10-14: automatic standing production calling approval for all accounts; revocable by disabling configuration.';
 rate_map jsonb := '{}';
 old_rate public.icash_operation_rates;
 new_rate public.icash_operation_rates;
 old_config icash_recorded_reception_private.configs;
 new_config icash_recorded_reception_private.configs;
 old_policy icash_recorded_reception_private.cost_policies;
 new_policy icash_recorded_reception_private.cost_policies;
 next_version integer;
begin
 -- Coordinate with inbound admission and new-account provisioning. An active
 -- call aborts this whole transaction; retry after it ends, never terminate it.
 perform 1 from icash_reception_private.config where id=1 for update;
 lock table public.icash_voice_production_template, public.icash_voice_configs
  in share row exclusive mode;
 if exists(select 1 from icash_recorded_reception_private.configs where enabled and call_profile='normal' and reviewed_until<>standing_until)
 and exists(select 1 from icash_recorded_reception_private.sessions where call_ended_at is null) then
  raise exception 'Wait for active inbound calls to finish before rotating approval';
 end if;
 if not exists(select 1 from public.icash_voice_production_template where id=1 and enabled) then
  raise exception 'An enabled reviewed production template is required';
 end if;

 -- Immutable rate versions preserve all costs and evidence. Old versions stay
 -- available to in-flight calls and historical settlement receipts.
 for old_rate in
  select r.* from public.icash_operation_rates r where r.id in (
   select seller_rate_id from public.icash_voice_production_template where enabled
   union select buyer_rate_id from public.icash_voice_production_template where enabled
   union select seller_rate_id from public.icash_voice_configs where enabled
   union select buyer_rate_id from public.icash_voice_configs where enabled
   union select rate_id from icash_recorded_reception_private.configs where enabled and call_profile='normal'
  ) for share
 loop
  if not old_rate.enabled then raise exception 'Referenced calling rate is disabled'; end if;
  if old_rate.expires_at=standing_until then
   rate_map:=rate_map||jsonb_build_object(old_rate.id::text,old_rate.id);
  else
   new_rate:=jsonb_populate_record(null::public.icash_operation_rates,
    to_jsonb(old_rate)||jsonb_build_object('id',gen_random_uuid(),
     'version',old_rate.version||':standing-20261014','expires_at',standing_until));
   insert into public.icash_operation_rates select (new_rate).*;
   rate_map:=rate_map||jsonb_build_object(old_rate.id::text,new_rate.id);
  end if;
 end loop;

 update public.icash_voice_production_template set
  seller_rate_id=(rate_map->>seller_rate_id::text)::uuid,
  buyer_rate_id=(rate_map->>buyer_rate_id::text)::uuid,
  reviewed_until=standing_until
 where enabled;
 update public.icash_voice_configs set
  seller_rate_id=(rate_map->>seller_rate_id::text)::uuid,
  buyer_rate_id=(rate_map->>buyer_rate_id::text)::uuid,
  reviewed_until=standing_until
 where enabled;

 for old_config in select * from icash_recorded_reception_private.configs
  where enabled and call_profile='normal' and reviewed_until<>standing_until for update
 loop
  select * into strict old_policy from icash_recorded_reception_private.cost_policies
   where id=old_config.cost_policy_id and enabled for share;
  select * into strict new_rate from public.icash_operation_rates
   where id=(rate_map->>old_config.rate_id::text)::uuid;
  new_policy:=jsonb_populate_record(null::icash_recorded_reception_private.cost_policies,
   to_jsonb(old_policy)||jsonb_build_object('id',gen_random_uuid(),
    'version',old_policy.version||':standing-20261014','rate_id',new_rate.id,
    'rate_snapshot',to_jsonb(new_rate)-'enabled','approved_at',now(),
    'reviewed_until',standing_until,'approval_reference',authority,'created_at',now()));
  insert into icash_recorded_reception_private.cost_policies select (new_policy).*;
  select max(version)+1 into next_version from icash_recorded_reception_private.configs
   where account_id=old_config.account_id and called_number=old_config.called_number;
  new_config:=jsonb_populate_record(null::icash_recorded_reception_private.configs,
   to_jsonb(old_config)||jsonb_build_object('id',gen_random_uuid(),'version',next_version,
    'cost_policy_id',new_policy.id,'cost_policy_snapshot',to_jsonb(new_policy)-'enabled',
    'rate_id',new_rate.id,'rate_snapshot',to_jsonb(new_rate)-'enabled',
    'approved_at',now(),'reviewed_until',standing_until,'approval_reference',authority,'created_at',now()));
  update icash_recorded_reception_private.configs set enabled=false where id=old_config.id;
  insert into icash_recorded_reception_private.configs select (new_config).*;
 end loop;
end $$;
commit;
