begin;
set local lock_timeout='3s';

-- Two texts and one extra call, only for an unanswered contact-only lead.
alter table public.icash_meta_lead_messages drop constraint icash_meta_lead_messages_purpose_check;
alter table public.icash_meta_lead_messages add constraint icash_meta_lead_messages_purpose_check
 check(purpose in ('initial','address_link','reply','offer_ready','followup_1','followup_2'));
create unique index icash_meta_followup_text_once on public.icash_meta_lead_messages(lead_id,purpose)
 where purpose in ('followup_1','followup_2');
alter table public.icash_voice_jobs add column meta_followup_lead_id uuid unique references public.icash_meta_leads(lead_id);
alter table public.icash_voice_jobs add constraint icash_meta_followup_voice_only check(meta_followup_lead_id is null or (
 permission_id is not null and operational_contact_id is null and callback_id is null and sms_source_message_id is null
 and cancellation_notice_id is null and meta_offer_lead_id is null and meta_retry_of is null));
drop index public.icash_voice_first_once;
create unique index icash_voice_first_once on public.icash_voice_jobs(permission_id)
 where callback_id is null and sms_source_message_id is null and cancellation_notice_id is null
 and meta_offer_lead_id is null and meta_retry_of is null and meta_followup_lead_id is null;

create function public.icash_meta_followup_current(p_lead uuid,p_step text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from public.icash_meta_leads m join public.icash_seller_intakes l on l.id=m.lead_id
  join public.icash_accounts a on a.id=m.account_id
  where m.lead_id=p_lead and p_step in ('followup_1','followup_2','call')
   and not m.paused and m.declined_at is null and m.response_at is null and m.address_confirmed_at is null
   and l.state='awaiting_address' and l.canonical_id is null and l.contact_consent_scope is distinct from 'icash_x_demo'
   and m.contact_until>now() and m.first_outreach_at>now()-interval '72 hours'
   and m.first_outreach_at<=now()-case p_step when 'followup_1' then interval '15 minutes' when 'call' then interval '2 hours' else interval '24 hours' end
   and not a.bot_paused and public.icash_membership_work_allowed(a.id)
   and exists(select 1 from public.icash_wallets w where w.account_id=a.id and w.balance_cents>0)
   and not exists(select 1 from public.icash_text_threads t join public.icash_text_messages msg on msg.thread_id=t.id and msg.account_id=t.account_id
    where t.seller_intake_id=m.lead_id and t.account_id=m.account_id and msg.direction='incoming' and msg.state='received')
   and not exists(select 1 from public.icash_live_conversations c where c.account_id=m.account_id and c.screening_id=m.screening_id and c.state in ('waiting','review'))
   and not exists(select 1 from public.icash_call_recordings r where r.account_id=m.account_id and r.screening_id=m.screening_id and r.call_ended_at is null
    and not (r.state in ('declined','failed','absent') and public.icash_voice_attempt_recorded(r.voice_job_id)))
   and exists(select 1 from public.icash_meta_lead_messages mm join public.icash_text_messages msg on msg.id=mm.message_id
    where mm.lead_id=m.lead_id and mm.purpose='initial' and msg.account_id=m.account_id and msg.state in ('accepted','delivered') and msg.provider_id is not null)
   and (p_step<>'followup_2' or exists(select 1 from public.icash_meta_lead_messages mm join public.icash_text_messages msg on msg.id=mm.message_id
    where mm.lead_id=m.lead_id and mm.purpose='followup_1' and msg.state in ('accepted','delivered') and msg.provider_id is not null and msg.updated_at<=now()-interval '6 hours'))
   and (p_step<>'call' or (not m.voice_paused and exists(select 1 from public.icash_voice_jobs j
    where j.id=m.voice_job_id and j.account_id=m.account_id and public.icash_voice_attempt_recorded(j.id)
     and (j.conversation_id is null or exists(select 1 from public.icash_live_conversations c
      where c.account_id=j.account_id and c.conversation_id=j.conversation_id and c.state='complete' and c.completed_at is not null
       and public.icash_meta_call_outcome(c.result)='no_response')))))
 );
$$;

-- Recheck after queueing, including ordinary dispatch paths. A reply must not
-- leave an already queued nudge able to send or reserve another call.
do $patch$
declare def text;needle text;
begin
 def:=pg_get_functiondef('public.icash_meta_queue_message(uuid,text,text,text)'::regprocedure);
 needle:=$n$p_purpose not in ('initial','address_link','reply','offer_ready')$n$;
 if position(needle in def)=0 then raise exception 'Meta text purpose prerequisite changed';end if;
 def:=replace(def,needle,$n$p_purpose not in ('initial','address_link','reply','offer_ready','followup_1','followup_2')$n$);
 needle:='select * into l from public.icash_seller_intakes where id=p_lead;';
 if position(needle in def)=0 then raise exception 'Meta text queue prerequisite changed';end if;
 def:=replace(def,needle,needle||$guard$
 if p_purpose in ('followup_1','followup_2') then
  if p_key<>'v1' or not public.icash_meta_followup_current(p_lead,p_purpose) then return null;end if;
  p_body:=case p_purpose
   when 'followup_1' then 'HomeOffer Network AI: Still looking for a cash offer? Reply with the property street, city and state so we can take a look. STOP to opt out.'
   else 'HomeOffer Network AI: Want us to check your property for a cash offer? Send the street, city and state whenever you are ready. STOP to opt out.' end;
 end if;
$guard$);
 execute def;
 def:=pg_get_functiondef('public.icash_meta_claim_text(uuid,uuid,text)'::regprocedure);
 needle:=$n$if not public.icash_sms_message_route_current(p_account,p_message) then return null;end if;$n$;
 if position(needle in def)=0 then raise exception 'Meta text claim prerequisite changed';end if;
 execute replace(def,needle,$guard$
 if exists(select 1 from public.icash_meta_lead_messages mm where mm.message_id=p_message and mm.purpose in ('followup_1','followup_2')
  and not public.icash_meta_followup_current(mm.lead_id,mm.purpose)) then return null;end if;
$guard$||needle);
 def:=pg_get_functiondef('public.icash_meta_prepare_voice(uuid)'::regprocedure);
 needle:='and meta_offer_lead_id is null and (meta_retry_of is null or id=m.voice_job_id)';
 if position(needle in def)=0 then raise exception 'Meta first call selection prerequisite changed';end if;
 execute replace(def,needle,'and meta_followup_lead_id is null '||needle);
 def:=pg_get_functiondef('public.icash_meta_voice_context(uuid,uuid)'::regprocedure);
 needle:='and not m.voice_paused';
 if position(needle in def)=0 then raise exception 'Meta voice context prerequisite changed';end if;
 execute replace(def,needle,$n$and (j.meta_followup_lead_id is null or (j.meta_followup_lead_id=m.lead_id and public.icash_meta_followup_current(m.lead_id,'call'))) $n$||needle);
 def:=pg_get_functiondef('public.icash_claim_before_activation(text)'::regprocedure);
 needle:=$n$select * into r from public.icash_operation_rates where id=o.rate_id for share;$n$;
 if position(needle in def)=0 then raise exception 'Final follow-up admission prerequisite changed';end if;
 execute replace(def,needle,needle||$guard$
 if exists(select 1 from public.icash_voice_jobs j where j.account_id=o.account_id and 'voice:'||j.id=p_operation
  and j.meta_followup_lead_id is not null and not public.icash_meta_followup_current(j.meta_followup_lead_id,'call'))
 or exists(select 1 from public.icash_meta_lead_messages mm join public.icash_text_messages msg on msg.id=mm.message_id
  where msg.account_id=o.account_id and 'text:'||msg.id=p_operation and mm.purpose in ('followup_1','followup_2')
  and not public.icash_meta_followup_current(mm.lead_id,mm.purpose)) then return false;end if;
$guard$);
end $patch$;

create function public.icash_meta_prepare_followups(p_lead uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;p public.icash_contact_permissions;j public.icash_voice_jobs;msg uuid;texts jsonb:='[]';call_id uuid;purpose text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_meta_leads where lead_id=p_lead for update;
 if not found then return null;end if;
 foreach purpose in array array['followup_1','followup_2'] loop
  if public.icash_meta_followup_current(p_lead,purpose) then
   msg:=public.icash_meta_queue_message(p_lead,purpose,'v1','Follow-up');
   if exists(select 1 from public.icash_text_messages where id=msg and account_id=m.account_id and state='ready' and provider_id is null) then
    texts:=texts||jsonb_build_array(msg);
   end if;
  end if;
 end loop;
 if public.icash_meta_followup_current(p_lead,'call') and public.icash_outreach_voice_current(m.account_id) then
  select cp.* into p from public.icash_contact_permissions cp join public.icash_voice_jobs first_job on first_job.permission_id=cp.id
   where first_job.id=m.voice_job_id and cp.account_id=m.account_id and cp.seller_intake_id=m.lead_id and cp.screening_id=m.screening_id;
  if p.id is not null and public.icash_seller_voice_permission_current(m.account_id,p.id)
   and not exists(select 1 from public.icash_voice_jobs v where v.permission_id=p.id and v.meta_followup_lead_id is null
    and (v.state in ('ready','issued','dispatching') or v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))) then
   insert into public.icash_voice_jobs(account_id,permission_id,meta_followup_lead_id) values(m.account_id,p.id,m.lead_id) on conflict do nothing;
   select * into j from public.icash_voice_jobs where meta_followup_lead_id=m.lead_id and account_id=m.account_id for update;
   if j.state in ('ready','issued') and j.due_at<=now() and j.provider_call_sid is null and j.conversation_id is null
    and not exists(select 1 from public.icash_operation_spend where operation_key='voice:'||j.id) then
    update public.icash_voice_jobs set state='issued',updated_at=now() where id=j.id;
    call_id:=j.id;
   end if;
  end if;
 end if;
 return jsonb_build_object('accountId',m.account_id,'messageIds',texts,'voiceJobId',call_id);
end $$;

create function public.icash_meta_cancel_followups() returns trigger
language plpgsql security invoker set search_path='' as $$
declare lead uuid;reason text:='meta_followup_stopped';
begin
 if TG_TABLE_NAME='icash_meta_leads' then
  if new.response_at is null and new.address_confirmed_at is null and new.declined_at is null and not new.paused then return new;end if;
  lead:=new.lead_id;
  if new.paused and new.response_at is null and new.declined_at is null and new.address_confirmed_at is null then reason:='meta_lead_paused';end if;
 else
  if new.direction<>'incoming' or new.state<>'received' then return new;end if;
  select t.seller_intake_id into lead from public.icash_text_threads t where t.id=new.thread_id and t.account_id=new.account_id;
 end if;
 if lead is null then return new;end if;
 update public.icash_text_messages msg set state='cancelled',updated_at=now()
 from public.icash_meta_lead_messages mm where mm.message_id=msg.id and mm.lead_id=lead
  and mm.purpose in ('followup_1','followup_2') and msg.state='ready' and msg.provider_id is null;
 update public.icash_voice_jobs j set state='held',outcome=reason,updated_at=now()
 where j.meta_followup_lead_id=lead and j.state in ('ready','issued') and j.provider_call_sid is null and j.conversation_id is null
  and not exists(select 1 from public.icash_operation_spend o where o.operation_key='voice:'||j.id);
 return new;
end $$;
create trigger icash_meta_stop_followups after update of response_at,address_confirmed_at,declined_at,paused on public.icash_meta_leads
 for each row execute function public.icash_meta_cancel_followups();
create trigger icash_meta_reply_stop_followups after insert or update of state on public.icash_text_messages
 for each row execute function public.icash_meta_cancel_followups();
revoke all on function public.icash_meta_followup_current(uuid,text),public.icash_meta_prepare_followups(uuid),public.icash_meta_cancel_followups() from public,anon,authenticated;
grant execute on function public.icash_meta_followup_current(uuid,text),public.icash_meta_prepare_followups(uuid),public.icash_meta_cancel_followups() to service_role;
commit;
