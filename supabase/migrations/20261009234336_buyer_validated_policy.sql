begin;
set local lock_timeout='3s';
-- Add a separately reviewed inbound policy; retain every existing session hash.
do $policy$
declare definition text;before_definition text;name text;new_hash text:='b3f477756bc851a6a8dd1ff1962146d68b95f72a1e0544b132a2037e9504feb5';
begin
 foreach name in array array['configs_context_policy_check','configs_context_binding_check'] loop
  select regexp_replace(pg_get_constraintdef(oid),'^CHECK ','') into definition from pg_constraint where conrelid='icash_recorded_reception_private.configs'::regclass and conname=name;
  if definition is null or position('automatic_offer_v11' in definition)=0 then raise exception 'Current policy constraints required';end if;
  execute format('alter table icash_recorded_reception_private.configs drop constraint %I',name);
  execute format('alter table icash_recorded_reception_private.configs add constraint %I check ((%s) or (context_policy=''automatic_offer_v17'' and context_policy_hash=%L and length(btrim(context_approval_reference)) between 10 and 500 and agreement_tool_id is not null and agreement_tool_id<>stop_tool_id))',name,definition,new_hash);
 end loop;
 foreach name in array array['icash_reception_context_before_agreement(uuid,text)','icash_reception_context_before_payoff(uuid,text)','icash_seller_agreement_recording(text)','icash_seller_agreement_call_context(text,text)'] loop
  before_definition:=pg_get_functiondef(('public.'||name)::regprocedure);
  definition:=replace(before_definition,'''automatic_offer_v12'',''automatic_offer_v13'',''automatic_offer_v14'',''automatic_offer_v15'',''automatic_offer_v16'')','''automatic_offer_v12'',''automatic_offer_v13'',''automatic_offer_v14'',''automatic_offer_v15'',''automatic_offer_v16'',''automatic_offer_v17'')');
  definition:=replace(definition,'(c.context_policy=''automatic_offer_v9'' and c.context_policy_hash=''24d43197289eb72d06d4d93fb4a1d3e0c0a6ef88f17b57664854e68674e2b3bf'')','((c.context_policy=''automatic_offer_v9'' and c.context_policy_hash=''24d43197289eb72d06d4d93fb4a1d3e0c0a6ef88f17b57664854e68674e2b3bf'') or (c.context_policy=''automatic_offer_v17'' and c.context_policy_hash='||quote_literal(new_hash)||'))');
  if definition=before_definition then raise exception 'Expected current policy binding missing: %',name;end if;
  execute definition;
 end loop;
end $policy$;

-- The new provider branch uses the reviewed response model configuration.
-- The current provider branches and active database configuration are unchanged.
-- Stage with zero traffic; activation follows a passed provider audit and READY app.
create function public.icash_stage_buyer_validated_policy(p_source uuid,p_branch text,p_version text,p_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c icash_recorded_reception_private.configs;n icash_recorded_reception_private.configs;audit jsonb;
begin
 select result into audit from public.icash_integration_checks where provider='buyer_scenario_audit_20261009_v7';
 if audit->>'status' is distinct from 'failed' or audit->>'fixtureHash' is distinct from 'd122040ff176d09d208e77fafdc7c67f5c42024d0118ce5d76221feff1b988e0'
  or audit->>'code' is distinct from 'BUYER_SCENARIO_FAILURES_REQUIRE_FIX' or audit->>'count' is distinct from '30'
  or jsonb_array_length(audit->'tests') is distinct from 30 then raise exception 'Reviewed failed scenario audit required';end if;
 select * into c from icash_recorded_reception_private.configs where id=p_source and enabled and context_policy='automatic_offer_v11'
 and context_policy_hash='2f40ffd420387c93f6fe66fd9093285a657a928f429d71ad177637840932fc8a' and entry_policy='direct_recorded_v1' for update;
 if not found or c.reviewed_until<=now()+interval '15 minutes' or c.branch_id is distinct from audit->>'sourceBranchId' or c.version_id is distinct from audit->>'sourceVersion' or c.config_hash is distinct from audit->>'sourceConfigHash' then raise exception 'Exact reviewed active source required';end if;
 if coalesce(p_branch,'') !~ '^agtbrch_[A-Za-z0-9]+$' or p_branch=c.branch_id or coalesce(p_version,'') !~ '^agtvrsn_[A-Za-z0-9]+$' or coalesce(p_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'Exact new branch review required';end if;
 select * into n from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number and context_policy='automatic_offer_v17';
 if found then
  if n.branch_id<>p_branch or n.version_id<>p_version or n.config_hash<>p_hash or n.enabled then raise exception 'Existing candidate differs';end if;
  return n.id;
 end if;
 n:=c;n.id:=gen_random_uuid();n.version:=(select max(version)+1 from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number);
 n.enabled:=false;n.context_policy:='automatic_offer_v17';n.context_policy_hash:='b3f477756bc851a6a8dd1ff1962146d68b95f72a1e0544b132a2037e9504feb5';
 n.branch_id:=p_branch;n.version_id:=p_version;n.config_hash:=p_hash;
 n.context_approval_reference:='Owner requested buyer scenario fixes and private acquisition pricing/spread on October 9, 2026. Complete-response buyer opening validation and current-question checks; existing provider branches unchanged.';
 n.approved_at:=now();n.created_at:=now();n.approval_reference:=n.context_approval_reference||' Zero traffic candidate. Activation requires passed 28 buyer and 2 seller simulations and compatible READY application.';
 insert into icash_recorded_reception_private.configs select n.*;
 return n.id;
end $$;
revoke all on function public.icash_stage_buyer_validated_policy(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_stage_buyer_validated_policy(uuid,text,text,text) to service_role;
-- The existing bound RPC remains the authority. Only an exact v17 session
-- receives the new presentation mode; old sessions keep their existing result.
alter function public.icash_call_offer_context(text,text) rename to icash_call_context_before_buyer_validated;
create function public.icash_call_offer_context(p_hash text,p_conversation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare scope jsonb;
begin
 scope:=public.icash_call_context_before_buyer_validated(p_hash,p_conversation);
 if scope is null then return null;end if;
 if scope->>'party'='buyer' and exists(
  select 1 from icash_recorded_reception_private.sessions s
  join icash_recorded_reception_private.configs c on c.id=s.config_id and c.account_id=s.account_id
  where s.stop_token_hash=p_hash and s.conversation_id=p_conversation
   and c.context_policy='automatic_offer_v17' and c.context_policy_hash='b3f477756bc851a6a8dd1ff1962146d68b95f72a1e0544b132a2037e9504feb5'
 ) then return scope||jsonb_build_object('contextPolicy','automatic_offer_v17');end if;
 return scope;
end $$;
revoke all on function public.icash_call_offer_context(text,text),public.icash_call_context_before_buyer_validated(text,text) from public,anon,authenticated;
grant execute on function public.icash_call_offer_context(text,text),public.icash_call_context_before_buyer_validated(text,text) to service_role;
commit;
