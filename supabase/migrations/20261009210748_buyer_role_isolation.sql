begin;
set local lock_timeout='3s';
-- Add a separately reviewed inbound policy; retain every existing session hash.
do $policy$
declare definition text;before_definition text;name text;new_hash text:='2f40ffd420387c93f6fe66fd9093285a657a928f429d71ad177637840932fc8a';
begin
 foreach name in array array['configs_context_policy_check','configs_context_binding_check'] loop
  select regexp_replace(pg_get_constraintdef(oid),'^CHECK ','') into definition from pg_constraint where conrelid='icash_recorded_reception_private.configs'::regclass and conname=name;
  if definition is null or position('automatic_offer_v9' in definition)=0 then raise exception 'Current policy constraints required';end if;
  execute format('alter table icash_recorded_reception_private.configs drop constraint %I',name);
  execute format('alter table icash_recorded_reception_private.configs add constraint %I check ((%s) or (context_policy=''automatic_offer_v11'' and context_policy_hash=%L and length(btrim(context_approval_reference)) between 10 and 500 and agreement_tool_id is not null and agreement_tool_id<>stop_tool_id))',name,definition,new_hash);
 end loop;
 foreach name in array array['icash_reception_context_before_agreement(uuid,text)','icash_reception_context_before_payoff(uuid,text)','icash_seller_agreement_recording(text)','icash_seller_agreement_call_context(text,text)'] loop
  before_definition:=pg_get_functiondef(('public.'||name)::regprocedure);
  definition:=replace(before_definition,'''automatic_offer_v9'',''automatic_offer_v10'')','''automatic_offer_v9'',''automatic_offer_v10'',''automatic_offer_v11'')');
  definition:=replace(definition,'(c.context_policy=''automatic_offer_v9'' and c.context_policy_hash=''24d43197289eb72d06d4d93fb4a1d3e0c0a6ef88f17b57664854e68674e2b3bf'')','((c.context_policy=''automatic_offer_v9'' and c.context_policy_hash=''24d43197289eb72d06d4d93fb4a1d3e0c0a6ef88f17b57664854e68674e2b3bf'') or (c.context_policy=''automatic_offer_v11'' and c.context_policy_hash='||quote_literal(new_hash)||'))');
  if definition=before_definition then raise exception 'Expected current policy binding missing: %',name;end if;
  execute definition;
 end loop;
end $policy$;

create function public.icash_stage_buyer_role_policy(p_source uuid,p_branch text,p_version text,p_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c icash_recorded_reception_private.configs;n icash_recorded_reception_private.configs;
begin
 select * into c from icash_recorded_reception_private.configs where id=p_source and enabled and context_policy='automatic_offer_v9'
 and context_policy_hash='24d43197289eb72d06d4d93fb4a1d3e0c0a6ef88f17b57664854e68674e2b3bf' and entry_policy='direct_recorded_v1' for update;
 if not found or c.reviewed_until<=now()+interval '15 minutes' then raise exception 'Reviewed active source required';end if;
 if coalesce(p_branch,'') !~ '^agtbrch_[A-Za-z0-9]+$' or p_branch=c.branch_id or coalesce(p_version,'') !~ '^agtvrsn_[A-Za-z0-9]+$' or coalesce(p_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'Exact new branch review required';end if;
 select * into n from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number and context_policy='automatic_offer_v11';
 if found then
  if n.branch_id<>p_branch or n.version_id<>p_version or n.config_hash<>p_hash or n.enabled then raise exception 'Existing candidate differs';end if;
  return n.id;
 end if;
 n:=c;n.id:=gen_random_uuid();n.version:=(select max(version)+1 from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number);
 n.enabled:=false;n.context_policy:='automatic_offer_v11';n.context_policy_hash:='2f40ffd420387c93f6fe66fd9093285a657a928f429d71ad177637840932fc8a';
 n.branch_id:=p_branch;n.version_id:=p_version;n.config_hash:=p_hash;
 n.context_approval_reference:='Owner requested confident buyer calls, seller viewing follow-up and buyer-proposed local title companies on October 9, 2026.';
 n.approved_at:=now();n.created_at:=now();n.approval_reference:=n.context_approval_reference||' Isolated inbound branch; current outbound seller branch and existing calls unchanged. Activation requires passed provider tests and deployed application.';
 insert into icash_recorded_reception_private.configs select n.*;
 return n.id;
end $$;
revoke all on function public.icash_stage_buyer_role_policy(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_stage_buyer_role_policy(uuid,text,text,text) to service_role;
commit;
