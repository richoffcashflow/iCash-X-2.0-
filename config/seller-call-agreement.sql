begin;
create schema icash_seller_agreement_private;
revoke all on schema icash_seller_agreement_private from public,anon,authenticated;
create table icash_seller_agreement_private.inbound_bindings(
 session_id uuid primary key references icash_recorded_reception_private.sessions(id),
 account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),
 thread_id uuid not null references public.icash_text_threads(id),created_at timestamptz not null default now()
);
create table icash_seller_agreement_private.confirmations(
 id uuid primary key default gen_random_uuid(),call_key text not null unique,
 account_id uuid not null references public.icash_accounts(id),deal_id uuid not null references public.icash_deal_files(id),
 confirmation jsonb not null,terms jsonb not null,envelope_id uuid references public.icash_signing_envelopes(id),
 state text not null default 'preparing' check(state in ('preparing','ready','needs_review')),
 created_at timestamptz not null default now()
);
create table icash_seller_agreement_private.rollouts(
 source_config_id uuid primary key references icash_recorded_reception_private.configs(id),
 tool_id text,inbound_config_id uuid references icash_recorded_reception_private.configs(id),outbound_review jsonb,
 claimed_at timestamptz not null default now()
);
alter table icash_seller_agreement_private.inbound_bindings enable row level security;
alter table icash_seller_agreement_private.confirmations enable row level security;
alter table icash_seller_agreement_private.rollouts enable row level security;
revoke all on all tables in schema icash_seller_agreement_private from public,anon,authenticated,service_role;
create trigger seller_agreement_binding_immutable before update or delete on icash_seller_agreement_private.inbound_bindings for each row execute function icash_recorded_reception_private.immutable();
create trigger seller_agreement_binding_no_truncate before truncate on icash_seller_agreement_private.inbound_bindings for each statement execute function icash_recorded_reception_private.immutable();

alter table icash_recorded_reception_private.configs add column agreement_tool_id text check(agreement_tool_id is null or agreement_tool_id ~ '^tool_[A-Za-z0-9]+$');
alter table icash_recorded_reception_private.configs drop constraint configs_context_policy_check;
alter table icash_recorded_reception_private.configs drop constraint configs_context_binding_check;
alter table icash_recorded_reception_private.configs add constraint configs_context_policy_check check(context_policy in ('message_only','property_intake_v1','buyer_seller_v1','seller_offer_v2','seller_agreement_v3'));
alter table icash_recorded_reception_private.configs add constraint configs_context_binding_check check(context_policy='message_only' or (
 length(btrim(context_approval_reference)) between 10 and 500 and context_policy_hash is not null and (
 (context_policy='property_intake_v1' and context_policy_hash='44fe91fa860afe2a83d897ffa647c2d42661fb2cdcdc0c0630da24218ee79e60') or
 (context_policy='buyer_seller_v1' and context_policy_hash='06b4040c9d2b788ac204479d1179173f9acbd59172a7e930bac0b189438fde57') or
 (context_policy='seller_offer_v2' and context_policy_hash='27968fe7a67beb299600ac7cc31b825d6d3f42cf4a8a7f54b53b8c4467e88b78') or
 (context_policy='seller_agreement_v3' and context_policy_hash='b2f3791d6af9a3468684a65dd25427a8168dd604f4b1a0b28a7ee4ef5b06e1e8' and agreement_tool_id is not null and agreement_tool_id<>stop_tool_id))));
-- Extend the exact current property resolver, retaining name/focus/role checks.
do $context$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_recorded_reception_property_context(uuid,text)'::regprocedure);
 needle:='(c.context_policy=''seller_offer_v2'' and c.context_policy_hash=''27968fe7a67beb299600ac7cc31b825d6d3f42cf4a8a7f54b53b8c4467e88b78'')';
 if position(needle in definition)=0 or position('icash_recorded_reception_private.return_call_focus' in definition)=0 then raise exception 'Current named property resolver required';end if;
 definition:=replace(definition,needle,'('||needle||' or (c.context_policy=''seller_agreement_v3'' and c.context_policy_hash=''b2f3791d6af9a3468684a65dd25427a8168dd604f4b1a0b28a7ee4ef5b06e1e8''))');
 needle:='r.configuration->>''context_policy''=''seller_offer_v2''';
 if position(needle in definition)=0 then raise exception 'Current proposal resolver required';end if;
 execute replace(definition,needle,'r.configuration->>''context_policy'' in (''seller_offer_v2'',''seller_agreement_v3'')');
end $context$;
alter function public.icash_recorded_reception_property_context(uuid,text) rename to icash_reception_context_before_agreement;
create function public.icash_recorded_reception_property_context(p_id uuid,p_nonce_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;r icash_recorded_reception_private.sessions;t public.icash_text_threads;d public.icash_deal_files;b icash_seller_agreement_private.inbound_bindings;
begin
 context:=public.icash_reception_context_before_agreement(p_id,p_nonce_hash);
 select * into r from icash_recorded_reception_private.sessions where id=p_id and nonce_hash=p_nonce_hash;
 if not found or r.configuration->>'context_policy'<>'seller_agreement_v3' or context->>'status' is distinct from 'matched' then return context;end if;
 select * into t from public.icash_text_threads where id=(context#>>'{smsContext,threadId}')::uuid and account_id=r.account_id and recipient=r.from_phone and party='seller' and not paused and not manual_only and retired_at is null;
 if not found then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=r.account_id and terms->>'address'=context->>'address';
 if not found then return null;end if;
 insert into icash_seller_agreement_private.inbound_bindings(session_id,account_id,deal_id,thread_id) values(r.id,r.account_id,d.id,t.id) on conflict do nothing;
 select * into b from icash_seller_agreement_private.inbound_bindings where session_id=r.id;
 if row(b.account_id,b.deal_id,b.thread_id) is distinct from row(r.account_id,d.id,t.id) then return null;end if;
 return context||jsonb_build_object('purchaseTerms',jsonb_build_object('earnestCents',d.terms->'earnestCents','inspectionDays',coalesce(d.terms->'inspectionDays','10'::jsonb),'closingDate',coalesce(d.terms->>'closingDate',''),'escrowAgent',coalesce(d.terms->>'escrowAgent',''),'legalDescriptionAvailable',coalesce(length(d.terms->>'legalDescription'),0)>0 or exists(select 1 from public.icash_screening_jobs s where s.id=d.screening_id and s.account_id=r.account_id and coalesce(length(s.result#>>'{property,legalDescription}'),0)>0)),
 'pendingAgreement',(select jsonb_build_object('priceCents',e.terms->'priceCents','closingDate',e.terms->>'closingDate') from public.icash_signing_envelopes e where e.account_id=r.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='awaiting_counterparty' and e.terms=d.terms limit 1));
end $$;

create function public.icash_seller_agreement_recording(p_hash text) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(s) from icash_recorded_reception_private.sessions s join icash_recorded_reception_private.configs c on c.id=s.config_id
 where p_hash ~ '^[a-f0-9]{64}$' and s.stop_token_hash=p_hash and s.state='recording' and s.recording_sid is not null and s.recording_authorized_at is not null
 and s.register_claimed_at is not null and s.end_requested_at is null and s.call_ended_at is null and s.call_deadline_at>now()
 and c.enabled and c.context_policy='seller_agreement_v3' and c.reviewed_until>now();
$$;
create function public.icash_seller_agreement_call_context(p_hash text,p_conversation text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare matches jsonb;
begin
 if coalesce(p_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_conversation,'') !~ '^conv_[A-Za-z0-9]+$' then return null;end if;
 with calls as (
  select 'inbound:'||s.id::text call_key,s.account_id,b.deal_id,t.id thread_id,t.recipient phone
  from icash_recorded_reception_private.sessions s join icash_recorded_reception_private.configs c on c.id=s.config_id
  join icash_seller_agreement_private.inbound_bindings b on b.session_id=s.id and b.account_id=s.account_id
  join public.icash_text_threads t on t.id=b.thread_id and t.deal_id=b.deal_id and t.account_id=b.account_id and t.recipient=s.from_phone
  where s.stop_token_hash=p_hash and s.conversation_id=p_conversation and s.state='recording' and s.recording_authorized_at is not null and s.recording_sid is not null
   and s.end_requested_at is null and s.call_ended_at is null and s.call_deadline_at>now() and c.enabled and c.context_policy='seller_agreement_v3' and c.reviewed_until>now()
  union all
  select 'outbound:'||c.id::text,c.account_id,d.id,t.id,t.recipient
  from public.icash_live_conversations c join public.icash_deal_files d on d.account_id=c.account_id and d.screening_id=c.screening_id
  join public.icash_text_threads t on t.account_id=c.account_id and t.deal_id=d.id and encode(sha256(convert_to(t.recipient,'UTF8')),'hex')=c.contact_key
  where c.tool_token_hash=p_hash and c.conversation_id=p_conversation and c.tool_expires_at>now() and c.state='waiting' and c.party='seller'
 )
 select jsonb_agg(jsonb_build_object('callKey',c.call_key,'accountId',c.account_id,'ownerUserId',a.owner_user_id,'ownerEmail',u.email,'dealId',d.id,'screeningId',d.screening_id,'phone',c.phone)) into matches
 from calls c join public.icash_accounts a on a.id=c.account_id and not a.bot_paused
 join auth.users u on u.id=a.owner_user_id and u.email is not null and u.email_confirmed_at is not null
 join public.icash_deal_files d on d.id=c.deal_id and d.account_id=c.account_id
 join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id
 join public.icash_text_threads t on t.id=c.thread_id and t.account_id=c.account_id and t.party='seller'
 where d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
 and t.retired_at is null and not t.paused and not t.manual_only and public.icash_membership_work_allowed(c.account_id)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=c.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual)
 and not exists(select 1 from public.icash_text_suppressions where phone=c.phone)
 and not exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(c.phone,'UTF8')),'hex'));
 if coalesce(jsonb_array_length(matches),0)<>1 then return null;end if;
 return matches->0;
end $$;

create function public.icash_claim_seller_agreement(p_hash text,p_conversation text,p_confirmation jsonb,p_expected_terms jsonb,p_terms jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb;d public.icash_deal_files;prior icash_seller_agreement_private.confirmations;e public.icash_signing_envelopes;new_id uuid;
begin
 c:=public.icash_seller_agreement_call_context(p_hash,p_conversation);if c is null then return null;end if;
 select * into d from public.icash_deal_files where id=(c->>'dealId')::uuid and account_id=(c->>'accountId')::uuid for update;
 select * into prior from icash_seller_agreement_private.confirmations where call_key=c->>'callKey';
 if found then
  if prior.confirmation is distinct from p_confirmation then return null;end if;
  return jsonb_build_object('id',prior.id,'claimed',false,'envelopeId',prior.envelope_id);
 end if;
 if d.stage<>'draft' or d.terms is distinct from p_expected_terms or jsonb_typeof(p_confirmation)<>'object' or jsonb_typeof(p_terms)<>'object'
  or p_confirmation->'soleOwner' is distinct from 'true'::jsonb or p_confirmation->'allDecisionMakersAgree' is distinct from 'true'::jsonb
  or p_confirmation->'priceAndDateConfirmed' is distinct from 'true'::jsonb or p_confirmation->'termsConfirmed' is distinct from 'true'::jsonb
  or p_confirmation->'sendTextRequested' is distinct from 'true'::jsonb or p_confirmation->'materialFactsChanged' is distinct from 'false'::jsonb
  or coalesce(p_confirmation->>'inspectionAccess','') not in ('yes','no')
  or p_terms->'priceCents' is distinct from p_confirmation->'agreedPriceCents' or p_terms->>'seller' is distinct from p_confirmation->>'sellerLegalName'
  or p_terms->>'closingDate' is distinct from p_confirmation->>'closingDate'
  or row(p_terms->'address',p_terms->'buyer',p_terms->'state') is distinct from row(d.terms->'address',d.terms->'buyer',d.terms->'state') then return null;end if;
 select * into e from public.icash_signing_envelopes where account_id=d.account_id and deal_id=d.id and kind='purchase' and not test_mode;
 if found then
  if e.state<>'awaiting_counterparty' or e.terms is distinct from p_terms or jsonb_array_length(e.recipients)<>2 or e.recipients->0->>'phone' is distinct from c->>'phone' then return null;end if;
 else
  update public.icash_deal_files set terms=p_terms,updated_at=now() where id=d.id;
 end if;
 insert into icash_seller_agreement_private.confirmations(call_key,account_id,deal_id,confirmation,terms,envelope_id,state)
 values(c->>'callKey',d.account_id,d.id,p_confirmation,p_terms,e.id,case when e.id is null then 'preparing' else 'ready' end) returning id into new_id;
 return jsonb_build_object('id',new_id,'claimed',true,'envelopeId',e.id);
end $$;
create function public.icash_finish_seller_agreement(p_id uuid,p_account uuid,p_envelope uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update icash_seller_agreement_private.confirmations c set envelope_id=e.id,state='ready' from public.icash_signing_envelopes e
 where c.id=p_id and c.account_id=p_account and c.state='preparing' and e.id=p_envelope and e.account_id=c.account_id and e.deal_id=c.deal_id
 and e.kind='purchase' and e.state='awaiting_counterparty' and not e.test_mode and e.provider_id is not null and e.terms=c.terms;
 return found;
end $$;
create function public.icash_fail_seller_agreement(p_id uuid,p_account uuid) returns void language sql security definer set search_path='' as $$
 update icash_seller_agreement_private.confirmations set state='needs_review' where id=p_id and account_id=p_account and state='preparing';
$$;

create function public.icash_claim_seller_agreement_rollout(p_source uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from icash_recorded_reception_private.configs where id=p_source and enabled and entry_policy='direct_recorded_v1' and context_policy='seller_offer_v2' and call_profile='normal' and called_number='+17816093521' and reviewed_until>now()+interval '15 minutes') then return false;end if;
 insert into icash_seller_agreement_private.rollouts(source_config_id) values(p_source) on conflict do nothing;return found;
end $$;
create function public.icash_stage_seller_agreement_rollout(p_source uuid,p_tool text,p_branch text,p_version text,p_hash text,p_outbound_review jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c icash_recorded_reception_private.configs;n icash_recorded_reception_private.configs;rollout icash_seller_agreement_private.rollouts;
begin
 select * into c from icash_recorded_reception_private.configs where id=p_source and enabled and context_policy='seller_offer_v2' and entry_policy='direct_recorded_v1' and called_number='+17816093521' for share;
 if not found or c.reviewed_until<=now()+interval '15 minutes' then return null;end if;
 select * into rollout from icash_seller_agreement_private.rollouts where source_config_id=c.id for update;if not found then return null;end if;
 if rollout.inbound_config_id is not null then return jsonb_build_object('inboundConfigId',rollout.inbound_config_id,'outboundReview',rollout.outbound_review);end if;
 if coalesce(p_tool,'') !~ '^tool_[A-Za-z0-9]+$' or p_tool=c.stop_tool_id or coalesce(p_branch,'') !~ '^agtbrch_[A-Za-z0-9]+$' or p_branch=c.branch_id or coalesce(p_version,'') !~ '^agtvrsn_[A-Za-z0-9]+$' or coalesce(p_hash,'') !~ '^[a-f0-9]{64}$'
  or p_outbound_review->>'contractToolId' is distinct from p_tool or p_outbound_review->>'agentId' is distinct from 'agent_6701m406qmqjf1kr6ykw71vksjns'
  or p_outbound_review->>'maxTotalSeconds' is distinct from '600' or p_outbound_review->>'approvedHoldCents' is distinct from '977' then raise exception 'Bound staged provider configuration required';end if;
 n:=c;n.id:=gen_random_uuid();n.version:=(select max(version)+1 from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number);
 n.enabled:=false;n.context_policy:='seller_agreement_v3';n.context_policy_hash:='b2f3791d6af9a3468684a65dd25427a8168dd604f4b1a0b28a7ee4ef5b06e1e8';n.agreement_tool_id:=p_tool;n.branch_id:=p_branch;n.version_id:=p_version;n.config_hash:=p_hash;
 n.context_approval_reference:='Owner requested confirmed closing date, all decision makers, optional inspection visit and contract text/signature verification during the call on October 8, 2026, 12:20 AM America/Chicago.';
 n.created_at:=now();n.approved_at:=now();n.approval_reference:=n.context_approval_reference||' Existing financial limits and direct recorded entry retained. Provider branch and tool read back by deployment.';
 insert into icash_recorded_reception_private.configs select n.*;
 update icash_seller_agreement_private.rollouts set tool_id=p_tool,inbound_config_id=n.id,outbound_review=p_outbound_review where source_config_id=c.id;
 return jsonb_build_object('inboundConfigId',n.id,'outboundReview',p_outbound_review);
end $$;
revoke all on function public.icash_recorded_reception_property_context(uuid,text),public.icash_reception_context_before_agreement(uuid,text),public.icash_seller_agreement_recording(text),public.icash_seller_agreement_call_context(text,text),public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb),public.icash_finish_seller_agreement(uuid,uuid,uuid),public.icash_fail_seller_agreement(uuid,uuid),public.icash_claim_seller_agreement_rollout(uuid),public.icash_stage_seller_agreement_rollout(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_recorded_reception_property_context(uuid,text),public.icash_seller_agreement_recording(text),public.icash_seller_agreement_call_context(text,text),public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb),public.icash_finish_seller_agreement(uuid,uuid,uuid),public.icash_fail_seller_agreement(uuid,uuid),public.icash_claim_seller_agreement_rollout(uuid),public.icash_stage_seller_agreement_rollout(uuid,text,text,text,text,jsonb) to service_role;
commit;
