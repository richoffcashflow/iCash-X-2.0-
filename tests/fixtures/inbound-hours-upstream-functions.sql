-- Read-only production function snapshot before the inbound-hours change.
CREATE OR REPLACE FUNCTION public.icash_cancellation_voice_current(p_account uuid, p_operation text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.icash_voice_jobs j join public.icash_voice_contact_targets p on p.id=coalesce(j.permission_id,j.operational_contact_id) and p.account_id=j.account_id
 join public.icash_accounts a on a.id=j.account_id and not a.bot_paused
 join public.icash_voice_configs cfg on cfg.account_id=a.id and cfg.enabled and cfg.reviewed_until>now()
 where j.account_id=p_account and 'voice:'||j.id=p_operation and j.cancellation_notice_id is not null
 and public.icash_cancellation_voice_context(p_account,j.id) is not null and p.party='seller' and p.revoked_at is null and p.permission_until>now()
 and (public.icash_seller_voice_permission_current(p_account,p.id) or (p.dnc_clear and p.dnc_checked_at between now()-interval '30 days' and now()))
 and (j.operational_contact_id is null or public.icash_operational_contact_current(p_account,j.operational_contact_id,'voice',true))
 and exists(select 1 from pg_timezone_names where name=p.timezone)
 and extract(hour from now() at time zone p.timezone)>=greatest(9,p.local_start_hour)
 and extract(hour from now() at time zone p.timezone)<least(case when public.icash_seller_voice_permission_current(p_account,p.id) then 20 else 18 end,p.local_end_hour)
 and not exists(select 1 from public.icash_text_suppressions where phone=p.phone)
 and not exists(select 1 from public.icash_contact_suppressions where contact_key=p.contact_key));
$function$;

CREATE OR REPLACE FUNCTION public.icash_claim_text_before_ai(p_account uuid, p_message uuid, p_sender text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare m public.icash_text_messages;t public.icash_text_threads;r uuid;h integer;prop text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account;
 if t.id is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account for update;
 if not found or m.state<>'ready' or m.direction<>'outgoing' then return null;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account for update;
 if not found or (t.paused and not (public.icash_manual_handoff_reply(p_account,t.id) and not exists(select 1 from public.icash_text_ai_jobs where outgoing_id=p_message and account_id=p_account))) or t.sender<>p_sender or not public.icash_sms_thread_review_current(p_account,t.id,true) then return null;end if;
 if not exists(select 1 from public.icash_text_senders where phone=t.sender and enabled) then return null;end if;
 if exists(select 1 from public.icash_text_suppressions where phone=t.recipient) then return null;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;if not found then return null;end if;
 select s.snapshot->>'propertyId' into prop from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id where d.id=t.deal_id and d.account_id=p_account and d.stage not in ('cancelled','closed');
 if prop is null then return null;end if;
 h:=extract(hour from now() at time zone t.timezone);if (h<9 or h>=20) and not public.icash_seller_sms_inquiry_window(p_account,t.id) then return null;end if;
 -- Human-authored API sends; automated generation/queueing is not enabled by this RPC.
 if cardinality(m.asset_ids)>0 and (select count(*) from public.icash_text_assets where id=any(m.asset_ids) and account_id=p_account and deal_id=t.deal_id and verified_until>now())<>cardinality(m.asset_ids) then return null;end if;
 if cardinality(m.asset_ids)>0 and (select jsonb_agg(url order by id) from public.icash_text_assets where id=any(m.asset_ids)) is distinct from m.attachments then return null;end if;
 r:=case when cardinality(m.asset_ids)>0 then t.mms_rate_id else t.sms_rate_id end;
 if not exists(select 1 from public.icash_operation_rates where id=r and operation=case when cardinality(m.asset_ids)>0 then 'mms_send' else 'sms_send' end and enabled and expires_at>now()) then return null;end if;
 perform public.icash_reserve_operation(p_account,'text:'||m.id,r,public.icash_sms_thread_dispatch_until(p_account,t.id));
 if not public.icash_claim_operation('text:'||m.id) then raise exception 'Text already dispatched';end if;
 update public.icash_text_messages set state='dispatching',updated_at=now() where id=m.id;
 return jsonb_build_object('from',t.sender,'to',t.recipient,'message',m.body,'attachments',m.attachments);
end $function$;

CREATE OR REPLACE FUNCTION public.icash_claim_voice_job(p_job uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_voice_jobs;p public.icash_voice_contact_targets;c public.icash_voice_configs;prop text;h integer;
begin
 -- Match the ledger lock order so Stop and spending claims serialize.
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job for update;
 if not found or j.state<>'issued' or j.due_at>now() then return false;end if;

 if j.operational_contact_id is not null then
  if not public.icash_operational_contact_current(j.account_id,j.operational_contact_id,'voice',true) then return false;end if;
 else
  perform 1 from public.icash_contact_permissions where id=j.permission_id and account_id=j.account_id for share;
 end if;
 select * into p from public.icash_voice_contact_targets where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=j.account_id;

 select * into c from public.icash_voice_configs where account_id=j.account_id for share;
 if p.id is null or p.party is distinct from 'seller' or not c.enabled or c.reviewed_until<=now() or p.revoked_at is not null or p.permission_until<=now() or not (public.icash_seller_voice_permission_current(j.account_id,p.id) or (p.dnc_clear and p.dnc_checked_at is not null and p.dnc_checked_at between now()-interval '30 days' and now())) then return false;end if;
 if not exists(select 1 from public.icash_timezone_names where name=p.timezone) then return false;end if;
 h:=extract(hour from now() at time zone p.timezone);
 if (h<greatest(9,p.local_start_hour) or h>=least(case when public.icash_seller_voice_permission_current(j.account_id,p.id) then 20 else 18 end,p.local_end_hour)) and not public.icash_requested_seller_call_current(j.account_id,j.id) and not public.icash_requested_optin_call_current(j.account_id,j.id) then return false;end if;
 perform 1 from public.icash_accounts where id=j.account_id and not bot_paused for update;if not found then return false;end if;
 if not exists(select 1 from public.icash_wallets where account_id=j.account_id and balance_cents>0) then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(p.contact_key,17));
 if exists(select 1 from public.icash_contact_suppressions where contact_key=p.contact_key) then return false;end if;
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=p.screening_id and account_id=j.account_id and state='complete';
 if prop is null or exists(select 1 from public.icash_property_controls where account_id=j.account_id and property_id=prop and manual) then return false;end if;
 if j.callback_id is not null and not exists(select 1 from public.icash_live_callbacks where id=j.callback_id and account_id=j.account_id and state='pending_dispatch_review' and due_at between now()-interval '15 minutes' and now()) then return false;end if;
 -- Serialize per account and contact. Uncertain dispatches remain held, never auto-retried.
 if exists(select 1 from public.icash_voice_jobs v join public.icash_voice_contact_targets x on x.id=coalesce(v.permission_id,v.operational_contact_id) where v.id<>j.id and (v.state='dispatching' or (v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))) and (v.account_id=j.account_id or x.contact_key=p.contact_key)) then return false;end if;
 if exists(select 1 from public.icash_live_conversations where state in ('waiting','review') and (account_id=j.account_id or contact_key=p.contact_key)) then return false;end if;
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id where o.operation_key='voice:'||j.id and o.account_id=j.account_id and o.rate_id=case when p.party='buyer' then c.buyer_rate_id else c.seller_rate_id end and r.operation=case when p.party='buyer' then 'buyer_call' else 'seller_call' end and r.voice_max_duration_seconds>=c.max_duration_seconds) then return false;end if;
 if p.party='buyer' and public.icash_buyer_voice_context(p.id) is null then return false;end if;
 if not public.icash_claim_operation('voice:'||j.id) then return false;end if;
 update public.icash_voice_jobs set state='dispatching',updated_at=now(),operation_key='voice:'||id where id=j.id;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_meta_claim_text(p_account uuid, p_message uuid, p_sender text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare msg public.icash_text_messages;t public.icash_text_threads;m public.icash_meta_leads;h integer;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select ml.* into m from public.icash_meta_lead_messages mm join public.icash_meta_leads ml on ml.lead_id=mm.lead_id where mm.message_id=p_message and ml.account_id=p_account for share of ml;
 if not found then return null;end if;
 
 if exists(select 1 from public.icash_meta_lead_messages mm where mm.message_id=p_message and mm.purpose in ('followup_1','followup_2')
  and not public.icash_meta_followup_current(mm.lead_id,mm.purpose)) then return null;end if;
if not public.icash_sms_message_route_current(p_account,p_message) then return null;end if;
 select * into msg from public.icash_text_messages where id=p_message and account_id=p_account for update;
 if not found or msg.state<>'ready' or msg.direction<>'outgoing' or cardinality(msg.asset_ids)>0 or msg.attachments<>'[]'::jsonb then return null;end if;
 select * into t from public.icash_text_threads where id=msg.thread_id and account_id=p_account for update;
 if not found or t.seller_intake_id is distinct from m.lead_id or t.sender<>p_sender or not public.icash_seller_sms_permission_current(p_account,t.id,false) then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 if m.paused or m.declined_at is not null or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) then return null;end if;
 h:=extract(hour from now() at time zone t.timezone);
 if (h<9 or h>=20) and not (m.call_now and m.submitted_at>now()-interval '5 minutes') and not public.icash_seller_sms_inquiry_window(p_account,t.id) then return null;end if;
 -- The normal reserve snapshots actual-cost pricing, membership, credits,
 -- explicit channel disables, billing reviews and uncertain-send protection.
 perform public.icash_reserve_operation(p_account,'text:'||msg.id,t.sms_rate_id,t.permission_until);
 if not public.icash_claim_operation('text:'||msg.id) then return null;end if;
 update public.icash_text_messages set state='dispatching',updated_at=now() where id=msg.id;
 return jsonb_build_object('from',t.sender,'to',t.recipient,'message',msg.body,'attachments',msg.attachments);
end $function$;

CREATE OR REPLACE FUNCTION public.icash_meta_claim_voice(p_account uuid, p_job uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_voice_jobs;p public.icash_contact_permissions;c public.icash_voice_configs;h integer;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' or j.due_at>now() or public.icash_meta_voice_context(p_account,p_job) is null then return false;end if;
 select * into p from public.icash_contact_permissions where id=j.permission_id and account_id=p_account for share;
 select * into c from public.icash_voice_configs where account_id=p_account and enabled and reviewed_until>now() for share;
 if c.account_id is null or not public.icash_outreach_voice_current(p_account) then return false;end if;
 h:=extract(hour from now() at time zone p.timezone);
 if (h<9 or h>=20) and not public.icash_meta_call_now(p_account,p_job) and not public.icash_requested_seller_call_current(p_account,p_job) then return false;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;if not found then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(p.contact_key,17));
 if exists(select 1 from public.icash_voice_jobs v join public.icash_voice_contact_targets t on t.id=coalesce(v.permission_id,v.operational_contact_id)
  where v.id<>j.id and (v.state='dispatching' or v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')) and (v.account_id=p_account or t.contact_key=p.contact_key))
  or exists(select 1 from public.icash_live_conversations where state in ('waiting','review') and (account_id=p_account or contact_key=p.contact_key)) then return false;end if;
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id
  where o.operation_key='voice:'||j.id and o.account_id=p_account and o.rate_id=c.seller_rate_id and r.operation='seller_call' and r.voice_max_duration_seconds>=c.max_duration_seconds) then return false;end if;
 if not public.icash_claim_operation('voice:'||j.id) then return false;end if;
 update public.icash_voice_jobs set state='dispatching',updated_at=now(),operation_key='voice:'||id where id=j.id;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_seller_sms_permission_current(p_account uuid, p_thread uuid, p_check_hour boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;d public.icash_deal_files;r public.icash_operation_rates;e jsonb;price bigint;h integer;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account for share;
 if not found or t.seller_intake_id is null or t.party<>'seller' or t.paused or t.manual_only or t.ai_mode<>'auto'
  or t.dnc_clear or t.dnc_checked_at is not null or t.sms_review_request_id is not null or t.operational_contact_id is not null then return false;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true' for share;
 if not found then return false;end if;
 e:=public.icash_seller_contact_evidence(p_account,d.screening_id,t.seller_intake_id,t.recipient);
 if e is null or t.permission_evidence is distinct from e->>'evidence' or t.timezone is distinct from e->>'timezone'
  or t.permission_until is distinct from (e->>'until')::timestamptz or not public.icash_outreach_sms_current(p_account) then return false;end if;
 perform 1 from public.icash_text_senders where phone=t.sender and enabled for share;
 if not found then return false;end if;
 select * into r from public.icash_operation_rates where id=t.sms_rate_id for share;
 if not found or not public.icash_sms_intake_rate_current(r.id)
  or encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') is distinct from t.seller_sms_rate_hash then return false;end if;
 select customer_micros into price from public.icash_communication_prices where operation='sms_segment' for share;
 if not found or price is null or t.seller_sms_price_micros is null or price>t.seller_sms_price_micros then return false;end if;
 if exists(select 1 from public.icash_property_controls pc join public.icash_screening_jobs s on s.account_id=pc.account_id and s.snapshot->>'propertyId'=pc.property_id where s.id=d.screening_id and s.account_id=p_account and pc.manual)
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=d.screening_id and state<>'resolved') then return false;end if;
 h:=extract(hour from now() at time zone t.timezone);
 return not p_check_hour or (h>=9 and h<20) or public.icash_seller_sms_inquiry_window(p_account,t.id);
end $function$;
