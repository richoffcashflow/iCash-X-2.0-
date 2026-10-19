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
