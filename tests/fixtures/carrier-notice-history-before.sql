-- Exact scoped current receipt-bound history/route readers; no account data.
CREATE OR REPLACE FUNCTION public.icash_inbound_property_context(p_call_sid text, p_conversation text, p_binding_hash text, p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare c public.icash_live_conversations;matches jsonb;address text;bound_thread uuid;first_name text;
begin
 if p_call_sid is null or p_call_sid !~ '^CA[a-fA-F0-9]{32}$'
 or p_conversation is null or p_conversation !~ '^conv_[A-Za-z0-9]+$' or length(p_conversation)>100
 or p_binding_hash is null or p_binding_hash !~ '^[a-f0-9]{64}$'
 or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then return null;end if;

 -- The server's durable receipt supplies the tenant/property binding. This RPC
 -- accepts neither caller-provided account IDs nor caller-provided property IDs.
 select live.* into c
 from public.icash_inbound_voice_receipts r
 join public.icash_live_conversations live on live.id=r.live_call_id and live.conversation_id=r.conversation_id
 join public.icash_accounts a on a.id=live.account_id and not a.bot_paused
 join public.icash_screening_jobs s on s.id=live.screening_id and s.account_id=live.account_id
 join public.icash_operation_spend o on o.operation_key=live.operation_key and o.account_id=live.account_id and o.state='dispatched'
 join public.icash_operation_rates rate on rate.id=o.rate_id and rate.operation='incoming_call'
 where r.call_sid=p_call_sid and r.conversation_id=p_conversation and r.binding_hash=p_binding_hash
  and live.operation_key='inbound:'||p_call_sid and live.state='waiting' and live.party='seller'
  and live.tool_token_hash=p_token_hash and live.tool_expires_at>now()
  and exists(select 1 from public.icash_voice_configs cfg where cfg.account_id=live.account_id
   and cfg.agent_id=live.agent_id and cfg.enabled and cfg.reviewed_until>now())
  and not exists(select 1 from public.icash_contact_suppressions cs where cs.contact_key=live.contact_key)
  and not exists(select 1 from public.icash_property_controls ctrl where ctrl.account_id=live.account_id
   and ctrl.property_id=s.snapshot->>'propertyId' and ctrl.manual);
 if not found then return null;end if;

 -- Keep the admitted party/contact/deal/account binding exact. Never search a
 -- caller's other properties or choose another tenant when a binding disappears.
 select jsonb_agg(to_jsonb(candidate)) into matches from (
  select distinct d.id as deal_id,t.id as thread_id,d.terms->>'address' as address
  from public.icash_deal_files d
  join public.icash_voice_contact_targets p on p.account_id=d.account_id and p.screening_id=d.screening_id
  join public.icash_text_threads t on t.account_id=d.account_id and t.deal_id=d.id and t.party=p.party and t.recipient=p.phone and not t.paused
  where d.account_id=c.account_id and d.screening_id=c.screening_id
   and p.party=c.party and p.contact_key=c.contact_key and p.revoked_at is null and p.permission_until>now()
   and not exists(select 1 from public.icash_text_suppressions suppressed where suppressed.phone=p.phone)
   and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
   and jsonb_typeof(d.terms->'address')='string'
  limit 2
 ) candidate;
 if coalesce(jsonb_array_length(matches),0)=0 then return null;end if;
 if jsonb_array_length(matches)<>1 then return jsonb_build_object('status','ambiguous');end if;
 address:=btrim(matches->0->>'address');
 if length(address) not between 1 and 300 then return null;end if;
 bound_thread:=(matches->0->>'thread_id')::uuid;
 -- A record-owner name is not the person on the phone. Only a received self-
 -- introduction after a real outbound message supports a first-name greeting.
 select introduced.name into first_name from (
  select m.created_at,m.id,substring(m.body from '^(?:[Hh]i[, ]+|[Hh]ello[, ]+)?(?:[Tt]his is|[Mm]y name is|I''m|I am) ([A-Z][a-z]{1,24})(?:[.!]?(?:[[:space:]]|$))') as name
  from (select m.id,m.created_at,m.body from public.icash_text_messages m
   where m.account_id=c.account_id and m.thread_id=bound_thread and m.direction='incoming' and m.state='received'
    and m.created_at between now()-interval '30 days' and now()
    and exists(select 1 from public.icash_text_messages sent where sent.account_id=c.account_id and sent.thread_id=m.thread_id
     and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.created_at>=now()-interval '30 days' and sent.created_at<=m.created_at)
   order by m.created_at desc,m.id desc limit 12) m
 ) introduced where introduced.name is not null and lower(introduced.name) not in ('interested','owner','selling','ready','not','yes','no') order by introduced.created_at desc,introduced.id desc limit 1;
 return jsonb_strip_nulls(jsonb_build_object('status','matched','address',address,'returningName',first_name));
end $function$

;
CREATE OR REPLACE FUNCTION public.icash_reception_property_context(p_call_sid text, p_nonce text, p_contact_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r icash_reception_private.receipts;matches jsonb;address text;bound_thread uuid;first_name text;
 checked_at timestamptz:=clock_timestamp();
begin
 if p_call_sid is null or p_call_sid !~ '^CA[a-fA-F0-9]{32}$'
  or p_nonce is null or p_nonce !~ '^[a-f0-9]{64}$'
  or p_contact_key is null or p_contact_key !~ '^[a-f0-9]{64}$' then return null;end if;
 -- SECURITY DEFINER is required only because service_role cannot read reception's
 -- private receipts/config. EXECUTE is revoked from every public client below.
 -- No caller-supplied account or deal ID participates in the lookup.
 select receipt.* into r from icash_reception_private.receipts receipt
 join icash_reception_private.config c on c.id=1 and c.account_id=receipt.account_id
 join public.icash_accounts a on a.id=c.account_id and a.owner_user_id=c.owner_user_id
 join public.icash_operation_spend o on o.operation_key=receipt.operation_key and o.account_id=receipt.account_id
  and o.rate_id=receipt.rate_id and o.state='dispatched' and o.charge_cap_cents=receipt.customer_charge_cap_cents
 where receipt.call_sid=p_call_sid and receipt.receipt_nonce=p_nonce and receipt.state='reserved'
  and receipt.operation_key='reception:'||p_call_sid and receipt.conversation_id is null
  and receipt.reserved_at<=checked_at and receipt.reserved_at+make_interval(secs=>receipt.max_duration_seconds+120)>checked_at
  and receipt.config_hash=c.config_hash and receipt.agent_id=c.agent_id and receipt.called_number=c.called_number
  and receipt.branch_id=c.branch_id and receipt.reviewed_version_id=c.reviewed_version_id
  and receipt.call_profile=c.call_profile and receipt.rate_id=c.rate_id
  and receipt.max_duration_seconds=c.max_duration_seconds and receipt.customer_charge_cap_cents=c.customer_charge_cap_cents
  and c.enabled and c.reviewed_until>checked_at and c.approved_at<=checked_at
  and (not a.bot_paused or (c.allow_inbound_while_paused and c.inbound_pause_approval_reference is not null))
  and c.context_policy='property_intake_v1'
  and c.context_policy_hash='44fe91fa860afe2a83d897ffa647c2d42661fb2cdcdc0c0630da24218ee79e60'
  and length(btrim(c.context_approval_reference))>=10;
 if not found then return null;end if;
 if exists(select 1 from public.icash_contact_suppressions s where s.contact_key=p_contact_key) then return null;end if;

 -- The trusted signed-webhook handler computes SHA256(from), never from an LLM
 -- or client account selector. Reception's HMAC caller hash is a separate throttle
 -- key, not proof of identity. A match permits only a property/name confirmation.
 -- Count every matching live-deal invitation before permission filtering; revoked
 -- or expired alternatives must not make an otherwise ambiguous match look unique.
 select jsonb_agg(to_jsonb(candidate)) into matches from (
  select distinct d.id as deal_id,t.id as thread_id,p.party,
   case when jsonb_typeof(d.terms->'address')='string' then d.terms->>'address' end as address,
   (p.revoked_at is null and p.permission_until>now() and not t.paused
    and not exists(select 1 from public.icash_property_controls ctrl where ctrl.account_id=d.account_id
     and ctrl.property_id=s.snapshot->>'propertyId' and ctrl.manual)) as permission_current
  from public.icash_voice_contact_targets p
  join public.icash_deal_files d on d.account_id=p.account_id and d.screening_id=p.screening_id
  join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
  join public.icash_text_threads t on t.account_id=d.account_id and t.deal_id=d.id and t.party=p.party and t.recipient=p.phone
  where p.account_id=r.account_id and p.contact_key=p_contact_key
   and p.contact_key=encode(sha256(convert_to(p.phone,'UTF8')),'hex')
   and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
   and not exists(select 1 from public.icash_text_suppressions s where s.phone=p.phone)
   and exists(select 1 from public.icash_text_messages sent where sent.account_id=p.account_id and sent.thread_id=t.id
    and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.created_at between now()-interval '30 days' and now())
  limit 2
 ) candidate;
 if coalesce(jsonb_array_length(matches),0)=0 then return null;end if;
 if jsonb_array_length(matches)<>1 then return jsonb_build_object('status','ambiguous');end if;
 if (matches->0->>'permission_current')::boolean is not true or matches->0->>'party'<>'seller' then return null;end if;
 address:=btrim(matches->0->>'address');
 if address is null or length(address) not between 1 and 300 then return null;end if;
 bound_thread:=(matches->0->>'thread_id')::uuid;
 select introduced.name into first_name from (
  select m.created_at,m.id,substring(m.body from '^(?:[Hh]i[, ]+|[Hh]ello[, ]+)?(?:[Tt]his is|[Mm]y name is|I''m|I am) ([A-Z][a-z]{1,24})(?:[.!]?(?:[[:space:]]|$))') as name
  from (select m.id,m.created_at,m.body from public.icash_text_messages m
   where m.account_id=r.account_id and m.thread_id=bound_thread and m.direction='incoming' and m.state='received'
    and m.created_at between now()-interval '30 days' and now()
    and exists(select 1 from public.icash_text_messages sent where sent.account_id=r.account_id and sent.thread_id=m.thread_id
     and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.created_at>=now()-interval '30 days' and sent.created_at<=m.created_at)
   order by m.created_at desc,m.id desc limit 12) m
 ) introduced where introduced.name is not null and lower(introduced.name) not in ('interested','owner','selling','ready','not','yes','no') order by introduced.created_at desc,introduced.id desc limit 1;
 return jsonb_strip_nulls(jsonb_build_object('status','matched','address',address,'returningName',first_name));
end $function$

;
CREATE OR REPLACE FUNCTION public.icash_recorded_reception_context_before_buyer(p_id uuid, p_nonce_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r icash_recorded_reception_private.sessions;matches jsonb;address text;bound_thread uuid;first_name text;
 p_contact_key text;checked_at timestamptz:=icash_recorded_reception_private.clock_now();
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
  and c.context_policy='property_intake_v1' and c.context_policy_hash='44fe91fa860afe2a83d897ffa647c2d42661fb2cdcdc0c0630da24218ee79e60'
  and length(btrim(c.context_approval_reference))>=10;
 if not found then return null;end if;
 p_contact_key:=encode(sha256(convert_to(r.from_phone,'UTF8')),'hex');
 if exists(select 1 from public.icash_contact_suppressions s where s.contact_key=p_contact_key) then return null;end if;

 -- The trusted signed-webhook handler computes SHA256(from), never from an LLM
 -- or client account selector. Reception's HMAC caller hash is a separate throttle
 -- key, not proof of identity. A match permits only a property/name confirmation.
 -- Count every matching live-deal invitation before permission filtering; revoked
 -- or expired alternatives must not make an otherwise ambiguous match look unique.
 select jsonb_agg(to_jsonb(candidate)) into matches from (
  select distinct d.id as deal_id,t.id as thread_id,p.party,
   case when jsonb_typeof(d.terms->'address')='string' then d.terms->>'address' end as address,
   (p.revoked_at is null and p.permission_until>now() and not t.paused
    and not exists(select 1 from public.icash_property_controls ctrl where ctrl.account_id=d.account_id
     and ctrl.property_id=s.snapshot->>'propertyId' and ctrl.manual)) as permission_current
  from public.icash_contact_permissions p
  join public.icash_deal_files d on d.account_id=p.account_id and d.screening_id=p.screening_id
  join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
  join public.icash_text_threads t on t.account_id=d.account_id and t.deal_id=d.id and t.party=p.party and t.recipient=p.phone
  where p.account_id=r.account_id and p.contact_key=p_contact_key
   and p.contact_key=encode(sha256(convert_to(p.phone,'UTF8')),'hex')
   and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
   and not exists(select 1 from public.icash_text_suppressions s where s.phone=p.phone)
   and exists(select 1 from public.icash_text_messages sent where sent.account_id=p.account_id and sent.thread_id=t.id
    and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.created_at between now()-interval '30 days' and now())
  limit 2
 ) candidate;
 if coalesce(jsonb_array_length(matches),0)=0 then return null;end if;
 if jsonb_array_length(matches)<>1 then return jsonb_build_object('status','ambiguous');end if;
 if (matches->0->>'permission_current')::boolean is not true or matches->0->>'party'<>'seller' then return null;end if;
 address:=btrim(matches->0->>'address');
 if address is null or length(address) not between 1 and 300 then return null;end if;
 bound_thread:=(matches->0->>'thread_id')::uuid;
 select introduced.name into first_name from (
  select m.created_at,m.id,substring(m.body from '^(?:[Hh]i[, ]+|[Hh]ello[, ]+)?(?:[Tt]his is|[Mm]y name is|I''m|I am) ([A-Z][a-z]{1,24})(?:[.!]?(?:[[:space:]]|$))') as name
  from (select m.id,m.created_at,m.body from public.icash_text_messages m
   where m.account_id=r.account_id and m.thread_id=bound_thread and m.direction='incoming' and m.state='received'
    and m.created_at between now()-interval '30 days' and now()
    and exists(select 1 from public.icash_text_messages sent where sent.account_id=r.account_id and sent.thread_id=m.thread_id
     and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.created_at>=now()-interval '30 days' and sent.created_at<=m.created_at)
   order by m.created_at desc,m.id desc limit 12) m
 ) introduced where introduced.name is not null and lower(introduced.name) not in ('interested','owner','selling','ready','not','yes','no') order by introduced.created_at desc,introduced.id desc limit 1;
 return jsonb_strip_nulls(jsonb_build_object('status','matched','address',address,'returningName',first_name));
end $function$

;
CREATE OR REPLACE FUNCTION public.icash_reception_context_before_agreement(p_id uuid, p_nonce_hash text)
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
 and c.enabled and not a.bot_paused and icash_callback_private.config_current(c) and icash_callback_private.session_current(s) and c.approved_at<=checked_at and c.reviewed_until>checked_at
 and o.state='dispatched' and o.rate_id=s.rate_id and o.charge_cap_cents=s.charge_cap_cents
 and ((c.context_policy='buyer_seller_v1' and c.context_policy_hash='06b4040c9d2b788ac204479d1179173f9acbd59172a7e930bac0b189438fde57') or ((c.context_policy='seller_offer_v2' and c.context_policy_hash='27968fe7a67beb299600ac7cc31b825d6d3f42cf4a8a7f54b53b8c4467e88b78') or ((c.context_policy='seller_agreement_v3' and c.context_policy_hash='b2f3791d6af9a3468684a65dd25427a8168dd604f4b1a0b28a7ee4ef5b06e1e8') or ((c.context_policy='seller_agreement_v4' and c.context_policy_hash='1ac0106b84426cd4aa75f30ac6f09bc68350733b47eed82d67db8d6460e9fafb') or ((c.context_policy='automatic_offer_v5' and c.context_policy_hash='1fca2735e85b914b8c934985834def9bd6e698eba33bae7d8d9262067bdea734') or ((c.context_policy='automatic_offer_v6' and c.context_policy_hash='9d85859a38887d32e5c91912bf897d23ff3cc78c26dc83de22599686b1deee96') or ((c.context_policy='automatic_offer_v7' and c.context_policy_hash='1ad640490c33ff5294e6bd728ed6f382af7909756256d9bac78a965032ae742b') or ((c.context_policy='automatic_offer_v8' and c.context_policy_hash='a33e3b4c1cdd1588cb16a6c1f53f804bc3b683dbee7152b23902020237cceff7') or ((((((((((c.context_policy='automatic_offer_v9' and c.context_policy_hash='24d43197289eb72d06d4d93fb4a1d3e0c0a6ef88f17b57664854e68674e2b3bf') or (c.context_policy='automatic_offer_v18' and c.context_policy_hash='12d7a6692b907e8bf125fce7b3afbeac549404eb7a1915e6c02001a5b36ac4e6')) or (c.context_policy='automatic_offer_v17' and c.context_policy_hash='b3f477756bc851a6a8dd1ff1962146d68b95f72a1e0544b132a2037e9504feb5')) or (c.context_policy='automatic_offer_v16' and c.context_policy_hash='58678e5c229ad2b6cc41be0fccb8ec01f0fc4c95b55f5e98b42a3a82e2fdb496')) or (c.context_policy='automatic_offer_v15' and c.context_policy_hash='80f89bf2ffaefcf31ed47f6f6db2e7f3b0b775108704b28fadb59ce892024420')) or (c.context_policy='automatic_offer_v14' and c.context_policy_hash='d8a18734f3b5adeafccffdf4095189ddf76e78a565a100dfe199a56a841d891b')) or (c.context_policy='automatic_offer_v13' and c.context_policy_hash='6fbbe513d434227c54d2b9eff0561d5739bca233dd69e87ca8fd489b057db803')) or (c.context_policy='automatic_offer_v12' and c.context_policy_hash='20790adc5e07a5e8c0f2fe92377ae7ee43963db0b7e3db97506cf4e0386d1265')) or (c.context_policy='automatic_offer_v11' and c.context_policy_hash='2f40ffd420387c93f6fe66fd9093285a657a928f429d71ad177637840932fc8a')) or (c.context_policy='automatic_offer_v10' and c.context_policy_hash='2f9344e113b73ea2fe1103ecd8b349c0ac49ba1792f6684ec4312bb0865d5a2d'))))))))))
 and length(btrim(c.context_approval_reference))>=10;
 if not found then return public.icash_recorded_reception_context_before_buyer(p_id,p_nonce_hash);end if;
 if exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(r.from_phone,'UTF8')),'hex'))
 or exists(select 1 from public.icash_text_suppressions where phone=r.from_phone) then return null;end if;
 -- Return calls remember the bound conversation after the SMS reply window.

 if r.callback_route->>'status'='ambiguous' then return jsonb_build_object('status','ambiguous');end if;
 if r.callback_route->>'source'='call' then return icash_callback_private.call_context(r);end if;
 if r.callback_route->>'status'='matched' then focus_thread:=(r.callback_route->>'threadId')::uuid;
 else focus_thread:=icash_recorded_reception_private.return_call_focus(r.account_id,r.from_phone,checked_at);end if;
 -- Caller ID permits public opportunity context only. Never seller identity,
 -- agreements, messages, account data, payment instructions or authentication.
 select jsonb_agg(to_jsonb(candidate)) into matches from (
  select distinct d.id,t.id thread_id,t.party,d.terms->>'address' address,
   (not t.paused and not t.manual_only and not exists(select 1 from public.icash_property_controls pc where pc.account_id=d.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual)) active
  from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id
  where t.account_id=r.account_id and t.recipient=r.from_phone and t.retired_at is null and (focus_thread is null or t.id=focus_thread) and (t.id=focus_thread or not exists(select 1 from public.icash_owner_buyer_tests x where x.thread_id=t.id))
  and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
  and ((r.callback_route->>'status'='matched' and t.id=(r.callback_route->>'threadId')::uuid) or exists(select 1 from public.icash_text_messages m where m.account_id=r.account_id and m.thread_id=t.id and m.direction='outgoing' and m.state in ('accepted','delivered') and m.provider_id is not null and m.created_at between checked_at-interval '30 days' and checked_at))
  limit 2
 ) candidate;
 if coalesce(jsonb_array_length(matches),0)=0 then return null;end if;
 if jsonb_array_length(matches)<>1 then return jsonb_build_object('status','ambiguous');end if;
 if (matches->0->>'active')::boolean is not true or length(btrim(matches->0->>'address')) not between 1 and 300 then return null;end if;
 if matches->0->>'party'='buyer' then
  opportunity:=public.icash_buyer_package_data(r.account_id,(matches->0->>'id')::uuid);
  if opportunity is null then return null;end if;
  return jsonb_build_object('status','buyer','returningName',icash_recorded_reception_private.contact_first_name(r.account_id,(matches->0->>'id')::uuid,'buyer',r.from_phone),'address',opportunity->'address','purchasePriceCents',opportunity->'purchasePriceCents','assignmentFeeCents',opportunity->'assignmentFeeCents','askingPriceCents',opportunity->'askingPriceCents','buyerPaysClosingCosts',true);
 end if;
 if matches->0->>'party'='seller' then
  select jsonb_agg(m order by m->>'at',m->>'id') into history from (
   select jsonb_build_object('id',m.id,'direction',m.direction,'body',left(m.body,1000),'at',m.created_at) m
   from public.icash_text_messages m where m.account_id=r.account_id and m.thread_id=(matches->0->>'thread_id')::uuid
    and m.created_at between checked_at-interval '30 days' and checked_at
    and ((m.direction='incoming' and m.state='received') or (m.direction='outgoing' and m.state in ('accepted','delivered') and m.provider_id is not null))
   order by m.created_at desc,m.id desc limit 12
  ) recent;
  if r.configuration->>'context_policy' in ('seller_offer_v2','seller_agreement_v3','seller_agreement_v4','automatic_offer_v5','automatic_offer_v6','automatic_offer_v7','automatic_offer_v8','automatic_offer_v9','automatic_offer_v10','automatic_offer_v11','automatic_offer_v12','automatic_offer_v13','automatic_offer_v14','automatic_offer_v15','automatic_offer_v16','automatic_offer_v17','automatic_offer_v18') then
   -- Service-only underwriting source. The application recalculates eligibility
   -- and emits a strict public proposal allowlist, never this raw snapshot.
   select jsonb_build_object('dealStage',d.stage,'screeningSnapshot',sc.snapshot,'agreementPending',
    exists(select 1 from public.icash_signing_envelopes e where e.account_id=r.account_id and e.deal_id=d.id and e.kind='purchase' and e.state in ('awaiting_counterparty','completed')))
   into offer_source from public.icash_deal_files d join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id
   where d.id=(matches->0->>'id')::uuid and d.account_id=r.account_id and sc.state='complete' and d.terms->>'address'=matches->0->>'address'
    and coalesce(d.terms->>'practice','false')<>'true';
  end if;
  return jsonb_build_object('status','matched','returningName',icash_recorded_reception_private.contact_first_name(r.account_id,(matches->0->>'id')::uuid,'seller',r.from_phone),'address',matches->0->>'address','smsContext',jsonb_build_object('threadId',matches->0->>'thread_id','messages',coalesce(history,'[]'::jsonb)))||coalesce(offer_source,'{}'::jsonb);
 end if;
 return null;
end $function$

;
CREATE OR REPLACE FUNCTION public.icash_sms_route_review_items(p_account uuid, p_offset integer DEFAULT 0, p_limit integer DEFAULT 7)
 RETURNS TABLE(message_id uuid, recipient text, body text, attachments jsonb, created_at timestamp with time zone, revision bigint, needs_review boolean, candidates jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select q.message_id,q.recipient,m.body,m.attachments,q.created_at,r.revision,r.needs_review,
 coalesce((select jsonb_agg(jsonb_build_object('threadId',t.id,'screeningId',d.screening_id,'address',d.terms->>'address') order by t.id)
 from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 where t.id=any(q.candidate_threads) and t.account_id=p_account),'[]'::jsonb)
 from public.icash_sms_route_reviews q join public.icash_sms_routes r on r.sender=q.sender and r.recipient=q.recipient and r.account_id=q.account_id
 join public.icash_text_messages m on m.id=q.message_id and m.account_id=q.account_id and m.thread_id is null
 where q.account_id=p_account and q.resolved_at is null
 order by q.created_at,q.message_id limit least(greatest(p_limit,1),7) offset least(greatest(p_offset,0),60000)
$function$
;

CREATE OR REPLACE FUNCTION public.icash_attention_sources_before_journey(p_account uuid)
 RETURNS TABLE(kind text, category text, source_id uuid, source_version text, screening_id uuid, event_at timestamp with time zone, priority integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with source as (
  select 'text_attention'::text kind,'needs_you'::text category,t.id source_id,t.message_id::text source_version,t.screening_id,t.deal_id,t.updated_at event_at,3 priority
  from public.icash_text_attention t where t.account_id=p_account and t.state='open'
   and not (t.kind='callback' and exists(select 1 from public.icash_sms_call_requests c where c.account_id=t.account_id and c.message_id=t.message_id))
  union all
  select 'handoff','needs_you',h.id,'open',h.screening_id,null::uuid,h.created_at,3
  from public.icash_handoffs h where h.account_id=p_account and h.state='open'
  union all
  select 'sms_callback','callbacks',c.id,c.message_id::text,c.screening_id,c.deal_id,c.requested_at,2
  from public.icash_sms_call_requests c where c.account_id=p_account and c.state='needs_review'
  union all
  select 'live_callback','callbacks',c.id,c.state||':'||c.due_at::text,c.screening_id,null::uuid,c.due_at,2
  from public.icash_live_callbacks c where c.account_id=p_account and c.state in ('held_for_human','missed')
  union all
  select 'signature','signatures',e.id,'customer_signature_needed',d.screening_id,d.id,e.updated_at,1
  from public.icash_signing_envelopes e join public.icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id
  where e.account_id=p_account and e.state='customer_signature_needed' and not e.test_mode
  union all
  select 'title_review','closing',t.id,t.state||':'||coalesce(t.due_date::text,''),d.screening_id,d.id,t.updated_at,2
  from public.icash_title_tasks t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  where t.account_id=p_account and t.state='needs_review' and d.stage in ('under_contract','buyer_selected','title_open','closing')
  union all
  select 'closing_deadline','closing',t.id,t.state||':'||t.due_date::text,d.screening_id,d.id,t.due_date::timestamp at time zone 'America/Chicago',0
  from public.icash_title_tasks t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  where t.account_id=p_account and t.kind='deadline' and t.state='scheduled'
   and t.due_date<=(now() at time zone 'America/Chicago')::date+2
   and d.stage in ('under_contract','buyer_selected','title_open','closing')
 )
 select s.kind,s.category,s.source_id,s.source_version,s.screening_id,s.event_at,s.priority
 from source s join public.icash_screening_jobs p on p.id=s.screening_id and p.account_id=p_account and p.state='complete'
 where (s.deal_id is null or exists(select 1 from public.icash_deal_files d where d.id=s.deal_id and d.account_id=p_account and d.screening_id=s.screening_id and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')='false'))
 and not exists(select 1 from public.icash_deal_files d where d.screening_id=s.screening_id and d.account_id=p_account and (d.stage in ('closed','cancelled') or coalesce(d.terms->>'practice','false')<>'false'));
$function$
;

CREATE OR REPLACE FUNCTION public.icash_attention_sources(p_account uuid)
 RETURNS TABLE(kind text, category text, source_id uuid, source_version text, screening_id uuid, event_at timestamp with time zone, priority integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select * from public.icash_attention_sources_before_journey(p_account)
 union all select 'handoff','needs_you',h.id,'assigned:'||h.updated_at::text||case when h.due_at<now() then ':overdue' else '' end,h.screening_id,h.due_at,case when h.due_at<now() then 0 else 2 end
 from public.icash_handoffs h join public.icash_screening_jobs s on s.id=h.screening_id and s.account_id=h.account_id and s.state='complete'
 where h.account_id=p_account and h.state='acknowledged'
$function$
;

CREATE OR REPLACE FUNCTION public.icash_prioritized_work(p_account uuid, p_page integer DEFAULT 0)
 RETURNS TABLE(id uuid, state text, result jsonb, completed_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select s.id,s.state,s.result,s.completed_at from public.icash_screening_jobs s
 where s.account_id=p_account and s.state='complete' and p_page between 0 and 10000
 order by case
 when exists(select 1 from public.icash_text_attention a where a.account_id=p_account and a.screening_id=s.id and a.state='open') then 0
 when exists(select 1 from public.icash_handoffs h where h.account_id=p_account and h.screening_id=s.id and h.state<>'resolved')
 or exists(select 1 from public.icash_sms_call_requests r where r.account_id=p_account and r.screening_id=s.id and r.state='needs_review')
 or exists(select 1 from public.icash_deal_files d join public.icash_signing_envelopes e on e.deal_id=d.id and e.account_id=d.account_id where d.account_id=p_account and d.screening_id=s.id and e.state='customer_signature_needed' and not e.test_mode) then 0
 when exists(select 1 from public.icash_deal_files d where d.account_id=p_account and d.screening_id=s.id and d.stage in ('under_contract','buyer_selected','title_open','closing')) then 1
 when exists(select 1 from public.icash_live_callbacks b where b.account_id=p_account and b.screening_id=s.id and b.state in ('pending_dispatch_review','held_for_human','missed')) then 2
 when s.result->'financialCheck'->>'status'='eligible' then 3 else 4 end,
 s.completed_at desc,s.id limit 7 offset (greatest(0,least(10000,p_page))*6);
$function$
;
