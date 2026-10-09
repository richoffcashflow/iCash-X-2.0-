begin;
set local lock_timeout='3s';
-- Add a separately reviewed inbound policy; retain every existing session hash.
do $policy$
declare definition text;before_definition text;name text;new_hash text:='20790adc5e07a5e8c0f2fe92377ae7ee43963db0b7e3db97506cf4e0386d1265';
begin
 foreach name in array array['configs_context_policy_check','configs_context_binding_check'] loop
  select regexp_replace(pg_get_constraintdef(oid),'^CHECK ','') into definition from pg_constraint where conrelid='icash_recorded_reception_private.configs'::regclass and conname=name;
  if definition is null or position('automatic_offer_v11' in definition)=0 then raise exception 'Current policy constraints required';end if;
  execute format('alter table icash_recorded_reception_private.configs drop constraint %I',name);
  execute format('alter table icash_recorded_reception_private.configs add constraint %I check ((%s) or (context_policy=''automatic_offer_v12'' and context_policy_hash=%L and length(btrim(context_approval_reference)) between 10 and 500 and agreement_tool_id is not null and agreement_tool_id<>stop_tool_id))',name,definition,new_hash);
 end loop;
 foreach name in array array['icash_reception_context_before_agreement(uuid,text)','icash_reception_context_before_payoff(uuid,text)','icash_seller_agreement_recording(text)','icash_seller_agreement_call_context(text,text)'] loop
  before_definition:=pg_get_functiondef(('public.'||name)::regprocedure);
  definition:=replace(before_definition,'''automatic_offer_v10'',''automatic_offer_v11'')','''automatic_offer_v10'',''automatic_offer_v11'',''automatic_offer_v12'')');
  definition:=replace(definition,'(c.context_policy=''automatic_offer_v9'' and c.context_policy_hash=''24d43197289eb72d06d4d93fb4a1d3e0c0a6ef88f17b57664854e68674e2b3bf'')','((c.context_policy=''automatic_offer_v9'' and c.context_policy_hash=''24d43197289eb72d06d4d93fb4a1d3e0c0a6ef88f17b57664854e68674e2b3bf'') or (c.context_policy=''automatic_offer_v12'' and c.context_policy_hash='||quote_literal(new_hash)||'))');
  if definition=before_definition then raise exception 'Expected current policy binding missing: %',name;end if;
  execute definition;
 end loop;
end $policy$;

-- The provider's role-slot prompt and branch/version are unchanged. Only the
-- repository-owned runtime buyer instructions gain a new exact policy hash.
-- Stage with zero traffic; activation follows a passed provider audit and READY app.
create function public.icash_stage_buyer_scenario_policy(p_source uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c icash_recorded_reception_private.configs;n icash_recorded_reception_private.configs;audit jsonb;
begin
 select result into audit from public.icash_integration_checks where provider='buyer_scenario_audit_20261009_v2';
 if audit->>'status' is distinct from 'failed' or audit->>'fixtureHash' is distinct from 'f0e28fbd5705e211088c9ea75da91fd9ec5dc2192e44c48dd06aa5620d94072f'
  or audit->>'code' is distinct from 'BUYER_SCENARIO_FAILURES_REQUIRE_FIX' or audit->>'count' is distinct from '28'
  or jsonb_array_length(audit->'tests') is distinct from 28 then raise exception 'Reviewed failed scenario audit required';end if;
 select * into c from icash_recorded_reception_private.configs where id=p_source and enabled and context_policy='automatic_offer_v11'
 and context_policy_hash='2f40ffd420387c93f6fe66fd9093285a657a928f429d71ad177637840932fc8a' and entry_policy='direct_recorded_v1' for update;
 if not found or c.reviewed_until<=now()+interval '15 minutes' or c.branch_id is distinct from audit->>'branchId' or c.version_id is distinct from audit->>'version' then raise exception 'Exact reviewed active source required';end if;
 select * into n from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number and context_policy='automatic_offer_v12';
 if found then
  if n.branch_id<>c.branch_id or n.version_id<>c.version_id or n.config_hash<>c.config_hash or n.enabled then raise exception 'Existing candidate differs';end if;
  return n.id;
 end if;
 n:=c;n.id:=gen_random_uuid();n.version:=(select max(version)+1 from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number);
 n.enabled:=false;n.context_policy:='automatic_offer_v12';n.context_policy_hash:='20790adc5e07a5e8c0f2fe92377ae7ee43963db0b7e3db97506cf4e0386d1265';
 n.context_approval_reference:='Owner requested buyer scenario fixes and private acquisition pricing/spread on October 9, 2026. Revised buyer-only runtime instructions; exact existing provider role-slot prompt.';
 n.approved_at:=now();n.created_at:=now();n.approval_reference:=n.context_approval_reference||' Zero traffic candidate. Activation requires passed 28 buyer and 2 seller simulations and compatible READY application.';
 insert into icash_recorded_reception_private.configs select n.*;
 return n.id;
end $$;
revoke all on function public.icash_stage_buyer_scenario_policy(uuid) from public,anon,authenticated;
grant execute on function public.icash_stage_buyer_scenario_policy(uuid) to service_role;
commit;
