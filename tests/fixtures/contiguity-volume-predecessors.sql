-- Schema-only fixture for the reviewed production predecessors. No customer records.
-- Unrelated downstream integrations are deliberately absent. Each exercised path
-- uses local rows and a deterministic adapter at its original dispatch boundary.
do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;end $$;
create schema if not exists auth;
create schema if not exists icash_text_receipt_private;
create schema if not exists icash_work_private;
set check_function_bodies=off;
create table public.icash_accounts(id uuid, owner_user_id uuid, assistant_name text, legal_name text, identity_verified_at timestamp with time zone, bot_paused boolean, daily_limit_cents bigint, created_at timestamp with time zone, billing_model text, contact_phone text, workspace_ack_version text, workspace_ack_user_id uuid, workspace_ack_hash text);
create table public.icash_automation_tickets(id uuid, token text, account_id uuid, kind text, screening_id uuid, state text, expires_at timestamp with time zone, created_at timestamp with time zone, completed_at timestamp with time zone, outcome text, live_call_id uuid, signing_id uuid, voice_job_id uuid, fulfillment_job_id uuid, title_task_id uuid, text_ai_job_id uuid, market_research_job_id uuid, issue_attempts integer, opener_message_id uuid, prospecting_quote_cents bigint, owner_preview_deferrals integer, owner_preview_retry_after timestamp with time zone, owner_preview_retry_until timestamp with time zone, owner_preview_screening_hash text);
create table public.icash_cancellation_notices(id uuid, account_id uuid, cancellation_id uuid, recipient_key text, recipient_name text, party text, channel text, phase text, destination text, subject text, body text, state text, detail text, sms_id uuid, email_id uuid, voice_job_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, next_attempt_at timestamp with time zone);
create table public.icash_contract_text_deliveries(envelope_id uuid, signer_id text, account_id uuid, thread_id uuid, message_id uuid, created_at timestamp with time zone);
create table public.icash_customer_identities(account_id uuid, first_name text, last_name text, company_name text, principal text, voice_id text, voice_name text, updated_at timestamp with time zone);
create table public.icash_customer_update_deliveries(id uuid, account_id uuid, channel text, source_key text, kind text, screening_id uuid, recipient text, preference_revision integer, state text, created_at timestamp with time zone, authorized_at timestamp with time zone, provider_id text, sender text);
create table public.icash_customer_update_preferences(account_id uuid, owner_user_id uuid, email_enabled boolean, sms_enabled boolean, email_suppressed_at timestamp with time zone, consent_email text, phone text, timezone text, consent_version text, consented_at timestamp with time zone, revision integer, seen_at timestamp with time zone, unsubscribe_token text, next_scan_at timestamp with time zone, updated_at timestamp with time zone, source_webinar_visitor uuid);
create table public.icash_customer_update_settings(id integer, enabled boolean, global_daily_limit integer, next_scan_at timestamp with time zone);
create table public.icash_deal_files(id uuid, account_id uuid, screening_id uuid, terms jsonb, stage text, seller_signed_at timestamp with time zone, assignment_signed_at timestamp with time zone, title_verified_at timestamp with time zone, funded_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone);
create table public.icash_legacy_contacts(id uuid, launch_id uuid, email text, phone text, name text, sources text[], source_ids text[], products text[], token text, email_permission boolean, sms_permission boolean, suppressed_reason text, stopped_at timestamp with time zone, replied_at timestamp with time zone, converted_at timestamp with time zone, membership_id uuid, first_visit_at timestamp with time zone, last_visit_at timestamp with time zone, last_purchase_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone);
create table public.icash_legacy_launches(id uuid, slug text, title text, state text, revision integer, approved_revision integer, approved_at timestamp with time zone, started_at timestamp with time zone, history_reviewed_at timestamp with time zone, history_evidence text, webinar_id uuid, steps jsonb, created_at timestamp with time zone, updated_at timestamp with time zone);
create table public.icash_legacy_outbox(id uuid, launch_id uuid, contact_id uuid, step_id text, cycle integer, channel text, recipient text, state text, due_at timestamp with time zone, subject text, body text, sender text, revision integer, provider_id text, sent_at timestamp with time zone, updated_at timestamp with time zone);
create table public.icash_messaging_settings(id integer, config jsonb, revision integer, updated_at timestamp with time zone);
create table public.icash_meta_lead_messages(message_id uuid, lead_id uuid, purpose text, evidence_key text);
create table public.icash_meta_leads(lead_id uuid, source_id uuid, account_id uuid, screening_id uuid, meta_id text, submitted_at timestamp with time zone, page_id text, form_id text, ad_id text, adset_id text, campaign_id text, consent_receipt jsonb, consent_text text, consent_version text, timezone text, call_now boolean, contact_until timestamp with time zone, link_hash text, link_expires_at timestamp with time zone, first_outreach_at timestamp with time zone, response_at timestamp with time zone, response_channel text, address_confirmed_at timestamp with time zone, address_channel text, voice_paused boolean, offer_ready_at timestamp with time zone, declined_at timestamp with time zone, paused boolean, next_attempt_at timestamp with time zone, voice_job_id uuid, created_at timestamp with time zone, offer_authorized_at timestamp with time zone, offer_conversation_id text, routed_at timestamp with time zone);
create table public.icash_operating_budget(id integer, enabled boolean, funded_micros bigint, protected_micros bigint, reserved_micros bigint, spent_micros bigint, daily_limit_micros bigint, minimum_margin_bps integer, hold_reason text, tax_reserve_bps integer, require_company_reserve boolean, standard_cost_multiplier numeric, elevenlabs_cost_multiplier numeric);
create table public.icash_operation_rates(id uuid, operation text, version text, charge_cents bigint, costs_micros jsonb, buffer_bps integer, evidence_ref text, verified_at timestamp with time zone, expires_at timestamp with time zone, enabled boolean, voice_max_duration_seconds integer, flat_customer_price_cents bigint);
create table public.icash_operation_spend(operation_key text, account_id uuid, rate_id uuid, credit_reservation_id uuid, charge_cap_cents bigint, reserved_micros bigint, state text, permission_until timestamp with time zone, financial_checked_at timestamp with time zone, actual_micros bigint, charged_cents bigint, settlement_evidence text, created_at timestamp with time zone, dispatched_at timestamp with time zone, settled_at timestamp with time zone, customer_price_micros bigint, standard_cost_multiplier numeric, elevenlabs_cost_multiplier numeric, required_revenue_micros numeric, cost_basis text, estimate_checked_at timestamp with time zone, dealmachine_cost_multiplier numeric, data_unit_cost_micros bigint, data_cost_basis text, prospecting_budget_id bigint);
create table public.icash_operational_contacts(id uuid, account_id uuid, screening_id uuid, channel text, phone text, contact_key text, timezone text, timezone_basis text, local_start_hour integer, local_end_hour integer, owner_user_id uuid, sending_principal text, source_hash text, dnc_receipt_id uuid, eligibility_until timestamp with time zone, created_at timestamp with time zone, revoked_at timestamp with time zone, provenance text, consent_verification text);
create table public.icash_owner_reply_attempts(id uuid, message_id uuid, thread_id uuid, state text, result jsonb, outgoing_id uuid, cost_micros bigint, created_at timestamp with time zone);
create table public.icash_owner_reply_sessions(thread_id uuid, enabled boolean, expires_at timestamp with time zone, remaining integer, authorization_ref text);
create table public.icash_property_controls(account_id uuid, property_id text, manual boolean, updated_at timestamp with time zone);
create table public.icash_purchase_access_followups(id uuid, purchase_email_id uuid, membership_id uuid, channel text, recipient text, visitor_id uuid, status text, attempts integer, due_at timestamp with time zone, next_attempt_at timestamp with time zone, claim_token uuid, claimed_at timestamp with time zone, first_attempt_at timestamp with time zone, message jsonb, provider_id text, delivery text, created_at timestamp with time zone, updated_at timestamp with time zone, checkout_permission boolean);
create table public.icash_purchase_phone_challenges(id uuid, membership_id uuid, email text, phone text, secret_hash text, code_hash text, sender text, status text, attempts integer, provider_id text, requested_at timestamp with time zone, expires_at timestamp with time zone, verified_at timestamp with time zone, used_at timestamp with time zone);
create table public.icash_screening_jobs(id uuid, account_id uuid, event_key text, snapshot jsonb, due_at timestamp with time zone, state text, attempts integer, lease_token uuid, lease_until timestamp with time zone, result jsonb, error_code text, created_at timestamp with time zone, completed_at timestamp with time zone);
create table public.icash_seller_gaps(id uuid, account_id uuid, deal_id uuid, screening_id uuid, thread_id uuid, source text, source_id uuid, reason text, stage text, channel text, quote text, state text, due_at timestamp with time zone, expires_at timestamp with time zone, source_at timestamp with time zone, outgoing_id uuid, resolution text, resolved_by uuid, resolved_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, review_reason text);
create table public.icash_seller_intakes(id uuid, request_id uuid, guest_hash text, duplicate_key text, name text, address text, phone text, ai_consented boolean, consent_version text, consent_text text, sharing_text text, owner_claimed boolean, agent_hash text, attribution jsonb, state text, canonical_id uuid, claim_token uuid, claimed_at timestamp with time zone, lookup_costs jsonb, lookup_cap_micros bigint, lookup_cost_basis text, data_rights_until timestamp with time zone, result jsonb, property jsonb, numbers_passed boolean, market_qualified boolean, checked_at timestamp with time zone, ad_cost_micros bigint, ad_cost_receipt text, assigned_account uuid, screening_id uuid, operation_key text, assigned_at timestamp with time zone, next_assignment_at timestamp with time zone, hold_reason text, created_at timestamp with time zone, email text, email_consented boolean, contact_consent_scope text, customer_costs jsonb, customer_cost_basis text, lookup_history jsonb, meta_measurement jsonb, customer_lead_multiplier integer);
create table public.icash_seller_opener_assignments(thread_id uuid, account_id uuid, variant text, body text, created_at timestamp with time zone, message_id uuid, delivered_at timestamp with time zone, first_reply_at timestamp with time zone, opted_out boolean, learning_context text, learning_decision_id bigint, learning_policy_version text, learning_selection_mode text);
create table public.icash_sms_inbound_invitations(id uuid, account_id uuid, thread_id uuid, deal_id uuid, screening_id uuid, opener_id uuid, reply_id uuid, message_id uuid, called_number text, sender text, recipient text, created_at timestamp with time zone, expires_at timestamp with time zone);
create table public.icash_sms_routes(sender text, recipient text, account_id uuid, revision bigint, needs_review boolean);
create table public.icash_text_ai_jobs(id uuid, account_id uuid, thread_id uuid, message_id uuid, state text, analysis jsonb, reply text, provider_id text, usage jsonb, outgoing_id uuid, next_attempt_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone);
create table public.icash_text_diagnostics(id uuid, token_hash text, sender text, recipient text, body text, authorization_ref text, expires_at timestamp with time zone, state text, provider_id text, cost_micros bigint, cost_status text, created_at timestamp with time zone, updated_at timestamp with time zone, ai_input text, ai_result jsonb, error_code text);
create table public.icash_text_events(id text, type text, payload jsonb, received_at timestamp with time zone);
create table public.icash_text_messages(id uuid, thread_id uuid, account_id uuid, direction text, body text, attachments jsonb, asset_ids uuid[], state text, request_key uuid, event_id text, provider_id text, last_delivery_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, customer_price_micros bigint, customer_author_id uuid, route_revision bigint);
create table public.icash_text_senders(phone text, enabled boolean);
create table public.icash_text_suppressions(phone text, reason text, created_at timestamp with time zone);
create table public.icash_text_threads(id uuid, account_id uuid, deal_id uuid, sender text, recipient text, permission_until timestamp with time zone, permission_evidence text, timezone text, dnc_checked_at timestamp with time zone, dnc_clear boolean, sms_rate_id uuid, mms_rate_id uuid, paused boolean, ai_mode text, party text, sms_review_request_id uuid, sms_intake_pending boolean, operational_contact_id uuid, eligibility_until timestamp with time zone, operational_sms_sender text, operational_sms_rate_hash text, operational_sms_price_micros bigint, manual_only boolean, seller_intake_id uuid, seller_sms_rate_hash text, seller_sms_price_micros bigint, retired_at timestamp with time zone, sender_pool_assigned boolean, owner_buyer_test_id uuid);
create table public.icash_timezone_names(name text);
create table public.icash_wallets(account_id uuid, balance_cents bigint, reserved_cents bigint, currency text);
create table public.icash_webinar_outbox(id uuid, visitor_id uuid, session_id uuid, channel text, recipient text, step integer, state text, due_at timestamp with time zone, created_at timestamp with time zone, claimed_at timestamp with time zone, first_attempt_at timestamp with time zone, attempts integer, payload jsonb, provider_id text, sent_at timestamp with time zone, last_error text, campaign_id uuid, expires_at timestamp with time zone, destination text, reply_event_id text, departure_id uuid);
create table public.icash_webinar_phone_suppressions(phone text, created_at timestamp with time zone);
create table public.icash_webinar_text_assignments(recipient text, sender text);
create table public.icash_webinar_text_senders(phone text, enabled boolean, verified_at timestamp with time zone, preferred boolean);
create table public.icash_webinar_visitors(id uuid, name text, email text, phone text, timezone text, attribution jsonb, email_consent_at timestamp with time zone, consent_version text, opted_out_at timestamp with time zone, account_id uuid, funded_at timestamp with time zone, funding_guest_hash text, created_at timestamp with time zone, last_seen_at timestamp with time zone, marketing_consent_at timestamp with time zone, measurement jsonb, activity_region text, sms_consent_at timestamp with time zone, sms_consent_version text, sms_opted_out_at timestamp with time zone, sms_replied_at timestamp with time zone);
alter table public.icash_text_messages add primary key(id);
create function public.icash_owner_targeting_pool(uuid,uuid) returns text language sql stable as $$select 'active'::text$$;
CREATE OR REPLACE FUNCTION public.icash_seller_direct_response_match(p_body text, p_pattern text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare remaining text:=p_body;matched text;offset_start integer:=1;match_start integer;prefix text;parts text[];sentence text;
begin
 loop
  matched:=(regexp_match(remaining,'('||p_pattern||')'))[1];
  if matched is null or length(matched)=0 then return false;end if;
  match_start:=offset_start+strpos(remaining,matched)-1;
  parts:=regexp_split_to_array(left(p_body,match_start-1),'[.!?;]|\ybut\y');
  sentence:=parts[cardinality(parts)];
  if (length(sentence)-length(replace(sentence,'"','')))%2=1 then prefix:=sentence;
  else parts:=string_to_array(sentence,',');prefix:=parts[cardinality(parts)];end if;
  if coalesce(prefix,'') !~ $pattern$(?:\y(?:not|never|did not|didn't|don't|do not|was not|wasn't) (?:say|saying|said|mean|meaning|ask|asking|asked|request|requesting|want|wanted)\y[^.!?;]{0,100}|\y(?:you|they|he|she|the tenant|my tenant|the owner|the agent|my wife|my husband) (?:said|say|wrote|asked)\y[^.!?;]{0,100}|\y(?:word|phrase|example)\y[^.!?;]{0,60}|\y(?:do not|don't|dont|never|not) )$$pattern$ and coalesce(sentence,'') !~ $pattern$\y(?:not|never|did not|didn't|don't|do not) (?:say|saying|mean|meaning|ask|asking|request|requesting)[ ,"']*$$pattern$ then return true;end if;
  offset_start:=match_start+length(matched);
  remaining:=substr(p_body,offset_start);
 end loop;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_claim_text(p_account uuid, p_message uuid, p_sender text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_text_ai_jobs;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where account_id=p_account and outgoing_id=p_message;
 if found and not public.icash_seller_progress_gate(p_account,j.id) then return null;end if;
 return public.icash_claim_text_before_progress(p_account,p_message,p_sender);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_claim_customer_text(p_account uuid, p_message uuid, p_sender text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare n public.icash_cancellation_notices;m public.icash_text_messages;t public.icash_text_threads;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into n from public.icash_cancellation_notices where account_id=p_account and sms_id=p_message;
 if found then
  select * into m from public.icash_text_messages where id=p_message and account_id=p_account;
  select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account;
  if not public.icash_cancellation_notice_current(p_account,n.id) or row(m.body,t.recipient,t.sender) is distinct from row(n.body,n.destination,p_sender) then return null;end if;
 end if;
 return public.icash_claim_customer_text_before_cancellation(p_account,p_message,p_sender);
end $function$
;
-- Reproduce one significant space in the deployed function's verified definition.
do $restore$ begin execute replace($ddl$CREATE OR REPLACE FUNCTION public.icash_meta_claim_text(p_account uuid, p_message uuid, p_sender text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare msg public.icash_text_messages;t public.icash_text_threads;m public.icash_meta_leads;h integer;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select ml.* into m from public.icash_meta_lead_messages mm join public.icash_meta_leads ml on ml.lead_id=mm.lead_id where mm.message_id=p_message and ml.account_id=p_account for share of ml;
 if not found then return null;end if;
__FIXTURE_SOURCE_SPACE__
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
 if not public.icash_sms_outreach_window_current(p_account,t.id) then return null;end if;
 -- The normal reserve snapshots actual-cost pricing, membership, credits,
 -- explicit channel disables, billing reviews and uncertain-send protection.
 perform public.icash_reserve_operation(p_account,'text:'||msg.id,t.sms_rate_id,t.permission_until);
 if not public.icash_claim_operation('text:'||msg.id) then return null;end if;
 update public.icash_text_messages set state='dispatching',updated_at=now() where id=msg.id;
 return jsonb_build_object('from',t.sender,'to',t.recipient,'message',msg.body,'attachments',msg.attachments);
end $function$
$ddl$, '__FIXTURE_SOURCE_SPACE__', chr(32));end $restore$;
CREATE OR REPLACE FUNCTION public.icash_prepare_owner_reply(p_attempt uuid, p_action text, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a public.icash_owner_reply_attempts;s public.icash_owner_reply_sessions;t public.icash_text_threads;body text;outgoing uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
select * into a from public.icash_owner_reply_attempts where id=p_attempt;
 if not found then return null;end if;
 select * into s from public.icash_owner_reply_sessions where thread_id=a.thread_id for update;
 select * into a from public.icash_owner_reply_attempts where id=p_attempt for update;
 select * into t from public.icash_text_threads where id=a.thread_id;
 if a.state<>'analyzing' then return null;end if;
 if not s.enabled or s.expires_at<=now() or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
 or exists(select 1 from public.icash_text_messages where thread_id=t.id and created_at>(select created_at from public.icash_text_messages where id=a.message_id)) then
 update public.icash_owner_reply_attempts set state='held',result=p_result where id=a.id;return null;end if;

 if p_action in ('ask_flexibility','ask_payoff') and public.icash_text_property_context(t.account_id,t.id) is null then raise exception 'Fresh property context required';end if;
 if p_action in ('ask_flexibility','ask_payoff') and exists(select 1 from public.icash_owner_reply_attempts prior where prior.thread_id=t.id and prior.id<>a.id and prior.outgoing_id is not null and prior.result->'analysis'->>'action'=p_action) then raise exception 'Question already sent';end if;

 if not exists(select 1 from public.icash_text_messages source join public.icash_sms_routes r on r.sender=t.sender and r.recipient=t.recipient
  where source.id=a.message_id and source.thread_id=t.id and source.account_id=t.account_id
   and r.account_id=t.account_id and not r.needs_review and source.route_revision=r.revision) then
  update public.icash_owner_reply_attempts set state='held',result=p_result where id=a.id;return null;
 end if;
 body:=case p_action
 when 'ask_condition' then 'What repairs or updates does the property need?'
 when 'ask_price' then 'What price did you have in mind?'
 when 'ask_timing' then 'When would you like to sell?'
 when 'ask_owners' then 'Are all property owners on board with selling?'
 when 'ask_occupancy' then 'Is the property vacant, owner occupied, or rented?'
 when 'ask_callback' then 'When is a good time to talk about a cash offer?'
 when 'ask_flexibility' then 'Is there flexibility in your asking price?'
 when 'ask_payoff' then 'Are there any mortgages, liens, or unpaid taxes that would need to be paid at closing?'
 when 'review' then 'I saved this for review. No offer or callback has been confirmed.'
 when 'handoff' then 'Your request is saved for review. A callback has not been booked. Automatic replies are paused.'
 else null end;
 if body is null then raise exception 'Unapproved diagnostic reply';end if;
 if p_action in ('review','handoff') then update public.icash_owner_reply_sessions set enabled=false where thread_id=t.id;end if;
 body:='iCash X AI practice. '||body;
 insert into public.icash_text_messages(thread_id,account_id,direction,body,state,request_key) values(t.id,t.account_id,'outgoing',body,'dispatching',a.id) returning id into outgoing;
 update public.icash_text_messages set customer_price_micros=null where id=outgoing;
 update public.icash_owner_reply_attempts set state='dispatching',result=p_result,outgoing_id=outgoing where id=a.id;
 update public.icash_text_ai_jobs set state=case when p_action in ('review','handoff') then 'handoff' else 'queued' end,analysis=p_result->'analysis',usage=p_result->'usage',provider_id=p_result->>'providerId',reply=body,outgoing_id=outgoing where message_id=a.message_id;
 return jsonb_build_object('id',outgoing,'account',t.account_id,'from',t.sender,'to',t.recipient,'message',body);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_claim_text_diagnostic(p_hash text, p_sender text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_text_diagnostics;
begin
 update public.icash_text_diagnostics d set state='dispatching',updated_at=now()
 where token_hash=p_hash and state='ready' and expires_at>now() and sender=p_sender
 and exists(select 1 from public.icash_text_senders s where s.phone=d.sender and s.enabled)
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=d.recipient)
 returning * into j;
 if not found then return null;end if;
 return jsonb_build_object('id',j.id,'from',j.sender,'to',j.recipient,'message',j.body);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_claim_customer_update(p_account uuid, p_email_ready boolean, p_sms_ready boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare p public.icash_customer_update_preferences;s record;chosen text;recipient text;email_address text;result uuid;settings public.icash_customer_update_settings;
begin
 select * into settings from public.icash_customer_update_settings where id=1 and enabled for update;
 if not found then return null;end if;
 select * into p from public.icash_customer_update_preferences where account_id=p_account for update;
 if not found or not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p.owner_user_id) or not(p.email_enabled or p.sms_enabled) or not public.icash_customer_update_consent_valid(p.consent_version) then return null;end if;
 select lower(u.email) into email_address from auth.users u join public.icash_accounts a on a.owner_user_id=u.id where a.id=p_account and u.email_confirmed_at is not null;
 if (select count(*) from public.icash_customer_update_deliveries where created_at>now()-interval '24 hours')>=settings.global_daily_limit then return null;end if;
 for chosen in select unnest(array['email','sms']) loop
  if chosen='email' and (p_email_ready and p.email_enabled and p.email_suppressed_at is null and p.consent_email=email_address) is not true then continue;end if;
  if chosen='sms' and (not(p_sms_ready and p.sms_enabled and p.phone is not null) or exists(select 1 from public.icash_text_suppressions where phone=p.phone) or exists(select 1 from public.icash_webinar_phone_suppressions where phone=p.phone) or public.icash_webinar_campaign_sender(p.phone) is null) then continue;end if;
  if chosen='sms' and extract(hour from now() at time zone p.timezone) not between 9 and 19 then continue;end if;
  if (select count(*) from public.icash_customer_update_deliveries where account_id=p_account and channel=chosen and created_at>now()-interval '24 hours')>=(case when chosen='sms' then 1 else 2 end)
   or exists(select 1 from public.icash_customer_update_deliveries where account_id=p_account and channel=chosen and created_at>now()-interval '1 hour') then continue;end if;
  if not public.icash_lifecycle_frequency_ok(chosen,case when chosen='email' then email_address else p.phone end) then continue;end if;select * into s from public.icash_customer_update_sources(p_account) x where x.event_at>=p.consented_at
   and not exists(select 1 from public.icash_customer_update_deliveries n where n.account_id=p_account and n.channel=chosen and n.source_key=x.source_key)
   and (x.kind<>'credits_low' or not exists(select 1 from public.icash_customer_update_deliveries n where n.account_id=p_account and n.channel=chosen and n.kind='credits_low' and n.created_at>now()-interval '24 hours')) and (x.kind<>'research_complete' or not exists(select 1 from public.icash_customer_update_deliveries n where n.account_id=p_account and n.channel=chosen and n.kind='research_complete' and n.created_at>now()-interval '24 hours'))
   order by x.priority,x.event_at desc limit 1;
  if not found then continue;end if;
  recipient:=case when chosen='email' then email_address else p.phone end;
  insert into public.icash_customer_update_deliveries(account_id,channel,source_key,kind,screening_id,recipient,preference_revision)
   values(p_account,chosen,s.source_key,s.kind,s.screening_id,recipient,p.revision) returning id into result;
  return result;
 end loop;
 return null;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_authorize_customer_update(p_account uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare sender_phone text;p public.icash_customer_update_preferences;n public.icash_customer_update_deliveries;email_address text;
begin
 perform 1 from public.icash_customer_update_settings where id=1 and enabled for share;if not found then return null;end if;
 select * into p from public.icash_customer_update_preferences where account_id=p_account for update;
 select * into n from public.icash_customer_update_deliveries where id=p_id and account_id=p_account for update;
 if not found or n.state<>'claimed' or n.authorized_at is not null then return null;end if;
 select lower(u.email) into email_address from auth.users u join public.icash_accounts a on a.owner_user_id=u.id where a.id=p_account and u.email_confirmed_at is not null;
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p.owner_user_id) or n.preference_revision<>p.revision or n.created_at<now()-interval '2 minutes'
  or (n.channel='email' and (not p.email_enabled or p.email_suppressed_at is not null or n.recipient is distinct from email_address or p.consent_email is distinct from email_address))
  or (n.channel='sms' and (not p.sms_enabled or n.recipient is distinct from p.phone))
  or not exists(select 1 from public.icash_customer_update_sources(p_account) s where s.source_key=n.source_key and s.screening_id is not distinct from n.screening_id) then
  update public.icash_customer_update_deliveries set state='canceled' where id=n.id;return null;
 end if;
 perform pg_advisory_xact_lock(hashtextextended((case when n.channel='email' then 'email:' else 'phone:' end)||n.recipient,815));if not public.icash_lifecycle_frequency_ok(n.channel,n.recipient,n.id) or n.channel='sms' and extract(hour from now() at time zone p.timezone) not between 9 and 19 then update public.icash_customer_update_deliveries set state='canceled' where id=n.id;return null;end if;if n.channel='sms' then sender_phone:=public.icash_webinar_campaign_sender(n.recipient);if sender_phone is null or exists(select 1 from public.icash_text_suppressions where phone=n.recipient) or exists(select 1 from public.icash_webinar_phone_suppressions where phone=n.recipient) then update public.icash_customer_update_deliveries set state='canceled' where id=n.id;return null;end if;end if;update public.icash_customer_update_deliveries set authorized_at=now(),sender=sender_phone where id=n.id;
 return jsonb_build_object('id',n.id,'channel',n.channel,'kind',n.kind,'screeningId',n.screening_id,'recipient',n.recipient,'unsubscribeToken',p.unsubscribe_token,'sender',sender_phone);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_authorize_phone_challenge(p_id uuid, p_secret_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_purchase_phone_challenges;target jsonb;
begin
 select * into c from public.icash_purchase_phone_challenges where id=p_id and secret_hash=p_secret_hash for update;
 if c.id is null or c.status<>'pending' or c.expires_at<=now() then return false;end if;
 target:=public.icash_phone_access_target(c.email,c.phone);
 if target is null or target->>'membershipId'<>c.membership_id::text or public.icash_webinar_campaign_sender(c.phone) is distinct from c.sender then return false;end if;
 update public.icash_purchase_phone_challenges set status='sending' where id=c.id;return true;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_authorize_purchase_access_followup(p_id uuid, p_claim uuid, p_message jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare f public.icash_purchase_access_followups; candidate jsonb; sender_phone text;
begin
 select * into f from public.icash_purchase_access_followups where id=p_id for update;
 if not found or f.status<>'claimed' or f.claim_token is distinct from p_claim or f.claimed_at<now()-interval '90 seconds' then return null;end if;
 if not public.icash_purchase_access_followup_allowed(f.id) or f.due_at>now() or f.first_attempt_at<=now()-interval '23 hours'
 or f.channel='sms' and f.first_attempt_at is not null then
  update public.icash_purchase_access_followups set status='canceled',updated_at=now() where id=f.id;return null;
 end if;
 candidate:=coalesce(f.message,p_message);
 if jsonb_typeof(candidate) is distinct from 'object' or octet_length(candidate::text)>20000 then raise exception 'Invalid access message';end if;
 if f.channel='email' then
  if candidate->'to' is distinct from jsonb_build_array(f.recipient) then raise exception 'Invalid recipient';end if;
 else
  sender_phone:=public.icash_webinar_campaign_sender(f.recipient);
  if sender_phone is null then update public.icash_purchase_access_followups set status='pending',next_attempt_at=now()+interval '1 minute',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
  if candidate->>'to' is distinct from f.recipient or candidate->>'from' is distinct from sender_phone
   or length(candidate->>'message') not between 1 and 1000 then raise exception 'Invalid text';end if;
 end if;
 update public.icash_purchase_access_followups set message=candidate,status='sending',first_attempt_at=coalesce(first_attempt_at,now()),updated_at=now() where id=f.id;
 return candidate;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_legacy_authorize(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_legacy_outbox;c public.icash_legacy_contacts;l public.icash_legacy_launches;
begin
 select * into j from public.icash_legacy_outbox where id=p_id for update;
 if j.id is null or j.state<>'sending' then return null;end if;
 select * into c from public.icash_legacy_contacts where id=j.contact_id;select * into l from public.icash_legacy_launches where id=j.launch_id;
 if not public.icash_legacy_admit(c.id,j.channel) or j.revision<>l.approved_revision then update public.icash_legacy_outbox set state='cancelled',updated_at=now() where id=j.id;return null;end if;
 return jsonb_build_object('id',j.id,'channel',j.channel,'recipient',j.recipient,'sender',j.sender,'subject',j.subject,'body',j.body,'token',c.token,'name',c.name);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_webinar_authorize_followup(p_id uuid, p_payload jsonb)
 RETURNS icash_webinar_outbox
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare f public.icash_webinar_outbox;v public.icash_webinar_visitors;config jsonb;identity text;candidate jsonb;recent integer;total integer;
begin
 select * into f from public.icash_webinar_outbox where id=p_id;
 if not found or f.state<>'claimed' then return null;end if;
 select * into v from public.icash_webinar_visitors where id=f.visitor_id;
 for identity in select distinct value from unnest(array['visitor:'||v.id::text,'email:'||lower(v.email),'phone:'||v.phone]) value where value is not null order by value loop
 perform pg_advisory_xact_lock(hashtextextended(identity,815));end loop;
 -- Same identity-lock order as presence cancellation; recheck the lease under lock.
 select * into f from public.icash_webinar_outbox where id=p_id for update;
 if not found or f.state<>'claimed' then return null;end if;
 select s.config into config from public.icash_messaging_settings s where id=1;
 if not public.icash_webinar_followup_allowed(f.id) or coalesce(f.expires_at,f.created_at+interval '7 days')<=now()
 or f.first_attempt_at<now()-interval '20 hours'
 or f.departure_id is not null and not public.icash_webinar_departure_pending(f.departure_id)
 or f.departure_id is null and f.reply_event_id is null and (f.created_at<=now()-interval '7 days' or f.campaign_id is not null and f.step not between 300000 and 300002) then
 update public.icash_webinar_outbox set state='canceled' where id=f.id;return null;end if;
 if not coalesce((config->>case when f.channel='email' then 'enabled' else 'smsEnabled' end)::boolean,false)
 or public.icash_webinar_recovery_active(v.id)
 or f.departure_id is null and public.icash_webinar_contact_last_seen(v.id)>now()-interval '15 minutes'
 or f.due_at>now() then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '15 minutes',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 -- Webinar recovery and scheduled reminders are not restricted by timezone.
 select count(*) filter(where coalesce(x.sent_at,x.first_attempt_at)>now()-interval '24 hours' or x.state='sending'),count(*) filter(where x.reply_event_id is null)
 into recent,total from public.icash_webinar_outbox x where x.id<>f.id and x.channel=f.channel and x.first_attempt_at is not null
 and (x.visitor_id=v.id or x.channel='email' and x.recipient=lower(v.email) or x.channel='sms' and x.recipient=v.phone);
 if f.first_attempt_at is null and f.departure_id is null and f.reply_event_id is null and (total>=3 or exists(
 select 1 from public.icash_webinar_outbox x where x.id<>f.id and x.channel=f.channel and x.step=f.step and x.first_attempt_at is not null and x.reply_event_id is null
 and (x.visitor_id=v.id or x.channel='email' and x.recipient=lower(v.email) or x.channel='sms' and x.recipient=v.phone))) then
 update public.icash_webinar_outbox set state='canceled',last_error='Reminder already sent or sequence complete' where id=f.id;return null;end if;
 -- A new real departure sends the pair promptly. Scheduled reminders still
 -- share the normal per-channel frequency budget with other lifecycle messages.
 if (f.departure_id is null or not public.icash_webinar_exit_consent(v.id,f.channel)) and (recent>=1 or not public.icash_lifecycle_frequency_ok(f.channel,f.recipient,null,f.id)) then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '1 hour',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 if f.departure_id is not null and f.first_attempt_at is null
 and not public.icash_webinar_exit_consent(v.id,f.channel)
 and total>=(case when f.channel='sms' then 2 else 3 end) then
 update public.icash_webinar_outbox set state='canceled',last_error='Original consent reminder limit reached' where id=f.id;return null;end if;
 candidate:=coalesce(f.payload,p_payload);
 if candidate is null or jsonb_typeof(candidate)<>'object' or octet_length(candidate::text)>16000 then raise exception 'Invalid follow-up content';end if;
 if f.channel='email' and coalesce(trim(config->>'postalAddress'),'')='' then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '1 hour',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 if f.campaign_id is not null and f.channel='sms' and not exists(select 1 from public.icash_webinar_text_assignments a join public.icash_webinar_text_senders s on s.phone=a.sender where a.recipient=f.recipient and s.enabled and s.phone=candidate->>'from') then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '1 hour',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 if f.channel='sms' then
 perform pg_advisory_xact_lock(818,1);
 if exists(select 1 from public.icash_text_threads where sender=candidate->>'from' and recipient=f.recipient and retired_at is null) then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '1 hour',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;end if;
 update public.icash_webinar_outbox set state='sending',payload=candidate,first_attempt_at=coalesce(first_attempt_at,now()),claimed_at=now() where id=f.id returning * into f;
 return f;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_seller_opener_candidate_body(p_account uuid, p_thread uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;d public.icash_deal_files;principal text;buyer_description text;address text;seller text;greeting text:='Hi, ';message_body text;message uuid;choice jsonb;
begin
 if not public.icash_outreach_sms_current(p_account) then return null;end if;
 if not public.icash_seller_text_cadence_current(p_account,p_thread) then return null;end if;
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' and not paused and ai_mode='auto';
 if not found or not icash_text_receipt_private.sender_opener_available(t.sender) or exists(select 1 from public.icash_seller_opener_assignments where thread_id=t.id)
  or exists(select 1 from public.icash_text_messages where thread_id=t.id and (state in ('ready','dispatching','needs_review') or created_at>now()-interval '1 day')) then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true';
 if not found then return null;end if;
 select trim(coalesce(nullif(trim(i.company_name),''),i.principal)),case when nullif(trim(i.company_name),'') is null then 'an individual HomeOffer Network investor' else 'an independent HomeOffer Network cash buyer' end into principal,buyer_description from public.icash_customer_identities i where i.account_id=p_account;
 address:=public.icash_conversation_street(d.terms->>'address');
 if coalesce(length(address),0)=0 or coalesce(length(principal),0)=0 then return null;end if;
 -- A property-record owner is not necessarily the person replying. Use only
 -- a strict self-introduction from this same contact after an actually sent text.
 -- Capture the FIRST name, never disclose terms.seller or another recorded owner.
 select substring(m.body from '^(?:[Tt]his is|[Mm]y name is|I''m|I am) ([A-Z][a-z]{1,24})(?:[ ''-][A-Z][a-z]{1,24}){0,2}[.!]?$') into seller
 from public.icash_text_messages m
 where m.thread_id=t.id and m.account_id=p_account and m.direction='incoming' and m.state='received'
 and m.body ~ '^(?:[Tt]his is|[Mm]y name is|I''m|I am) ([A-Z][a-z]{1,24})(?:[ ''-][A-Z][a-z]{1,24}){0,2}[.!]?$'
 and exists(select 1 from public.icash_text_messages sent where sent.thread_id=t.id and sent.account_id=p_account and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.provider_id is not null and sent.created_at<m.created_at)
 order by m.created_at desc,m.id desc limit 1;
 if lower(seller) in ('interested','owner','selling','ready','not','yes','no') then seller:=null;end if;
 if seller is not null then greeting:='Hi '||seller||', ';end if;
 if t.seller_intake_id is not null and public.icash_seller_contact_evidence(p_account,d.screening_id,t.seller_intake_id,t.recipient) is not null then
  select split_part(trim(l.name),' ',1) into seller from public.icash_seller_intakes l where l.id=t.seller_intake_id and l.phone=t.recipient;
  if seller is null or seller !~ '^[A-Za-z][A-Za-z]{0,30}$' then seller:=null;end if;
  message_body:=public.icash_seller_recipient_opener(p_account,t.id,seller,principal,address);
  if message_body is null then return null;end if;
 else
  if public.icash_seller_sms_learning_active(p_account,t.id) then
   choice:=public.icash_seller_sms_learning_plan(p_account,t.id);
   message_body:=choice->>'body';
  else message_body:=public.icash_seller_identity_opener(principal,address);end if;
 end if;
 -- Retain the existing one-segment rate. Never silently truncate identity/address or bill extra segments.
 if message_body is null or length(message_body)>160 or message_body ~ '[^A-Za-z0-9 .,!?&#/-]' then return null;end if;
 -- Copy is only a candidate. Keep the exact full source/consent/cost review
 -- mandatory before returning it; unknown review results also stay rejected.
 if public.icash_sms_thread_review_current(p_account,t.id,false) is distinct from true then return null;end if;
 return message_body;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_queue_seller_opener(p_account uuid, p_thread uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;d public.icash_deal_files;principal text;buyer_description text;address text;seller text;greeting text:='Hi, ';message_body text;message uuid;choice jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
perform 1 from public.icash_operating_budget where id=1 for update;
 if not public.icash_outreach_sms_current(p_account) then return null;end if;
 if not public.icash_seller_text_cadence_current(p_account,p_thread) then return null;end if;
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' and not paused and ai_mode='auto' and public.icash_sms_thread_review_current(p_account,id,false) for update;
 if not found or not icash_text_receipt_private.sender_opener_available(t.sender) or exists(select 1 from public.icash_seller_opener_assignments where thread_id=t.id)
  or exists(select 1 from public.icash_text_messages where thread_id=t.id and (state in ('ready','dispatching','needs_review') or created_at>now()-interval '1 day')) then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true';
 if not found then return null;end if;
 select trim(coalesce(nullif(trim(i.company_name),''),i.principal)),case when nullif(trim(i.company_name),'') is null then 'an individual HomeOffer Network investor' else 'an independent HomeOffer Network cash buyer' end into principal,buyer_description from public.icash_customer_identities i where i.account_id=p_account;
 address:=public.icash_conversation_street(d.terms->>'address');
 if coalesce(length(address),0)=0 or coalesce(length(principal),0)=0 then return null;end if;
 -- A property-record owner is not necessarily the person replying. Use only
 -- a strict self-introduction from this same contact after an actually sent text.
 -- Capture the FIRST name, never disclose terms.seller or another recorded owner.
 select substring(m.body from '^(?:[Tt]his is|[Mm]y name is|I''m|I am) ([A-Z][a-z]{1,24})(?:[ ''-][A-Z][a-z]{1,24}){0,2}[.!]?$') into seller
 from public.icash_text_messages m
 where m.thread_id=t.id and m.account_id=p_account and m.direction='incoming' and m.state='received'
 and m.body ~ '^(?:[Tt]his is|[Mm]y name is|I''m|I am) ([A-Z][a-z]{1,24})(?:[ ''-][A-Z][a-z]{1,24}){0,2}[.!]?$'
 and exists(select 1 from public.icash_text_messages sent where sent.thread_id=t.id and sent.account_id=p_account and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.provider_id is not null and sent.created_at<m.created_at)
 order by m.created_at desc,m.id desc limit 1;
 if lower(seller) in ('interested','owner','selling','ready','not','yes','no') then seller:=null;end if;
 if seller is not null then greeting:='Hi '||seller||', ';end if;
 if t.seller_intake_id is not null and public.icash_seller_contact_evidence(p_account,d.screening_id,t.seller_intake_id,t.recipient) is not null then
  select split_part(trim(l.name),' ',1) into seller from public.icash_seller_intakes l where l.id=t.seller_intake_id and l.phone=t.recipient;
  if seller is null or seller !~ '^[A-Za-z][A-Za-z]{0,30}$' then seller:=null;end if;
  message_body:=public.icash_seller_recipient_opener(p_account,t.id,seller,principal,address);
  if message_body is null then return null;end if;
 else
  if public.icash_seller_sms_learning_active(p_account,t.id) then
   choice:=public.icash_seller_sms_learning_plan(p_account,t.id);
   message_body:=choice->>'body';
  else message_body:=public.icash_seller_identity_opener(principal,address);end if;
 end if;
 -- Retain the existing one-segment rate. Never silently truncate identity/address or bill extra segments.
 if message_body is null or length(message_body)>160 or message_body ~ '[^A-Za-z0-9 .,!?&#/-]' then return null;end if;
 choice:=public.icash_assign_seller_opener_v5(p_account,t.id);
 if choice is null then return null;end if;
 if choice->>'context'='identity-v5' then
  message_body:=choice->>'body';
  if message_body is null or length(message_body)>160 or message_body ~ '[^A-Za-z0-9 .,!?&#/-]' then raise exception 'Seller SMS v5 copy requires review';end if;
 elsif choice->>'context'='interest-v2' then
  message_body:=replace(replace(choice->>'body','{owner}',case when seller is null then '' else seller||', ' end||'the owner'),'{address}',address);
  -- Any invalid expansion rolls back the new assignment along with this call.
  if message_body is null or length(message_body)>160 or message_body ~ '[^A-Za-z0-9 .,!?&#/-]' then raise exception 'Seller experiment copy requires review';end if;
 end if;
 update public.icash_seller_opener_assignments a set body=message_body where a.thread_id=t.id and a.account_id=p_account and a.message_id is null;
 message:=public.icash_queue_text(p_account,t.id,t.id,message_body,'{}');
 insert into public.icash_sms_seller_openings(thread_id,account_id,owner_question_id) values(t.id,p_account,message);
 return message;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_next_seller_followup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare g public.icash_seller_gaps;mid uuid;ticket public.icash_automation_tickets;
begin
 perform pg_advisory_xact_lock(726341927);
 if not exists(select 1 from public.icash_operating_budget where id=1 and enabled)
  or exists(select 1 from public.icash_automation_tickets where kind='seller_recovery' and created_at>now()-interval '1 minute') then return null;end if;
 -- Bound expiry maintenance and selection independently of the acquisition lane.
 with expired as (
  select gap.id from public.icash_seller_gaps gap
  join public.icash_text_threads t on t.id=gap.thread_id and t.account_id=gap.account_id
  join public.icash_operational_contacts c on c.id=t.operational_contact_id and c.account_id=t.account_id
  where gap.state='open' and gap.outgoing_id is null and gap.reason='no_response' and gap.stage='draft'
   and (t.eligibility_until<=now() or c.eligibility_until<=now())
  order by gap.due_at limit 100 for update of gap skip locked
 )
 update public.icash_seller_gaps gap set state='needs_review',review_reason='contact_checks_expired',updated_at=now()
 from expired where gap.id=expired.id;
 for g in
  select gap.* from public.icash_seller_gaps gap
  join public.icash_text_threads t on t.id=gap.thread_id and t.account_id=gap.account_id and t.deal_id=gap.deal_id
  join public.icash_operational_contacts c on c.id=t.operational_contact_id and c.account_id=t.account_id
  join public.icash_accounts a on a.id=gap.account_id and not a.bot_paused
  join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
  where gap.state='open' and gap.reason='no_response' and gap.stage='draft' and gap.outgoing_id is null
   and gap.due_at<=now() and gap.expires_at>now()
   and not t.paused and not t.manual_only and t.retired_at is null and t.ai_mode='auto'
   and t.eligibility_until>now() and c.eligibility_until>now() and c.revoked_at is null
   and public.icash_seller_text_cadence_current(gap.account_id,t.id,gap.outgoing_id,true)
  order by gap.due_at for update of gap skip locked limit 20
 loop
  if not public.icash_sms_outreach_window_current(g.account_id,g.thread_id) then continue;end if;
  mid:=public.icash_prepare_seller_recovery(g.account_id,g.id);
  if mid is not null then
   insert into public.icash_automation_tickets(account_id,kind,opener_message_id)
    values(g.account_id,'seller_recovery',mid) returning * into ticket;
   return jsonb_build_object('token',ticket.token);
  end if;
  update public.icash_seller_gaps set due_at=now()+interval '1 hour',updated_at=now() where id=g.id and state='open';
 end loop;
 return null;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_recover_unstarted_seller_opener()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare prior jsonb;candidate record;ticket public.icash_automation_tickets;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found or exists(select 1 from public.icash_automation_tickets where kind='seller_opener' and created_at>now()-interval '1 second') then return null;end if;
 select ordered.account_id,ordered.message_id,ordered.attempt into candidate from (
 select th.account_id,th.id as thread_id,msg.id as message_id,history.attempt+1 as attempt
 from public.icash_seller_opener_assignments assignment
 join public.icash_text_messages msg on msg.id=assignment.message_id and msg.thread_id=assignment.thread_id and msg.account_id=assignment.account_id and msg.body=assignment.body
 join public.icash_text_threads th on th.id=msg.thread_id and th.account_id=msg.account_id
 join public.icash_accounts a on a.id=th.account_id and not a.bot_paused
 join public.icash_operation_rates rate on rate.id=th.sms_rate_id
 join public.icash_wallets wallet on wallet.account_id=a.id and wallet.balance_cents>0
 join public.icash_deal_files deal on deal.id=th.deal_id and deal.account_id=th.account_id and deal.stage='draft' and coalesce(deal.terms->>'practice','false')<>'true'
 join public.icash_screening_jobs sc on sc.id=deal.screening_id and sc.account_id=deal.account_id and sc.state='complete' and sc.result->'financialCheck'->>'status'='eligible' and sc.completed_at between now()-interval '24 hours' and now()
 join public.icash_timezone_names zone on zone.name=th.timezone
 cross join lateral(select count(*) as total,max(issue_attempts) as attempt from public.icash_automation_tickets where opener_message_id=msg.id) history
 cross join lateral(select * from public.icash_automation_tickets where opener_message_id=msg.id order by created_at desc,id desc limit 1) previous
 where msg.direction='outgoing' and msg.state='ready' and msg.provider_id is null and msg.last_delivery_at is null and msg.request_key=th.id and cardinality(msg.asset_ids)=0
 and assignment.delivered_at is null and assignment.first_reply_at is null and not assignment.opted_out
 and th.party='seller' and not th.paused and th.ai_mode='auto' and not th.sms_intake_pending

 and history.total between 1 and 2 and history.attempt between 1 and 2
 and previous.account_id=th.account_id and previous.kind='seller_opener'
 and ((previous.state='issued' and previous.expires_at<=now()) or (previous.state='held' and previous.outcome in ('expired','message_held','messaging_configuration_required','business_number_mismatch','business_number_verification_required')))
 and not exists(select 1 from public.icash_automation_tickets active where active.opener_message_id=msg.id and (active.state='consumed' or (active.state='issued' and active.expires_at>now()) or active.account_id<>th.account_id or active.kind<>'seller_opener'))
 and not exists(select 1 from public.icash_operation_spend where operation_key='text:'||msg.id)
 and not exists(select 1 from public.icash_text_messages other where other.thread_id=th.id and other.id<>msg.id)
 and not exists(select 1 from public.icash_sms_inbound_invitations where message_id=msg.id or thread_id=th.id)
 and not exists(select 1 from public.icash_text_ai_jobs where outgoing_id=msg.id)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=th.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual)
 order by previous.created_at,th.id for update of th,msg skip locked offset 0
 ) ordered
 where public.icash_outreach_sms_current(ordered.account_id)
 and public.icash_sms_thread_review_current(ordered.account_id,ordered.thread_id,true)
 and public.icash_sms_outreach_window_current(ordered.account_id,ordered.thread_id)
 and public.icash_seller_text_cadence_current(ordered.account_id,ordered.thread_id,ordered.message_id)
 limit 1;
 if not found then return null;end if;
 insert into public.icash_automation_tickets(account_id,kind,opener_message_id,issue_attempts)
 values(candidate.account_id,'seller_opener',candidate.message_id,candidate.attempt) returning * into ticket;
 return jsonb_build_object('token',ticket.token);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_seller_response_disposition(p_body text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare b text:=trim(regexp_replace(lower(replace(replace(replace(replace(coalesce(p_body,''),'’',chr(39)),'‘',chr(39)),'“','"'),'”','"')),'[[:space:]]+',' ','g'));decline_body text;
begin
 if public.icash_seller_direct_response_match(b,$pattern$(?:^|[.!?;] +)(?:please )?stop(?: please)?[.! ,]*$|\y(?:stop|quit) (?:asking|bothering|harassing) (?:me|us)\y|\yplease unsubscribe(?: me)?\y|(?:^|[,;.!] +)(?:please )?(?:unsubscribe|dnc)(?: me)?[.! ,]*$|^(?:please )?(?:stop|stopall|unsubscribe|cancel|end|quit|revoke|opt out|dnc)(?: please)?(?:[.! ,]*$|\s*[,;.!]\s*(?:please\y|call\y|text\y|but\y))|\y(?:(?:do not|don't|dont) want (?:you|your (?:company|business)) to (?:ever )?(?:call|text|email|contact)\y|(?:do not|don't|dont|never) (?:ever )?(?:call|text|email|message|contact)(?:ing)?(?: (?:me|us))?\y(?! (?:it|that|the house|the property)\y)|(?:stop|quit) (?:(?:calling|texting|emailing|messaging|contacting)\y|(?:call|text|email|message|contact)\y(?! (?:it|that|the house|the property)\y))|(?:unsubscribe|remove|delete) (?:me|my number)\y|take (?:me|my number) off\y|leave (?:me|us) alone\y|(?:put|add|place) (?:me|my number) (?:on|in) (?:your |the )?(?:dnc|do not call)(?: list)?\y|(?:i am|i'm) (?:already )?on (?:the |your )?(?:dnc|do not call) list\y)$pattern$) then return 'opt_out';end if;
 decline_body:=case when b ~ '\y(call|talk)\y' then regexp_replace(b,$pattern$\ynot (?:(?:super|very|really|that|at all) )?interested in (?:texting|emailing|emails|texts)\y$pattern$,'','g') else b end;
 if public.icash_seller_direct_response_match(decline_body,$pattern$\y(?:i|we)(?:'ve)? (?:(?:have|already) ){0,2}told (?:you|yall|y'all|you all) no\y|\y(?:i|we) (?:will not|won't|wont) (?:ever )?sell\y|\y(?:no thanks|no thank you|wrong number|not (?:(?:super|very|really|that|at all) )?interested|(?:do not|don't|dont) want to sell|not selling(?: (?:my|our|the) (?:house|home|property))?|no quiero vender|no me interesa vender)\y$pattern$) then
  return case when b ~ '\y(unless|if|but)\y|[$]|\yprice\y' then 'review' else 'declined' end;
 end if;
 if public.icash_seller_direct_response_match(b,$pattern$\y(?:tired|sick) of (?:these|your|the) (?:texts|messages|calls)\y|\y(?:scam|scammer|scammers|fraud|fraudulent|suspicious|(?:i am|i'm|we are|we're) not (?:comfortable|ready)|need to think|never agreed|hold off|not for me|no interest|not looking to sell|(?:do not|don't|dont) trust|not now|not sure (?:about|i want)|stop bothering|waste of (?:my )?time)\y|^(?:not comfortable|not ready)[.! ,]*$$pattern$) then
  if strpos(b,'?')=0 and b ~ $pattern$\y(?:not|isn't|is not|wasn't|was not) (?:a )?(?:scam|fraud)\y$pattern$
   and not public.icash_seller_direct_response_match(b,$pattern$\y(?:tired|sick) of (?:these|your|the) (?:texts|messages|calls)\y|\y(?:suspicious|(?:i am|i'm|we are|we're) not (?:comfortable|ready)|need to think|never agreed|hold off|not for me|no interest|not looking to sell|(?:do not|don't|dont) trust|not now|not sure (?:about|i want)|stop bothering|waste of (?:my )?time)\y|^(?:not comfortable|not ready)[.! ,]*$$pattern$) then return null;end if;
  return 'review';
 end if;
 return null;
end $function$
;
set check_function_bodies=on;
