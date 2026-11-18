-- HomeOffer Network already has three texts. Add its third unanswered call
-- through the original consent-bound lead, never by replaying its first job.
set local lock_timeout='3s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$ begin
 if md5(pg_get_functiondef('public.icash_meta_followup_call_current(uuid,uuid)'::regprocedure))<>'c091c51b256754e1855d26e022ed0ad5'
  or md5(pg_get_functiondef('public.icash_meta_prepare_followups(uuid)'::regprocedure))<>'8450b8c01ee1f7dbd7059b9b06f329c3'
  or (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.icash_voice_jobs'::regclass and conname='icash_voice_jobs_meta_followup_lead_id_key') is distinct from 'UNIQUE (meta_followup_lead_id)'
  or (select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.icash_voice_jobs'::regclass and conname='seller_unanswered_followup_shape') is distinct from '63d08c5c44f65777b298ae29173e9ee3'
 then raise exception 'Three-touch Meta prerequisite changed';end if;
end $guard$;
-- Reuse the existing parent link; adding a job column would change original
-- to_jsonb snapshots used by immutable financial recovery reviews.
alter table public.icash_voice_jobs drop constraint seller_unanswered_followup_shape;
alter table public.icash_voice_jobs add constraint seller_unanswered_followup_shape check(seller_followup_of is null or
 (seller_followup_of<>id and callback_id is null and sms_source_message_id is null and cancellation_notice_id is null
  and meta_offer_lead_id is null and meta_retry_of is null and
  ((operational_contact_id is not null and permission_id is null and meta_followup_lead_id is null)
   or (operational_contact_id is null and permission_id is not null and meta_followup_lead_id is not null))));
alter table public.icash_voice_jobs drop constraint icash_voice_jobs_meta_followup_lead_id_key;
create unique index icash_meta_followup_step_once on public.icash_voice_jobs(meta_followup_lead_id) where meta_followup_lead_id is not null and seller_followup_of is null;
create unique index icash_meta_third_call_once on public.icash_voice_jobs(meta_followup_lead_id) where meta_followup_lead_id is not null and seller_followup_of is not null;

create function icash_seller_recovery_private.meta_third_call_current(p_lead uuid,p_job uuid default null)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare m public.icash_meta_leads;l public.icash_seller_intakes;j public.icash_voice_jobs;r public.icash_call_recordings;
 first_at timestamptz;first_sender text;ids uuid[];previous_id uuid;
begin
 if not exists(select 1 from icash_seller_recovery_private.unanswered_policy where id=1 and enabled and three_touch_enabled) then return false;end if;
 select * into m from public.icash_meta_leads where lead_id=p_lead;
 if not found or m.first_outreach_at>now()-interval '24 hours' or m.first_outreach_at<now()-interval '72 hours' then return false;end if;
 select * into l from public.icash_seller_intakes where id=m.lead_id;
 if not found or l.contact_consent_scope='icash_x_demo' then return false;end if;
 select * into j from public.icash_voice_jobs where meta_followup_lead_id=m.lead_id and seller_followup_of is null and account_id=m.account_id;
 if not found or (p_job is null and exists(select 1 from public.icash_voice_jobs where meta_followup_lead_id=m.lead_id and seller_followup_of is not null)) then return false;end if;
 ids:=array[m.voice_job_id,j.id];
 if p_job is not null and not exists(select 1 from public.icash_voice_jobs f where f.id=p_job and f.account_id=m.account_id
  and f.meta_followup_lead_id=m.lead_id and f.seller_followup_of=j.id and f.permission_id=j.permission_id) then return false;end if;
 foreach previous_id in array ids loop
  select * into j from public.icash_voice_jobs where id=previous_id and account_id=m.account_id;
  if not found or j.state is distinct from 'dispatched' or not exists(select 1 from public.icash_contact_permissions p
   where p.id=j.permission_id and p.account_id=m.account_id and p.seller_intake_id=m.lead_id and p.screening_id=m.screening_id and p.phone=l.phone) then return false;end if;
  select * into r from public.icash_call_recordings where voice_job_id=j.id and account_id=m.account_id
   and operation_key='voice:'||j.id and screening_id=m.screening_id and party='seller' and to_phone=l.phone
   and contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex');
  if not found or r.call_sid is null or r.dial_claimed_at is null or r.dial_claimed_at>now()-interval '2 hours'
   or public.icash_seller_recorded_call_finished(m.account_id,r.id) is not true
   or not exists(select 1 from public.icash_operation_spend where operation_key=r.operation_key and account_id=m.account_id and state='settled') then return false;end if;
  if first_at is null then first_at:=r.dial_claimed_at;first_sender:=r.from_phone;
  elsif r.dial_claimed_at<first_at+interval '2 hours' or r.from_phone is distinct from first_sender then return false;end if;
  if not exists(select 1 from public.icash_live_conversations c where c.account_id=m.account_id and c.screening_id=m.screening_id
   and c.contact_key=r.contact_key and c.operation_key=r.operation_key and c.conversation_id=r.conversation_id
   and c.party='seller' and c.state='complete' and c.completed_at between r.dial_claimed_at and now()
   and c.result->>'contactEvidence' in ('no_response','automated_answer') and not public.icash_call_has_seller_response(c.result)
   and public.icash_seller_call_disposition(c.result) is null and coalesce(c.result->>'humanRequested','false')='false')
   and not exists(select 1 from icash_recording_private.terminal_cost_receipts t where t.recording_id=r.id
    and t.receipt->>'status' in ('no-answer','busy') and row(t.receipt->>'providerAccountSid',t.receipt->>'callSid',t.receipt->>'fromPhone',t.receipt->>'toPhone')
     is not distinct from row(r.provider_account_sid,r.call_sid,r.from_phone,r.to_phone)) then return false;end if;
 end loop;
 if exists(select 1 from public.icash_call_recordings other where other.to_phone=l.phone and other.dial_claimed_at is not null
   and other.voice_job_id is distinct from p_job and (other.voice_job_id is null or other.voice_job_id<>all(ids))
   and (other.dial_claimed_at>=first_at or not public.icash_seller_recorded_call_finished(other.account_id,other.id)))
  or exists(select 1 from public.icash_customer_phone_calls human where human.recipient_phone=l.phone and human.child_sid is not null and human.created_at>=first_at)
  or exists(select 1 from public.icash_text_threads t join public.icash_text_messages msg on msg.thread_id=t.id and msg.account_id=t.account_id
   where t.recipient=l.phone and t.party='seller' and msg.direction='incoming' and msg.state='received' and (msg.provider_id is not null or msg.event_id is not null))
  or exists(select 1 from public.icash_live_conversations conv where conv.contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex') and conv.party='seller' and conv.state='complete'
   and (public.icash_call_has_seller_response(conv.result) or public.icash_seller_call_disposition(conv.result) is not null))
  or exists(select 1 from icash_seller_agreement_private.call_history h where h.contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex')
   and (public.icash_call_has_seller_response(jsonb_build_object('transcript',h.transcript)) or public.icash_seller_call_disposition(jsonb_build_object('transcript',h.transcript)) is not null))
 then return false;end if;
 return true;
end $fn$;
revoke all on function icash_seller_recovery_private.meta_third_call_current(uuid,uuid) from public,anon,authenticated;
grant execute on function icash_seller_recovery_private.meta_third_call_current(uuid,uuid) to service_role;

do $patch$
declare d text;old text;
begin
 d:=pg_get_functiondef('public.icash_meta_followup_call_current(uuid,uuid)'::regprocedure);
 old:='and current_job.meta_followup_lead_id=m.lead_id and current_job.operational_contact_id is null';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Three-touch Meta final gate changed';end if;
 execute replace(d,old,old||' and (current_job.seller_followup_of is null or icash_seller_recovery_private.meta_third_call_current(p_lead,p_job))');
 d:=pg_get_functiondef('public.icash_meta_prepare_followups(uuid)'::regprocedure);
 old:='select * into j from public.icash_voice_jobs where meta_followup_lead_id=m.lead_id and account_id=m.account_id for update;';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Three-touch Meta queue changed';end if;
 execute replace(d,old,$new$select * into j from public.icash_voice_jobs where meta_followup_lead_id=m.lead_id and seller_followup_of is null and account_id=m.account_id for update;
   if j.state='dispatched' and exists(select 1 from icash_seller_recovery_private.unanswered_policy where id=1 and enabled and three_touch_enabled) then
    if icash_seller_recovery_private.meta_third_call_current(m.lead_id) then
     insert into public.icash_voice_jobs(account_id,permission_id,meta_followup_lead_id,seller_followup_of)
      values(m.account_id,p.id,m.lead_id,j.id) on conflict do nothing;
    end if;
    select * into j from public.icash_voice_jobs where meta_followup_lead_id=m.lead_id and seller_followup_of is not null and account_id=m.account_id for update;
    if j.id is not null and not public.icash_meta_followup_call_current(m.lead_id,j.id) then return jsonb_build_object('accountId',m.account_id,'messageIds',texts,'voiceJobId',null);end if;
   end if;$new$);
 d:=pg_get_functiondef('public.icash_seller_phone_call_current(uuid,uuid)'::regprocedure);
 old:='if j.seller_followup_of is not null then';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Three-touch follow-up family changed';end if;
 d:=replace(d,old,'if j.seller_followup_of is not null and j.meta_followup_lead_id is null then');
 old:='return n<2 and (last_attempt is null or last_attempt<=now()-interval ''2 hours'')';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Three-touch Meta phone spacing changed';end if;
 execute replace(d,old,$new$return n<case when j.seller_followup_of is not null then 3 else 2 end
   and (last_attempt is null or last_attempt<=now()-interval '2 hours')$new$);
end $patch$;
