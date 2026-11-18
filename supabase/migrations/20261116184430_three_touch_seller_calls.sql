-- Three calls total: the original and two independently admitted follow-ups.
-- Installed inactive; original attempts, contact evidence and costs are immutable.
set local lock_timeout='3s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$ begin
 if md5(pg_get_functiondef('public.icash_unanswered_seller_call_current(uuid,uuid,uuid)'::regprocedure))<>'f5b44d0af51e5ea3b40e3146b52be942'
  or md5(pg_get_functiondef('public.icash_queue_unanswered_seller_calls()'::regprocedure))<>'9e39c833b45e698099521628862e10ca'
  or md5(pg_get_functiondef('public.icash_seller_phone_call_current(uuid,uuid)'::regprocedure))<>'991815d00e3ec1389689db3556964aef'
 then raise exception 'Three-touch seller call prerequisite changed';end if;
end $guard$;
alter table icash_seller_recovery_private.unanswered_policy
 add column three_touch_enabled boolean not null default false,
 add column three_touch_activated_at timestamptz,
 add constraint three_touch_activation check(not three_touch_enabled or three_touch_activated_at is not null);

-- Each previous call must have exact terminal unanswered evidence and settled
-- costs. A missing transcript, expired lease or guessed model flag never suffices.
create function icash_seller_recovery_private.settled_unanswered_call(p_account uuid,p_job uuid,p_contact uuid)
returns boolean language plpgsql security invoker set search_path='' as $fn$
declare j public.icash_voice_jobs;c public.icash_operational_contacts;r public.icash_call_recordings;
begin
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account and operational_contact_id=p_contact;
 if not found or j.state is distinct from 'dispatched' or j.permission_id is not null or j.callback_id is not null
  or j.sms_source_message_id is not null or j.cancellation_notice_id is not null or j.meta_offer_lead_id is not null
  or j.meta_retry_of is not null or j.meta_followup_lead_id is not null then return false;end if;
 select * into c from public.icash_operational_contacts where id=p_contact and account_id=p_account and channel='voice';
 if not found then return false;end if;
 select * into r from public.icash_call_recordings where voice_job_id=j.id and account_id=p_account and party='seller'
  and operation_key='voice:'||j.id and screening_id=c.screening_id and to_phone=c.phone and contact_key=c.contact_key;
 if not found or r.call_sid is null or r.dial_claimed_at is null or r.dial_claimed_at>clock_timestamp()
  or public.icash_seller_recorded_call_finished(p_account,r.id) is not true
  or not exists(select 1 from public.icash_operation_spend where operation_key=r.operation_key and account_id=p_account and state='settled') then return false;end if;
 return exists(select 1 from public.icash_live_conversations conv where conv.account_id=p_account and conv.screening_id=c.screening_id
   and conv.operation_key=r.operation_key and conv.conversation_id=r.conversation_id and conv.contact_key=c.contact_key
   and conv.party='seller' and conv.state='complete' and conv.completed_at between r.dial_claimed_at and clock_timestamp()
   and conv.result->>'contactEvidence' in ('no_response','automated_answer')
   and public.icash_seller_call_disposition(conv.result) is null and not public.icash_call_has_seller_response(conv.result)
   and coalesce(conv.result->>'humanRequested','false')='false')
  or exists(select 1 from icash_recording_private.terminal_cost_receipts receipt where receipt.recording_id=r.id
   and receipt.receipt->>'status' in ('no-answer','busy')
   and row(receipt.receipt->>'providerAccountSid',receipt.receipt->>'callSid',receipt.receipt->>'fromPhone',receipt.receipt->>'toPhone')
    is not distinct from row(r.provider_account_sid,r.call_sid,r.from_phone,r.to_phone));
end $fn$;

create function icash_seller_recovery_private.three_touch_call_current(p_account uuid,p_previous uuid,p_followup uuid)
returns boolean language plpgsql security invoker set search_path='' as $fn$
declare j public.icash_voice_jobs;root public.icash_voice_jobs;c public.icash_operational_contacts;
 previous_at timestamptz;first_at timestamptz;previous_sender text;root_sender text;allowed_jobs uuid[];
begin
 select * into j from public.icash_voice_jobs where id=p_previous and account_id=p_account;
 if not found or j.operational_contact_id is null then return false;end if;
 select * into c from public.icash_operational_contacts where id=j.operational_contact_id and account_id=p_account and channel='voice';
 if not found or c.revoked_at is not null or (c.eligibility_until>clock_timestamp()) is not true
  or public.icash_outreach_voice_current(p_account) is not true
  or public.icash_seller_response_operation_allowed(p_account,'voice:'||j.id) is not true
  or public.icash_operational_contact_current(p_account,c.id,'voice',false) is not true
  or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused)
  or not exists(select 1 from public.icash_wallets where account_id=p_account and balance_cents>reserved_cents)
  or exists(select 1 from public.icash_voice_jobs f where f.seller_followup_of=j.id and f.id is distinct from p_followup)
  or (p_followup is not null and not exists(select 1 from public.icash_voice_jobs f where f.id=p_followup and f.account_id=p_account and f.seller_followup_of=j.id and f.operational_contact_id=c.id))
  or icash_seller_recovery_private.settled_unanswered_call(p_account,j.id,c.id) is not true then return false;end if;
 select dial_claimed_at,from_phone into previous_at,previous_sender from public.icash_call_recordings where voice_job_id=j.id and account_id=p_account;
 if previous_at>clock_timestamp()-interval '2 hours' or previous_at<clock_timestamp()-interval '7 days' then return false;end if;
 first_at:=previous_at;allowed_jobs:=array[j.id];
 if j.seller_followup_of is not null then
  select * into root from public.icash_voice_jobs where id=j.seller_followup_of and account_id=p_account and operational_contact_id=c.id;
  if not found or root.seller_followup_of is not null
   or icash_seller_recovery_private.settled_unanswered_call(p_account,root.id,c.id) is not true then return false;end if;
  select dial_claimed_at,from_phone into first_at,root_sender from public.icash_call_recordings where voice_job_id=root.id and account_id=p_account;
  if first_at<clock_timestamp()-interval '7 days' or first_at>previous_at-interval '2 hours'
   or root_sender is distinct from previous_sender then return false;end if;
  allowed_jobs:=array[root.id,j.id];
 end if;
 -- Any real response exits the cold routine. The ordinary conversation/callback
 -- workflow owns the next action; absence of STOP alone never creates authority.
 if exists(select 1 from public.icash_text_threads t join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
   where t.recipient=c.phone and t.party='seller' and m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null))
  or exists(select 1 from public.icash_live_conversations conv where conv.contact_key=c.contact_key and conv.party='seller' and conv.state='complete'
   and (public.icash_call_has_seller_response(conv.result) or public.icash_seller_call_disposition(conv.result) is not null))
  or exists(select 1 from icash_seller_agreement_private.call_history h where h.contact_key=c.contact_key
   and (public.icash_call_has_seller_response(jsonb_build_object('transcript',h.transcript)) or public.icash_seller_call_disposition(jsonb_build_object('transcript',h.transcript)) is not null))
  or exists(select 1 from public.icash_call_recordings other where other.to_phone=c.phone
   and (other.voice_job_id is null or other.voice_job_id<>all(allowed_jobs)) and other.voice_job_id is distinct from p_followup
   and other.dial_claimed_at is not null
   and (other.dial_claimed_at>=first_at or not public.icash_seller_recorded_call_finished(other.account_id,other.id)))
  or exists(select 1 from public.icash_customer_phone_calls human where human.recipient_phone=c.phone and human.child_sid is not null and human.created_at>=first_at)
 then return false;end if;
 return true;
end $fn$;
revoke all on function icash_seller_recovery_private.settled_unanswered_call(uuid,uuid,uuid),icash_seller_recovery_private.three_touch_call_current(uuid,uuid,uuid) from public,anon,authenticated,service_role;
-- The existing public boolean-only definer calls these private receipt readers.

do $patch$
declare d text;old text;
begin
 d:=pg_get_functiondef('public.icash_unanswered_seller_call_current(uuid,uuid,uuid)'::regprocedure);
 old:=' if cutover is null then return false;end if;';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Three-touch call gate changed';end if;
 execute replace(d,old,old||$new$
 if exists(select 1 from icash_seller_recovery_private.unanswered_policy where id=1 and three_touch_enabled) then
  return icash_seller_recovery_private.three_touch_call_current(p_account,p_original,p_followup);
 end if;
$new$);
 d:=pg_get_functiondef('public.icash_seller_phone_call_current(uuid,uuid)'::regprocedure);
 old:='return n=1 and last_attempt<=clock_timestamp()-interval ''2 hours''';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Three-touch final dial gate changed';end if;
 execute replace(d,old,$new$return (n=1 or (n<=2 and exists(select 1 from icash_seller_recovery_private.unanswered_policy where id=1 and enabled and three_touch_enabled)))
   and (last_attempt is null or last_attempt<=clock_timestamp()-interval '2 hours')$new$);
 d:=pg_get_functiondef('public.icash_queue_unanswered_seller_calls()'::regprocedure);
 old:=$old$where j.seller_followup_of is null and j.state='dispatched' and j.created_at>=policy.activated_at
   and r.dial_claimed_at between greatest(policy.activated_at,now()-interval '24 hours') and now()-interval '2 hours'$old$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Three-touch call scan changed';end if;
 execute replace(d,old,$new$where j.state='dispatched'
   and ((policy.three_touch_enabled and (j.seller_followup_of is null or exists(select 1 from public.icash_voice_jobs root
    where root.id=j.seller_followup_of and root.account_id=j.account_id and root.operational_contact_id=j.operational_contact_id and root.seller_followup_of is null))
    and r.dial_claimed_at between now()-interval '7 days' and now()-interval '2 hours')
    or (not policy.three_touch_enabled and j.seller_followup_of is null and j.created_at>=policy.activated_at
     and r.dial_claimed_at between greatest(policy.activated_at,now()-interval '24 hours') and now()-interval '2 hours'))$new$);
end $patch$;
