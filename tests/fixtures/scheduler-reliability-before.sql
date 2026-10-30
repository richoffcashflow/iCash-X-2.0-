-- Exact main/production function definitions; no customer data.
CREATE OR REPLACE FUNCTION public.icash_voice_capacity_available(p_account uuid, p_agent text, p_operation text, p_contact text, p_incoming boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare total_limit integer:=1;agent_limit integer:=1;account_limit integer:=1;
 busy integer;agent_busy integer;account_busy integer;outgoing_busy integer;agent_outgoing_busy integer;contact_busy boolean;
begin
 if p_incoming is not true and exists(select 1 from public.icash_voice_capacity_policy where id=1 and credit_state='exhausted') then return false;end if;
 select least(20,workspace_limit) into total_limit from public.icash_voice_capacity_policy where id=1 and verified_at>now()-interval '24 hours';
 select concurrent_limit into agent_limit from public.icash_voice_agent_capacity where agent_id=p_agent and verified_at>now()-interval '24 hours';
 total_limit:=coalesce(total_limit,1);agent_limit:=least(total_limit,coalesce(agent_limit,1));
 select count(distinct operation_key),count(distinct operation_key) filter(where agent_id=p_agent),
 count(distinct operation_key) filter(where account_id=p_account),coalesce(bool_or(p_contact is not null and contact_key=p_contact),false),
 count(distinct operation_key) filter(where operation_key not like 'recorded-reception:%'),
 count(distinct operation_key) filter(where agent_id=p_agent and operation_key not like 'recorded-reception:%')
 into busy,agent_busy,account_busy,contact_busy,outgoing_busy,agent_outgoing_busy
 from public.icash_active_voice_slots() where operation_key is distinct from p_operation;

 select contact_busy or exists(select 1 from public.icash_voice_contact_holds() s where s.operation_key is distinct from p_operation and s.contact_key=p_contact)
  or exists(select 1 from icash_recording_private.capacity_quarantines q where q.contact_key=p_contact
   and exists(select 1 from public.icash_voice_contact_holds() held where held.operation_key=q.operation_key and held.account_id=q.account_id))
 into contact_busy;
 if contact_busy or busy>=total_limit or agent_busy>=agent_limit then return false;end if;
 if p_incoming then return true;end if;
 -- Count outgoing calls separately: occupied incoming slots must not subtract
 -- the callback reserve a second time. A one-slot fallback stays usable.
 if outgoing_busy>=greatest(1,total_limit-2) or (agent_outgoing_busy>=greatest(1,agent_limit-2)
  and exists(select 1 from jsonb_array_elements(public.icash_voice_capacity_targets()) t where t->>'agentId'=p_agent and t->>'branchId' is not null)) then return false;end if;
 select least(3,greatest(1,floor(greatest(0,least(w.balance_cents,
 coalesce((public.icash_daily_allowance(p_account)->>'remainingCents')::bigint,0)))::numeric/1000)))::integer
 into account_limit from public.icash_wallets w where w.account_id=p_account and w.balance_cents>0;
 return account_busy<coalesce(account_limit,0);
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_voice_contact_holds()
 RETURNS TABLE(operation_key text, account_id uuid, agent_id text, contact_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with candidates as (
 select 'voice:'||j.id as operation_key,j.account_id,c.agent_id,t.contact_key
 from public.icash_voice_jobs j join public.icash_voice_configs c on c.account_id=j.account_id
 left join lateral (
  select target.contact_key from public.icash_voice_contact_targets target
  where target.id=coalesce(j.permission_id,j.operational_contact_id) and target.account_id=j.account_id
  offset 0
 ) t on true
 where (j.state in ('issued','dispatching') or (j.state='held' and j.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')))
 and not coalesce((
  j.state='issued' and j.operation_key is null and j.conversation_id is null and j.provider_call_sid is null
  and j.updated_at<=now()-interval '2 minutes'
  and exists(
   select 1 from public.icash_automation_tickets ticket
   where ticket.voice_job_id=j.id and ticket.account_id=j.account_id and ticket.kind='voice_dispatch'
    and ticket.state='held' and ticket.outcome='held_for_reconciliation'
    and ticket.expires_at<=now() and ticket.completed_at>=ticket.created_at
    and ticket.completed_at<=now()-interval '2 minutes'
    and not exists(select 1 from public.icash_automation_tickets other where other.voice_job_id=j.id and other.id<>ticket.id)
  )
  and not exists(select 1 from public.icash_operation_spend spent where spent.operation_key='voice:'||j.id)
  and not exists(select 1 from public.icash_call_recordings recording where recording.voice_job_id=j.id or recording.operation_key='voice:'||j.id)
  and not exists(select 1 from public.icash_live_conversations live where live.operation_key='voice:'||j.id)
 ),false)
 union
 select l.operation_key,l.account_id,l.agent_id,l.contact_key from public.icash_live_conversations l where l.state in ('waiting','review')
 union
 select r.operation_key,r.account_id,r.agent_id,r.contact_key from public.icash_call_recordings r where r.call_ended_at is null
 union
 select r.operation_key,r.account_id,r.agent_id,r.contact_key from icash_recorded_reception_private.sessions r where r.call_ended_at is null
 ) select c.* from candidates c where not exists(
  select 1 from public.icash_call_recordings r where r.operation_key=c.operation_key and r.account_id=c.account_id and (
   r.call_ended_at is not null
   or (r.state='failed' and r.last_error='provider_rejected_call_creation' and r.call_sid is null and r.recording_sid is null
    and r.conversation_id is null and r.start_claimed_at is null and r.consent_at is null and r.recording_authorized_at is null and r.provider_started_at is null
    and r.end_requested_at is null
    and not exists(select 1 from public.icash_live_conversations l where l.operation_key=r.operation_key)
    and not exists(select 1 from public.icash_voice_jobs j where j.id=r.voice_job_id and (j.provider_call_sid is not null or j.conversation_id is not null))
    and exists(select 1 from icash_recording_private.call_creation_rejections rejection
     where rejection.recording_id=r.id and rejection.account_id=r.account_id and rejection.operation_key=r.operation_key))
   or exists(select 1 from public.icash_recorded_gate_terminal_receipts t where t.recording_id=r.id and t.account_id=r.account_id and t.call_sid=r.call_sid
    and t.receipt->>'status' in ('completed','failed','busy','no-answer','canceled'))
   or exists(select 1 from icash_recording_private.terminal_cost_receipts t where t.recording_id=r.id and t.receipt->>'callSid'=r.call_sid
    and t.receipt->>'status' in ('completed','failed','busy','no-answer','canceled'))
  )
 )
$function$
;

CREATE OR REPLACE FUNCTION public.icash_voice_queue_slot_open(p_account uuid, p_job uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(
  select 1 from public.icash_voice_jobs j
  join public.icash_voice_contact_targets target on target.id=coalesce(j.permission_id,j.operational_contact_id)
   and target.account_id=j.account_id and target.party='seller' and target.contact_key is not null
   and ((j.permission_id is not null and j.operational_contact_id is null and target.eligibility_source='operator_record')
    or (j.permission_id is null and j.operational_contact_id is not null and target.eligibility_source='operational_checks_only'))
  where j.id=p_job and j.account_id=p_account and j.state='ready'
 and public.icash_voice_capacity_available(j.account_id,(select agent_id from public.icash_voice_configs where account_id=j.account_id),'voice:'||j.id,target.contact_key,false)
  and not exists(
   select 1 from public.icash_voice_jobs busy where busy.id<>j.id
    and (busy.state in ('issued','dispatching') or (busy.state='held' and busy.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')))
    and (exists(
     select 1 from public.icash_voice_contact_targets other where other.id=coalesce(busy.permission_id,busy.operational_contact_id)
      and other.account_id=busy.account_id and other.contact_key=target.contact_key
      and ((busy.permission_id is not null and busy.operational_contact_id is null and other.eligibility_source='operator_record')
       or (busy.permission_id is null and busy.operational_contact_id is not null and other.eligibility_source='operational_checks_only')))))
  and not exists(select 1 from public.icash_live_conversations live where live.state in ('waiting','review')
   and (live.contact_key=target.contact_key))
 );
$function$
;

CREATE OR REPLACE FUNCTION public.icash_active_voice_slots()
 RETURNS TABLE(operation_key text, account_id uuid, agent_id text, contact_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select s.* from public.icash_voice_contact_holds() s where not exists(
  select 1 from icash_recording_private.capacity_quarantines q
  where q.operation_key=s.operation_key and q.account_id=s.account_id
   and not exists(select 1 from public.icash_voice_jobs j where j.id=q.voice_job_id and (j.provider_call_sid is not null or j.conversation_id is not null))
   and not exists(select 1 from public.icash_call_recordings r where r.operation_key=q.operation_key
    and (r.call_sid is not null or r.recording_sid is not null or r.conversation_id is not null or r.consent_at is not null
     or r.recording_authorized_at is not null or r.start_claimed_at is not null or r.provider_started_at is not null or r.final_provider_started_at is not null))
   and not exists(select 1 from public.icash_live_conversations l where l.operation_key=q.operation_key)
 );
$function$
;

CREATE OR REPLACE FUNCTION public.icash_issue_ready_voice_ticket()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_voice_jobs;t public.icash_automation_tickets;last_voice timestamptz;
begin
 perform public.icash_queue_voice_jobs();
 select last_dispatch_at into last_voice from public.icash_voice_scheduler where id=1 for update;
 if (last_voice is null or last_voice<now()-interval '1 second') and exists(select 1 from public.icash_operating_budget where id=1 and enabled) and public.icash_outgoing_voice_capacity_open() then
 select candidate.* into j from (
 select v.* from public.icash_voice_jobs v join public.icash_accounts a on a.id=v.account_id and not a.bot_paused join public.icash_voice_configs c on c.account_id=a.id and c.enabled
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
 where v.state='ready' and v.due_at<=now()
 and exists(select 1 from public.icash_voice_contact_targets current_target
  where current_target.id=coalesce(v.permission_id,v.operational_contact_id) and current_target.account_id=v.account_id
   and ((v.permission_id is not null and v.operational_contact_id is null and current_target.eligibility_source='operator_record')
    or (v.permission_id is null and v.operational_contact_id is not null and current_target.eligibility_source='operational_checks_only'))
   and current_target.revoked_at is null and current_target.permission_until>now()
   and public.icash_outreach_window_open(current_target.timezone,
    case when v.operational_contact_id is not null then (select timezone_basis from public.icash_operational_contacts
     where id=v.operational_contact_id and account_id=v.account_id and channel='voice') end,clock_timestamp()))
 and not (v.callback_id is null and v.sms_source_message_id is null and v.cancellation_notice_id is null
  and v.operational_contact_id is null and v.meta_offer_lead_id is null and v.meta_followup_lead_id is null
  and exists(select 1 from public.icash_meta_leads m
   join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id and s.state='awaiting_address'
   where m.account_id=v.account_id and (m.voice_job_id=v.id
    or m.voice_job_id is null and exists(select 1 from public.icash_contact_permissions p
     where p.id=v.permission_id and p.account_id=m.account_id and p.screening_id=m.screening_id and p.seller_intake_id=m.lead_id))))
 and case
  when v.sms_source_message_id is not null then public.icash_requested_seller_call_current(v.account_id,v.id)
  when v.callback_id is not null then exists(
   select 1 from public.icash_live_callbacks cb
   join public.icash_live_conversations call on call.id=cb.conversation_id and call.account_id=cb.account_id
   join public.icash_voice_contact_targets target on target.id=coalesce(v.permission_id,v.operational_contact_id)
    and target.account_id=v.account_id and target.party='seller'
    and ((v.permission_id is not null and v.operational_contact_id is null and target.eligibility_source='operator_record')
     or (v.permission_id is null and v.operational_contact_id is not null and target.eligibility_source='operational_checks_only'))
   where cb.id=v.callback_id and cb.account_id=v.account_id and cb.screening_id=target.screening_id
    and cb.state='pending_dispatch_review' and cb.due_at=v.due_at and cb.due_at between now()-interval '15 minutes' and now()
    and call.screening_id=cb.screening_id and call.contact_key=target.contact_key and call.party='seller'
    and call.state='complete' and call.completed_at<=now() and public.icash_call_has_seller_response(call.result)
    and case when pg_catalog.pg_input_is_valid(call.result->>'callbackDueAt','timestamp with time zone')
     then (call.result->>'callbackDueAt')::timestamptz=cb.due_at else false end)
  when v.cancellation_notice_id is not null then public.icash_cancellation_voice_current(v.account_id,'voice:'||v.id)
  else false end
 order by v.due_at,v.id for update of v skip locked offset 0
 ) candidate
 where public.icash_voice_queue_slot_open(candidate.account_id,candidate.id)
 and public.icash_seller_phone_call_current(candidate.account_id,candidate.id)
 limit 1;
 if not found then
 select candidate.* into j from (
 select v.* from public.icash_voice_jobs v join public.icash_accounts a on a.id=v.account_id and not a.bot_paused join public.icash_voice_configs c on c.account_id=a.id and c.enabled
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
 left join lateral(
  select recent.created_at from public.icash_automation_tickets recent
  where recent.account_id=v.account_id and recent.kind='voice_dispatch'
  order by recent.created_at desc limit 1
 ) last_ticket on true
 where v.state='ready' and v.due_at<=now()
 and exists(select 1 from public.icash_voice_contact_targets current_target
  where current_target.id=coalesce(v.permission_id,v.operational_contact_id) and current_target.account_id=v.account_id
   and ((v.permission_id is not null and v.operational_contact_id is null and current_target.eligibility_source='operator_record')
    or (v.permission_id is null and v.operational_contact_id is not null and current_target.eligibility_source='operational_checks_only'))
   and current_target.revoked_at is null and current_target.permission_until>now()
   and public.icash_outreach_window_open(current_target.timezone,
    case when v.operational_contact_id is not null then (select timezone_basis from public.icash_operational_contacts
     where id=v.operational_contact_id and account_id=v.account_id and channel='voice') end,clock_timestamp()))
 and not (v.callback_id is null and v.sms_source_message_id is null and v.cancellation_notice_id is null
  and v.operational_contact_id is null and v.meta_offer_lead_id is null and v.meta_followup_lead_id is null
  and exists(select 1 from public.icash_meta_leads m
   join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id and s.state='awaiting_address'
   where m.account_id=v.account_id and (m.voice_job_id=v.id
    or m.voice_job_id is null and exists(select 1 from public.icash_contact_permissions p
     where p.id=v.permission_id and p.account_id=m.account_id and p.screening_id=m.screening_id and p.seller_intake_id=m.lead_id))))
 order by last_ticket.created_at asc nulls first,v.due_at,v.id for update of v skip locked offset 0
 ) candidate
 where public.icash_voice_queue_slot_open(candidate.account_id,candidate.id)
 and public.icash_seller_phone_call_current(candidate.account_id,candidate.id)
 limit 1;
 end if;
 if found then
 update public.icash_voice_scheduler set last_dispatch_at=now() where id=1;
 update public.icash_voice_jobs set state='issued',updated_at=now() where id=j.id;
 insert into public.icash_automation_tickets(account_id,kind,voice_job_id) values(j.account_id,'voice_dispatch',j.id) returning * into t;return jsonb_build_object('token',t.token);
 end if;end if;
 return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_resume_prospecting_ticket()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_automation_tickets;op text;
begin
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return null;end if;
 for t in
  with waiting_accounts as materialized (
   select distinct account_id from public.icash_automation_tickets
   where state='held' and outcome='prospecting_budget_held' and expires_at<=now()
  ), allowances as materialized (
   select a.id,public.icash_prospecting_available(a.id) available
   from public.icash_accounts a join waiting_accounts w on w.account_id=a.id
   where not a.bot_paused and public.icash_membership_work_allowed(a.id)
  ), outreach_priority as materialized (
   select a.*,case when exists(
    select 1 from public.icash_automation_tickets pending where pending.account_id=a.id
     and pending.state='held' and pending.outcome='prospecting_budget_held' and pending.expires_at<=now()
     and pending.kind in ('contacts','discovery') and a.available>=pending.prospecting_quote_cents
   ) then public.icash_research_waiting_on_outreach(a.id) else false end waiting_for_outreach
   from allowances a
  )
  select x.* from public.icash_automation_tickets x join outreach_priority a on a.id=x.account_id
  where x.state='held' and x.outcome='prospecting_budget_held' and x.expires_at<=now()
  and a.available>=x.prospecting_quote_cents
  and (x.kind<>'voice_dispatch' or exists(
   select 1 from public.icash_voice_jobs v
   join public.icash_voice_contact_targets current_target
    on current_target.id=coalesce(v.permission_id,v.operational_contact_id) and current_target.account_id=v.account_id
   where v.id=x.voice_job_id and v.account_id=x.account_id
    and ((v.permission_id is not null and v.operational_contact_id is null and current_target.eligibility_source='operator_record')
     or (v.permission_id is null and v.operational_contact_id is not null and current_target.eligibility_source='operational_checks_only'))
    and current_target.revoked_at is null and current_target.permission_until>now()
    and public.icash_outreach_window_open(current_target.timezone,
     case when v.operational_contact_id is not null then (select timezone_basis from public.icash_operational_contacts
      where id=v.operational_contact_id and account_id=v.account_id and channel='voice') end,clock_timestamp())
  ))
  and (x.kind not in ('contacts','discovery') or (public.icash_dealmachine_capacity_available() and not a.waiting_for_outreach))
  order by x.created_at limit 20 for update of x skip locked loop
  op:=null;
  if t.kind='contacts' then op:='owners:'||t.account_id||':'||t.screening_id;
  elsif t.kind='voice_dispatch' then
   op:='voice:'||t.voice_job_id;
   if not exists(select 1 from public.icash_voice_jobs where id=t.voice_job_id and account_id=t.account_id and state='held' and outcome='prospecting_budget_held' and operation_key is null and conversation_id is null and provider_call_sid is null) then continue;end if;
  elsif t.kind in ('seller_opener','seller_recovery') then
   op:='text:'||t.opener_message_id;
   if not exists(select 1 from public.icash_text_messages where id=t.opener_message_id and account_id=t.account_id and state='ready' and provider_id is null and last_delivery_at is null) then continue;end if;
  elsif t.kind='discovery' then
   -- A discovery page can move independently. Its scheduler handles the current
   -- revision; do not replay a stale page capability.
   update public.icash_automation_tickets set outcome='prospecting_budget_released' where id=t.id;
   perform public.icash_wake_funded_outreach(t.account_id);continue;
  end if;
  if op is null or exists(select 1 from public.icash_operation_spend where operation_key=op) or exists(select 1 from public.icash_live_conversations where operation_key=op) then continue;end if;
  if exists(select 1 from public.icash_automation_tickets x where x.id<>t.id and x.account_id=t.account_id and ((x.state='issued' and x.expires_at>now()) or (x.state='consumed' and x.created_at>now()-interval '5 minutes'))) then continue;end if;
  if t.kind='voice_dispatch' then update public.icash_voice_jobs set state='issued',outcome=null,updated_at=now() where id=t.voice_job_id;end if;
  update public.icash_automation_tickets set token=gen_random_uuid()::text||gen_random_uuid()::text,state='issued',outcome=null,completed_at=null,created_at=now(),expires_at=now()+interval '2 minutes' where id=t.id returning * into t;
  return jsonb_build_object('token',t.token);
 end loop;
 return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_outgoing_voice_capacity_open()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if exists(select 1 from public.icash_voice_capacity_policy where id=1 and credit_state='exhausted') then return false;end if;
 return (
 with slots as materialized (
  select operation_key,agent_id from public.icash_active_voice_slots()
 ), policy as (
  select coalesce((select least(20,workspace_limit) from public.icash_voice_capacity_policy
   where id=1 and verified_at>now()-interval '24 hours'),1) as total_limit
 ), busy as (
  select count(distinct operation_key) total,
   count(distinct operation_key) filter(where operation_key not like 'recorded-reception:%') outgoing from slots
 ), agents as (
  select distinct c.agent_id,least(p.total_limit,coalesce(v.concurrent_limit,1)) agent_limit
  from public.icash_voice_configs c cross join policy p
  left join public.icash_voice_agent_capacity v on v.agent_id=c.agent_id and v.verified_at>now()-interval '24 hours'
  where c.enabled
 ), agent_busy as (
  select agent_id,count(distinct operation_key) total,
   count(distinct operation_key) filter(where operation_key not like 'recorded-reception:%') outgoing
  from slots group by agent_id
 )
 -- Final admission excludes the job's own operation. If such a ready job
 -- already occupies a slot, leave that decision to its existing exact gate.
 select exists(select 1 from slots s join public.icash_voice_jobs j on s.operation_key='voice:'||j.id where j.state='ready')
 or exists(
  select 1 from policy p cross join busy b
  where b.total<p.total_limit and b.outgoing<greatest(1,p.total_limit-2)
   and exists(select 1 from agents a left join agent_busy ab on ab.agent_id=a.agent_id
    where coalesce(ab.total,0)<a.agent_limit
     and (coalesce(ab.outgoing,0)<greatest(1,a.agent_limit-2)
      or not exists(select 1 from jsonb_array_elements(public.icash_voice_capacity_targets()) t
       where t->>'agentId'=a.agent_id and t->>'branchId' is not null)))
 ));
end $function$
;

