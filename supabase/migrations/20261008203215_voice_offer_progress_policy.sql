begin;
-- Preserve older reviewed calls while staging the requested payoff and response flow.
do $policy$
declare definition text;old_definition text;name text;
begin
 foreach name in array array['configs_context_policy_check','configs_context_binding_check'] loop
  select regexp_replace(pg_get_constraintdef(oid),'^CHECK ','') into definition from pg_constraint where conrelid='icash_recorded_reception_private.configs'::regclass and conname=name;
  if definition is null or position('automatic_offer_v7' in definition)=0 then raise exception 'Current context constraints required';end if;
  execute format('alter table icash_recorded_reception_private.configs drop constraint %I',name);
  execute format('alter table icash_recorded_reception_private.configs add constraint %I check ((%s) or (context_policy=''automatic_offer_v8'' and context_policy_hash=''a8c62cf741cc0124067ba62e104f854fd29f37027ac699a38ec34f222e27a175'' and length(btrim(context_approval_reference)) between 10 and 500 and agreement_tool_id is not null and agreement_tool_id<>stop_tool_id))',name,definition);
 end loop;
 foreach name in array array['icash_reception_context_before_agreement(uuid,text)','icash_reception_context_before_payoff(uuid,text)','icash_seller_agreement_recording(text)','icash_seller_agreement_call_context(text,text)'] loop
  old_definition:=pg_get_functiondef(('public.'||name)::regprocedure);
  definition:=replace(old_definition,'''seller_agreement_v3'',''seller_agreement_v4'',''automatic_offer_v5'',''automatic_offer_v6'',''automatic_offer_v7''','''seller_agreement_v3'',''seller_agreement_v4'',''automatic_offer_v5'',''automatic_offer_v6'',''automatic_offer_v7'',''automatic_offer_v8''');
  definition:=replace(definition,'(c.context_policy=''automatic_offer_v7'' and c.context_policy_hash=''1ad640490c33ff5294e6bd728ed6f382af7909756256d9bac78a965032ae742b'')','((c.context_policy=''automatic_offer_v7'' and c.context_policy_hash=''1ad640490c33ff5294e6bd728ed6f382af7909756256d9bac78a965032ae742b'') or (c.context_policy=''automatic_offer_v8'' and c.context_policy_hash=''a8c62cf741cc0124067ba62e104f854fd29f37027ac699a38ec34f222e27a175''))');
  if definition=old_definition then raise exception 'Expected version binding missing: %',name;end if;
  execute definition;
 end loop;
end $policy$;

create function public.icash_stage_offer_continuity_rollout(p_source uuid,p_tool text,p_branch text,p_version text,p_hash text,p_outbound_review jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c icash_recorded_reception_private.configs;n icash_recorded_reception_private.configs;rollout icash_seller_agreement_private.rollouts;
begin
 select * into c from icash_recorded_reception_private.configs where id=p_source and enabled and context_policy='automatic_offer_v7' and context_policy_hash='1ad640490c33ff5294e6bd728ed6f382af7909756256d9bac78a965032ae742b' and entry_policy='direct_recorded_v1' for share;
 if not found or c.reviewed_until<=now()+interval '15 minutes' then return null;end if;
 insert into icash_seller_agreement_private.rollouts(source_config_id) values(c.id) on conflict do nothing;
 select * into rollout from icash_seller_agreement_private.rollouts where source_config_id=c.id for update;
 if rollout.inbound_config_id is not null then return jsonb_build_object('inboundConfigId',rollout.inbound_config_id,'outboundReview',rollout.outbound_review);end if;
 if coalesce(p_tool,'') !~ '^tool_[A-Za-z0-9]+$' or p_tool is distinct from c.agreement_tool_id or coalesce(p_branch,'') !~ '^agtbrch_[A-Za-z0-9]+$' or p_branch=c.branch_id or coalesce(p_version,'') !~ '^agtvrsn_[A-Za-z0-9]+$' or coalesce(p_hash,'') !~ '^[a-f0-9]{64}$'
  or p_outbound_review->>'contractToolId' is distinct from p_tool or p_outbound_review->>'offerPolicy' is distinct from 'automatic_offer_v8' or p_outbound_review->>'agentId' is distinct from 'agent_6701m406qmqjf1kr6ykw71vksjns' or p_outbound_review->>'maxTotalSeconds' is distinct from '600' or p_outbound_review->>'approvedHoldCents' is distinct from '977' then raise exception 'Exact staged provider review required';end if;
 n:=c;n.id:=gen_random_uuid();n.version:=(select max(version)+1 from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number);
 n.enabled:=false;n.context_policy:='automatic_offer_v8';n.context_policy_hash:='a8c62cf741cc0124067ba62e104f854fd29f37027ac699a38ec34f222e27a175';n.agreement_tool_id:=p_tool;n.branch_id:=p_branch;n.version_id:=p_version;n.config_hash:=p_hash;
 n.context_approval_reference:='Owner requested working offer lookup, no repeated qualification loops and exclusion of agent-listed properties on October 8, 2026.';
 n.created_at:=now();n.approved_at:=now();n.approval_reference:=n.context_approval_reference||' Exact provider branches and price validation independently checked; no calls or messages sent by this rollout.';
 insert into icash_recorded_reception_private.configs select n.*;
 update icash_seller_agreement_private.rollouts set tool_id=p_tool,inbound_config_id=n.id,outbound_review=p_outbound_review where source_config_id=c.id;
 return jsonb_build_object('inboundConfigId',n.id,'outboundReview',p_outbound_review);
end $$;
revoke all on function public.icash_stage_offer_continuity_rollout(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_stage_offer_continuity_rollout(uuid,text,text,text,text,jsonb) to service_role;
commit;
