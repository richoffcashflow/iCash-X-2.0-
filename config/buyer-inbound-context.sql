begin;
alter table icash_recorded_reception_private.configs drop constraint configs_context_policy_check;
alter table icash_recorded_reception_private.configs drop constraint configs_check1;
alter table icash_recorded_reception_private.configs add constraint configs_context_policy_check check(context_policy in ('message_only','property_intake_v1','buyer_seller_v1'));
alter table icash_recorded_reception_private.configs add constraint configs_context_binding_check check(context_policy='message_only' or (
 length(btrim(context_approval_reference)) between 10 and 500 and context_policy_hash is not null and (
 (context_policy='property_intake_v1' and context_policy_hash='44fe91fa860afe2a83d897ffa647c2d42661fb2cdcdc0c0630da24218ee79e60') or
 (context_policy='buyer_seller_v1' and context_policy_hash='06b4040c9d2b788ac204479d1179173f9acbd59172a7e930bac0b189438fde57'))));
alter function public.icash_recorded_reception_property_context(uuid,text) rename to icash_recorded_reception_context_before_buyer;
create function public.icash_recorded_reception_property_context(p_id uuid,p_nonce_hash text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r icash_recorded_reception_private.sessions;matches jsonb;opportunity jsonb;checked_at timestamptz:=icash_recorded_reception_private.clock_now();
begin
 select s.* into r from icash_recorded_reception_private.sessions s
 join icash_recorded_reception_private.configs c on c.id=s.config_id
 join public.icash_accounts a on a.id=s.account_id and a.owner_user_id=c.owner_user_id
 join public.icash_operation_spend o on o.operation_key=s.operation_key and o.account_id=s.account_id
 where s.id=p_id and s.nonce_hash=p_nonce_hash and s.state='recording' and s.consent_at is not null and s.recording_sid is not null
 and s.register_claimed_at is null and s.conversation_id is null and s.end_requested_at is null and s.call_ended_at is null
 and s.from_phone ~ '^\+[1-9][0-9]{7,14}$' and s.call_deadline_at>checked_at
 and c.enabled and not a.bot_paused and c.approved_at<=checked_at and c.reviewed_until>checked_at
 and o.state='dispatched' and o.rate_id=s.rate_id and o.charge_cap_cents=s.charge_cap_cents
 and c.context_policy='buyer_seller_v1' and c.context_policy_hash='06b4040c9d2b788ac204479d1179173f9acbd59172a7e930bac0b189438fde57'
 and length(btrim(c.context_approval_reference))>=10;
 if not found then return public.icash_recorded_reception_context_before_buyer(p_id,p_nonce_hash);end if;
 if exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(r.from_phone,'UTF8')),'hex'))
 or exists(select 1 from public.icash_text_suppressions where phone=r.from_phone) then return null;end if;
 -- Caller ID permits public opportunity context only. Never seller identity,
 -- agreements, messages, account data, payment instructions or authentication.
 select jsonb_agg(to_jsonb(candidate)) into matches from (
  select distinct d.id,t.party,d.terms->>'address' address,
   (not t.paused and not exists(select 1 from public.icash_property_controls pc where pc.account_id=d.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual)) active
  from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id
  where t.account_id=r.account_id and t.recipient=r.from_phone and t.retired_at is null
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
 if matches->0->>'party'='seller' then return jsonb_build_object('status','matched','address',matches->0->>'address');end if;
 return null;
end $$;
revoke all on function public.icash_recorded_reception_property_context(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_recorded_reception_property_context(uuid,text) to service_role;
commit;
