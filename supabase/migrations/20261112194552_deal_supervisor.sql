-- A durable owner for the next supported step. Provider work stays in the existing
-- once-only workers. Install disabled; activate only after the matching release.
create table public.icash_deal_supervisor_settings (
 id integer primary key check(id=1), enabled boolean not null default false,
 activated_at timestamptz, release_sha text,
 check(not enabled or (activated_at is not null and release_sha ~ '^[0-9a-f]{40}$'))
);
insert into public.icash_deal_supervisor_settings(id) values(1);
create table public.icash_deal_supervisor (
 deal_id uuid primary key references public.icash_deal_files(id),
 account_id uuid not null references public.icash_accounts(id),
 state text not null check(state in ('ready','waiting','blocked','complete','stopped')),
 milestone text not null, reason text not null, next_step text not null,
 evidence jsonb not null default '{}', last_action text, last_error text,
 revision bigint not null default 1, next_check_at timestamptz not null default now(),
 checked_at timestamptz not null default now(), changed_at timestamptz not null default now()
);
create index icash_deal_supervisor_due on public.icash_deal_supervisor(next_check_at,deal_id);
create index icash_deal_supervisor_account on public.icash_deal_supervisor(account_id);
-- Append-only wakeups avoid locking a supervisor row while a source transaction
-- holds a deal, message or journey row. A sweep deletes only the IDs it observed.
create table public.icash_deal_supervisor_events (
 id bigint generated always as identity primary key,
 account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),
 source text not null, observed_at timestamptz not null default now()
);
create index icash_deal_supervisor_events_deal on public.icash_deal_supervisor_events(deal_id,id);
create index icash_deal_supervisor_events_account on public.icash_deal_supervisor_events(account_id);
alter table public.icash_deal_supervisor_settings enable row level security;
alter table public.icash_deal_supervisor enable row level security;
alter table public.icash_deal_supervisor_events enable row level security;
revoke all on public.icash_deal_supervisor_settings,public.icash_deal_supervisor,public.icash_deal_supervisor_events from public,anon,authenticated;
grant all on public.icash_deal_supervisor_settings,public.icash_deal_supervisor,public.icash_deal_supervisor_events to service_role;
grant usage,select on sequence public.icash_deal_supervisor_events_id_seq to service_role;

create function public.icash_wake_deal_supervisor() returns trigger language plpgsql set search_path='' as $$
declare a uuid;d uuid;
begin
 if tg_op='UPDATE' and (to_jsonb(new)-'updated_at'-'next_run_at')=(to_jsonb(old)-'updated_at'-'next_run_at') then return new;end if;
 if not exists(select 1 from public.icash_deal_supervisor_settings where id=1 and enabled) then return new;end if;
 if tg_table_name='icash_signing_envelopes' and to_jsonb(new)->'test_mode'='true'::jsonb then return new;end if;
 if tg_table_name='icash_accounts' then
  insert into public.icash_deal_supervisor_events(account_id,deal_id,source)
   select account_id,deal_id,tg_table_name from public.icash_deal_supervisor where account_id=new.id and state not in ('complete','stopped') order by next_check_at limit 100;
  return new;
 end if;
 if tg_table_name='icash_text_threads' then
  if not exists(select 1 from public.icash_deal_supervisor where deal_id=new.deal_id and account_id=new.account_id) then return new;end if;
 end if;
 if tg_table_name='icash_deal_files' then a:=new.account_id;d:=new.id;
 elsif tg_table_name='icash_text_messages' then
  select t.account_id,t.deal_id into a,d from public.icash_text_threads t where t.id=new.thread_id and t.account_id=new.account_id;
  -- Cold openers do not turn a draft into an engaged opportunity.
  if new.direction<>'incoming' and not exists(select 1 from public.icash_deal_supervisor where deal_id=d and account_id=a) then return new;end if;
 else a:=new.account_id;d:=new.deal_id;end if;
 if exists(select 1 from public.icash_deal_files f join public.icash_screening_jobs s on s.id=f.screening_id and s.account_id=f.account_id
  where f.id=d and f.account_id=a and coalesce(f.terms->>'practice','false')<>'true'
  and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.snapshot->>'propertyId','') not like 'practice_%') then
  insert into public.icash_deal_supervisor_events(account_id,deal_id,source) values(a,d,tg_table_name);
 end if;
 return new;
end $$;
create trigger icash_supervisor_deal after update of stage,terms on public.icash_deal_files for each row when (old.stage is distinct from new.stage or old.terms is distinct from new.terms) execute function public.icash_wake_deal_supervisor();
create trigger icash_supervisor_message after insert or update of state,provider_id on public.icash_text_messages for each row execute function public.icash_wake_deal_supervisor();
create trigger icash_supervisor_signing after insert or update of state,provider_evidence on public.icash_signing_envelopes for each row execute function public.icash_wake_deal_supervisor();
create trigger icash_supervisor_journey after insert or update of state,buyer_details on public.icash_deal_journeys for each row execute function public.icash_wake_deal_supervisor();
create trigger icash_supervisor_title after insert or update of state,provider_id on public.icash_title_requests for each row execute function public.icash_wake_deal_supervisor();
create trigger icash_supervisor_closing after insert on public.icash_closing_updates for each row execute function public.icash_wake_deal_supervisor();
create trigger icash_supervisor_proceeds after insert on public.icash_proceeds_receipts for each row execute function public.icash_wake_deal_supervisor();
create trigger icash_supervisor_control after update of bot_paused on public.icash_accounts for each row when (old.bot_paused is distinct from new.bot_paused) execute function public.icash_wake_deal_supervisor();
create trigger icash_supervisor_thread after update of paused,manual_only,ai_mode,permission_until,retired_at on public.icash_text_threads for each row execute function public.icash_wake_deal_supervisor();

create function public.icash_supervise_deal(p_account uuid,p_deal uuid) returns jsonb language plpgsql set search_path='' as $$
declare cfg public.icash_deal_supervisor_settings;d public.icash_deal_files;s public.icash_screening_jobs;
 purchase public.icash_signing_envelopes;assignment public.icash_signing_envelopes;signing public.icash_signing_envelopes;
 fulfillment public.icash_fulfillment_jobs;j public.icash_deal_journeys;t public.icash_title_requests;
 m public.icash_text_messages;progress jsonb;closing public.icash_closing_updates;proceeds public.icash_proceeds_receipts;
 status text:='waiting';milestone text:='seller';why text:='awaiting_seller';step text:='Wait for a current seller response.';
 evidence jsonb:='{}';action text;due timestamptz:=now()+interval '1 hour';job_id uuid;repaired integer:=0;
begin
 select * into cfg from public.icash_deal_supervisor_settings where id=1;
 if cfg.enabled is distinct from true then return jsonb_build_object('status','disabled','repaired',0);end if;
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account;
 if d.id is null or s.id is null or coalesce(d.terms->>'practice','false')='true'
  or coalesce(s.snapshot->>'practice','false')='true' or coalesce(s.snapshot->>'propertyId','') like 'practice_%' then
  return jsonb_build_object('status','excluded','repaired',0);
 end if;
 -- Canonical signatures require actual ordered recipient receipts and exact terms.
 select * into purchase from public.icash_signing_envelopes e where e.account_id=p_account and e.deal_id=p_deal and e.kind='purchase'
  and e.updated_at<=now() and public.icash_learning_signature_verified(e) order by e.updated_at,e.id limit 1;
 select * into assignment from public.icash_signing_envelopes e where e.account_id=p_account and e.deal_id=p_deal and e.kind='assignment'
  and e.updated_at<=now() and public.icash_learning_signature_verified(e) order by e.updated_at,e.id limit 1;
 -- Same evidence boundary as icash_learning_deal_outcomes, scoped to this deal.
 select u.* into closing from public.icash_closing_updates u join public.icash_title_replies r
  on r.id=u.reply_id and r.account_id=u.account_id and r.deal_id=u.deal_id and r.sender_verified
  where u.account_id=p_account and u.deal_id=p_deal and u.kind='closed' and u.created_at between assignment.updated_at and now()
  and r.received_at<=u.created_at and u.effective_date<=(now() at time zone 'America/Chicago')::date
  and (u.confirmed_by is not null or u.confirmation_source='verified_title_format')
  and purchase.id is not null and assignment.id is not null order by u.created_at,u.id limit 1;
 select r.* into proceeds from public.icash_proceeds_receipts r join public.icash_closing_updates u
  on u.id=r.closing_update_id and u.account_id=r.account_id and u.deal_id=r.deal_id and u.kind='funds_disbursed'
  join public.icash_title_replies reply on reply.id=u.reply_id and reply.account_id=u.account_id and reply.deal_id=u.deal_id and reply.sender_verified
  where r.account_id=p_account and r.deal_id=p_deal and closing.id is not null
  and r.amount_cents=u.amount_cents and r.amount_cents>0 and r.confirmed_by is not null
  and (u.confirmed_by is not null or u.confirmation_source='verified_title_format') and reply.received_at<=u.created_at
  and u.created_at between closing.created_at and now() and r.created_at between u.created_at and now()
  and r.received_date between u.effective_date and (now() at time zone 'America/Chicago')::date;
 evidence:=jsonb_build_object('purchaseEnvelopeId',purchase.id,'assignmentEnvelopeId',assignment.id,'closingUpdateId',closing.id,'proceedsReceiptId',proceeds.id,'receivedCents',coalesce(proceeds.amount_cents,0));
 if proceeds.id is not null then status:='complete';milestone:='proceeds';why:='proceeds_received';step:='Verified proceeds received.';due:=now()+interval '1 day';
 elsif closing.id is not null then milestone:='proceeds';why:='awaiting_proceeds_receipt';step:='Reconcile actual proceeds with the verified closing; a closing is not a payment.';
 elsif d.stage='cancelled' then status:='stopped';why:='deal_cancelled';step:='Preserve cancellation.';due:=now()+interval '1 day';
 elsif exists(select 1 from public.icash_accounts where id=p_account and bot_paused)
  or exists(select 1 from public.icash_property_controls c where c.account_id=p_account and c.property_id=s.snapshot->>'propertyId' and c.manual)
  or exists(select 1 from public.icash_handoffs h where h.account_id=p_account and h.screening_id=s.id and h.state<>'resolved')
  or exists(select 1 from public.icash_conversations c where c.account_id=p_account and c.deal_id=p_deal and c.human_takeover) then
  status:='blocked';why:='customer_control';step:='Wait for the customer to release Pause or manual control.';
 elsif purchase.id is not null then
  milestone:=case when assignment.id is null then 'buyer' else 'title' end;
  select * into fulfillment from public.icash_fulfillment_jobs where account_id=p_account and deal_id=p_deal;
  if fulfillment.id is null and public.icash_journey_allowed(p_account,p_deal) then
   insert into public.icash_fulfillment_jobs(account_id,deal_id,purchase_envelope_id) values(p_account,p_deal,purchase.id) on conflict(deal_id) do nothing returning * into fulfillment;
   if found then action:='queued_missing_fulfillment';repaired:=repaired+1;end if;
  end if;
  select * into j from public.icash_deal_journeys where account_id=p_account and deal_id=p_deal and state<>'closed' order by last_progress_at desc,id limit 1;
  if j.id is not null and j.next_run_at<=now() and public.icash_journey_current(j.id) then
   -- This only prepares the existing source-keyed actions. It cannot send or sign.
   perform public.icash_advance_journey(j.id);action:=coalesce(action||',','')||'advanced_existing_journey';
   select * into j from public.icash_deal_journeys where id=j.id;
  end if;
  select * into t from public.icash_title_requests where account_id=p_account and deal_id=p_deal order by created_at desc,id limit 1;
  evidence:=evidence||jsonb_build_object('fulfillmentJobId',fulfillment.id,'fulfillmentState',fulfillment.state,'journeyId',j.id,'journeyState',j.state,'titleRequestId',t.id,'titleRequestState',t.state);
  if fulfillment.id is null then status:='blocked';why:='fulfillment_authority_required';step:='Resolve current purchase, marketing and account authority before fulfillment.';
  elsif fulfillment.state='held' then status:='blocked';why:='fulfillment_held';step:='Resolve the existing fulfillment hold without resetting it.';
  elsif fulfillment.state in ('ready','issued') then status:='ready';why:='fulfillment_queued';step:='Complete the existing buyer and title preparation job.';due:=now()+interval '5 minutes';
  elsif j.state='needs_review' then status:='blocked';why:='buyer_next_step_review';step:='Resolve the existing buyer request and original receipts.';
  elsif assignment.id is not null then
   if t.id is null then status:='blocked';why:='title_opening_required';step:='Complete title qualification and the existing executed-document handoff.';
   elsif t.state in ('needs_review','dispatching') then status:='blocked';why:='title_receipt_review';step:='Reconcile the original title request; never send a duplicate.';
   else why:='awaiting_verified_closing';step:='Continue title tasks and obtain a verified closing confirmation.';end if;
  elsif j.id is not null then why:='buyer_next_step';step:='Continue the existing buyer details, viewing, signature or deposit workflow.';due:=now()+interval '5 minutes';
  else why:='buyer_matching';step:='Continue authorized buyer matching and package delivery from the existing fulfillment workflow.';end if;
 elsif exists(select 1 from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='purchase' and not test_mode) then
  select * into signing from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='purchase' and not test_mode order by created_at desc,id desc limit 1;
  milestone:='purchase';why:='awaiting_verified_purchase';step:='Reconcile the original purchase envelope and collect required signatures.';due:=now()+interval '5 minutes';
  evidence:=evidence||jsonb_build_object('pendingEnvelopeId',signing.id,'pendingEnvelopeState',signing.state);
  if signing.state in ('needs_review','failed','cancelled','completed') then status:='blocked';why:='purchase_receipt_review';end if;
 else
  select x.* into m from public.icash_text_messages x join public.icash_text_threads th on th.id=x.thread_id and th.account_id=x.account_id
   where x.account_id=p_account and th.deal_id=p_deal and th.party='seller' and th.retired_at is null and x.direction='incoming' and x.state='received'
   order by x.created_at desc,x.id desc limit 1;
  if m.id is not null then
   progress:=public.icash_refresh_seller_reply_progress(p_account,m.id);
   -- Repair only an absent job for a fresh, receipt-backed current conversation.
   -- Existing failed/issued/unknown jobs are immutable recovery boundaries.
   if (progress->>'state'='pending' or progress->>'reason'='reply_not_routed') and progress->'context'->'blockers'='[]'::jsonb
    and progress->>'outgoingId' is null and public.icash_sms_reply_time(m.id)>=extract(epoch from greatest(cfg.activated_at,now()-interval '24 hours'))
    and public.icash_sms_reply_time(m.id)<=extract(epoch from now())
    and public.icash_seller_conversation_context(p_account,m.thread_id) is not null
    and not public.icash_seller_sms_call_current(p_account,m.id)
    and not exists(select 1 from public.icash_text_ai_jobs where account_id=p_account and message_id=m.id) then
    insert into public.icash_text_ai_jobs(account_id,thread_id,message_id) values(p_account,m.thread_id,m.id) on conflict(message_id) do nothing returning id into job_id;
    if job_id is not null then
     if public.icash_seller_progress_gate(p_account,job_id) then repaired:=repaired+1;action:='queued_missing_seller_reply';end if;
     progress:=public.icash_refresh_seller_reply_progress(p_account,m.id);
    end if;
   end if;
   milestone:=coalesce(progress->>'milestone','seller');why:=coalesce(progress->>'reason','seller_progress_unavailable');
   step:=coalesce(progress->>'nextStep','Review the current source message and conversation.');
   status:=case progress->>'state' when 'pending' then 'ready' when 'waiting' then 'waiting' when 'stopped' then 'stopped' when 'superseded' then 'waiting' else 'blocked' end;
   if status='ready' then due:=now()+interval '5 minutes';end if;
   evidence:=evidence||jsonb_build_object('sellerMessageId',m.id,'sellerThreadId',m.thread_id,'sellerProgress',progress-'context','sellerFacts',jsonb_build_object('answered',progress->'context'->'answered','blockers',progress->'context'->'blockers','offerAuthorized',progress->'context'->'offerAuthorized','proposedPriceCents',progress->'context'->'proposedPriceCents'));
  end if;
 end if;
 insert into public.icash_deal_supervisor(deal_id,account_id,state,milestone,reason,next_step,evidence,last_action,next_check_at)
 values(p_deal,p_account,status,milestone,why,step,evidence,action,due)
 on conflict(deal_id) do update set state=excluded.state,milestone=excluded.milestone,reason=excluded.reason,next_step=excluded.next_step,evidence=excluded.evidence,
  last_action=coalesce(excluded.last_action,icash_deal_supervisor.last_action),last_error=null,next_check_at=excluded.next_check_at,checked_at=now(),
  revision=icash_deal_supervisor.revision+case when (icash_deal_supervisor.state,icash_deal_supervisor.reason,icash_deal_supervisor.evidence) is distinct from (excluded.state,excluded.reason,excluded.evidence) then 1 else 0 end,
  changed_at=case when (icash_deal_supervisor.state,icash_deal_supervisor.reason,icash_deal_supervisor.evidence) is distinct from (excluded.state,excluded.reason,excluded.evidence) then now() else icash_deal_supervisor.changed_at end
 where icash_deal_supervisor.account_id=excluded.account_id;
 return jsonb_build_object('status',status,'repaired',repaired);
end $$;

create function public.icash_run_deal_supervisor() returns jsonb language plpgsql set search_path='' set statement_timeout='15s' set lock_timeout='1s' as $$
declare c record;result jsonb;processed integer:=0;repairs integer:=0;errors integer:=0;
begin
 if not exists(select 1 from public.icash_deal_supervisor_settings where id=1 and enabled) then
  return jsonb_build_object('status','disabled','processed',0,'repaired',0,'errors',0);end if;
 if not pg_try_advisory_xact_lock(726341972) then return jsonb_build_object('status','busy','processed',0,'repaired',0,'errors',0);end if;
 -- Reserve capacity for overdue checks as well as fresh events. No full draft scan.
 for c in with due as materialized (select account_id,deal_id from public.icash_deal_supervisor where next_check_at<=now() order by next_check_at,deal_id limit 10),
  events as materialized (select id,account_id,deal_id from public.icash_deal_supervisor_events order by id limit 100),
  fresh as (select account_id,deal_id from events group by account_id,deal_id order by min(id) limit 15),
  candidates as (select account_id,deal_id from due union select account_id,deal_id from fresh)
  select candidate.*,array(select e.id from events e where e.account_id=candidate.account_id and e.deal_id=candidate.deal_id) event_ids from candidates candidate loop
  begin
   result:=public.icash_supervise_deal(c.account_id,c.deal_id);
   repairs:=repairs+coalesce((result->>'repaired')::integer,0);processed:=processed+1;
  exception when others then
   errors:=errors+1;
   insert into public.icash_deal_supervisor(account_id,deal_id,state,milestone,reason,next_step,last_error,next_check_at)
   values(c.account_id,c.deal_id,'blocked','review','supervisor_check_failed','Recheck the original workflow; no provider action was retried.',sqlstate,now()+interval '5 minutes')
   on conflict(deal_id) do update set last_error=excluded.last_error,next_check_at=excluded.next_check_at,checked_at=now() where icash_deal_supervisor.account_id=excluded.account_id;
  end;
  -- Sequence order is not commit order: a late-committing lower ID must survive.
  delete from public.icash_deal_supervisor_events where account_id=c.account_id and deal_id=c.deal_id and id=any(c.event_ids);
 end loop;
 return jsonb_build_object('status','checked','processed',processed,'repaired',repairs,'errors',errors);
end $$;
revoke all on function public.icash_wake_deal_supervisor(),public.icash_supervise_deal(uuid,uuid),public.icash_run_deal_supervisor() from public,anon,authenticated;
grant execute on function public.icash_wake_deal_supervisor(),public.icash_run_deal_supervisor() to service_role;
-- The per-deal implementation is intentionally private; only the serialized runner
-- is an external entry point. Both functions execute with the service role's rights.
grant execute on function public.icash_supervise_deal(uuid,uuid) to service_role;
notify pgrst,'reload schema';
