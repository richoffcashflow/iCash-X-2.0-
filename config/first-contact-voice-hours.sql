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
