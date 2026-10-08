-- Add a reviewed seller proposal script; legacy policy hashes remain valid.
begin;
alter table icash_recorded_reception_private.configs drop constraint configs_context_policy_check;
alter table icash_recorded_reception_private.configs drop constraint configs_context_binding_check;
alter table icash_recorded_reception_private.configs add constraint configs_context_policy_check check(context_policy in ('message_only','property_intake_v1','buyer_seller_v1','seller_offer_v2'));
alter table icash_recorded_reception_private.configs add constraint configs_context_binding_check check(context_policy='message_only' or (
 length(btrim(context_approval_reference)) between 10 and 500 and context_policy_hash is not null and (
 (context_policy='property_intake_v1' and context_policy_hash='44fe91fa860afe2a83d897ffa647c2d42661fb2cdcdc0c0630da24218ee79e60') or
 (context_policy='buyer_seller_v1' and context_policy_hash='06b4040c9d2b788ac204479d1179173f9acbd59172a7e930bac0b189438fde57') or
 (context_policy='seller_offer_v2' and context_policy_hash='27968fe7a67beb299600ac7cc31b825d6d3f42cf4a8a7f54b53b8c4467e88b78'))));
CREATE OR REPLACE FUNCTION public.icash_recorded_reception_property_context(p_id uuid, p_nonce_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r icash_recorded_reception_private.sessions;matches jsonb;opportunity jsonb;focus_thread uuid;history jsonb;offer_source jsonb;checked_at timestamptz:=icash_recorded_reception_private.clock_now();
begin
 select s.* into r from icash_recorded_reception_private.sessions s
 join icash_recorded_reception_private.configs c on c.id=s.config_id
 join public.icash_accounts a on a.id=s.account_id and a.owner_user_id=c.owner_user_id
 join public.icash_operation_spend o on o.operation_key=s.operation_key and o.account_id=s.account_id
 where s.id=p_id and s.nonce_hash=p_nonce_hash and s.state='recording' and coalesce(s.consent_at,s.recording_authorized_at) is not null and s.recording_sid is not null
 and s.register_claimed_at is null and s.conversation_id is null and s.end_requested_at is null and s.call_ended_at is null
 and s.from_phone ~ '^\+[1-9][0-9]{7,14}$' and s.call_deadline_at>checked_at
 and c.enabled and not a.bot_paused and c.approved_at<=checked_at and c.reviewed_until>checked_at
 and o.state='dispatched' and o.rate_id=s.rate_id and o.charge_cap_cents=s.charge_cap_cents
 and ((c.context_policy='buyer_seller_v1' and c.context_policy_hash='06b4040c9d2b788ac204479d1179173f9acbd59172a7e930bac0b189438fde57') or (c.context_policy='seller_offer_v2' and c.context_policy_hash='27968fe7a67beb299600ac7cc31b825d6d3f42cf4a8a7f54b53b8c4467e88b78'))
 and length(btrim(c.context_approval_reference))>=10;
 if not found then return public.icash_recorded_reception_context_before_buyer(p_id,p_nonce_hash);end if;
 if exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(r.from_phone,'UTF8')),'hex'))
 or exists(select 1 from public.icash_text_suppressions where phone=r.from_phone) then return null;end if;
 -- Carry the exact, unexpired SMS property focus into the same account's return call.
 -- A different property's outbound message invalidates this focus in the SMS engine.
 select case when count(*)=1 then min(f.thread_id::text)::uuid end into focus_thread
 from public.icash_sms_conversation_focus f
 join public.icash_sms_routes route on route.sender=f.sender and route.recipient=f.recipient and route.account_id=f.account_id and route.revision=f.route_revision and not route.needs_review
 join public.icash_text_threads t on t.id=f.thread_id and t.account_id=f.account_id and t.sender=f.sender and t.recipient=f.recipient
 where f.account_id=r.account_id and f.recipient=r.from_phone and f.expires_at>checked_at and t.retired_at is null and t.party='seller' and not t.paused and not t.manual_only
 and not exists(select 1 from public.icash_text_threads other where other.account_id=r.account_id and other.recipient=r.from_phone and other.retired_at is null and other.party<>'seller');
 -- Caller ID permits public opportunity context only. Never seller identity,
 -- agreements, messages, account data, payment instructions or authentication.
 select jsonb_agg(to_jsonb(candidate)) into matches from (
  select distinct d.id,t.id thread_id,t.party,d.terms->>'address' address,
   (not t.paused and not t.manual_only and not exists(select 1 from public.icash_property_controls pc where pc.account_id=d.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual)) active
  from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id
  where t.account_id=r.account_id and t.recipient=r.from_phone and t.retired_at is null and (focus_thread is null or t.id=focus_thread)
  and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
  and exists(select 1 from public.icash_text_messages m where m.account_id=r.account_id and m.thread_id=t.id and m.direction='outgoing' and m.state in ('accepted','delivered') and m.provider_id is not null and m.created_at between checked_at-interval '30 days' and checked_at)
  limit 2
 ) candidate;
 if coalesce(jsonb_array_length(matches),0)=0 then return null;end if;
 if jsonb_array_length(matches)<>1 then return jsonb_build_object('status','ambiguous');end if;
 if (matches->0->>'active')::boolean is not true or length(btrim(matches->0->>'address')) not between 1 and 300 then return null;end if;
 if matches->0->>'party'='buyer' then
  opportunity:=public.icash_buyer_package_data(r.account_id,(matches->0->>'id')::uuid);
  if opportunity is null then return null;end if;
  return jsonb_build_object('status','buyer','address',opportunity->'address','purchasePriceCents',opportunity->'purchasePriceCents','assignmentFeeCents',opportunity->'assignmentFeeCents','askingPriceCents',opportunity->'askingPriceCents','buyerPaysClosingCosts',true);
 end if;
 if matches->0->>'party'='seller' then
  select jsonb_agg(m order by m->>'at',m->>'id') into history from (
   select jsonb_build_object('id',m.id,'direction',m.direction,'body',left(m.body,1000),'at',m.created_at) m
   from public.icash_text_messages m where m.account_id=r.account_id and m.thread_id=(matches->0->>'thread_id')::uuid
    and m.created_at between checked_at-interval '30 days' and checked_at
    and ((m.direction='incoming' and m.state='received') or (m.direction='outgoing' and m.state in ('accepted','delivered') and m.provider_id is not null))
   order by m.created_at desc,m.id desc limit 12
  ) recent;
  if r.configuration->>'context_policy'='seller_offer_v2' then
   -- Service-only underwriting source. The application recalculates eligibility
   -- and emits a strict public proposal allowlist, never this raw snapshot.
   select jsonb_build_object('dealStage',d.stage,'screeningSnapshot',sc.snapshot,'agreementPending',
    exists(select 1 from public.icash_signing_envelopes e where e.account_id=r.account_id and e.deal_id=d.id and e.kind='purchase' and e.state in ('awaiting_counterparty','completed')))
   into offer_source from public.icash_deal_files d join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id
   where d.id=(matches->0->>'id')::uuid and d.account_id=r.account_id and sc.state='complete' and d.terms->>'address'=matches->0->>'address'
    and coalesce(d.terms->>'practice','false')<>'true';
  end if;
  return jsonb_build_object('status','matched','address',matches->0->>'address','smsContext',jsonb_build_object('threadId',matches->0->>'thread_id','messages',coalesce(history,'[]'::jsonb)))||coalesce(offer_source,'{}'::jsonb);
 end if;
 return null;
end $function$;
create function public.icash_claim_seller_offer_branch(p_source uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from icash_recorded_reception_private.configs where id=p_source and enabled and entry_policy='direct_recorded_v1' and context_policy='buyer_seller_v1' and call_profile='normal' and called_number='+17816093521' and reviewed_until>now()+interval '15 minutes') then return false;end if;
 insert into icash_recorded_reception_private.direct_branch_attempts(source_config_id) values(p_source) on conflict do nothing;
 return found;
end $$;
revoke all on function public.icash_claim_seller_offer_branch(uuid) from public,anon,authenticated;
grant execute on function public.icash_claim_seller_offer_branch(uuid) to service_role;
-- This deployment hook can only stage a disabled clone of the currently reviewed
-- reception configuration. It cannot enable a call, raise limits or alter routing.
create function public.icash_stage_seller_offer_reception(p_source uuid,p_branch text,p_version text,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c icash_recorded_reception_private.configs;n icash_recorded_reception_private.configs;prior icash_recorded_reception_private.configs;
begin
 perform pg_advisory_xact_lock(hashtext('direct-recorded-reception-v1'));
 select * into c from icash_recorded_reception_private.configs where id=p_source and call_profile='normal' for share;
 if not found or not c.enabled or (c.entry_policy<>'direct_recorded_v1' or c.context_policy<>'buyer_seller_v1') or c.reviewed_until<=now()+interval '15 minutes'
  or c.called_number<>'+17816093521' or p_branch=c.branch_id or coalesce(p_branch,'') !~ '^agtbrch_[A-Za-z0-9]+$'
  or coalesce(p_version,'') !~ '^agtvrsn_[A-Za-z0-9]+$' or coalesce(p_hash,'') !~ '^[a-f0-9]{64}$' then return null;end if;
 if not exists(select 1 from icash_recorded_reception_private.carrier_estimate_policies where cost_policy_id=c.cost_policy_id) then raise exception 'Carrier settlement configuration required';end if;
 select * into prior from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number and context_policy='seller_offer_v2' order by version desc limit 1;
 if found then
  if row(prior.branch_id,prior.version_id,prior.config_hash) is distinct from row(p_branch,p_version,p_hash) then raise exception 'Direct script candidate changed';end if;
  return icash_recorded_reception_private.config_json(prior);
 end if;
 n:=c;n.id:=gen_random_uuid();n.version:=(select max(version)+1 from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number);
 n.enabled:=false;n.entry_policy:='direct_recorded_v1';n.context_policy:='seller_offer_v2';n.context_policy_hash:='27968fe7a67beb299600ac7cc31b825d6d3f42cf4a8a7f54b53b8c4467e88b78';n.context_approval_reference:='Owner requested seller qualification, motivation, condition and timing confirmation, then an as-is cash proposal using current calculated price on October 7, 2026 at 11:30 PM America/Chicago.';n.branch_id:=p_branch;n.version_id:=p_version;n.config_hash:=p_hash;
 n.created_at:=now();n.approved_at:=now();n.approval_reference:='Owner requested seller qualification and calculated cash offer on October 7, 2026 at 11:30 PM America/Chicago. Direct recorded entry retained. Provider script read back by deployment.';
 insert into icash_recorded_reception_private.configs select n.*;
 return icash_recorded_reception_private.config_json(n);
end $$;
revoke all on function public.icash_stage_seller_offer_reception(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_stage_seller_offer_reception(uuid,text,text,text) to service_role;

commit;
