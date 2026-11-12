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
