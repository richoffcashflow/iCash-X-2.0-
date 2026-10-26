-- Outbound reminders must fit the existing contact-evidence window.
-- No evidence is renewed, no messages are sent, and no wallet is charged here.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);

alter table public.icash_seller_gaps add column review_reason text
 check(review_reason is null or review_reason='contact_checks_expired');

do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_open_seller_gap(uuid,uuid,text,uuid,text,text,timestamptz)'::regprocedure);
 needle:=' insert into public.icash_seller_gaps(account_id,deal_id,screening_id,thread_id,source,source_id,reason,stage,channel,quote,state,due_at,expires_at,source_at)';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Seller gap scheduling prerequisite changed';end if;
 d:=replace(d,needle,$new$
 -- Operational observations currently last 24 hours from their original source.
 -- Allow one same-day continuation; a missed window needs new contact checks.
 if p_reason='no_response' and t.operational_contact_id is not null then
  due:=greatest(now(),p_at+interval '4 hours');
  if t.eligibility_until is null or due>=t.eligibility_until then initial:='needs_review';end if;
 end if;
 insert into public.icash_seller_gaps(account_id,deal_id,screening_id,thread_id,source,source_id,reason,stage,channel,quote,state,due_at,expires_at,source_at)$new$);
 needle:=' return new_id;';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Seller gap return prerequisite changed';end if;
 execute replace(d,needle,$new$
 if new_id is not null and initial='needs_review' and p_reason='no_response' and t.operational_contact_id is not null then
  update public.icash_seller_gaps set review_reason='contact_checks_expired' where id=new_id;
 end if;
 return new_id;$new$);

 d:=pg_get_functiondef('public.icash_seller_recovery_current(uuid)'::regprocedure);
 needle:='public.icash_seller_sms_permission_current(g.account_id,t.id,false) is true';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Seller recovery contact prerequisite changed';end if;
 d:=replace(d,needle,$new$(public.icash_seller_sms_permission_current(g.account_id,t.id,false) is true
  or (t.operational_contact_id is not null and public.icash_sms_thread_review_current(g.account_id,t.id,false) is true))$new$);
 -- The reviewed operational path takes locks on its current evidence.
 execute replace(d,E'\n STABLE\n',E'\n VOLATILE\n');
end $patch$;

-- Expired unsent reminders become visible work, without changing their original
-- quote/source, renewing a receipt, replaying an uncertain send or clearing Pause.
update public.icash_seller_gaps g
 set state='needs_review',review_reason='contact_checks_expired',updated_at=now()
 from public.icash_text_threads t,public.icash_operational_contacts c
 where g.thread_id=t.id and g.account_id=t.account_id and t.operational_contact_id=c.id
  and c.account_id=t.account_id and g.reason='no_response' and g.stage='draft'
  and g.state='open' and g.outgoing_id is null
  and (t.eligibility_until<=now() or c.eligibility_until<=now());

create function public.icash_next_seller_followup() returns jsonb
language plpgsql security invoker set search_path='' as $function$
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
end $function$;
revoke all on function public.icash_next_seller_followup() from public,anon,authenticated;
grant execute on function public.icash_next_seller_followup() to service_role;

do $patch$
declare d text;needle text:=' retry:=public.icash_recover_unstarted_seller_opener();';
begin
 d:=pg_get_functiondef('public.icash_next_automation()'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Root follow-up scheduling prerequisite changed';end if;
 execute replace(d,needle,$new$
 retry:=public.icash_issue_due_signing_result();
 if retry->>'token' is not null then return retry;end if;
 retry:=public.icash_issue_due_voice_result();
 if retry->>'token' is not null then return retry;end if;
 retry:=public.icash_issue_due_text_ai();
 if retry->>'token' is not null then return retry;end if;
 retry:=public.icash_issue_due_title_followup();
 if retry->>'token' is not null then return retry;end if;
 retry:=public.icash_issue_ready_fulfillment();
 if retry->>'token' is not null then return retry;end if;
 retry:=public.icash_next_seller_followup();
 if retry->>'token' is not null then return retry;end if;
 retry:=public.icash_recover_unstarted_seller_opener();$new$);
end $patch$;
commit;
