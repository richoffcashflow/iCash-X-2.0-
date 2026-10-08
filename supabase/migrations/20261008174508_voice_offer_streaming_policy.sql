begin;
-- Keep v5 intact for existing sessions; stage the voice-safe v6 separately.
do $policy$
declare definition text;old_definition text;name text;
begin
 foreach name in array array['configs_context_policy_check','configs_context_binding_check'] loop
  select regexp_replace(pg_get_constraintdef(oid),'^CHECK ','') into definition from pg_constraint where conrelid='icash_recorded_reception_private.configs'::regclass and conname=name;
  if definition is null or position('automatic_offer_v5' in definition)=0 then raise exception 'Current context constraints required';end if;
  execute format('alter table icash_recorded_reception_private.configs drop constraint %I',name);
  execute format('alter table icash_recorded_reception_private.configs add constraint %I check ((%s) or (context_policy=''automatic_offer_v6'' and context_policy_hash=''9d85859a38887d32e5c91912bf897d23ff3cc78c26dc83de22599686b1deee96'' and length(btrim(context_approval_reference)) between 10 and 500 and agreement_tool_id is not null and agreement_tool_id<>stop_tool_id))',name,definition);
 end loop;
 foreach name in array array['icash_reception_context_before_agreement(uuid,text)','icash_recorded_reception_property_context(uuid,text)','icash_seller_agreement_recording(text)','icash_seller_agreement_call_context(text,text)'] loop
  old_definition:=pg_get_functiondef(('public.'||name)::regprocedure);
  definition:=replace(old_definition,'''seller_agreement_v3'',''seller_agreement_v4'',''automatic_offer_v5''','''seller_agreement_v3'',''seller_agreement_v4'',''automatic_offer_v5'',''automatic_offer_v6''');
  definition:=replace(definition,'(c.context_policy=''automatic_offer_v5'' and c.context_policy_hash=''1fca2735e85b914b8c934985834def9bd6e698eba33bae7d8d9262067bdea734'')','((c.context_policy=''automatic_offer_v5'' and c.context_policy_hash=''1fca2735e85b914b8c934985834def9bd6e698eba33bae7d8d9262067bdea734'') or (c.context_policy=''automatic_offer_v6'' and c.context_policy_hash=''9d85859a38887d32e5c91912bf897d23ff3cc78c26dc83de22599686b1deee96''))');
  if definition=old_definition then raise exception 'Expected version binding missing: %',name;end if;
  execute definition;
 end loop;
end $policy$;

create function public.icash_stage_voice_offer_rollout(p_source uuid,p_tool text,p_branch text,p_version text,p_hash text,p_outbound_review jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c icash_recorded_reception_private.configs;n icash_recorded_reception_private.configs;rollout icash_seller_agreement_private.rollouts;
begin
 select * into c from icash_recorded_reception_private.configs where id=p_source and enabled and context_policy='automatic_offer_v5' and context_policy_hash='1fca2735e85b914b8c934985834def9bd6e698eba33bae7d8d9262067bdea734' and entry_policy='direct_recorded_v1' for share;
 if not found or c.reviewed_until<=now()+interval '15 minutes' then return null;end if;
 insert into icash_seller_agreement_private.rollouts(source_config_id) values(c.id) on conflict do nothing;
 select * into rollout from icash_seller_agreement_private.rollouts where source_config_id=c.id for update;
 if rollout.inbound_config_id is not null then return jsonb_build_object('inboundConfigId',rollout.inbound_config_id,'outboundReview',rollout.outbound_review);end if;
 if coalesce(p_tool,'') !~ '^tool_[A-Za-z0-9]+$' or p_tool is distinct from c.agreement_tool_id or coalesce(p_branch,'') !~ '^agtbrch_[A-Za-z0-9]+$' or p_branch=c.branch_id or coalesce(p_version,'') !~ '^agtvrsn_[A-Za-z0-9]+$' or coalesce(p_hash,'') !~ '^[a-f0-9]{64}$'
  or p_outbound_review->>'contractToolId' is distinct from p_tool or p_outbound_review->>'offerPolicy' is distinct from 'automatic_offer_v6' or p_outbound_review->>'agentId' is distinct from 'agent_6701m406qmqjf1kr6ykw71vksjns' or p_outbound_review->>'maxTotalSeconds' is distinct from '600' or p_outbound_review->>'approvedHoldCents' is distinct from '977' then raise exception 'Exact staged provider review required';end if;
 n:=c;n.id:=gen_random_uuid();n.version:=(select max(version)+1 from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number);
 n.enabled:=false;n.context_policy:='automatic_offer_v6';n.context_policy_hash:='9d85859a38887d32e5c91912bf897d23ff3cc78c26dc83de22599686b1deee96';n.agreement_tool_id:=p_tool;n.branch_id:=p_branch;n.version_id:=p_version;n.config_hash:=p_hash;
 n.context_approval_reference:='Owner requested correcting repeated offer speech and premature hangup on October 8, 2026. Voice fragments retain exact tool-authorized price validation.';
 n.created_at:=now();n.approved_at:=now();n.approval_reference:=n.context_approval_reference||' Existing spending limits retained. Provider branches and price validation independently checked.';
 insert into icash_recorded_reception_private.configs select n.*;
 update icash_seller_agreement_private.rollouts set tool_id=p_tool,inbound_config_id=n.id,outbound_review=p_outbound_review where source_config_id=c.id;
 return jsonb_build_object('inboundConfigId',n.id,'outboundReview',p_outbound_review);
end $$;
revoke all on function public.icash_stage_voice_offer_rollout(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_stage_voice_offer_rollout(uuid,text,text,text,text,jsonb) to service_role;
commit;
