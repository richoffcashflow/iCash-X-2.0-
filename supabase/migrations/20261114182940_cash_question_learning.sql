-- Connect the current reviewed cash questions to outcome learning.
-- Derived labels may recover old source-bound answers; no historical allocation
-- is relabelled and no message, receipt, authority or money record is changed.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$ declare r record;begin
 if to_regprocedure('icash_learning_private.seller_contact_window_costs(uuid,text,timestamptz,timestamptz)') is null then raise exception 'Seller contact cost scope required';end if;
 for r in select * from (values
 ('public.icash_seller_cash_question_plan(uuid,uuid)','ef8d85115b898c003fd8e78a23204349'),
 ('public.icash_assign_seller_opener_v6(uuid,uuid)','58f10880c180299fb1eb9c4bfd1a339c'),
 ('public.icash_record_learning_decision(text,text,text,jsonb,text[],boolean)','d085ec5a7e47f0ae28a772c2d74741ad'),
 ('public.icash_seller_sms_interest_at(uuid,uuid,timestamptz,timestamptz)','1093a0e69d410fc497235da6566f6297'),
 ('public.icash_refresh_seller_interest(uuid)','81160d294374cc6847d018f2ffc9e826'),
 ('icash_learning_private.record_policy_application()','4afd57f13acf023f9972d364f56e3435')
 ) v(signature,checksum) loop
  if md5(pg_get_functiondef(to_regprocedure(r.signature))) is distinct from r.checksum then
   raise exception 'Cash question learning prerequisite changed: %',r.signature;
  end if;
 end loop;
end $guard$;
create table icash_learning_policy_private.cash_learning_settings(
 id integer primary key check(id=1),installed_at timestamptz not null default now(),enabled_at timestamptz,release_sha text check(release_sha ~ '^[a-f0-9]{40}$'),
 check(enabled_at is null or release_sha is not null)
);
insert into icash_learning_policy_private.cash_learning_settings(id) values(1);
alter table icash_learning_policy_private.cash_learning_settings enable row level security;
revoke all on icash_learning_policy_private.cash_learning_settings from public,anon,authenticated,service_role;
grant select on icash_learning_policy_private.cash_learning_settings to service_role;

-- V5 remains mandatory. Existing V6 assignments remain without a decision;
-- only new V6 assignments may carry a complete immutable decision receipt.
alter table public.icash_seller_opener_assignments drop constraint seller_opener_v5_decision_check;
alter table public.icash_seller_opener_assignments add constraint seller_opener_v5_decision_check check(
 (learning_context in ('identity-v5','cash-question-v6') and learning_decision_id is not null and learning_policy_version='evidence-v2'
  and learning_policy_version is not null and learning_selection_mode is not null and learning_selection_mode in ('control','explore','shared'))
 or (learning_context<>'identity-v5' and learning_decision_id is null and learning_policy_version is null and learning_selection_mode is null));

create function public.icash_seller_cash_learning_active() returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from icash_learning_policy_private.cash_learning_settings c
  join icash_learning_policy_private.settings s on s.id=c.id and s.enabled and s.release_sha=c.release_sha
  join icash_learning_policy_private.sms_settings sms on sms.id=c.id and sms.enabled
  join icash_learning_private.policy_releases r on r.release_sha=c.release_sha
  where c.id=1 and c.enabled_at between c.installed_at and now() and r.completed_at between c.installed_at and c.enabled_at
   and r.registered_at<=now() and s.activated_at between r.completed_at and c.enabled_at and s.evidence_after>=r.completed_at)
$$;
create function public.icash_activate_cash_question_learning(p_actor uuid,p_release_sha text,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid or p_enabled is null then raise exception 'Owner required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(726341927);perform 1 from public.icash_operating_budget where id=1 for update;
 if not p_enabled then update icash_learning_policy_private.cash_learning_settings set enabled_at=null where id=1;
  return jsonb_build_object('enabled',false);end if;
 if not public.icash_seller_cash_questions_enabled() or not exists(
  select 1 from icash_learning_policy_private.cash_learning_settings c
  join icash_learning_policy_private.settings s on s.id=c.id and s.enabled and s.release_sha=p_release_sha
  join icash_learning_private.policy_releases r on r.release_sha=s.release_sha
  join icash_learning_policy_private.sms_settings sms on sms.id=s.id and sms.enabled
  where c.id=1 and r.completed_at between c.installed_at and now() and s.activated_at between r.completed_at and now()
   and s.evidence_after>=r.completed_at and r.registered_at<=now()) then raise exception 'Canonical successful post-install learning release required';end if;
 update icash_learning_policy_private.cash_learning_settings set release_sha=p_release_sha,
  enabled_at=case when release_sha=p_release_sha and enabled_at>=(select activated_at from icash_learning_policy_private.settings where id=1) then enabled_at else now() end where id=1;
 return jsonb_build_object('enabled',true,'releaseSha',p_release_sha);
end $$;

-- Call transcripts are retained 30 days. Preserve only verified negative receipt
-- identity/timing so routine transcript deletion cannot turn a refusal positive.
create table icash_learning_private.cash_inbound_negatives(
 session_id uuid primary key,account_id uuid not null,screening_id uuid not null,contact_key text not null,
 completed_at timestamptz not null,disposition text not null check(disposition in ('opt_out','declined','review'))
);
create index cash_inbound_negative_scope on icash_learning_private.cash_inbound_negatives(account_id,screening_id,contact_key,completed_at);
alter table icash_learning_private.cash_inbound_negatives enable row level security;
revoke all on icash_learning_private.cash_inbound_negatives from public,anon,authenticated,service_role;
create function icash_learning_private.capture_cash_inbound_negative() returns trigger
language plpgsql security definer set search_path='' as $$
declare disposition text:=public.icash_seller_call_disposition(jsonb_build_object('transcript',new.transcript));
begin
 if disposition in ('opt_out','declined','review') and nullif(new.conversation_id,'') is not null and new.completed_at<=now() then
  insert into icash_learning_private.cash_inbound_negatives
  select new.session_id,new.account_id,new.screening_id,new.contact_key,new.completed_at,disposition
  where exists(select 1 from icash_seller_agreement_private.inbound_bindings b
   join public.icash_deal_files d on d.id=b.deal_id and d.account_id=b.account_id and d.screening_id=new.screening_id
   join public.icash_text_threads t on t.id=b.thread_id and t.account_id=d.account_id and t.deal_id=d.id and t.party='seller'
   where b.session_id=new.session_id and b.account_id=new.account_id and encode(sha256(convert_to(t.recipient,'UTF8')),'hex')=new.contact_key)
  on conflict do nothing;
 end if;
 return new;
end $$;
create trigger icash_learning_cash_inbound_negative after insert on icash_seller_agreement_private.call_history
 for each row execute function icash_learning_private.capture_cash_inbound_negative();
insert into icash_learning_private.cash_inbound_negatives
 select h.session_id,h.account_id,h.screening_id,h.contact_key,h.completed_at,public.icash_seller_call_disposition(jsonb_build_object('transcript',h.transcript))
 from icash_seller_agreement_private.call_history h
 where nullif(h.conversation_id,'') is not null and h.completed_at<=now()
  and public.icash_seller_call_disposition(jsonb_build_object('transcript',h.transcript)) in ('opt_out','declined','review')
  and exists(select 1 from icash_seller_agreement_private.inbound_bindings b
   join public.icash_deal_files d on d.id=b.deal_id and d.account_id=b.account_id and d.screening_id=h.screening_id
   join public.icash_text_threads t on t.id=b.thread_id and t.account_id=d.account_id and t.deal_id=d.id and t.party='seller'
   where b.session_id=h.session_id and b.account_id=h.account_id and encode(sha256(convert_to(t.recipient,'UTF8')),'hex')=h.contact_key);
create function icash_learning_private.cash_inbound_disposition(p_account uuid,p_screening uuid,p_recipient text,p_start timestamptz,p_end timestamptz)
returns text language sql stable security definer set search_path='' as $$
 select case when bool_or(disposition='opt_out') then 'opt_out' when count(*)>0 then 'held' end
 from icash_learning_private.cash_inbound_negatives where account_id=p_account and screening_id=p_screening
  and contact_key=encode(sha256(convert_to(p_recipient,'UTF8')),'hex') and completed_at between p_start and least(p_end,now())
$$;
revoke all on function icash_learning_private.capture_cash_inbound_negative() from public,anon,authenticated,service_role;

-- Incoming created_at is webhook ingestion time. A reward needs its exact
-- provider event (including both phone numbers/body) and actual source clock.
-- Missing or future source chronology cannot be reconstructed into a positive.
create function icash_learning_private.seller_sms_received_at(p_account uuid,p_thread uuid,p_message uuid)
returns timestamptz language sql stable security invoker set search_path='' as $$
 select case when jsonb_typeof(e.payload->'timestamp')='number' then
  case when (e.payload->>'timestamp')::numeric between 0 and least(extract(epoch from now()),extract(epoch from m.created_at)+300,extract(epoch from e.received_at)+300)
   then to_timestamp((e.payload->>'timestamp')::double precision) end end
 from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
 join public.icash_text_events e on e.id=m.event_id
 where m.id=p_message and m.account_id=p_account and m.thread_id=p_thread and m.direction='incoming' and m.state='received'
  and e.type in ('text.incoming.sms','text.incoming.mms') and e.payload->>'type'=e.type and e.payload->>'id'=e.id
  and e.payload->'data'->>'from'=t.recipient and e.payload->'data'->>'to'=t.sender and e.payload->'data'->>'body'=m.body
$$;

-- A positive must answer the original actual delivered question. Unknown or
-- intervening question clocks remain ambiguous. This is interest, not ownership,
-- price acceptance, permission, contract or a closed deal.
create function public.icash_seller_sms_interest_v6_at(p_account uuid,p_thread uuid,p_start timestamptz,p_end timestamptz)
returns timestamptz language sql stable security invoker set search_path='' as $function$
 with assigned as (
  select a.*,public.icash_conversation_street(d.terms->>'address') address,d.screening_id,t.recipient,o.dispatched_at original_started_at
  from public.icash_seller_opener_assignments a
  join public.icash_text_threads t on t.id=a.thread_id and t.account_id=a.account_id and t.party='seller'
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join public.icash_text_messages m on m.id=a.message_id and m.thread_id=a.thread_id and m.account_id=a.account_id and m.body=a.body
  join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id
  where a.account_id=p_account and a.thread_id=p_thread and a.learning_context='cash-question-v6'
   and a.variant in ('cash_sale_v6','all_cash_v6','cash_offer_v6')
   and a.body=public.icash_seller_cash_question(a.variant,public.icash_conversation_street(d.terms->>'address'))
   and m.direction='outgoing' and m.state='delivered' and nullif(m.provider_id,'') is not null
   and o.dispatched_at>=greatest(a.created_at,m.created_at) and o.dispatched_at<=least(p_end,now())
   and m.last_delivery_at between o.dispatched_at and now() and a.delivered_at between o.dispatched_at and now()
 ), questions as (
  select a.message_id id from assigned a
  union
  -- The approved identity clarification asks the same cash-sale question.
  -- Bind it to its real incoming identity question and exact saved job/output.
  select j.outgoing_id from assigned a
  join public.icash_text_ai_jobs j on j.account_id=a.account_id and j.thread_id=a.thread_id
  join public.icash_text_messages source on source.id=j.message_id and source.account_id=j.account_id and source.thread_id=j.thread_id
  join public.icash_text_messages m on m.id=j.outgoing_id and m.account_id=j.account_id and m.thread_id=j.thread_id
  where j.analysis->>'dialogueAction'='cash_identity_v6' and source.direction='incoming' and source.state='received'
   and icash_learning_private.seller_sms_received_at(a.account_id,a.thread_id,source.id)>=a.delivered_at
   and source.created_at>=a.delivered_at and m.created_at>=source.created_at
   and m.body=public.icash_seller_cash_identity_reply(source.body,a.address)
   and m.body like '% Have you considered a cash sale?'
 )
 select min(actual.received_at) from assigned a cross join questions candidate
 join public.icash_text_messages question on question.id=candidate.id and question.thread_id=p_thread and question.account_id=p_account
 join public.icash_operation_spend operation on operation.operation_key='text:'||question.id and operation.account_id=question.account_id
 join public.icash_text_messages reply on reply.thread_id=p_thread and reply.account_id=p_account
 cross join lateral(select icash_learning_private.seller_sms_received_at(p_account,p_thread,reply.id) received_at) actual
 where question.direction='outgoing' and question.state='delivered' and nullif(question.provider_id,'') is not null
  and question.last_delivery_at between operation.dispatched_at and now()
  and operation.dispatched_at>=greatest(a.created_at,question.created_at) and operation.dispatched_at<=least(p_end,now())
  and reply.direction='incoming' and reply.state='received'
  and question.last_delivery_at<=actual.received_at and a.delivered_at<=actual.received_at
  and actual.received_at>operation.dispatched_at and actual.received_at between p_start and least(p_end,now())
  and lower(trim(reply.body)) ~ '^(yes|yeah|yep|sure|interested|i am interested|i''m interested|yes please|yes i am|yes i am interested|yes, i am interested|yes interested|yes, interested)[.! ]*$'
  and not coalesce(a.opted_out,false)
  and not exists(select 1 from public.icash_text_suppressions where phone=a.recipient)
  and not exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(a.recipient,'UTF8')),'hex'))
  and icash_learning_private.cash_inbound_disposition(a.account_id,a.screening_id,a.recipient,a.original_started_at,p_end) is null
  and not exists(select 1 from public.icash_text_messages negative where negative.account_id=a.account_id and negative.thread_id=a.thread_id
   and negative.direction='incoming' and negative.state='received' and (nullif(negative.provider_id,'') is not null or nullif(negative.event_id,'') is not null)
   and coalesce(icash_learning_private.seller_sms_received_at(negative.account_id,negative.thread_id,negative.id),negative.created_at) between a.original_started_at and least(p_end,now()) and public.icash_seller_response_disposition(negative.body) is not null)
  and not exists(select 1 from public.icash_call_recordings r
   join public.icash_live_conversations c on c.account_id=r.account_id and c.operation_key=r.operation_key
   join public.icash_operation_spend o on o.account_id=r.account_id and o.operation_key=r.operation_key
   where r.account_id=a.account_id and r.screening_id=a.screening_id and r.party='seller' and r.to_phone=a.recipient
    and c.screening_id=a.screening_id and c.party='seller' and c.state='complete' and nullif(c.conversation_id,'') is not null
    and o.dispatched_at between a.original_started_at and c.completed_at
    and c.completed_at between a.original_started_at and least(p_end,now())
    and (public.icash_seller_call_disposition(c.result) is not null
     or (public.icash_call_has_seller_response(c.result) and c.result->'optedOut'='true'::jsonb)))
  and not exists(select 1 from public.icash_text_messages m
   left join public.icash_operation_spend sent on sent.account_id=m.account_id and sent.operation_key='text:'||m.id
   where m.thread_id=a.thread_id and m.account_id=a.account_id and m.id not in (question.id,reply.id)
   and ((m.direction='incoming' and m.state='received' and (icash_learning_private.seller_sms_received_at(m.account_id,m.thread_id,m.id) between operation.dispatched_at and actual.received_at
     or (icash_learning_private.seller_sms_received_at(m.account_id,m.thread_id,m.id) is null and m.created_at between operation.dispatched_at and reply.created_at)))
    or (m.direction='outgoing' and nullif(m.provider_id,'') is not null and m.state in ('accepted','delivered')
     and (sent.dispatched_at between operation.dispatched_at and actual.received_at
      or (sent.dispatched_at is null and (m.created_at between operation.dispatched_at and actual.received_at
       or m.last_delivery_at between operation.dispatched_at and actual.received_at))))));
$function$;
-- The new seller-call cost reader shares these same negative receipts. Install
-- only after the private helper exists; both allocation gates remain disabled.
do $call_negatives$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_refresh_seller_call_learning(uuid)'::regprocedure);
 needle:='coalesce(v.opted_out,false) or coalesce(t.opted_out,false) opted_out,';
 replacement:='coalesce(v.opted_out,false) or coalesce(t.opted_out,false) or coalesce(inbound.opted_out,false)
    or exists(select 1 from public.icash_text_suppressions where phone=f.recipient)
    or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(f.recipient,''UTF8'')),''hex'')) opted_out,';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'Seller call opt-out boundary changed';end if;
 definition:=replace(definition,needle,replacement);
 needle:='coalesce(v.held,false) or coalesce(t.held,false) held,';
 replacement:='coalesce(v.held,false) or coalesce(t.held,false) or coalesce(inbound.held,false) held,';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'Seller call refusal boundary changed';end if;
 definition:=replace(definition,needle,replacement);
 needle:='  where f.started_at between now()-interval ''180 days'' and now()';
 replacement:='  left join lateral (
   select bool_or(disposition=''opt_out'') opted_out,bool_or(disposition is not null) held
   from (select icash_learning_private.cash_inbound_disposition(p_account,p.id,f.recipient,f.started_at,f.started_at+interval ''72 hours'') disposition
    from properties p where p.property_key=f.property_key) negatives
  ) inbound on true
'||needle;
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'Seller call inbound source boundary changed';end if;
 definition:=replace(definition,needle,replacement);
 needle:='m.created_at between f.started_at and least(f.started_at+interval ''72 hours'',now())';
 replacement:='coalesce(icash_learning_private.seller_sms_received_at(m.account_id,m.thread_id,m.id),m.created_at) between f.started_at and least(f.started_at+interval ''72 hours'',now())';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'Seller call SMS source clock boundary changed';end if;
 definition:=replace(definition,needle,replacement);
 needle:='m.created_at<f.started_at';
 replacement:='coalesce(icash_learning_private.seller_sms_received_at(m.account_id,m.thread_id,m.id),m.created_at)<f.started_at';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'Seller call prior SMS boundary changed';end if;
 execute replace(definition,needle,replacement);
end $call_negatives$;

alter function public.icash_seller_sms_interest_at(uuid,uuid,timestamptz,timestamptz) rename to icash_seller_sms_interest_before_cash_learning;
create function public.icash_seller_sms_interest_at(p_account uuid,p_thread uuid,p_start timestamptz,p_end timestamptz) returns timestamptz
language sql stable security invoker set search_path='' as $$
 select case when exists(select 1 from public.icash_seller_opener_assignments where account_id=p_account and thread_id=p_thread and learning_context='cash-question-v6')
  then public.icash_seller_sms_interest_v6_at(p_account,p_thread,p_start,p_end)
  else public.icash_seller_sms_interest_before_cash_learning(p_account,p_thread,p_start,p_end) end
$$;
create function public.icash_refresh_seller_interest_v6(p_account uuid) returns void
language plpgsql security invoker set search_path='' as $function$
begin
 -- The account refresh already holds this same transaction lock. Direct
 -- service calls also replace only this context atomically and idempotently.
 perform pg_advisory_xact_lock(hashtextextended(p_account::text,81021));
 delete from public.icash_learning_rollups where account_id=p_account and domain='seller_sms' and context='cash-question-v6';
 with properties as materialized (
  select id,nullif(snapshot->>'propertyId','') property_key from public.icash_screening_jobs
  where account_id=p_account and nullif(snapshot->>'propertyId','') is not null
 ), property_outcomes as materialized (
  select p.property_key,min(e.purchase_at) purchase_at,min(e.closed_at) closed_at
  from public.icash_learning_deal_outcomes(p_account) e join properties p on p.id=e.screening_id group by p.property_key
 ), eligible as materialized (
  select a.*,o.dispatched_at started_at,t.recipient,d.screening_id,p.property_key
  from public.icash_seller_opener_assignments a
  join public.icash_text_messages m on m.id=a.message_id and m.account_id=a.account_id and m.thread_id=a.thread_id and m.body=a.body
   and m.direction='outgoing'
  join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
  join public.icash_text_threads t on t.id=a.thread_id and t.account_id=a.account_id and t.party='seller'
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join properties p on p.id=d.screening_id
  where a.account_id=p_account and a.learning_context='cash-question-v6'
   and a.variant in ('cash_sale_v6','all_cash_v6','cash_offer_v6')
   and a.body=public.icash_seller_cash_question(a.variant,public.icash_conversation_street(d.terms->>'address'))
   and public.icash_seller_sms_learning_eligible(p_account,t.id)
   and o.dispatched_at>=greatest(a.created_at,m.created_at) and o.dispatched_at between now()-interval '90 days' and now()

 ), first_exposures as materialized (
  -- One property is one experiment unit across every recipient and variant.
  -- Re-screening the same provider property cannot duplicate a signed deal.
  select distinct on (property_key) * from eligible order by property_key,started_at,thread_id
 ), base as materialized (
  select b.*,e.purchase_at,e.closed_at from first_exposures b
  left join property_outcomes e on e.property_key=b.property_key
  where (e.purchase_at is null or e.purchase_at>=b.started_at)
   -- Prior outreach cannot be relabelled as a fresh v6 treatment. Missing
   -- canonical clocks on known sends are conservative, never inferred fresh.
   and not exists(select 1 from properties p join public.icash_deal_files d on d.screening_id=p.id and d.account_id=p_account
    join public.icash_text_threads t on t.deal_id=d.id and t.account_id=p_account and t.party='seller'
    join public.icash_text_messages m on m.thread_id=t.id and m.account_id=p_account
    left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key='text:'||m.id
    where p.property_key=b.property_key and m.id<>b.message_id
     and ((m.direction='outgoing' and m.state in ('accepted','delivered') and nullif(m.provider_id,'') is not null and coalesce(o.dispatched_at,m.created_at)<b.started_at)
      or (m.direction='incoming' and m.state='received' and (nullif(m.provider_id,'') is not null or nullif(m.event_id,'') is not null) and coalesce(icash_learning_private.seller_sms_received_at(m.account_id,m.thread_id,m.id),m.created_at)<b.started_at)))
   and not exists(select 1 from properties p join public.icash_customer_phone_calls c on c.screening_id=p.id and c.account_id=p_account
    left join public.icash_operation_spend o on o.account_id=c.account_id and o.operation_key=c.operation_key
    where p.property_key=b.property_key and coalesce(o.dispatched_at,c.connected_at,c.created_at)<b.started_at)
   and not exists(select 1 from properties p join public.icash_call_recordings r on r.screening_id=p.id and r.account_id=p_account and r.party='seller'
    left join public.icash_operation_spend o on o.account_id=r.account_id and o.operation_key=r.operation_key
    where p.property_key=b.property_key and (nullif(r.call_sid,'') is not null or r.dial_claimed_at is not null or o.dispatched_at is not null)
     and coalesce(o.dispatched_at,r.dial_claimed_at,r.created_at)<b.started_at)
   and not exists(select 1 from properties p join public.icash_live_conversations c on c.screening_id=p.id and c.account_id=p_account and c.party='seller'
    left join public.icash_operation_spend o on o.account_id=c.account_id and o.operation_key=c.operation_key
    where p.property_key=b.property_key and nullif(c.conversation_id,'') is not null and coalesce(o.dispatched_at,c.created_at)<b.started_at)
 ), exposures as materialized (
  select b.*,public.icash_seller_sms_interest_v6_at(p_account,b.thread_id,b.started_at,b.started_at+interval '72 hours') interest_at,
   coalesce(b.opted_out,false) or coalesce(sms.opted_out,false) or coalesce(calls.opted_out,false) or coalesce(icash_learning_private.cash_inbound_disposition(p_account,b.screening_id,b.recipient,b.started_at,b.started_at+interval '72 hours')='opt_out',false) contact_opted_out,
   coalesce(sms.held,false) or coalesce(calls.held,false) or icash_learning_private.cash_inbound_disposition(p_account,b.screening_id,b.recipient,b.started_at,b.started_at+interval '72 hours') is not null contact_held
  from base b
  left join lateral (
   select bool_or(public.icash_seller_response_disposition(m.body)='opt_out') opted_out,
    bool_or(public.icash_seller_response_disposition(m.body) is not null) held
   from public.icash_text_messages m where m.account_id=p_account and m.thread_id=b.thread_id and m.direction='incoming' and m.state='received'
    and (nullif(m.provider_id,'') is not null or nullif(m.event_id,'') is not null)
    and coalesce(icash_learning_private.seller_sms_received_at(m.account_id,m.thread_id,m.id),m.created_at) between b.started_at and least(b.started_at+interval '72 hours',now())
  ) sms on true
  left join lateral (
   select bool_or(public.icash_seller_call_disposition(c.result)='opt_out' or c.result->'optedOut'='true'::jsonb) opted_out,
    bool_or(public.icash_seller_call_disposition(c.result) is not null) held
   from public.icash_call_recordings r join public.icash_live_conversations c on c.account_id=r.account_id and c.operation_key=r.operation_key
   join public.icash_operation_spend o on o.account_id=r.account_id and o.operation_key=r.operation_key
   where r.account_id=p_account and r.screening_id=b.screening_id and r.party='seller' and r.to_phone=b.recipient
    and c.screening_id=b.screening_id and c.party='seller' and c.state='complete' and nullif(c.conversation_id,'') is not null
    and o.dispatched_at between b.started_at and c.completed_at
    and c.completed_at between b.started_at and least(b.started_at+interval '72 hours',now())
  ) calls on true
 ), costs as (
  select e.thread_id,cost->'priorContact'='true'::jsonb prior_contact,cost->>'scope' scope,(cost->>'costCents')::bigint cents,(cost->>'complete')::boolean complete
  from exposures e cross join lateral (
   select icash_learning_private.seller_contact_window_costs(p_account,e.property_key,e.started_at,least(e.started_at+interval '72 hours',now())) cost
  ) c
 )
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,
  contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete,cost_scope)
 select p_account,'seller_sms','cash-question-v6','*',e.variant,count(*),
  -- Early answers remain observable in their source conversation, but all
  -- experiment arms finish the same window before producing positive labels.
  count(*) filter(where e.started_at>now()-interval '72 hours'),
  count(*) filter(where e.started_at<=now()-interval '72 hours' and e.interest_at is not null and not e.contact_opted_out and not e.contact_held),count(*) filter(where e.contact_opted_out),
  count(*) filter(where e.started_at<=now()-interval '30 days'),
  count(*) filter(where e.started_at<=now()-interval '30 days' and e.purchase_at between e.started_at and e.started_at+interval '30 days'),
  count(*) filter(where e.started_at<=now()-interval '60 days'),
  count(*) filter(where e.started_at<=now()-interval '60 days' and e.closed_at between e.started_at and e.started_at+interval '60 days'),
  coalesce(sum(c.cents) filter(where e.started_at<=now()-interval '72 hours'),0),
  (bool_and(c.complete) filter(where e.started_at<=now()-interval '72 hours')) is true,'seller-contact-72h-v1'
 from exposures e join costs c on c.thread_id=e.thread_id where not c.prior_contact group by e.variant;
end $function$;


-- Only reviewed V6 alternatives enter the existing immutable decision ledger.
do $scope$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_record_learning_decision(text,text,text,jsonb,text[],boolean)'::regprocedure);
 needle:=$n$or (p_domain='seller_sms' and p_context='identity-v5'$n$;
 replacement:=$n$or (p_domain='seller_sms' and p_context='cash-question-v6' and p_market='*' and cardinality(p_choices)>0
   and p_choices<@array['cash_sale_v6','all_cash_v6','cash_offer_v6'])
  or (p_domain='seller_sms' and p_context='identity-v5'$n$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Cash learning decision scope changed';end if;
 execute replace(d,needle,replacement);
 d:=pg_get_functiondef('icash_learning_private.record_policy_application()'::regprocedure);
 needle:=$n$expected:=public.icash_seller_sms_learning_plan(new.account_id,new.thread_id);$n$;
 replacement:=$n$expected:=case when new.learning_context='cash-question-v6' then public.icash_seller_cash_question_plan(new.account_id,new.thread_id)
   else public.icash_seller_sms_learning_plan(new.account_id,new.thread_id) end;$n$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Cash learning application boundary changed';end if;
 execute replace(d,needle,replacement);
end $scope$;

alter function public.icash_seller_cash_question_plan(uuid,uuid) rename to icash_seller_cash_question_before_learning;
create function public.icash_seller_cash_question_plan(p_account uuid,p_thread uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $function$
declare fallback jsonb;address text;unit text;choices text[];allowed text[];challengers text[];chosen text;
 stats jsonb;decision jsonb;mode text:='explore';bucket bigint;control boolean;
begin
 fallback:=public.icash_seller_cash_question_before_learning(p_account,p_thread);
 if fallback is null or not public.icash_seller_cash_learning_active() or not public.icash_seller_sms_learning_eligible(p_account,p_thread) then return fallback;end if;
 select public.icash_conversation_street(d.terms->>'address'),nullif(j.snapshot->>'propertyId','') into address,unit
 from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 join public.icash_screening_jobs j on j.id=d.screening_id and j.account_id=d.account_id where t.id=p_thread and t.account_id=p_account and t.party='seller';
 if unit is null then return fallback;end if;
 select array_agg(v.key order by v.key) into choices from public.icash_seller_opener_variants v
 where v.enabled and v.key in ('cash_sale_v6','all_cash_v6','cash_offer_v6')
  and v.body=replace(public.icash_seller_cash_question(v.key,'ADDRESS'),'ADDRESS','{address}')
  and public.icash_seller_cash_question(v.key,address) is not null;
 if coalesce(cardinality(choices),0)=0 then return null;end if;
 stats:=public.icash_shared_learning_stats('seller_sms','cash-question-v6','*');
 decision:=public.icash_learning_decision_v2(stats,choices,false);
 select array_agg(c order by c) into allowed from unnest(choices)c where decision->'allowedChoices' ? c;
 if coalesce(cardinality(allowed),0)=0 then return null;end if;
 -- Fixed account holdout and property-unit assignment preserve a prospective
 -- comparison while treatment retains 40% challenger allocation after a winner.
 bucket:=('x'||substr(md5(p_account::text||unit||':seller-sms:cash-question-v6:learning'),1,8))::bit(32)::bigint%10000;
 control:=('x'||substr(md5(p_account::text||':seller-sms:cash-question-v6:control'),1,8))::bit(32)::bigint%10000<2000;
 if control then mode:='control';end if;
 if not control and decision->>'status'='shared' and decision->>'winner'=any(allowed) and cardinality(allowed)>1 then
  select array_agg(c order by c) into challengers from unnest(allowed)c where c<>decision->>'winner';
  if bucket<6000 then chosen:=decision->>'winner';mode:='shared';
  else chosen:=challengers[1+(bucket-6000)%cardinality(challengers)];end if;
 else chosen:=allowed[1+bucket%cardinality(allowed)];end if;
 return jsonb_build_object('variant',chosen,'body',public.icash_seller_cash_question(chosen,address),'context','cash-question-v6',
  'stats',stats,'choices',to_jsonb(choices),'decision',decision,'mode',mode);
end $function$;
create or replace function public.icash_assign_seller_opener_v6(p_account uuid,p_thread uuid) returns jsonb
language plpgsql security invoker set search_path='' as $function$
declare existing public.icash_seller_opener_assignments;plan jsonb;choices text[];decision_id bigint;saved_decision jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' for update;
 if not found then return null;end if;
 select * into existing from public.icash_seller_opener_assignments where thread_id=p_thread and account_id=p_account;
 if found then return jsonb_build_object('variant',existing.variant,'body',existing.body,'context',existing.learning_context);end if;
 if not public.icash_seller_cash_questions_enabled() then return public.icash_assign_seller_opener_v5(p_account,p_thread);end if;
 plan:=public.icash_seller_cash_question_plan(p_account,p_thread);if plan is null then return null;end if;
 if plan ? 'decision' then
  select array_agg(c order by c) into choices from jsonb_array_elements_text(plan->'choices')c;
  decision_id:=public.icash_record_learning_decision('seller_sms','cash-question-v6','*',plan->'stats',choices,false);
  select decision into saved_decision from icash_learning_policy_private.decisions where id=decision_id;
  if saved_decision is distinct from plan->'decision' then raise exception 'Cash question decision changed';end if;
  insert into public.icash_seller_opener_assignments(thread_id,account_id,variant,body,learning_context,learning_decision_id,learning_policy_version,learning_selection_mode)
  values(p_thread,p_account,plan->>'variant',plan->>'body','cash-question-v6',decision_id,'evidence-v2',plan->>'mode');
 else
  insert into public.icash_seller_opener_assignments(thread_id,account_id,variant,body,learning_context)
  values(p_thread,p_account,plan->>'variant',plan->>'body','cash-question-v6');
 end if;
 return jsonb_build_object('variant',plan->>'variant','body',plan->>'body','context','cash-question-v6');
end $function$;

-- Append the new context to the existing account refresh. The 72/30/60-day
-- windows and unchanged strict qualification remain authoritative.
do $refresh$ declare d text;needle text;begin
 d:=pg_get_functiondef('public.icash_refresh_seller_interest(uuid)'::regprocedure);
 needle:=E' select public.icash_refresh_seller_interest_v5(p_account);\n';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Cash learning refresh boundary changed';end if;
 execute replace(d,needle,needle||E' select public.icash_refresh_seller_interest_v6(p_account);\n');
end $refresh$;

-- Keep the old descriptive report separate from authoritative allocation proof.
create function public.icash_seller_cash_learning_report() returns jsonb language sql stable security invoker set search_path='' as $$
 with evidence as (select public.icash_shared_learning_stats('seller_sms','cash-question-v6','*') stats),
 choices as (select coalesce(array_agg(key order by key),array[]::text[]) arms from public.icash_seller_opener_variants
  where enabled and key in ('cash_sale_v6','all_cash_v6','cash_offer_v6')
   and body=replace(public.icash_seller_cash_question(key,'ADDRESS'),'ADDRESS','{address}'))
 select jsonb_build_object('checkedAt',now(),'context','cash-question-v6','enabled',public.icash_seller_cash_learning_active(),
  'windowHours',72,'controlShare',0.2,'maxLearnedShare',0.6,'stats',stats,'decision',public.icash_learning_decision_v2(stats,arms,false),
  'businessSuccess',false) from evidence cross join choices
$$;
do $acl$ declare sig text;begin
 foreach sig in array array[
 'icash_learning_private.cash_inbound_disposition(uuid,uuid,text,timestamptz,timestamptz)',
 'icash_learning_private.seller_sms_received_at(uuid,uuid,uuid)',
 'public.icash_seller_cash_learning_active()',
 'public.icash_activate_cash_question_learning(uuid,text,boolean)',
 'public.icash_seller_sms_interest_v6_at(uuid,uuid,timestamptz,timestamptz)',
 'public.icash_seller_sms_interest_at(uuid,uuid,timestamptz,timestamptz)',
 'public.icash_seller_sms_interest_before_cash_learning(uuid,uuid,timestamptz,timestamptz)',
 'public.icash_refresh_seller_interest_v6(uuid)',
 'public.icash_seller_cash_question_plan(uuid,uuid)',
 'public.icash_seller_cash_question_before_learning(uuid,uuid)',
 'public.icash_assign_seller_opener_v6(uuid,uuid)',
 'public.icash_seller_cash_learning_report()'] loop
  execute format('revoke all on function %s from public,anon,authenticated',sig);
  execute format('grant execute on function %s to service_role',sig);
 end loop;
end $acl$;
commit;
