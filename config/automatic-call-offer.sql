begin;
-- Version the new provider policy without invalidating in-flight v3/v4 calls.
do $policy$
declare definition text;name text;
begin
 foreach name in array array['configs_context_policy_check','configs_context_binding_check'] loop
  select regexp_replace(pg_get_constraintdef(oid),'^CHECK ','') into definition from pg_constraint where conrelid='icash_recorded_reception_private.configs'::regclass and conname=name;
  if definition is null then raise exception 'Current context constraints required';end if;
  execute format('alter table icash_recorded_reception_private.configs drop constraint %I',name);
  execute format('alter table icash_recorded_reception_private.configs add constraint %I check ((%s) or (context_policy=''automatic_offer_v5'' and context_policy_hash=''1fca2735e85b914b8c934985834def9bd6e698eba33bae7d8d9262067bdea734'' and length(btrim(context_approval_reference)) between 10 and 500 and agreement_tool_id is not null and agreement_tool_id<>stop_tool_id))',name,definition);
 end loop;
 foreach name in array array['icash_reception_context_before_agreement(uuid,text)','icash_recorded_reception_property_context(uuid,text)','icash_seller_agreement_recording(text)','icash_seller_agreement_call_context(text,text)'] loop
  definition:=pg_get_functiondef(('public.'||name)::regprocedure);
  definition:=replace(definition,'''seller_agreement_v3'',''seller_agreement_v4''','''seller_agreement_v3'',''seller_agreement_v4'',''automatic_offer_v5''');
  definition:=replace(definition,'(c.context_policy=''seller_agreement_v4'' and c.context_policy_hash=''1ac0106b84426cd4aa75f30ac6f09bc68350733b47eed82d67db8d6460e9fafb'')','((c.context_policy=''seller_agreement_v4'' and c.context_policy_hash=''1ac0106b84426cd4aa75f30ac6f09bc68350733b47eed82d67db8d6460e9fafb'') or (c.context_policy=''automatic_offer_v5'' and c.context_policy_hash=''1fca2735e85b914b8c934985834def9bd6e698eba33bae7d8d9262067bdea734''))');
  execute definition;
 end loop;
end $policy$;

create schema icash_call_offer_private;
revoke all on schema icash_call_offer_private from public,anon,authenticated;
create table icash_call_offer_private.offers(
 deal_id uuid primary key references public.icash_deal_files(id),account_id uuid not null references public.icash_accounts(id),
 version bigint not null default 1 check(version>0),state jsonb not null,snapshot jsonb not null,updated_at timestamptz not null default now()
);
create table icash_call_offer_private.events(
 id uuid primary key default gen_random_uuid(),deal_id uuid not null references public.icash_deal_files(id),account_id uuid not null references public.icash_accounts(id),
 call_key text not null,action text not null,state jsonb not null,created_at timestamptz not null default now()
);
alter table icash_call_offer_private.offers enable row level security;
alter table icash_call_offer_private.events enable row level security;
revoke all on all tables in schema icash_call_offer_private from public,anon,authenticated,service_role;
create function icash_call_offer_private.append_only() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Offer events are append only';end $$;
create trigger offer_events_append_only before update or delete on icash_call_offer_private.events for each row execute function icash_call_offer_private.append_only();
revoke all on function icash_call_offer_private.append_only() from public,anon,authenticated,service_role;

create function public.icash_call_offer_context(p_hash text,p_conversation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare scope jsonb;r icash_recorded_reception_private.sessions;context jsonb;buyer jsonb;d public.icash_deal_files;s public.icash_screening_jobs;o icash_call_offer_private.offers;
begin
 if coalesce(p_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_conversation,'') !~ '^conv_[A-Za-z0-9]+$' then return null;end if;
 scope:=public.icash_seller_agreement_call_context(p_hash,p_conversation);
 if scope is not null then
  select * into d from public.icash_deal_files where id=(scope->>'dealId')::uuid and account_id=(scope->>'accountId')::uuid;
  select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=d.account_id and state='complete';
  if not found or d.stage<>'draft' then return null;end if;
  select * into o from icash_call_offer_private.offers where deal_id=d.id and account_id=d.account_id;
  return scope||jsonb_build_object('party','seller','address',d.terms->>'address','snapshot',s.snapshot,'terms',d.terms,'offerState',o.state,'offerVersion',coalesce(o.version,0),
   'pendingAgreement',(select jsonb_build_object('priceCents',e.terms->'priceCents','closingDate',e.terms->>'closingDate') from public.icash_signing_envelopes e where e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='awaiting_counterparty' and e.terms=d.terms and exists(select 1 from jsonb_array_elements(e.recipients) recipient where recipient->>'phone'=scope->>'phone') limit 1));
 end if;
 select * into r from icash_recorded_reception_private.sessions where stop_token_hash=p_hash and conversation_id=p_conversation and state='recording' and call_ended_at is null and end_requested_at is null and call_deadline_at>now();
 if found then
  if public.icash_seller_agreement_recording(p_hash) is null then return null;end if;
  context:=public.icash_recorded_reception_property_context(r.id,r.nonce_hash);
  if context is null then return null;end if;
  if context->>'status'='buyer' then return jsonb_build_object('party','buyer','buyer',context);end if;
  return jsonb_build_object('party','unknown');
 end if;
 select public.icash_buyer_voice_context(j.permission_id) into buyer
 from public.icash_live_conversations c join public.icash_voice_jobs j on j.account_id=c.account_id and j.operation_key=c.operation_key
 join public.icash_accounts a on a.id=c.account_id and not a.bot_paused
 where c.tool_token_hash=p_hash and c.conversation_id=p_conversation and c.tool_expires_at>now() and c.state='waiting' and c.party='buyer'
 and public.icash_membership_work_allowed(c.account_id) and not exists(select 1 from public.icash_contact_suppressions blocked where blocked.contact_key=c.contact_key);
 if buyer is null then return null;end if;
 return jsonb_build_object('party','buyer','buyer',buyer);
end $$;

create function public.icash_save_call_offer(p_hash text,p_conversation text,p_expected_version bigint,p_expected_snapshot jsonb,p_state jsonb,p_action text) returns boolean
language plpgsql security definer set search_path='' as $$
declare scope jsonb;d public.icash_deal_files;s public.icash_screening_jobs;o icash_call_offer_private.offers;
begin
 scope:=public.icash_seller_agreement_call_context(p_hash,p_conversation);if scope is null then return false;end if;
 if p_expected_version is null or p_expected_version<0 or coalesce(p_action,'') not in ('get_offer','accept_offer','update_repairs','report_change') or jsonb_typeof(p_state) is distinct from 'object' or length(p_state::text)>5000 or coalesce(p_state->>'quoteRevision','') !~ '^[a-f0-9]{64}$' then return false;end if;
 select * into d from public.icash_deal_files where id=(scope->>'dealId')::uuid and account_id=(scope->>'accountId')::uuid and stage='draft' for update;
 if not found then return false;end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=d.account_id and state='complete' for share;
 if not found or s.snapshot is distinct from p_expected_snapshot then return false;end if;
 select * into o from icash_call_offer_private.offers where deal_id=d.id for update;
 if coalesce(o.version,0)<>p_expected_version then return false;end if;
 if p_action='accept_offer' and (coalesce(o.state->>'quotedPriceCents','') !~ '^[1-9][0-9]*$' or p_state->'acceptedPriceCents' is distinct from o.state->'quotedPriceCents' or p_state->>'quoteRevision' is distinct from o.state->>'quoteRevision') then return false;end if;
 if o.state is not distinct from p_state then return true;end if;
 insert into icash_call_offer_private.offers(deal_id,account_id,state,snapshot) values(d.id,d.account_id,p_state,p_expected_snapshot)
 on conflict(deal_id) do update set state=excluded.state,snapshot=excluded.snapshot,version=icash_call_offer_private.offers.version+1,updated_at=now();
 insert into icash_call_offer_private.events(deal_id,account_id,call_key,action,state) values(d.id,d.account_id,scope->>'callKey',p_action,p_state);
 return true;
end $$;

-- Serialize price acceptance and contract creation on the same deal lock.
-- Existing v3/v4 calls remain valid; any deal using the new ledger must match it.
alter function public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb) rename to icash_claim_seller_agreement_before_offer;
revoke all on function public.icash_claim_seller_agreement_before_offer(text,text,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.icash_claim_seller_agreement(p_hash text,p_conversation text,p_confirmation jsonb,p_expected_terms jsonb,p_terms jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare scope jsonb;d public.icash_deal_files;o icash_call_offer_private.offers;snapshot jsonb;
begin
 scope:=public.icash_seller_agreement_call_context(p_hash,p_conversation);if scope is null then return null;end if;
 select * into d from public.icash_deal_files where id=(scope->>'dealId')::uuid and account_id=(scope->>'accountId')::uuid for update;
 if not found then return null;end if;
 select * into o from icash_call_offer_private.offers where deal_id=d.id and account_id=d.account_id for share;
 if found then
  select s.snapshot into snapshot from public.icash_screening_jobs s where s.id=d.screening_id and s.account_id=d.account_id for share;
  if snapshot is distinct from o.snapshot or coalesce(o.state->>'acceptedPriceCents','') !~ '^[1-9][0-9]*$'
   or o.state->'acceptedPriceCents' is distinct from p_terms->'priceCents' or o.state->'quotedPriceCents' is distinct from p_terms->'priceCents'
   or o.state->'factsPending'='true'::jsonb or o.state->'conditionPending'='true'::jsonb or o.state->'agreementRevisionRequired'='true'::jsonb
   or o.state->'contractBlocked'='true'::jsonb or o.state->'acceptanceConditional'='true'::jsonb or o.state->'payoffPending'='true'::jsonb then return null;end if;
 end if;
 return public.icash_claim_seller_agreement_before_offer(p_hash,p_conversation,p_confirmation,p_expected_terms,p_terms);
end $$;
revoke all on function public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb) to service_role;

create function public.icash_stage_automatic_offer_rollout(p_source uuid,p_tool text,p_branch text,p_version text,p_hash text,p_outbound_review jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c icash_recorded_reception_private.configs;n icash_recorded_reception_private.configs;rollout icash_seller_agreement_private.rollouts;
begin
 select * into c from icash_recorded_reception_private.configs where id=p_source and enabled and context_policy='seller_agreement_v4' and entry_policy='direct_recorded_v1' for share;
 if not found or c.reviewed_until<=now()+interval '15 minutes' then return null;end if;
 insert into icash_seller_agreement_private.rollouts(source_config_id) values(c.id) on conflict do nothing;
 select * into rollout from icash_seller_agreement_private.rollouts where source_config_id=c.id for update;
 if rollout.inbound_config_id is not null then return jsonb_build_object('inboundConfigId',rollout.inbound_config_id,'outboundReview',rollout.outbound_review);end if;
 if coalesce(p_tool,'') !~ '^tool_[A-Za-z0-9]+$' or p_tool=c.stop_tool_id or coalesce(p_branch,'') !~ '^agtbrch_[A-Za-z0-9]+$' or p_branch=c.branch_id or coalesce(p_version,'') !~ '^agtvrsn_[A-Za-z0-9]+$' or coalesce(p_hash,'') !~ '^[a-f0-9]{64}$'
  or p_outbound_review->>'contractToolId' is distinct from p_tool or p_outbound_review->>'offerPolicy' is distinct from 'automatic_offer_v5' or p_outbound_review->>'maxTotalSeconds' is distinct from '600' or p_outbound_review->>'approvedHoldCents' is distinct from '977' then raise exception 'Exact staged provider review required';end if;
 n:=c;n.id:=gen_random_uuid();n.version:=(select max(version)+1 from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number);
 n.enabled:=false;n.context_policy:='automatic_offer_v5';n.context_policy_hash:='1fca2735e85b914b8c934985834def9bd6e698eba33bae7d8d9262067bdea734';n.agreement_tool_id:=p_tool;n.branch_id:=p_branch;n.version_id:=p_version;n.config_hash:=p_hash;
 n.context_approval_reference:='Owner requested automatic engine prices throughout the call and contract flow on October 8, 2026, 2:01 AM America/Chicago.';
 n.created_at:=now();n.approved_at:=now();n.approval_reference:=n.context_approval_reference||' Existing spending limits retained. Exact provider tool, branch and blocking price validator independently checked.';
 insert into icash_recorded_reception_private.configs select n.*;
 update icash_seller_agreement_private.rollouts set tool_id=p_tool,inbound_config_id=n.id,outbound_review=p_outbound_review where source_config_id=c.id;
 return jsonb_build_object('inboundConfigId',n.id,'outboundReview',p_outbound_review);
end $$;
revoke all on function public.icash_call_offer_context(text,text),public.icash_save_call_offer(text,text,bigint,jsonb,jsonb,text),public.icash_stage_automatic_offer_rollout(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_call_offer_context(text,text),public.icash_save_call_offer(text,text,bigint,jsonb,jsonb,text),public.icash_stage_automatic_offer_rollout(uuid,text,text,text,text,jsonb) to service_role;
commit;
