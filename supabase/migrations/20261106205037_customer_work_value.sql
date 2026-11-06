-- Read-only receipts. Research priority is staged separately from reporting.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Explicit requests and offers in the seller's own words. A generic price
-- question or an affirmative response to an ownership question is insufficient.
create function icash_work_private.value_offer_request(body text) returns boolean
language sql immutable security invoker set search_path='' as $value$
 select lower(trim(regexp_replace(translate(body,'’',''''),'\s+',' ','g'))) ~
 $rx$^(yes[, ]+)?(((please )?(make|send|give) (me|us) (a |an |your |your best |a cash |an all.cash )?offer( (on|for) (it|(my|our|the) (house|home|property)))?)|(what('s| is) your (cash )?offer)|(i('d| would| will)|we('d| would| will)) sell (it )?for [$]?[0-9][0-9,.]*(k| thousand)?|(i am|i'm|we are|we're) (interested in|open to) selling( (my|our|the) (house|home|property))?|(i|we) (want|would like) to sell( (my|our|the) (house|home|property))?)[.!? ]*$$rx$
$value$;

create function icash_work_private.value_call_quote(result jsonb) returns text
language sql immutable security invoker set search_path='' as $value$
 select case when result->'optedOut' is distinct from 'true'::jsonb and coalesce(result->>'contactEvidence','') not in ('automated_answer','no_response') and public.icash_seller_call_disposition(result) is null
  and public.icash_call_has_seller_response(result) then coalesce(public.icash_seller_interest_quote(result),(
   select left(turn->>'message',240) from jsonb_array_elements(case when jsonb_typeof(result->'transcript')='array' then result->'transcript' else '[]'::jsonb end)
    with ordinality as turns(turn,seq)
   where turn->>'role'='user' and icash_work_private.value_offer_request(turn->>'message') order by seq desc limit 1)) end
$value$;

-- Only a narrow evidence projection leaves the private inbound-call archive.
create function icash_work_private.value_inbound_calls(p_account uuid,p_start timestamptz,p_end timestamptz)
returns table(screening_id uuid,contact_key text,source_id uuid,at timestamptz,quote text)
language sql stable security definer set search_path='' as $value$
 select h.screening_id,h.contact_key,h.session_id,h.completed_at,icash_work_private.value_call_quote(jsonb_build_object('transcript',h.transcript))
 from icash_seller_agreement_private.call_history h
 where h.account_id=p_account and h.completed_at between p_start and p_end
$value$;

-- Use the same contact key for a phone call and an authenticated text reply.
-- Select one piece of evidence per seller contact, even across multiple properties.
create function icash_work_private.value_sellers(p_account uuid,p_start timestamptz,p_end timestamptz)
returns table(seller_key text,screening_id uuid,source text,source_id uuid,thread_id uuid,at timestamptz,quote text)
language sql stable security invoker set search_path='' as $value$
 with events as (
  select c.contact_key,c.screening_id,'call'::text source,c.id source_id,null::uuid thread_id,c.completed_at at,
    icash_work_private.value_call_quote(c.result) quote
  from public.icash_live_conversations c
  where c.account_id=p_account and c.party='seller' and c.state='complete' and nullif(c.conversation_id,'') is not null
   and c.completed_at between p_start and p_end and c.result->'optedOut' is distinct from 'true'::jsonb
  union all
  select i.contact_key,i.screening_id,'reception',i.source_id,null,i.at,i.quote
  from icash_work_private.value_inbound_calls(p_account,p_start,p_end) i
  union all
  select encode(sha256(convert_to(t.recipient,'UTF8')),'hex'),d.screening_id,'text',m.id,t.id,m.created_at,left(m.body,240)
  from public.icash_text_messages m
  join public.icash_text_threads t on t.account_id=m.account_id and t.id=m.thread_id and t.party='seller'
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  where m.account_id=p_account and m.direction='incoming' and m.state='received'
   and coalesce(nullif(m.provider_id,''),nullif(m.event_id,'')) is not null and t.recipient ~ '^[+][1-9][0-9]{7,14}$'
   and m.created_at between p_start and p_end and coalesce(d.terms->>'practice','false')<>'true'
   and case when icash_work_private.value_offer_request(m.body) then true
     when lower(trim(m.body)) ~ $rx$^(yes|yeah|yep|sure|interested|i am interested|i'm interested|yes i am|yes,? (i am )?interested)[.! ]*$$rx$
     then public.icash_seller_sms_interest_at(p_account,t.id,m.created_at,m.created_at)=m.created_at else false end
 ), real_events as (
  select e.* from events e join public.icash_screening_jobs s on s.id=e.screening_id and s.account_id=p_account
  where s.state='complete' and e.quote is not null and nullif(e.contact_key,'') is not null
   and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.result->>'practice','false')<>'true'
   and left(coalesce(s.snapshot->>'propertyId',''),9)<>'practice_' and left(coalesce(s.result->'property'->>'propertyId',''),9)<>'practice_'
 )
 select distinct on (e.contact_key) e.contact_key,e.screening_id,e.source,e.source_id,e.thread_id,e.at,left(e.quote,240)
 from real_events e order by e.contact_key,e.at desc,e.source_id
$value$;

create function icash_work_private.value_spent(p_account uuid,p_start timestamptz,p_end timestamptz)
returns bigint language sql stable security invoker set search_path='' as $value$
 select coalesce(sum(greatest(0,-l.delta_cents-coalesce(c.delta_cents,0))),0)::bigint
 from public.icash_credit_ledger l
 left join public.icash_credit_ledger c on c.account_id=l.account_id and c.kind='grant'
  and l.event_key like 'usage:%' and c.event_key='usage-coverage:'||substr(l.event_key,7) and c.created_at<=p_end
 where l.account_id=p_account and l.kind='usage' and l.delta_cents<0 and l.created_at between p_start and p_end
$value$;

create function icash_work_private.value_receipt(p_account uuid,p_start timestamptz,p_end timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $value$
 with sellers as materialized (select * from icash_work_private.value_sellers(p_account,p_start,p_end)),
 chosen as (select * from sellers order by at desc,source_id limit 1),
 last_work as (
   (select 'property_screened' kind,s.completed_at at from public.icash_screening_jobs s
    where s.account_id=p_account and s.state='complete' and s.completed_at<=p_end and s.result is not null
     and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.result->>'practice','false')<>'true'
     and left(coalesce(s.snapshot->>'propertyId',''),9)<>'practice_' and left(coalesce(s.result->'property'->>'propertyId',''),9)<>'practice_'
    order by s.completed_at desc limit 1)
   union all
   (select 'work_settled',o.settled_at from public.icash_operation_spend o where o.account_id=p_account and o.state='settled' and o.settled_at<=p_end order by o.settled_at desc limit 1)
   union all
   (select case when m.direction='incoming' then 'seller_reply' else 'text_sent' end,m.created_at from public.icash_text_messages m
    join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id and t.party='seller'
    join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
    join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
    where m.account_id=p_account and ((m.direction='incoming' and m.state='received' and coalesce(nullif(m.provider_id,''),nullif(m.event_id,'')) is not null)
     or (m.direction='outgoing' and m.state in ('accepted','delivered') and nullif(m.provider_id,'') is not null))
     and m.created_at<=p_end and coalesce(d.terms->>'practice','false')<>'true' and coalesce(s.snapshot->>'practice','false')<>'true'
     and left(coalesce(s.snapshot->>'propertyId',''),9)<>'practice_' and left(coalesce(s.result->'property'->>'propertyId',''),9)<>'practice_'
    order by m.created_at desc limit 1)
   union all
   (select 'call_completed',c.completed_at from public.icash_live_conversations c
    join public.icash_screening_jobs s on s.id=c.screening_id and s.account_id=c.account_id
    where c.account_id=p_account and c.party='seller' and c.state='complete' and c.completed_at<=p_end and nullif(c.conversation_id,'') is not null
     and coalesce(s.snapshot->>'practice','false')<>'true' and left(coalesce(s.snapshot->>'propertyId',''),9)<>'practice_' and left(coalesce(s.result->'property'->>'propertyId',''),9)<>'practice_'
    order by c.completed_at desc limit 1)
   union all select 'seller_interest',at from chosen
 ), next_reply as (
  select r.reason, d.screening_id,t.id thread_id,r.next_check_at
  from public.icash_seller_reply_progress r
  join public.icash_text_messages m on m.id=r.message_id and m.account_id=r.account_id and m.thread_id=r.thread_id
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id and t.party='seller'
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id and d.id=r.deal_id
  join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
  where r.account_id=p_account and r.state in ('needs_review','waiting','pending')
   and r.reason in ('visit_requested','price_reconciliation','awaiting_seller_reply','awaiting_dispatch')
   and m.direction='incoming' and m.state='received' and coalesce(nullif(m.provider_id,''),nullif(m.event_id,'')) is not null
   and m.created_at<=p_end and coalesce(d.terms->>'practice','false')<>'true' and coalesce(s.snapshot->>'practice','false')<>'true'
   and left(coalesce(s.snapshot->>'propertyId',''),9)<>'practice_' and left(coalesce(s.result->'property'->>'propertyId',''),9)<>'practice_'
   and not exists(select 1 from public.icash_text_suppressions x where x.phone=t.recipient)
   and not exists(select 1 from public.icash_text_messages newer where newer.account_id=t.account_id and newer.thread_id=t.id
    and newer.direction='incoming' and newer.state='received' and coalesce(nullif(newer.provider_id,''),nullif(newer.event_id,'')) is not null and (newer.created_at,newer.id)>(m.created_at,m.id))
  order by (r.reason in ('visit_requested','price_reconciliation')) desc,m.created_at desc limit 1
 ), next_callback as (
  select b.due_at from public.icash_live_callbacks b join public.icash_live_conversations c on c.account_id=b.account_id and c.id=b.conversation_id and c.screening_id=b.screening_id and c.party='seller'
  join public.icash_screening_jobs s on s.account_id=b.account_id and s.id=b.screening_id
  where b.account_id=p_account and b.state='pending_dispatch_review' and b.due_at>p_end
   and coalesce(s.snapshot->>'practice','false')<>'true' and left(coalesce(s.snapshot->>'propertyId',''),9)<>'practice_'
   and not exists(select 1 from public.icash_property_controls pc where pc.account_id=b.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
  order by b.due_at limit 1
 ), next_opening as (
  select (case when (p_end at time zone z.name)::time<time '09:00' then (p_end at time zone z.name)::date
     else (p_end at time zone z.name)::date+1 end + time '09:00') at time zone z.name as at
  from public.icash_voice_jobs j
  join public.icash_voice_contact_targets v on v.id=coalesce(j.permission_id,j.operational_contact_id) and v.account_id=j.account_id
  left join public.icash_operational_contacts oc on oc.id=j.operational_contact_id and oc.account_id=j.account_id and oc.channel='voice'
  cross join lateral (select public.icash_outreach_timezone(v.timezone,oc.timezone_basis) name) z
  where j.account_id=p_account and j.state='ready' and j.due_at<=p_end and v.party='seller'
   and j.callback_id is null and j.sms_source_message_id is null and j.cancellation_notice_id is null and j.operation_key is null and j.provider_call_sid is null
   and v.revoked_at is null and v.permission_until>p_end and v.dnc_clear
   and extract(hour from p_end at time zone z.name) not between 9 and 20
   and not exists(select 1 from public.icash_text_suppressions x where x.phone=v.phone)
   and not exists(select 1 from public.icash_contact_suppressions x where x.contact_key=v.contact_key)
   and not public.icash_voice_outreach_hours_current(p_account,j.id)
  order by at limit 1
 )
 select jsonb_build_object('spentCents',icash_work_private.value_spent(p_account,p_start,p_end),
  'availableCents',greatest(0,w.balance_cents-w.reserved_cents),'heldCents',w.reserved_cents,
  'interested',(select count(*) from sellers),'evidence',(select jsonb_build_object('screeningId',screening_id,'source',source,'sourceId',source_id,'threadId',thread_id,'at',at,'quote',quote) from chosen),
  'lastWork',(select jsonb_build_object('kind',kind,'at',at) from last_work order by at desc limit 1),
  'nextReply',(select jsonb_build_object('reason',reason,'screeningId',screening_id,'threadId',thread_id,'checkAt',case when next_check_at>p_end then next_check_at end) from next_reply),
  'callbackAt',(select due_at from next_callback),'contactWindowAt',(select at from next_opening))
 from public.icash_wallets w where w.account_id=p_account
$value$;

-- Count exactly the same question family in signed-in support and the owner report.
create function public.icash_value_question(p_question text) returns boolean
language sql immutable security invoker set search_path='' as $value$
 select coalesce(p_question !~* '\m(refund|cancel|renewal|subscription|dispute|chargeback|charged twice|credit card|payment method)\M'
 and p_question ~* $rx$(what|where|how).{0,55}(my|the|our|these|those|work|bot|i|money|credits?|dollars?).{0,42}(spen[td]|pa(id|y) for|money go|credits? go|get me|used (on|for)|buy me|accomplish)|\m(money|credits?|dollars?)\M.{0,38}(go towards|go toward|used for|spent on|wasted|nothing to show)|\m(what|show)\M.{0,30}(work|activity|results?).{0,22}(paid for|for my money)|\m(spent|used|spent all my)\M.{0,35}\m(no leads|no replies|nothing to show|no results)\M|\m(no spend|zero spend|not spending|isn.t spending)\M$rx$,false)
$value$;

create function public.icash_weekly_work_value(p_actor uuid,p_include_owner boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $value$
declare owner_id constant uuid:='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'; ends timestamptz:=now(); starts timestamptz:=now()-interval '7 days'; result jsonb;
begin
 if p_actor is distinct from owner_id or p_include_owner is null then raise exception 'Owner required' using errcode='42501'; end if;
 with funded as materialized (
  select f.account_id,min(greatest(f.paid_at,f.credited_at)) funded_at
  from public.icash_funding_orders f join public.icash_accounts a on a.id=f.account_id
  where (p_include_owner or a.owner_user_id<>owner_id) and f.mode='live' and f.state='paid' and f.price_cents>0 and f.paid_at<=ends and f.credited_at<=ends
   and exists(select 1 from public.icash_credit_ledger l where l.account_id=f.account_id and l.event_key='stripe-funding:'||f.id::text and l.kind='purchase' and l.delta_cents>0 and l.evidence_ref=f.stripe_payment_id)
  group by f.account_id
 )
 select jsonb_build_object('startAt',starts,'endAt',ends,'funded',count(*),
  'spentCents',coalesce(sum(icash_work_private.value_spent(f.account_id,greatest(starts,f.funded_at),ends)),0),
  'interested',coalesce(sum((select count(*) from icash_work_private.value_sellers(f.account_id,greatest(starts,f.funded_at),ends))),0),
  'asked',count(*) filter(where exists(select 1 from public.icash_support_messages m where m.account_id=f.account_id and m.role='user' and m.created_at between greatest(starts,f.funded_at) and ends and public.icash_value_question(m.content))))
 into result from funded f;
 return result;
end $value$;

create table icash_work_private.value_priority_settings(id boolean primary key check(id),enabled boolean not null default false);
insert into icash_work_private.value_priority_settings(id) values(true);
alter table icash_work_private.value_priority_settings enable row level security;
revoke all on icash_work_private.value_priority_settings from public,anon,authenticated,service_role;
grant select on icash_work_private.value_priority_settings to service_role;

-- A first, short opportunity to handle fresh, actionable replies or callbacks.
-- Each source ages out independently; an old draft or an outage cannot freeze buying.
create function icash_work_private.warm_seller_due(p_account uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $value$
begin
 if not exists(select 1 from icash_work_private.value_priority_settings where id and enabled) then return false; end if;
 return exists (
  select 1 from public.icash_text_ai_jobs j
  join public.icash_text_threads t on t.id=j.thread_id and t.account_id=j.account_id
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
  join public.icash_text_messages m on m.id=j.message_id and m.thread_id=t.id and m.account_id=t.account_id
  where j.account_id=p_account and j.state in ('pending','drafted') and j.next_attempt_at<=now() and j.outgoing_id is null
   and m.direction='incoming' and m.state='received' and coalesce(nullif(m.provider_id,''),nullif(m.event_id,'')) is not null
   and m.created_at<=now() and greatest(m.created_at,j.next_attempt_at) between now()-interval '5 minutes' and now()
   and t.party='seller' and t.ai_mode='auto' and not t.paused and not t.manual_only and t.retired_at is null
   and coalesce(t.eligibility_until,t.permission_until)>now() and coalesce(d.terms->>'practice','false')<>'true'
   and public.icash_seller_response_disposition(m.body) is null
   and not exists(select 1 from public.icash_text_suppressions x where x.phone=t.recipient)
   and not exists(select 1 from public.icash_contact_suppressions x where x.contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex'))
   and not exists(select 1 from public.icash_property_controls x where x.account_id=p_account and x.property_id=s.snapshot->>'propertyId' and x.manual)
   and not exists(select 1 from public.icash_seller_reply_progress r where r.message_id=m.id and r.account_id=p_account and r.state<>'pending')
 ) or exists (
  select 1 from public.icash_voice_jobs j join public.icash_voice_contact_targets v on v.account_id=j.account_id and v.id=coalesce(j.permission_id,j.operational_contact_id)
  join public.icash_screening_jobs s on s.id=v.screening_id and s.account_id=v.account_id
  where j.account_id=p_account and j.state='ready' and (j.callback_id is not null or j.sms_source_message_id is not null)
   and j.due_at between now()-interval '5 minutes' and now() and j.provider_call_sid is null and j.operation_key is null
   and v.party='seller' and v.revoked_at is null and v.permission_until>now() and v.dnc_clear
   and not exists(select 1 from public.icash_text_suppressions x where x.phone=v.phone)
   and not exists(select 1 from public.icash_contact_suppressions x where x.contact_key=v.contact_key)
   and not exists(select 1 from public.icash_property_controls x where x.account_id=p_account and x.property_id=s.snapshot->>'propertyId' and x.manual)
   and public.icash_outgoing_voice_capacity_open() and public.icash_voice_outreach_hours_current(p_account,j.id)
 );
end $value$;

-- Preserve every predecessor admission check. Never gate the seller reply's own charge.
do $patch$
declare part record; def text;
begin
 for part in select * from (values
  ('public.icash_opportunity_progress_report(uuid,integer,text)', $old$'screened',(select count(*) from first_screens$old$, $new$'receipt',icash_work_private.value_receipt(p_account,starts,ends),
  'screened',(select count(*) from first_screens$new$),
  ('public.icash_next_acquisition()', $old$ perform public.icash_prepare_research_efficiency(c.account_id);$old$, $new$ if icash_work_private.warm_seller_due(c.account_id) then
  update public.icash_discovery_configs set next_run_at=now()+interval '15 seconds' where account_id=c.account_id;
  continue;
 end if;
 perform public.icash_prepare_research_efficiency(c.account_id);$new$),
  ('public.icash_resume_prospecting_ticket()', $old$then public.icash_research_waiting_on_outreach(a.id) else false end waiting_for_outreach$old$,
   $new$then (icash_work_private.warm_seller_due(a.id) or public.icash_research_waiting_on_outreach(a.id)) else false end waiting_for_outreach$new$),
  ('public.icash_guard_prospecting_spend()', $old$if public.icash_research_waiting_on_outreach(new.account_id) then$old$,
   $new$if icash_work_private.warm_seller_due(new.account_id) or public.icash_research_waiting_on_outreach(new.account_id) then$new$)
 ) as parts(signature,old_part,new_part) loop
  def:=pg_get_functiondef(part.signature::regprocedure);
  if (length(def)-length(replace(def,part.old_part,'')))/length(part.old_part)<>1 then raise exception 'Value prerequisite changed: %',part.signature; end if;
  execute replace(def,part.old_part,part.new_part);
 end loop;
end $patch$;

revoke all on function icash_work_private.value_offer_request(text), icash_work_private.value_call_quote(jsonb), icash_work_private.value_inbound_calls(uuid,timestamptz,timestamptz), icash_work_private.value_sellers(uuid,timestamptz,timestamptz), icash_work_private.value_spent(uuid,timestamptz,timestamptz), icash_work_private.value_receipt(uuid,timestamptz,timestamptz), icash_work_private.warm_seller_due(uuid), public.icash_value_question(text), public.icash_weekly_work_value(uuid,boolean) from public,anon,authenticated;
grant execute on function icash_work_private.value_offer_request(text), icash_work_private.value_call_quote(jsonb), icash_work_private.value_inbound_calls(uuid,timestamptz,timestamptz), icash_work_private.value_sellers(uuid,timestamptz,timestamptz), icash_work_private.value_spent(uuid,timestamptz,timestamptz), icash_work_private.value_receipt(uuid,timestamptz,timestamptz), icash_work_private.warm_seller_due(uuid), public.icash_value_question(text), public.icash_weekly_work_value(uuid,boolean) to service_role;
commit;
