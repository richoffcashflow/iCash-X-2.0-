create role anon;create role authenticated;create role service_role bypassrls;
 create schema icash_recording_private;create schema icash_seller_recovery_private;create schema icash_seller_agreement_private;
 grant usage on schema icash_seller_recovery_private to service_role;create table public.icash_accounts ("id" uuid,"owner_user_id" uuid,"assistant_name" text,"legal_name" text,"identity_verified_at" timestamp with time zone,"bot_paused" boolean,"daily_limit_cents" bigint,"created_at" timestamp with time zone,"billing_model" text,"contact_phone" text,"workspace_ack_version" text,"workspace_ack_user_id" uuid,"workspace_ack_hash" text);
create table public.icash_automation_tickets ("id" uuid,"token" text,"account_id" uuid,"kind" text,"screening_id" uuid,"state" text,"expires_at" timestamp with time zone,"created_at" timestamp with time zone,"completed_at" timestamp with time zone,"outcome" text,"live_call_id" uuid,"signing_id" uuid,"voice_job_id" uuid,"fulfillment_job_id" uuid,"title_task_id" uuid,"text_ai_job_id" uuid,"market_research_job_id" uuid,"issue_attempts" integer,"opener_message_id" uuid,"prospecting_quote_cents" bigint);
create table public.icash_call_recordings ("id" uuid,"account_id" uuid,"operation_key" text,"voice_job_id" uuid,"permission_id" uuid,"operational_contact_id" uuid,"screening_id" uuid,"party" text,"call_context" jsonb,"provider_account_sid" text,"call_sid" text,"recording_sid" text,"conversation_id" text,"to_phone" text,"from_phone" text,"contact_key" text,"agent_id" text,"branch_id" text,"version_id" text,"rate_id" uuid,"charge_cap_cents" bigint,"max_total_seconds" integer,"state" text,"nonce_hash" text,"stop_token_hash" text,"disclosure_version" text,"pricing_policy" jsonb,"row_version" bigint,"consent_at" timestamp with time zone,"consent_evidence" jsonb,"dial_claimed_at" timestamp with time zone,"start_claimed_at" timestamp with time zone,"provider_started_at" timestamp with time zone,"ended_at" timestamp with time zone,"duration_seconds" integer,"audio_expires_at" timestamp with time zone,"deleted_at" timestamp with time zone,"end_requested_at" timestamp with time zone,"call_ended_at" timestamp with time zone,"provider_recording_price_micros" bigint,"price_is_estimate" boolean,"created_at" timestamp with time zone,"consent_deadline_at" timestamp with time zone,"updated_at" timestamp with time zone,"next_reconcile_at" timestamp with time zone,"reconcile_attempts" integer,"reconcile_lease_token" uuid,"reconcile_lease_expires_at" timestamp with time zone,"next_delete_at" timestamp with time zone,"deletion_attempts" integer,"deletion_lease_token" uuid,"deletion_lease_expires_at" timestamp with time zone,"last_error" text,"last_action" text,"entry_policy" text,"recording_authorized_at" timestamp with time zone,"caller_id_sid" text,"final_provider_started_at" timestamp with time zone);
create table public.icash_contact_permissions ("id" uuid,"account_id" uuid,"screening_id" uuid,"party" text,"phone" text,"contact_key" text,"timezone" text,"local_start_hour" integer,"local_end_hour" integer,"permission_evidence" text,"permission_until" timestamp with time zone,"dnc_checked_at" timestamp with time zone,"dnc_clear" boolean,"revoked_at" timestamp with time zone,"buyer_id" uuid,"review_request_id" uuid,"seller_intake_id" uuid);
create table public.icash_customer_phone_calls ("id" uuid,"account_id" uuid,"actor_id" uuid,"screening_id" uuid,"callback_phone" text,"recipient_phone" text,"business_phone" text,"provider_account_sid" text,"nonce_hash" text,"operation_key" text,"rate_id" uuid,"max_seconds" integer,"state" text,"parent_sid" text,"child_sid" text,"connected_at" timestamp with time zone,"ended_at" timestamp with time zone,"parent_receipt" jsonb,"child_receipt" jsonb,"settled_at" timestamp with time zone,"created_at" timestamp with time zone,"updated_at" timestamp with time zone,"recording_required" boolean,"recording_state" text,"recording_sid" text,"recording_receipt" jsonb,"recording_expires_at" timestamp with time zone,"recording_deleted_at" timestamp with time zone,"recipient_answered_at" timestamp with time zone,"connection_type" text);
create table public.icash_live_callbacks ("id" uuid,"conversation_id" uuid,"account_id" uuid,"screening_id" uuid,"due_at" timestamp with time zone,"timezone" text,"evidence" jsonb,"state" text,"created_at" timestamp with time zone);
create table public.icash_live_conversations ("id" uuid,"account_id" uuid,"screening_id" uuid,"party" text,"agent_id" text,"conversation_id" text,"operation_key" text,"contact_key" text,"strategy_key" text,"tool_token_hash" text,"tool_expires_at" timestamp with time zone,"state" text,"next_poll_at" timestamp with time zone,"poll_attempts" integer,"result" jsonb,"created_at" timestamp with time zone,"completed_at" timestamp with time zone);
create table public.icash_meta_lead_messages ("message_id" uuid,"lead_id" uuid,"purpose" text,"evidence_key" text);
create table public.icash_meta_leads ("lead_id" uuid,"source_id" uuid,"account_id" uuid,"screening_id" uuid,"meta_id" text,"submitted_at" timestamp with time zone,"page_id" text,"form_id" text,"ad_id" text,"adset_id" text,"campaign_id" text,"consent_receipt" jsonb,"consent_text" text,"consent_version" text,"timezone" text,"call_now" boolean,"contact_until" timestamp with time zone,"link_hash" text,"link_expires_at" timestamp with time zone,"first_outreach_at" timestamp with time zone,"response_at" timestamp with time zone,"response_channel" text,"address_confirmed_at" timestamp with time zone,"address_channel" text,"voice_paused" boolean,"offer_ready_at" timestamp with time zone,"declined_at" timestamp with time zone,"paused" boolean,"next_attempt_at" timestamp with time zone,"voice_job_id" uuid,"created_at" timestamp with time zone,"offer_authorized_at" timestamp with time zone,"offer_conversation_id" text,"routed_at" timestamp with time zone);
create table public.icash_operating_budget ("id" integer,"enabled" boolean,"funded_micros" bigint,"protected_micros" bigint,"reserved_micros" bigint,"spent_micros" bigint,"daily_limit_micros" bigint,"minimum_margin_bps" integer,"hold_reason" text,"tax_reserve_bps" integer,"require_company_reserve" boolean,"standard_cost_multiplier" numeric,"elevenlabs_cost_multiplier" numeric);
create table public.icash_operation_rates ("id" uuid,"operation" text,"version" text,"charge_cents" bigint,"costs_micros" jsonb,"buffer_bps" integer,"evidence_ref" text,"verified_at" timestamp with time zone,"expires_at" timestamp with time zone,"enabled" boolean,"voice_max_duration_seconds" integer,"flat_customer_price_cents" bigint);
create table public.icash_operation_spend ("operation_key" text,"account_id" uuid,"rate_id" uuid,"credit_reservation_id" uuid,"charge_cap_cents" bigint,"reserved_micros" bigint,"state" text,"permission_until" timestamp with time zone,"financial_checked_at" timestamp with time zone,"actual_micros" bigint,"charged_cents" bigint,"settlement_evidence" text,"created_at" timestamp with time zone,"dispatched_at" timestamp with time zone,"settled_at" timestamp with time zone,"customer_price_micros" bigint,"standard_cost_multiplier" numeric,"elevenlabs_cost_multiplier" numeric,"required_revenue_micros" numeric,"cost_basis" text,"estimate_checked_at" timestamp with time zone,"dealmachine_cost_multiplier" numeric,"data_unit_cost_micros" bigint,"data_cost_basis" text,"prospecting_budget_id" bigint);
create table public.icash_operational_contacts ("id" uuid,"account_id" uuid,"screening_id" uuid,"channel" text,"phone" text,"contact_key" text,"timezone" text,"timezone_basis" text,"local_start_hour" integer,"local_end_hour" integer,"owner_user_id" uuid,"sending_principal" text,"source_hash" text,"dnc_receipt_id" uuid,"eligibility_until" timestamp with time zone,"created_at" timestamp with time zone,"revoked_at" timestamp with time zone,"provenance" text,"consent_verification" text);
create table public.icash_screening_jobs ("id" uuid,"account_id" uuid,"event_key" text,"snapshot" jsonb,"due_at" timestamp with time zone,"state" text,"attempts" integer,"lease_token" uuid,"lease_until" timestamp with time zone,"result" jsonb,"error_code" text,"created_at" timestamp with time zone,"completed_at" timestamp with time zone);
create table public.icash_seller_intakes ("id" uuid,"request_id" uuid,"guest_hash" text,"duplicate_key" text,"name" text,"address" text,"phone" text,"ai_consented" boolean,"consent_version" text,"consent_text" text,"sharing_text" text,"owner_claimed" boolean,"agent_hash" text,"attribution" jsonb,"state" text,"canonical_id" uuid,"claim_token" uuid,"claimed_at" timestamp with time zone,"lookup_costs" jsonb,"lookup_cap_micros" bigint,"lookup_cost_basis" text,"data_rights_until" timestamp with time zone,"result" jsonb,"property" jsonb,"numbers_passed" boolean,"market_qualified" boolean,"checked_at" timestamp with time zone,"ad_cost_micros" bigint,"ad_cost_receipt" text,"assigned_account" uuid,"screening_id" uuid,"operation_key" text,"assigned_at" timestamp with time zone,"next_assignment_at" timestamp with time zone,"hold_reason" text,"created_at" timestamp with time zone,"email" text,"email_consented" boolean,"contact_consent_scope" text,"customer_costs" jsonb,"customer_cost_basis" text,"lookup_history" jsonb,"meta_measurement" jsonb,"customer_lead_multiplier" integer);
create table public.icash_text_messages ("id" uuid,"thread_id" uuid,"account_id" uuid,"direction" text,"body" text,"attachments" jsonb,"asset_ids" uuid[],"state" text,"request_key" uuid,"event_id" text,"provider_id" text,"last_delivery_at" timestamp with time zone,"created_at" timestamp with time zone,"updated_at" timestamp with time zone,"customer_price_micros" bigint,"customer_author_id" uuid,"route_revision" bigint);
create table public.icash_text_threads ("id" uuid,"account_id" uuid,"deal_id" uuid,"sender" text,"recipient" text,"permission_until" timestamp with time zone,"permission_evidence" text,"timezone" text,"dnc_checked_at" timestamp with time zone,"dnc_clear" boolean,"sms_rate_id" uuid,"mms_rate_id" uuid,"paused" boolean,"ai_mode" text,"party" text,"sms_review_request_id" uuid,"sms_intake_pending" boolean,"operational_contact_id" uuid,"eligibility_until" timestamp with time zone,"operational_sms_sender" text,"operational_sms_rate_hash" text,"operational_sms_price_micros" bigint,"manual_only" boolean,"seller_intake_id" uuid,"seller_sms_rate_hash" text,"seller_sms_price_micros" bigint,"retired_at" timestamp with time zone,"sender_pool_assigned" boolean,"owner_buyer_test_id" uuid);
create table public.icash_voice_configs ("account_id" uuid,"enabled" boolean,"agent_id" text,"phone_number_id" text,"agent_config_hash" text,"reviewed_until" timestamp with time zone,"seller_rate_id" uuid,"buyer_rate_id" uuid,"max_duration_seconds" integer,"required_tool_ids" text[],"approved_voice_ids" text[]);
create table public.icash_voice_jobs ("id" uuid,"account_id" uuid,"permission_id" uuid,"callback_id" uuid,"due_at" timestamp with time zone,"state" text,"outcome" text,"operation_key" text,"conversation_id" text,"provider_call_sid" text,"created_at" timestamp with time zone,"updated_at" timestamp with time zone,"sms_context" jsonb,"operational_contact_id" uuid,"sms_source_message_id" uuid,"sms_requested_at" timestamp with time zone,"sms_requested_by" uuid,"cancellation_notice_id" uuid,"meta_offer_lead_id" uuid,"meta_retry_of" uuid,"meta_followup_lead_id" uuid);
create table public.icash_voice_scheduler ("id" integer,"last_dispatch_at" timestamp with time zone);
create table public.icash_wallets ("account_id" uuid,"balance_cents" bigint,"reserved_cents" bigint,"currency" text);
create table public.icash_customer_update_deliveries ("id" uuid,"account_id" uuid,"channel" text,"source_key" text,"kind" text,"screening_id" uuid,"recipient" text,"preference_revision" integer,"state" text,"created_at" timestamp with time zone,"authorized_at" timestamp with time zone,"provider_id" text,"sender" text);
create table public.icash_deal_files ("id" uuid,"account_id" uuid,"screening_id" uuid,"terms" jsonb,"stage" text,"seller_signed_at" timestamp with time zone,"assignment_signed_at" timestamp with time zone,"title_verified_at" timestamp with time zone,"funded_at" timestamp with time zone,"created_at" timestamp with time zone,"updated_at" timestamp with time zone);
create table public.icash_lifecycle_text_inbox ("event_id" text,"role" text,"sender" text,"recipient" text,"body" text,"attachments" jsonb,"state" text,"created_at" timestamp with time zone);
create table public.icash_seller_gaps ("id" uuid,"account_id" uuid,"deal_id" uuid,"screening_id" uuid,"thread_id" uuid,"source" text,"source_id" uuid,"reason" text,"stage" text,"channel" text,"quote" text,"state" text,"due_at" timestamp with time zone,"expires_at" timestamp with time zone,"source_at" timestamp with time zone,"outgoing_id" uuid,"resolution" text,"resolved_by" uuid,"resolved_at" timestamp with time zone,"created_at" timestamp with time zone,"updated_at" timestamp with time zone,"review_reason" text);
create table public.icash_text_senders ("phone" text,"enabled" boolean);

 alter table icash_voice_jobs add primary key(id),alter column id set default gen_random_uuid(),alter column created_at set default now(),alter column state set default 'ready';
 alter table icash_call_recordings add column if not exists last_action text;
 create unique index icash_voice_operational_first_once on public.icash_voice_jobs(operational_contact_id) where callback_id is null and cancellation_notice_id is null;
 create table icash_recording_private.terminal_cost_receipts(recording_id uuid,receipt jsonb);
 create table icash_seller_agreement_private.call_history(contact_key text,transcript jsonb);
 create table icash_cancellation_notices(account_id uuid,sms_id uuid);
 create table icash_seller_recovery_attempts(account_id uuid,thread_id uuid,reason text,assigned_at timestamptz);
 create table icash_text_suppressions(phone text);
 create table icash_property_controls(account_id uuid,screening_id uuid,manual boolean);
 create table icash_outreach_campaigns(account_id uuid,mode text);
 create table icash_dnc_verification_receipts(id uuid,evidence_kind text);
 create table fixture_eligibility(account_id uuid,contact_id uuid,allowed boolean);
 create view public.icash_voice_contact_targets as select id,account_id,screening_id,phone,contact_key,party,permission_until,revoked_at,'operator_record'::text eligibility_source from icash_contact_permissions
 union all select id,account_id,screening_id,phone,contact_key,'seller',eligibility_until,revoked_at,'operational_checks_only' from icash_operational_contacts;
 create function icash_outreach_voice_current(uuid) returns boolean language sql as $$select not exists(select 1 from public.icash_outreach_campaigns where account_id=$1 and mode='sms_inbound')$$;
 -- Boundary substitute only. Actual contact/financial/hour admission remains
 -- covered by the existing operational and final dial suites.
 create function icash_operational_contact_current(uuid,uuid,text,boolean) returns boolean language sql as $$select coalesce((select allowed from public.fixture_eligibility where account_id=$1 and contact_id=$2),false)$$;
 create function icash_seller_response_operation_allowed(uuid,text) returns boolean language sql as $$select not exists(select 1 from public.icash_voice_jobs j join public.icash_operational_contacts c on c.id=j.operational_contact_id and c.account_id=j.account_id where j.account_id=$1 and 'voice:'||j.id=$2 and (exists(select 1 from public.icash_text_suppressions s where s.phone=c.phone) or exists(select 1 from public.icash_property_controls p where p.account_id=c.account_id and p.screening_id=c.screening_id and p.manual)))$$;
 create function icash_voice_outreach_context(uuid,uuid) returns jsonb language sql as $$select '{"activeConversation":false}'::jsonb$$;
 create function icash_requested_seller_call_current(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_meta_followup_call_current(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_owner_demo_call_current(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_prepare_operational_contacts() returns void language sql as $$select$$;
 create function icash_queue_voice_jobs_before_operational() returns void language sql as $$select$$;
 insert into icash_operating_budget(id,enabled) values(1,true);
 set check_function_bodies=off;create function public.icash_seller_direct_response_match(p_body text,p_pattern text) returns boolean
language plpgsql immutable security invoker set search_path='' as $fn$
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
end $fn$;

CREATE OR REPLACE FUNCTION public.icash_call_has_seller_response(p_result jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_result->'transcript')='array' then p_result->'transcript' else '[]'::jsonb end) t
 where t->>'role'='user' and (
  case when t->>'message' ~ '[[:alpha:]]'
   and t->>'message' !~* '^\s*[\[(*]?\s*(music|silence|noise|background noise|inaudible|unintelligible|no speech|no audio)\s*[\])*]?\s*[.!]*\s*$'
   and t->>'message' !~* 'leave (a |an |your )?((additional|brief|short) )?message|record (a |your )?message|(at|after) the (sound of the )?(beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call|when you( have|[’'']ve|ve) finished recording|^\s*(stay|hold|remain) on the line[.! ]*$|this person is not available|press the (pound|star|[0-9#*]) key|^\s*[. ]*(?:(?:when (?:that.s|you.ve|you have)|have) )?finish(?:ed)? recording[,. ]+you may hang up|^\s*[. ]*recording[, ]+you may hang up|^\s*to end recording[.! ]*$|^\s*this is a recorded message[.! ]|^\s*[¿]?(?:puedes|puede|pueden) colgar cuando hayas? terminado de grabar(?:lo)?|(?:graba|grabe|deja|deje) (?:tu|su|un) mensaje despu[eé]s (?:del tono|de la se[ñn]al)|^\s*deje despu[eé]s del tono|^\s*no se ha grabado nada[.! ]|^\s*[0-9 -]{4,16} is not available[.! ]*$'
   and (t->>'message' !~* '^\s*at the (beep|beach)[.! ,]*thank you[.! ,]*$' or not exists(
    select 1 from jsonb_array_elements(p_result->'transcript') machine
    where machine->>'role'='user' and machine->>'message' ~* 'leave (a |an |your )?((additional|brief|short) )?message|record (a |your )?message|(at|after) the (sound of the )?(beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call|when you( have|[’'']ve|ve) finished recording|^\s*(stay|hold|remain) on the line[.! ]*$|this person is not available|press the (pound|star|[0-9#*]) key|^\s*[. ]*(?:(?:when (?:that.s|you.ve|you have)|have) )?finish(?:ed)? recording[,. ]+you may hang up|^\s*[. ]*recording[, ]+you may hang up|^\s*to end recording[.! ]*$|^\s*this is a recorded message[.! ]|^\s*[¿]?(?:puedes|puede|pueden) colgar cuando hayas? terminado de grabar(?:lo)?|(?:graba|grabe|deja|deje) (?:tu|su|un) mensaje despu[eé]s (?:del tono|de la se[ñn]al)|^\s*deje despu[eé]s del tono|^\s*no se ha grabado nada[.! ]|^\s*[0-9 -]{4,16} is not available[.! ]*$')) then true
   else public.icash_seller_response_disposition(t->>'message')='opt_out' end));
$function$
;
CREATE OR REPLACE FUNCTION public.icash_open_seller_gap(p_account uuid, p_thread uuid, p_source text, p_source_id uuid, p_reason text, p_quote text, p_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;d public.icash_deal_files;new_id uuid;initial text;due timestamptz;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' and retired_at is null;
 if not found or p_source_id is null or p_at is null or p_at>now() or p_at<now()-interval '7 days' then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true';
 if not found or p_reason is null then return null;end if;
 initial:=case when p_reason='contact_stop' then 'suppressed' when p_reason in ('human','declined','owners','material_facts','callback','delivery_unknown') then 'needs_review' else 'open' end;
 -- Clarify once. An unresolved reply after a recovery is a human task, not a loop.
 if p_reason in ('unanswered','repeated_question') and exists(select 1 from public.icash_seller_recovery_attempts where account_id=p_account and thread_id=t.id and reason in ('unanswered','repeated_question') and assigned_at>now()-interval '7 days') then initial:='needs_review';end if;
 due:=greatest(now(),p_at+case when p_reason='no_response' then interval '24 hours' else interval '2 minutes' end);

 -- Operational observations currently last 24 hours from their original source.
 -- Allow one same-day continuation; a missed window needs new contact checks.
 if p_reason='no_response' and t.operational_contact_id is not null then
  due:=greatest(now(),p_at+interval '3 days');
  if t.eligibility_until is null or due>=t.eligibility_until then initial:='needs_review';end if;
 end if;
 insert into public.icash_seller_gaps(account_id,deal_id,screening_id,thread_id,source,source_id,reason,stage,channel,quote,state,due_at,expires_at,source_at)
 values(p_account,d.id,d.screening_id,t.id,p_source,p_source_id,p_reason,d.stage,case when p_source in ('call','inbound_call','tool') then 'call' else 'text' end,left(coalesce(p_quote,''),1000),initial,due,p_at+interval '7 days',p_at)
 on conflict(source,source_id,reason) do nothing returning icash_seller_gaps.id into new_id;

 if new_id is not null and initial='needs_review' and p_reason='no_response' and t.operational_contact_id is not null then
  update public.icash_seller_gaps set review_reason='contact_checks_expired' where id=new_id;
 end if;
 return new_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_queue_voice_jobs()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_operational_contacts;b record;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform public.icash_prepare_operational_contacts();
 perform public.icash_queue_voice_jobs_before_operational();
 for c in with prior_first_routes as materialized (
 select prior.account_id,target.screening_id,target.contact_key
 from public.icash_voice_jobs prior join public.icash_voice_contact_targets target
  on target.id=coalesce(prior.permission_id,prior.operational_contact_id) and target.account_id=prior.account_id
 where prior.callback_id is null
), candidates as materialized (
 select op.* from public.icash_operational_contacts op
 join public.icash_accounts a on a.id=op.account_id and not a.bot_paused
 join public.icash_voice_configs cfg on cfg.account_id=op.account_id and cfg.enabled and cfg.reviewed_until>now()
 join public.icash_screening_jobs s on s.id=op.screening_id and s.account_id=op.account_id and s.state='complete' and s.result->'financialCheck'->>'status'='eligible'
 where op.channel='voice' and op.revoked_at is null and op.eligibility_until>now()
 and not exists(select 1 from public.icash_contact_permissions legacy where legacy.account_id=op.account_id and legacy.screening_id=op.screening_id and legacy.phone=op.phone)
 and not exists(select 1 from public.icash_outreach_campaigns campaign where campaign.account_id=op.account_id and campaign.mode='sms_inbound')
 and not exists(select 1 from prior_first_routes prior
  where prior.account_id=op.account_id and prior.screening_id=op.screening_id and prior.contact_key=op.contact_key)
 ) select op.* from candidates op
 where case when public.icash_outreach_voice_current(op.account_id) then
  (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=op.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
   or public.icash_operational_contact_current(op.account_id,op.id,'voice',false))
  else false end
 order by op.created_at,op.id limit 100
 loop
  if public.icash_operational_contact_current(c.account_id,c.id,'voice',false)
   and not exists(select 1 from public.icash_voice_jobs j join public.icash_voice_contact_targets target on target.id=coalesce(j.permission_id,j.operational_contact_id)
    where j.account_id=c.account_id and target.account_id=c.account_id and target.screening_id=c.screening_id and target.contact_key=c.contact_key and j.callback_id is null)
  then insert into public.icash_voice_jobs(account_id,operational_contact_id) values(c.account_id,c.id) on conflict do nothing;end if;
 end loop;
 for b in with callback_candidates as materialized (
 select cb.id,cb.account_id,cb.due_at,op.id as target_id,op.dnc_receipt_id,op.created_at as contact_created_at from public.icash_live_callbacks cb
 join public.icash_live_conversations call on call.id=cb.conversation_id and call.account_id=cb.account_id and call.state='complete' and (call.result->>'callbackDueAt')::timestamptz=cb.due_at
 join public.icash_operational_contacts op on op.account_id=cb.account_id and op.screening_id=cb.screening_id and op.contact_key=call.contact_key and op.channel='voice'
 where public.icash_outreach_voice_current(cb.account_id) and call.party='seller' and cb.state='pending_dispatch_review' and cb.due_at>now()-interval '15 minutes'
 and not exists(select 1 from public.icash_voice_jobs job where job.callback_id=cb.id)
 and not exists(select 1 from public.icash_outreach_campaigns campaign where campaign.account_id=cb.account_id and campaign.mode='sms_inbound')
 ) select candidate.id,candidate.account_id,candidate.due_at,candidate.target_id from callback_candidates candidate
 where (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=candidate.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
  or public.icash_operational_contact_current(candidate.account_id,candidate.target_id,'voice',false))
 order by candidate.due_at,candidate.contact_created_at desc limit 100
 loop
  if public.icash_operational_contact_current(b.account_id,b.target_id,'voice',false) then
   insert into public.icash_voice_jobs(account_id,operational_contact_id,callback_id,due_at) values(b.account_id,b.target_id,b.id,b.due_at) on conflict do nothing;
  end if;
 end loop;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_seller_call_disposition(p_result jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare turns jsonb:=case when jsonb_typeof(p_result->'transcript')='array' then p_result->'transcript' else '[]'::jsonb end;
 turn jsonb;message text;last_agent text:='';current_disposition text;disposition text;
begin
 if exists(select 1 from jsonb_array_elements(turns) t where t->>'role'='user' and public.icash_seller_response_disposition(t->>'message')='opt_out') then return 'opt_out';end if;
 if not exists(select 1 from jsonb_array_elements(turns) t where t->>'role'='user' and t->>'message' ~* '[a-z0-9]') then return null;end if;
 for turn in select value from jsonb_array_elements(turns) loop
  message:=turn->>'message';
  if turn->>'role'='agent' then last_agent:=coalesce(message,'');continue;end if;
  if turn->>'role' is distinct from 'user' or jsonb_typeof(turn->'message') is distinct from 'string' then continue;end if;
  if trim(message) ~* $pattern$^(?:(?:hi|hello)[,.! ]+)?(?:you.{0,8}(?:have reached|ve reached)|(?:this is |welcome to ).{0,60}(?:voice[ -]?mail|mailbox|automated (?:system|assistant))|(?:please )?leave.{0,25}(?:message|name|number)|after.{0,12}(?:tone|beep)|(?:the person|the subscriber|the number|your call|the call|this number).{0,80}(?:not available|unavailable|forwarded|disconnected|not in service)|no one is available|press [0-9]|comunicarte.{0,30}no est[aá] disponible|(?:buz[oó]n de voz|correo de voz)|(?:graba|grabe|deja|deje).{0,25}mensaje)$pattern$ then last_agent:='';continue;end if;
  current_disposition:=public.icash_seller_response_disposition(message);
  if current_disposition is null and trim(message) ~* '^no([,! .]+(thanks|thank you|gracias))?[.! ]*$'
   and last_agent ~* 'interested.{0,35}(sell|cash offer)|consider selling|want to sell|open to.{0,15}cash offer' then current_disposition:='declined';end if;
  if current_disposition='opt_out' then return current_disposition;end if;
  if current_disposition='declined' or disposition is null then disposition:=current_disposition;end if;
  last_agent:='';
 end loop;
 return disposition;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_seller_phone_call_current(p_account uuid, p_job uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_voice_jobs;p public.icash_voice_contact_targets;n bigint;last_attempt timestamptz;unknown_attempt boolean;
begin
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account;
 if not found then return false;end if;
 select * into p from public.icash_voice_contact_targets
 where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=p_account and party='seller'
 and ((j.permission_id is not null and j.operational_contact_id is null and eligibility_source='operator_record')
  or (j.permission_id is null and j.operational_contact_id is not null and eligibility_source='operational_checks_only'));
 if not found or p.phone is null or p.phone !~ '^\+[1-9][0-9]{7,14}$' then return false;end if;
 if exists(select 1 from public.icash_call_recordings r where r.voice_job_id=p_job
  and (r.account_id is distinct from p_account or r.to_phone is distinct from p.phone)) then return false;end if;
 select count(*),max(at),coalesce(bool_or(unknown),false) into n,last_attempt,unknown_attempt from (
  select r.dial_claimed_at at,(r.call_sid is null and r.call_ended_at is null) unknown
  from public.icash_call_recordings r
  where r.party='seller' and r.to_phone=p.phone and r.voice_job_id is distinct from p_job and r.dial_claimed_at is not null
   and (r.dial_claimed_at>now()-interval '24 hours' or (r.call_sid is null and r.call_ended_at is null))
  union all
  select c.created_at,false from public.icash_customer_phone_calls c
  where c.recipient_phone=p.phone and c.child_sid is not null and c.created_at>now()-interval '24 hours'
 ) attempts;
 if unknown_attempt then return false;end if;
 -- Real active conversations, due requested callbacks and validated notices
 -- retain the existing receipt-bound service path. A job flag is not proof.
 if coalesce(public.icash_voice_outreach_context(p_account,p_job)->>'activeConversation','false')='true'
  or public.icash_requested_seller_call_current(p_account,p_job) then return true;end if;
 -- A completed address response followed by a ready cash offer is existing
 -- seller work. Bind it to the original lead, permission, phone and actual call.
 if j.meta_offer_lead_id is not null and exists(
  select 1 from public.icash_meta_leads m
  join public.icash_seller_intakes l on l.id=m.lead_id and l.phone=p.phone
  join public.icash_contact_permissions cp on cp.id=j.permission_id and cp.account_id=m.account_id
   and cp.seller_intake_id=m.lead_id and cp.screening_id=m.screening_id and cp.phone=l.phone
  join public.icash_call_recordings first_call on first_call.voice_job_id=m.voice_job_id
   and first_call.account_id=m.account_id and first_call.to_phone=l.phone and first_call.call_sid is not null
  where m.lead_id=j.meta_offer_lead_id and m.account_id=p_account and m.screening_id=p.screening_id
   and m.address_confirmed_at>=first_call.dial_claimed_at and m.address_confirmed_at<=now()
   and m.offer_ready_at>=m.address_confirmed_at and m.offer_ready_at<=now()
   and m.offer_authorized_at is null and not m.paused and not m.voice_paused and m.declined_at is null
   and cp.revoked_at is null and cp.permission_until>now()
 ) then return true;end if;
 if j.meta_followup_lead_id is not null then
  return n<2 and (last_attempt is null or last_attempt<=now()-interval '2 hours')
   and public.icash_meta_followup_call_current(j.meta_followup_lead_id,p_job);
 end if;
 -- Owner self-demonstrations require their own fresh form receipt even when
 -- the rolling-day window clears. Expired requests cannot dial tomorrow.
 if p_account='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid and p.phone='+12142185280'
  and exists(select 1 from public.icash_contact_permissions cp
   join public.icash_seller_intakes l on l.id=cp.seller_intake_id
   where cp.id=j.permission_id and cp.account_id=p_account and l.contact_consent_scope='icash_x_demo') then
  return public.icash_owner_demo_call_current(p_account,p_job);
 end if;
 -- One new automatic introduction per phone per rolling day. Other properties
 -- do not create permission to call the same person again immediately.
 return n=0;
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
 if public.icash_seller_direct_response_match(b,$pattern$\y(?:do not|don't|dont) send (?:me|us) (?:any |more |any more )?(?:texts?|messages?|emails?)(?: again)?\y|(?:^|[.!?;] +)(?:please )?stop(?: please)?[.! ,]*$|\y(?:stop|quit) (?:asking|bothering|harassing) (?:me|us)\y|\yplease unsubscribe(?: me)?\y|(?:^|[,;.!] +)(?:please )?(?:unsubscribe|dnc)(?: me)?[.! ,]*$|^(?:please )?(?:stop|stopall|unsubscribe|cancel|end|quit|revoke|opt out|dnc)(?: please)?(?:[.! ,]*$|\s*[,;.!]\s*(?:please\y|call\y|text\y|but\y))|\y(?:(?:do not|don't|dont) want (?:you|your (?:company|business)) to (?:ever )?(?:call|text|email|contact)\y|(?:do not|don't|dont|never) (?:ever )?(?:call|text|email|message|contact)(?:ing)?(?: (?:me|us))?\y(?! (?:it|that|the house|the property)\y)|(?:stop|quit) (?:(?:calling|texting|emailing|messaging|contacting)\y|(?:call|text|email|message|contact)\y(?! (?:it|that|the house|the property)\y))|(?:unsubscribe|remove|delete) (?:me|us|(?:my|our|this) (?:phone )?number)\y|take (?:me|us|(?:my|our|this) (?:phone )?number) off\y|leave (?:me|us) alone\y|(?:put|add|place) (?:me|us|(?:my|our|this) (?:phone )?number) (?:on|in) (?:your |the )?(?:dnc|do not call)(?: list)?\y|(?:i am|i'm) (?:already )?on (?:the |your )?(?:dnc|do not call) list\y)$pattern$) then return 'opt_out';end if;
 decline_body:=case when b ~ '\y(call|talk)\y' then regexp_replace(b,$pattern$\ynot (?:(?:super|very|really|that|at all) )?interested in (?:texting|emailing|emails|texts)\y$pattern$,'','g') else b end;
 if public.icash_seller_direct_response_match(decline_body,$pattern$\y(?:i|we)(?:'ve)? (?:(?:have|already) ){0,2}told (?:you|yall|y'all|you all) no\y|\y(?:i|we) (?:will not|won't|wont) (?:ever )?sell\y|\y(?:no thanks|no thank you|wrong (?:phone )?number|not for sale|not (?:(?:super|very|really|that|at all) )?interested|(?:do not|don't|dont) want to sell|not selling(?: (?:my|our|the) (?:house|home|property))?|no quiero vender|no me interesa vender)\y$pattern$) then
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
CREATE OR REPLACE FUNCTION public.icash_seller_text_cadence_current(p_account uuid, p_thread uuid, p_message uuid DEFAULT NULL::uuid, p_followup boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;d public.icash_deal_files;last_body text;n integer;first_at timestamptz;original_thread uuid;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found then return false;end if;
 if t.party<>'seller' then return true;end if;
 -- Human-authored sends and verified cancellation workflows retain their own
 -- final consent/suppression gates. A draft is never an incoming response.
 if p_message is not null and exists(select 1 from public.icash_text_messages m
  where m.id=p_message and m.thread_id=t.id and m.account_id=p_account
   and (m.customer_author_id is not null or exists(select 1 from public.icash_cancellation_notices c where c.account_id=p_account and c.sms_id=m.id))) then return true;end if;
 -- Requested-contact flows keep their separately verified source-bound sequence.
 -- This field does not grant consent: their existing final evidence gate still runs.
 if t.seller_intake_id is not null and t.operational_contact_id is null then return true;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account;
 if not found then return false;end if;
 -- Continue source-backed human replies and ongoing signed work normally.
 if d.stage not in ('draft','cancelled','closed') then return true;end if;
 if exists(select 1 from public.icash_text_messages m where m.thread_id=t.id and m.account_id=p_account
  and m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)
  and m.created_at between now()-interval '24 hours' and now()
  and m.body ~ '[[:alnum:]]' and m.body !~* '(^Free Msg:|Message Blocking is active|verification code|one.time (password|code))'
  and public.icash_seller_response_disposition(m.body) is null)
 or exists(select 1 from public.icash_live_conversations c where c.account_id=p_account and c.screening_id=d.screening_id
  and c.contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex') and c.state='complete'
  and c.completed_at between now()-interval '24 hours' and now() and c.conversation_id is not null
  and public.icash_call_has_seller_response(c.result)) then return true;end if;
 -- Natural refusals on another property cannot restart automated cold pursuit.
 select m.body into last_body from public.icash_text_threads other
 join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
 where other.recipient=t.recipient and other.party='seller' and m.direction='incoming'
  and m.state='received' and (m.provider_id is not null or m.event_id is not null)
 order by m.created_at desc,m.id desc limit 1;
 if public.icash_seller_response_disposition(last_body) is not null then return false;end if;
 -- Include every business number, property and account, including retired history.
 -- Unknown or already reserved sends cannot be treated as an unused introduction.
 if exists(select 1 from public.icash_text_threads other
  join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
  left join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
  where other.recipient=t.recipient and other.party='seller' and m.direction='outgoing' and m.id is distinct from p_message
   and (m.state in ('dispatching','needs_review') or (m.provider_id is null and o.state in ('reserved','dispatched')))) then return false;end if;
 select count(*),min(sent.at) into n,first_at from (
  select m.thread_id,coalesce(o.dispatched_at,m.created_at) at
  from public.icash_text_threads other
  join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
  left join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
  where other.recipient=t.recipient and other.party='seller' and m.direction='outgoing' and m.id is distinct from p_message
   and (m.provider_id is not null or o.dispatched_at is not null)
  limit 2
 ) sent;
 if n=0 then return not p_followup;end if;
 if n<>1 or not p_followup or first_at>now()-interval '3 days' or first_at<now()-interval '5 days' then return false;end if;
 select m.thread_id into original_thread from public.icash_text_threads other
 join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
 left join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
 where other.recipient=t.recipient and other.party='seller' and m.direction='outgoing' and m.id is distinct from p_message
  and (m.provider_id is not null or o.dispatched_at is not null) limit 1;
 return original_thread=t.id;
end $function$
;
create function public.icash_seller_recorded_call_finished(p_account uuid,p_recording uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.icash_call_recordings r where r.id=p_recording and r.account_id=p_account
  and (r.call_ended_at is not null or exists(select 1 from icash_recording_private.terminal_cost_receipts receipt
     join public.icash_operation_spend spend on spend.operation_key=r.operation_key and spend.account_id=r.account_id and spend.state='settled'
     where receipt.recording_id=r.id and r.last_action='gate_settled'
      and r.state in ('failed','declined','expired')
      and r.conversation_id is null and r.recording_sid is null and r.start_claimed_at is null
      and receipt.receipt->>'status' in ('completed','busy','failed','no-answer','canceled')
      and row(receipt.receipt->>'providerAccountSid',receipt.receipt->>'callSid',receipt.receipt->>'fromPhone',receipt.receipt->>'toPhone')
        is not distinct from row(r.provider_account_sid,r.call_sid,r.from_phone,r.to_phone)
      and r.call_sid is not null and r.provider_account_sid is not null)));
$$;
revoke all on function public.icash_seller_recorded_call_finished(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_recorded_call_finished(uuid,uuid) to service_role;
set check_function_bodies=on;begin;-- Source-bound ownership and selling refusals; never infer an opt-out from no.
-- No provider requests, historical replay, new contact authority or UI change.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$ begin
 if md5(pg_get_functiondef('public.icash_seller_call_disposition(jsonb)'::regprocedure))<>'070b7300e48791b0aa5f30c2c6caf6d3'
  or md5(pg_get_functiondef('public.icash_seller_response_disposition(text)'::regprocedure))<>'dff2b608dfa29241520e97d89c037715'
 then raise exception 'Seller call context prerequisite changed';end if;
end $guard$;
create function public.icash_seller_call_answer_disposition(p_question text,p_answer text)
returns text language plpgsql immutable security invoker set search_path='' as $fn$
declare q text:=lower(btrim(regexp_replace(replace(coalesce(p_question,''),'’',chr(39)),'[[:space:]]+',' ','g')));
 a text:=lower(btrim(regexp_replace(replace(coalesce(p_answer,''),'’',chr(39)),'[[:space:]]+',' ','g')));last_question text;
begin
 select part into last_question from unnest(string_to_array(q,'?')) with ordinality parts(part,n) where btrim(part)<>'' order by n desc limit 1;
 if last_question ~ $pattern$\y(?:is this|are you|am i (?:speaking|talking) (?:to|with)) (?:the )?(?:property )?owner\y|\ydo you (?:still )?own\y|\yis .{1,100} (?:your (?:house|home|property)|yours)\y$pattern$ then
  if a ~ $pattern$^(?:no|nope|nah|naw)(?:[,! .]+(?:thanks|thank you|gracias|sir|ma'am|maam|i (?:am not|don't|do not)|i'm not|we (?:are not|don't|do not)|that's not me))?[.! ,]*$|^(?:not me|i am not|i'm not|i don't|i do not|we are not|we don't|we do not)[.! ,]*$$pattern$ then return 'declined';end if;
  if a ~ $pattern$^(?:no|nope|nah|naw)\y$pattern$ then return 'review';end if;
 end if;
 if last_question ~ $pattern$\y(?:interested.{0,35}(?:sell|cash offer)|consider (?:selling|a cash offer)|want to sell|open to.{0,15}cash offer)\y$pattern$ and a ~ $pattern$^(?:no|nope|nah|naw)(?:[,! .]+(?:thanks|thank you|gracias|sir|ma'am|maam|i (?:am not|don't|do not)|i'm not|we (?:are not|don't|do not)|that's not me))?[.! ,]*$|^(?:not me|i am not|i'm not|i don't|i do not|we are not|we don't|we do not)[.! ,]*$$pattern$ then return 'declined';end if;
 return null;
end $fn$;
revoke all on function public.icash_seller_call_answer_disposition(text,text) from public,anon,authenticated;
grant execute on function public.icash_seller_call_answer_disposition(text,text) to service_role;
do $patch$
declare d text;old text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_seller_call_disposition(jsonb)'::regprocedure);
 old:=$old$  if current_disposition is null and trim(message) ~* '^no([,! .]+(thanks|thank you|gracias))?[.! ]*$'
   and last_agent ~* 'interested.{0,35}(sell|cash offer)|consider selling|want to sell|open to.{0,15}cash offer' then current_disposition:='declined';end if;$old$;
 replacement:=$new$  if current_disposition='declined' and btrim(last_agent)<>''
   and lower(btrim(regexp_replace(replace(message,'’',chr(39)),'[[:space:]]+',' ','g'))) ~ $answer$^no[,! .]+(?:thanks|thank you|gracias)[.! ,]*$$answer$ then
   current_disposition:=public.icash_seller_call_answer_disposition(last_agent,message);
  end if;
  if current_disposition is null then current_disposition:=public.icash_seller_call_answer_disposition(last_agent,message);end if;$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Seller call answer patch changed';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_seller_response_disposition(text)'::regprocedure);
 old:=$old$\y(?:i|we)(?:'ve)? (?:(?:have|already) ){0,2}told (?:you|yall|y'all|you all) no\y|\y(?:i|we) (?:will not|won't|wont) (?:ever )?sell\y|\y(?:no thanks|no thank you|wrong (?:phone )?number|not for sale|not (?:(?:super|very|really|that|at all) )?interested|(?:do not|don't|dont) want to sell|not selling(?: (?:my|our|the) (?:house|home|property))?|no quiero vender|no me interesa vender)\y$old$;
 replacement:=$new$\y(?:i|we)(?:'ve)? (?:(?:have|already) ){0,2}told (?:you|yall|y'all|you all) no\y|\y(?:i|we) (?:will not|won't|wont) (?:ever )?sell\y|\y(?:no thanks|no thank you|wrong (?:phone )?number|not (?:up )?for sale|(?:i am|i'm|we are|we're) not (?:the )?owner|(?:i|we) (?:do not|don't|dont) own (?:the |this |that |my |our )?(?:house|home|property)|not (?:(?:super|very|really|that|at all) )?interested|(?:do not|don't|dont) want to sell|not selling(?: (?:my|our|the) (?:house|home|property))?|no quiero vender|no me interesa vender)\y$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Seller direct refusal patch changed';end if;
 execute replace(d,old,replacement);
end $patch$;
-- Prospective second outreach, bounded to the original contact evidence.
-- Caller owns the migration transaction and receipt. No existing job is retried.
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$ begin
 if md5(pg_get_functiondef('public.icash_queue_voice_jobs()'::regprocedure))<>'29afd464ca9254386392984bf86b72a9'
  or md5(pg_get_functiondef('public.icash_seller_phone_call_current(uuid,uuid)'::regprocedure))<>'f61390aea2be0e3d3a88e70554272ce2'
  or md5(pg_get_functiondef('public.icash_seller_text_cadence_current(uuid,uuid,uuid,boolean)'::regprocedure))<>'3c9ac9061e2d6d52365621bb13da7a55'
  or pg_get_indexdef('public.icash_voice_operational_first_once'::regclass)<>'CREATE UNIQUE INDEX icash_voice_operational_first_once ON public.icash_voice_jobs USING btree (operational_contact_id) WHERE ((callback_id IS NULL) AND (cancellation_notice_id IS NULL))'
 then raise exception 'Unanswered seller follow-up prerequisite changed';end if;
 if to_regprocedure('public.icash_seller_call_answer_disposition(text,text)') is null then raise exception 'Seller refusal correction required first';end if;
end $guard$;
create table icash_seller_recovery_private.unanswered_policy(
 id integer primary key check(id=1),enabled boolean not null default false,activated_at timestamptz,scan_at timestamptz,scan_id uuid,
 check((scan_at is null)=(scan_id is null)),
 check(not enabled or activated_at is not null)
);
insert into icash_seller_recovery_private.unanswered_policy(id) values(1);
alter table icash_seller_recovery_private.unanswered_policy enable row level security;
revoke all on icash_seller_recovery_private.unanswered_policy from public,anon,authenticated,service_role;
grant select,update(scan_at,scan_id) on icash_seller_recovery_private.unanswered_policy to service_role;
alter table public.icash_voice_jobs add column seller_followup_of uuid references public.icash_voice_jobs(id);
alter table public.icash_voice_jobs add constraint seller_unanswered_followup_shape check(seller_followup_of is null or
 (seller_followup_of<>id and operational_contact_id is not null and permission_id is null and callback_id is null
  and sms_source_message_id is null and cancellation_notice_id is null and meta_offer_lead_id is null and meta_retry_of is null and meta_followup_lead_id is null));
create unique index icash_seller_unanswered_call_once on public.icash_voice_jobs(seller_followup_of) where seller_followup_of is not null;
drop index public.icash_voice_operational_first_once;
create unique index icash_voice_operational_first_once on public.icash_voice_jobs(operational_contact_id)
 where callback_id is null and cancellation_notice_id is null and seller_followup_of is null;

create function public.icash_unanswered_seller_call_current(p_account uuid,p_original uuid,p_followup uuid default null)
-- Boolean-only service RPC reads private original receipts; never grants raw receipt access.
returns boolean language plpgsql security definer set search_path='' as $fn$
declare j public.icash_voice_jobs;c public.icash_operational_contacts;r public.icash_call_recordings;cutover timestamptz;
begin
 select activated_at into cutover from icash_seller_recovery_private.unanswered_policy where id=1 and enabled;
 if cutover is null then return false;end if;
 select * into j from public.icash_voice_jobs where id=p_original and account_id=p_account;
 if not found or j.seller_followup_of is not null or j.operational_contact_id is null or j.permission_id is not null
  or j.callback_id is not null or j.sms_source_message_id is not null or j.cancellation_notice_id is not null
  or j.meta_offer_lead_id is not null or j.meta_retry_of is not null or j.meta_followup_lead_id is not null
  or j.created_at<cutover or j.state<>'dispatched' then return false;end if;
 select * into c from public.icash_operational_contacts where id=j.operational_contact_id and account_id=p_account and channel='voice';
 if not found or c.revoked_at is not null or (c.eligibility_until>clock_timestamp()) is not true
  or public.icash_outreach_voice_current(p_account) is not true
  or public.icash_seller_response_operation_allowed(p_account,'voice:'||j.id) is not true
  or public.icash_operational_contact_current(p_account,c.id,'voice',false) is not true then return false;end if;
 if not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused)
  or not exists(select 1 from public.icash_wallets where account_id=p_account and balance_cents>reserved_cents)
  or exists(select 1 from public.icash_voice_jobs other where other.seller_followup_of=j.id and other.id is distinct from p_followup)
  or (p_followup is not null and not exists(select 1 from public.icash_voice_jobs f where f.id=p_followup and f.account_id=p_account and f.seller_followup_of=j.id and f.operational_contact_id=c.id)) then return false;end if;
 select * into r from public.icash_call_recordings where voice_job_id=j.id and account_id=p_account and party='seller'
  and operation_key='voice:'||j.id and screening_id=c.screening_id and to_phone=c.phone and contact_key=c.contact_key;
 if not found or r.call_sid is null or r.dial_claimed_at is null or r.dial_claimed_at<cutover
  or r.dial_claimed_at>clock_timestamp()-interval '2 hours' or r.dial_claimed_at<clock_timestamp()-interval '24 hours'
  or public.icash_seller_recorded_call_finished(p_account,r.id) is not true
  or not exists(select 1 from public.icash_operation_spend where operation_key=r.operation_key and account_id=p_account and state='settled') then return false;end if;
 -- Explicit terminal evidence only: no missing transcript or model flag guesses.
 if not exists(select 1 from public.icash_live_conversations conv where conv.account_id=p_account and conv.screening_id=c.screening_id
   and conv.operation_key=r.operation_key and conv.conversation_id=r.conversation_id and conv.contact_key=c.contact_key
   and conv.party='seller' and conv.state='complete' and conv.completed_at>=r.dial_claimed_at
   and conv.result->>'contactEvidence' in ('no_response','automated_answer')
   and public.icash_seller_call_disposition(conv.result) is null and not public.icash_call_has_seller_response(conv.result)
   and coalesce(conv.result->>'humanRequested','false')='false')
  and not exists(select 1 from icash_recording_private.terminal_cost_receipts receipt where receipt.recording_id=r.id
   and receipt.receipt->>'status' in ('no-answer','busy')
   and row(receipt.receipt->>'providerAccountSid',receipt.receipt->>'callSid',receipt.receipt->>'fromPhone',receipt.receipt->>'toPhone')
    is not distinct from row(r.provider_account_sid,r.call_sid,r.from_phone,r.to_phone)) then return false;end if;
 -- Any actual reply ends the unanswered sequence, regardless of the channel.
 if exists(select 1 from public.icash_text_threads t join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
   where t.recipient=c.phone and t.party='seller' and m.direction='incoming' and m.state='received'
    and (m.provider_id is not null or m.event_id is not null))
  or exists(select 1 from public.icash_live_conversations conv where conv.contact_key=c.contact_key and conv.party='seller' and conv.state='complete'
   and (public.icash_call_has_seller_response(conv.result) or public.icash_seller_call_disposition(conv.result) is not null))
  or exists(select 1 from icash_seller_agreement_private.call_history h where h.contact_key=c.contact_key
   and (public.icash_call_has_seller_response(jsonb_build_object('transcript',h.transcript)) or public.icash_seller_call_disposition(jsonb_build_object('transcript',h.transcript)) is not null))
  or exists(select 1 from public.icash_call_recordings other where other.to_phone=c.phone and other.id<>r.id
   and other.voice_job_id is distinct from p_followup and other.dial_claimed_at is not null
   and (other.dial_claimed_at>=r.dial_claimed_at or not public.icash_seller_recorded_call_finished(other.account_id,other.id)))
  or exists(select 1 from public.icash_customer_phone_calls human where human.recipient_phone=c.phone and human.child_sid is not null and human.created_at>=r.dial_claimed_at)
 then return false;end if;
 return true;
end $fn$;
revoke all on function public.icash_unanswered_seller_call_current(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_unanswered_seller_call_current(uuid,uuid,uuid) to service_role;

create function public.icash_queue_unanswered_seller_calls() returns integer
language plpgsql security invoker set search_path='' as $fn$
declare candidate record;created integer:=0;added integer;visited boolean:=false;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;if not found then return 0;end if;
 for candidate in
  select j.id,j.account_id,j.operational_contact_id,r.id recording_id,r.dial_claimed_at from public.icash_call_recordings r
  join public.icash_voice_jobs j on j.id=r.voice_job_id and j.account_id=r.account_id
  join public.icash_operational_contacts c on c.id=j.operational_contact_id and c.account_id=j.account_id
  join public.icash_accounts a on a.id=j.account_id and not a.bot_paused
  join public.icash_wallets w on w.account_id=j.account_id and w.balance_cents>w.reserved_cents
  join icash_seller_recovery_private.unanswered_policy policy on policy.id=1 and policy.enabled
  where j.seller_followup_of is null and j.state='dispatched' and j.created_at>=policy.activated_at
   and r.dial_claimed_at between greatest(policy.activated_at,now()-interval '24 hours') and now()-interval '2 hours'
   and c.eligibility_until>now() and c.revoked_at is null
   and (policy.scan_at is null or (r.dial_claimed_at,r.id)>(policy.scan_at,policy.scan_id))
   and not exists(select 1 from public.icash_voice_jobs f where f.seller_followup_of=j.id)
  order by r.dial_claimed_at,r.id limit 20
 loop
  visited:=true;
  update icash_seller_recovery_private.unanswered_policy set scan_at=candidate.dial_claimed_at,scan_id=candidate.recording_id where id=1;
  if public.icash_unanswered_seller_call_current(candidate.account_id,candidate.id) then
   insert into public.icash_voice_jobs(account_id,operational_contact_id,seller_followup_of,due_at)
    values(candidate.account_id,candidate.operational_contact_id,candidate.id,clock_timestamp()) on conflict do nothing;
   get diagnostics added=row_count;created:=created+added;
  end if;
 end loop;
 if not visited then update icash_seller_recovery_private.unanswered_policy set scan_at=null,scan_id=null where id=1;end if;
 return created;
end $fn$;
revoke all on function public.icash_queue_unanswered_seller_calls() from public,anon,authenticated;
grant execute on function public.icash_queue_unanswered_seller_calls() to service_role;

do $patch$
declare d text;old text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_seller_phone_call_current(uuid,uuid)'::regprocedure);
 old:=' -- Real active conversations, due requested callbacks and validated notices';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Unanswered final call guard changed';end if;
 execute replace(d,old,$new$ if j.seller_followup_of is not null then
  return n=1 and last_attempt<=clock_timestamp()-interval '2 hours'
   and public.icash_unanswered_seller_call_current(p_account,j.seller_followup_of,p_job);
 end if;
$new$||old);
 d:=pg_get_functiondef('public.icash_queue_voice_jobs()'::regprocedure);
 old:=' perform public.icash_prepare_operational_contacts();';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Unanswered call queue hook changed';end if;
 execute replace(d,old,' perform public.icash_queue_unanswered_seller_calls();'||E'
'||old);
 -- The same one-introduction/one-reminder recipient cap remains authoritative.
 -- New reminders fit the original 24-hour observation, avoiding a new purchase.
 -- Prior introductions retain their original three-to-five-day policy.
 d:=pg_get_functiondef('public.icash_seller_text_cadence_current(uuid,uuid,uuid,boolean)'::regprocedure);
 old:='first_at>now()-interval ''3 days'' or first_at<now()-interval ''5 days''';
 replacement:=$new$first_at>now()-(case when exists(select 1 from icash_seller_recovery_private.unanswered_policy policy where policy.id=1 and policy.enabled and first_at>=policy.activated_at) then interval '4 hours' else interval '3 days' end)
  or first_at<now()-(case when exists(select 1 from icash_seller_recovery_private.unanswered_policy policy where policy.id=1 and policy.enabled and first_at>=policy.activated_at) then interval '24 hours' else interval '5 days' end)$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Unanswered text cadence changed';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_open_seller_gap(uuid,uuid,text,uuid,text,text,timestamptz)'::regprocedure);
 old:='due:=greatest(now(),p_at+interval ''3 days'');';
 replacement:=$new$due:=greatest(now(),p_at+case when exists(select 1 from icash_seller_recovery_private.unanswered_policy policy where policy.id=1 and policy.enabled and p_at>=policy.activated_at) then interval '4 hours' else interval '3 days' end);$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Unanswered text due changed';end if;
 execute replace(d,old,replacement);
end $patch$;
-- Keep a canonical Spanish voicemail beginning with no out of seller refusals.
-- Caller owns the transaction; original transcripts and contact authority stay intact.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;old text:='|no one is available|press [0-9]';
 replacement text:='|no se ha grabado nada[.! ]|no one is available|press [0-9]';
begin
 d:=pg_get_functiondef('public.icash_seller_call_disposition(jsonb)'::regprocedure);
 if md5(d)<>'7fa8cdc84ba7694537694a4d52e45001' or (length(d)-length(replace(d,old,'')))<>length(old)
 then raise exception 'Seller automated greeting prerequisite changed';end if;
 execute replace(d,old,replacement);
end $patch$;
commit;
update icash_seller_recovery_private.unanswered_policy set enabled=true,activated_at=now()-interval '12 hours';
insert into icash_accounts(id,bot_paused) values('00000000-0000-4000-8000-000000000001',false);
insert into icash_wallets(account_id,balance_cents,reserved_cents) values('00000000-0000-4000-8000-000000000001',1000,0);
insert into icash_operational_contacts(id,account_id,screening_id,phone,contact_key,channel,eligibility_until)
 values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','+12145550123','fixture-contact','voice',now()+interval '10 hours');
insert into fixture_eligibility values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',true);
insert into icash_voice_jobs(id,account_id,operational_contact_id,state,created_at)
 values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','dispatched',now()-interval '4 hours');
insert into icash_call_recordings(id,account_id,voice_job_id,screening_id,party,operation_key,to_phone,from_phone,contact_key,dial_claimed_at,call_ended_at,call_sid,conversation_id)
 values('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','seller','voice:00000000-0000-4000-8000-000000000004','+12145550123','+17205550100','fixture-contact',now()-interval '3 hours',now()-interval '175 minutes','CAfixture','conv-fixture');
insert into icash_operation_spend(operation_key,account_id,state) values('voice:00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','settled');
insert into icash_live_conversations(id,account_id,screening_id,party,operation_key,contact_key,conversation_id,state,completed_at,result)
 values('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','seller','voice:00000000-0000-4000-8000-000000000004','fixture-contact','conv-fixture','complete',now()-interval '175 minutes','{"contactEvidence":"no_response","transcript":[{"role":"user","message":"..."}]}');
grant usage on schema public to service_role;
grant select on all tables in schema public to service_role;
grant insert on icash_voice_jobs to service_role;
grant update on icash_operating_budget to service_role;
