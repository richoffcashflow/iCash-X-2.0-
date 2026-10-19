-- Current operating policy only: original contact/source/consent metadata stays immutable.
-- Apply after prospecting delivery pacing and automatic prospecting SMS drafts.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.icash_outreach_timezone(p_timezone text,p_basis text default null) returns text
language sql stable security invoker set search_path='' as $$
 select case when p_basis in ('conservative_nanp_window','business_operating_clock') or nullif(btrim(p_timezone),'') is null
  then 'America/Chicago'
  when exists(select 1 from public.icash_timezone_names where name=p_timezone) then p_timezone end
$$;

create function public.icash_outreach_window_open(p_timezone text,p_basis text default null,p_clock timestamptz default now()) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(isfinite(p_clock) and extract(hour from p_clock at time zone public.icash_outreach_timezone(p_timezone,p_basis))>=9
  and extract(hour from p_clock at time zone public.icash_outreach_timezone(p_timezone,p_basis))<21,false)
$$;

-- A submitted form or an unanswered attempt is not an active conversation.
-- Bind the exception to this tenant, property and actual phone, with a recent receipt.
create function public.icash_outreach_active_conversation(p_account uuid,p_screening uuid,p_phone text,p_clock timestamptz default now()) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(isfinite(p_clock) and p_phone ~ '^\+[1-9][0-9]{7,14}$' and (
  exists(select 1 from public.icash_text_threads t
   join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
   join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
   where t.account_id=p_account and d.screening_id=p_screening and t.recipient=p_phone and t.retired_at is null
    and m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)
    and m.created_at between p_clock-interval '24 hours' and p_clock)
  or exists(select 1 from public.icash_live_conversations c
   where c.account_id=p_account and c.screening_id=p_screening
    and c.contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex') and c.state='complete'
    and c.completed_at between p_clock-interval '24 hours' and p_clock
    and c.conversation_id is not null and public.icash_call_has_seller_response(c.result))
 ),false)
$$;

create function public.icash_sms_outreach_window_current(p_account uuid,p_thread uuid,p_clock timestamptz default now()) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select public.icash_outreach_active_conversation(p_account,d.screening_id,t.recipient,p_clock)
   or public.icash_outreach_window_open(t.timezone,c.timezone_basis,p_clock)
  from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  left join public.icash_operational_contacts c on c.id=t.operational_contact_id and c.account_id=t.account_id and c.channel='sms'
  where t.id=p_thread and t.account_id=p_account and t.retired_at is null),false)
$$;

-- Existing review still verifies every source, DNC, recipient, channel and rate
-- snapshot. Only its obsolete operating-hour check is replaced.
alter function public.icash_sms_thread_review_current(uuid,uuid,boolean) rename to icash_sms_review_before_business_hours;
create function public.icash_sms_thread_review_current(p_account uuid,p_thread uuid,p_check_hour boolean default true) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_check_hour is null or public.icash_sms_review_before_business_hours(p_account,p_thread,false) is distinct from true then return false;end if;
 return not p_check_hour or public.icash_sms_outreach_window_current(p_account,p_thread);
end $$;

revoke all on function public.icash_outreach_timezone(text,text),public.icash_outreach_window_open(text,text,timestamptz),
 public.icash_outreach_active_conversation(uuid,uuid,text,timestamptz),public.icash_sms_outreach_window_current(uuid,uuid,timestamptz),
 public.icash_sms_thread_review_current(uuid,uuid,boolean),public.icash_sms_review_before_business_hours(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.icash_outreach_timezone(text,text),public.icash_outreach_window_open(text,text,timestamptz),
 public.icash_outreach_active_conversation(uuid,uuid,text,timestamptz),public.icash_sms_outreach_window_current(uuid,uuid,timestamptz),
 public.icash_sms_thread_review_current(uuid,uuid,boolean),public.icash_sms_review_before_business_hours(uuid,uuid,boolean) to service_role;

do $patch$
declare definition text;needle text;signature text;replacement text;expected integer;item record;
begin
 signature:='public.icash_claim_text_before_ai(uuid,uuid,text)';
 definition:=pg_get_functiondef(signature::regprocedure);
 needle:='h:=extract(hour from now() at time zone t.timezone);if (h<9 or h>=20) and not public.icash_seller_sms_permission_current(p_account,t.id,false) and not public.icash_seller_sms_inquiry_window(p_account,t.id) then return null;end if;';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'SMS claim hours boundary changed';end if;
 execute replace(definition,needle,'if not public.icash_sms_outreach_window_current(p_account,t.id) then return null;end if;');

 signature:='public.icash_seller_sms_permission_current(uuid,uuid,boolean)';
 definition:=pg_get_functiondef(signature::regprocedure);
 needle:='return true; -- All binding, consent and channel checks above still apply.';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Seller SMS hours boundary changed';end if;
 execute replace(definition,needle,'return p_check_hour is not null and (not p_check_hour or public.icash_sms_outreach_window_current(p_account,t.id));');

 signature:='public.icash_meta_claim_text(uuid,uuid,text)';
 definition:=pg_get_functiondef(signature::regprocedure);
 needle:='-- Verified Meta contact evidence is checked above; no clock-hour gate.';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Meta SMS hours boundary changed';end if;
 execute replace(definition,needle,'if not public.icash_sms_outreach_window_current(p_account,t.id) then return null;end if;');

 signature:='public.icash_claim_email_before_cancellation(uuid,uuid)';
 definition:=pg_get_functiondef(signature::regprocedure);
 needle:='if m.email_id=e.id then';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Buyer initial email hours boundary changed';end if;
 execute replace(definition,needle,needle||E'\n   if not public.icash_outreach_window_open(null,null) then return null;end if;');

 -- Ready SMS has no clock-derived due_at to reset. Replace the scheduler's old
 -- clock predicates so ordinary ticks see it immediately, without replaying a
 -- consumed ticket, resetting attempts, or touching any provider operation.
 for item in select * from (values
  ('public.icash_next_before_owner_question()','extract(hour from now() at time zone zone.name) between 9 and 19','public.icash_sms_outreach_window_current(th.account_id,th.id)',1),
  ('public.icash_next_before_sms_inbound_campaign()','extract(hour from now() at time zone zone.name) between 9 and 19','public.icash_sms_outreach_window_current(t.account_id,t.id)',1),
  ('public.icash_next_before_unstarted_sms_recovery()','extract(hour from now() at time zone tz.name) between 9 and 19','public.icash_sms_outreach_window_current(th.account_id,th.id)',1),
  ('public.icash_next_before_closing_gaps()','extract(hour from now() at time zone tz.name) between 9 and 19','public.icash_sms_outreach_window_current(t.account_id,t.id)',2),
  ('public.icash_queue_fulfillment()',E'extract(hour from now() at time zone z.name)>=greatest(9,(r.payload->>''localStartHour'')::integer)\n    and extract(hour from now() at time zone z.name)<least(20,(r.payload->>''localEndHour'')::integer)','public.icash_sms_outreach_window_current(t.account_id,t.id)',1)
 ) rules(signature,needle,replacement,expected) loop
  definition:=pg_get_functiondef(item.signature::regprocedure);
  if (length(definition)-length(replace(definition,item.needle,'')))/length(item.needle)<>item.expected then raise exception 'SMS scheduler hours boundary changed: %',item.signature;end if;
  execute replace(definition,item.needle,item.replacement);
 end loop;
end $patch$;
commit;

-- Apply after first-contact-hours.sql. Historical contact metadata and
-- recipient evidence stay immutable; only the current operating clock changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.icash_voice_outreach_context(p_account uuid,p_job uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare j public.icash_voice_jobs;p public.icash_voice_contact_targets;basis text;zone text;active boolean;stamp timestamptz:=clock_timestamp();
begin
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account;
 if not found then return null;end if;
 select * into p from public.icash_voice_contact_targets
  where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=p_account and party='seller';
 if not found then return null;end if;
 if j.operational_contact_id is not null then
  select timezone_basis into basis from public.icash_operational_contacts
   where id=j.operational_contact_id and account_id=p_account and channel='voice';
  if not found then return null;end if;
 end if;
 zone:=public.icash_outreach_timezone(p.timezone,basis);
 if zone is null then return null;end if;
 active:=public.icash_outreach_active_conversation(p_account,p.screening_id,p.phone,stamp)
  -- Preserve the dedicated, currently permitted contract-cancellation workflow.
  -- A job flag alone is not enough: its existing admission verifies the notice,
  -- agreement, property, recipient, account controls and contact evidence.
  or (j.cancellation_notice_id is not null and public.icash_cancellation_voice_current(p_account,'voice:'||j.id))
  or exists(select 1 from public.icash_live_callbacks cb
   join public.icash_live_conversations call on call.id=cb.conversation_id and call.account_id=cb.account_id
    and call.screening_id=cb.screening_id and call.contact_key=p.contact_key and call.party='seller' and call.state='complete'
   where cb.id=j.callback_id and cb.account_id=p_account and cb.screening_id=p.screening_id
    and cb.state='pending_dispatch_review' and cb.due_at between stamp-interval '15 minutes' and stamp
    and call.completed_at<=stamp and public.icash_call_has_seller_response(call.result)
    and case when pg_catalog.pg_input_is_valid(call.result->>'callbackDueAt','timestamp with time zone')
     then (call.result->>'callbackDueAt')::timestamptz=cb.due_at else false end);
 return jsonb_build_object('timezone',zone,
  'startHour',9,'endHour',21,'activeConversation',coalesce(active,false),
  'policyVersion','outreach-hours-2026-10-19');
end $$;

create function public.icash_voice_outreach_hours_current(p_account uuid,p_job uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare context jsonb;
begin
 context:=public.icash_voice_outreach_context(p_account,p_job);
 if context is null then return false;end if;
 return coalesce((context->>'activeConversation')::boolean,false)
  or public.icash_outreach_window_open(context->>'timezone',null,clock_timestamp());
end $$;

revoke all on function public.icash_voice_outreach_context(uuid,uuid),public.icash_voice_outreach_hours_current(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_voice_outreach_context(uuid,uuid),public.icash_voice_outreach_hours_current(uuid,uuid) to service_role;

do $patch$
declare definition text;needle text;signature text;
begin
 signature:='public.icash_reserve_paced_voice(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,boolean)';
 definition:=pg_get_functiondef(signature::regprocedure);
 needle:='if not found or j.state<>''issued'' then return false;end if;';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Voice reservation hours boundary changed';end if;
 definition:=replace(definition,needle,needle||E'\n if not public.icash_voice_outreach_hours_current(p_account,p_job) then return false;end if;');
 needle:='public.icash_operational_contact_current(p_account,j.operational_contact_id,''voice'',true)';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Voice reservation recipient boundary changed';end if;
 execute replace(definition,needle,'public.icash_operational_contact_current(p_account,j.operational_contact_id,''voice'',false)');

 signature:='public.icash_claim_voice_job(uuid)';
 definition:=pg_get_functiondef(signature::regprocedure);
 needle:='if not found or j.state<>''issued'' or j.due_at>now() then return false;end if;';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Voice claim hours boundary changed';end if;
 definition:=replace(definition,needle,needle||E'\n if not public.icash_voice_outreach_hours_current(j.account_id,p_job) then return false;end if;');
 needle:='public.icash_operational_contact_current(j.account_id,j.operational_contact_id,''voice'',true)';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Voice claim recipient boundary changed';end if;
 definition:=replace(definition,needle,'public.icash_operational_contact_current(j.account_id,j.operational_contact_id,''voice'',false)');
 needle:='if not public.icash_seller_voice_permission_current(j.account_id,p.id) and (h<greatest(9,p.local_start_hour) or h>=least(18,p.local_end_hour)) and not public.icash_requested_seller_call_current(j.account_id,j.id) and not public.icash_requested_optin_call_current(j.account_id,j.id) then return false;end if;';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Legacy voice contact hours boundary changed';end if;
 execute replace(definition,needle,'-- Current business hours were checked above; all recipient evidence remains required.');

 signature:='public.icash_meta_claim_voice(uuid,uuid)';
 definition:=pg_get_functiondef(signature::regprocedure);
 needle:='if not found or j.state<>''issued'' or j.due_at>now() or public.icash_meta_voice_context(p_account,p_job) is null then return false;end if;';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Meta voice claim hours boundary changed';end if;
 execute replace(definition,needle,needle||E'\n if not public.icash_voice_outreach_hours_current(p_account,p_job) then return false;end if;');

 -- A verified contract-cancellation notice is existing deal service. Preserve
 -- all notice, recipient and account checks without an obsolete contact clock.
 signature:='public.icash_cancellation_voice_current(uuid,text)';
 definition:=pg_get_functiondef(signature::regprocedure);
 needle:='public.icash_operational_contact_current(p_account,j.operational_contact_id,''voice'',true)';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Cancellation voice recipient boundary changed';end if;
 definition:=replace(definition,needle,'public.icash_operational_contact_current(p_account,j.operational_contact_id,''voice'',false)');
 needle:=$old$ and (public.icash_seller_voice_permission_current(p_account,p.id) or (
 extract(hour from now() at time zone p.timezone)>=greatest(9,p.local_start_hour)
 and extract(hour from now() at time zone p.timezone)<least(18,p.local_end_hour)))$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Cancellation voice clock boundary changed';end if;
 execute replace(definition,needle,'');

 -- Check the wall clock at the final provider-dial boundary. A call which has
 -- already dialed may continue recording after 9 PM, with all stop/contact and
 -- recording authority checks retained. Reconciliation/deletion are unchanged.
 signature:='public.icash_transition_call_recording(uuid,uuid,text,text,text,jsonb)';
 definition:=pg_get_functiondef(signature::regprocedure);
 needle:='public.icash_operational_contact_current(r.account_id,r.operational_contact_id,''voice'',true)';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Recording final recipient boundary changed';end if;
 definition:=replace(definition,needle,'public.icash_operational_contact_current(r.account_id,r.operational_contact_id,''voice'',false)');
 needle:='if p_action=''claim_dial'' then';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Recording final dial hours boundary changed';end if;
 execute replace(definition,needle,needle||E'\n  if not public.icash_voice_outreach_hours_current(r.account_id,r.voice_job_id) then return null;end if;');
end $patch$;

-- Release only an unattempted first call delayed by the old operating clock.
-- Provider attempts, ledger evidence, callbacks and every unrelated hold remain.
update public.icash_voice_jobs j set state='ready',due_at=now(),outcome=null,updated_at=now()
where j.state in ('ready','held') and j.due_at>now()
 and j.outcome in ('Waiting for calling hours','outside_contact_hours')
 and j.callback_id is null and j.sms_source_message_id is null and j.cancellation_notice_id is null
 and j.operation_key is null and j.provider_call_sid is null and j.conversation_id is null
 and exists(select 1 from public.icash_accounts a where a.id=j.account_id and not a.bot_paused)
 and not exists(select 1 from public.icash_operation_spend o where o.account_id=j.account_id and o.operation_key='voice:'||j.id)
 and not exists(select 1 from public.icash_live_conversations call where call.account_id=j.account_id and call.operation_key='voice:'||j.id)
 and public.icash_voice_outreach_context(j.account_id,j.id) is not null
 and public.icash_outreach_window_open(public.icash_voice_outreach_context(j.account_id,j.id)->>'timezone',null,clock_timestamp());
commit;
