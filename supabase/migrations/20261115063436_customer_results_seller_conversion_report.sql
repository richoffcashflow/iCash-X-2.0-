-- Private observation only: no queue repairs, contact renewal, offer authority,
-- provider calls or writes to the original conversation/financial evidence.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create index if not exists icash_conversion_received_recent on public.icash_text_messages(created_at desc,id desc)
 where direction='incoming' and state='received';
create index if not exists icash_conversion_recorded_recent on public.icash_call_recordings(dial_claimed_at desc,id desc)
 where party='seller' and call_sid is not null;
create index if not exists icash_conversion_callbacks_recent on public.icash_live_callbacks(created_at desc,id desc);
create index if not exists icash_conversion_offer_recent on icash_call_offer_private.events(created_at desc,id desc);

create function public.icash_seller_conversion_report(p_actor uuid,p_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='8s' as $$
declare owner_id constant uuid:='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
 finish timestamptz:=now();start_at timestamptz;cap constant integer:=2000;report jsonb;
begin
 if p_actor is distinct from owner_id then raise exception 'Owner required' using errcode='42501';end if;
 if p_days is null or p_days not in (1,7,30) then raise exception 'Invalid report window';end if;
 start_at:=finish-p_days*interval '1 day';
 with recent_received as materialized (
  select * from public.icash_text_messages where direction='incoming' and state='received' and created_at>=start_at and created_at<finish order by created_at desc,id desc limit cap+1
 ), recent_calls as materialized (
  select * from public.icash_call_recordings where party='seller' and call_sid is not null and dial_claimed_at>=start_at and dial_claimed_at<finish order by dial_claimed_at desc,id desc limit cap+1
 ), recent_offers as materialized (
  select e.*,case when split_part(e.call_key,':',2) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   then split_part(e.call_key,':',2)::uuid end source_id from icash_call_offer_private.events e where created_at>=start_at and created_at<finish order by created_at desc,id desc limit cap+1
 ), recent_callbacks as materialized (
  select * from public.icash_live_callbacks where created_at>=start_at and created_at<finish order by created_at desc,id desc limit cap+1
 ), customers as not materialized (
  select a.id,a.bot_paused from public.icash_accounts a
  where a.owner_user_id<>owner_id and exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='live' and f.state='paid')
 ), deals as not materialized (
  select d.id,d.account_id,d.screening_id,a.bot_paused from public.icash_deal_files d
  join customers a on a.id=d.account_id join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
  where coalesce(d.terms->>'practice','false')<>'true' and coalesce(s.snapshot->>'practice','false')<>'true'
   and coalesce(s.snapshot->>'propertyId','') not like 'practice_%'
 ), received_candidates as materialized (
  select m.*,t.deal_id,t.paused or t.manual_only or t.ai_mode<>'auto' or t.retired_at is not null or d.bot_paused controlled,
   to_timestamp(public.icash_sms_reply_time(m.id)::double precision) source_at,
   coalesce(case when jsonb_typeof(e.payload->'timestamp')='number' then (e.payload->>'timestamp')::numeric
    between extract(epoch from start_at) and least(extract(epoch from finish),extract(epoch from m.created_at)+300)
    and e.type in ('text.incoming.sms','text.incoming.mms') and e.payload->>'id'=e.id and e.payload->>'type'=e.type
    and e.payload#>>'{data,from}'=t.recipient and e.payload#>>'{data,to}'=t.sender and e.payload#>>'{data,body}'=m.body
    else false end,false) source_time_known
  from (select * from recent_received order by created_at desc,id desc limit cap) m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id and t.party='seller'
  join deals d on d.id=t.deal_id and d.account_id=t.account_id left join public.icash_text_events e on e.id=m.event_id
  where m.direction='incoming' and m.state='received' and m.created_at>=start_at and m.created_at<finish
   and (nullif(m.provider_id,'') is not null or nullif(m.event_id,'') is not null)
   and public.icash_sms_reply_time(m.id) between extract(epoch from start_at) and extract(epoch from finish)
  order by m.created_at desc,m.id desc limit cap+1
 ), received as materialized (select * from received_candidates order by created_at desc,id desc limit cap),
 reply_observations as materialized (
  select m.id,m.account_id,m.thread_id,m.deal_id,m.source_at,m.source_time_known,m.controlled,
   public.icash_seller_response_disposition(m.body) is null
    and m.body !~* '(auto(matic|mated)?[ -]?(reply|response|message)|out of (the )?office|message (blocking|undeliverable)|wrong (person|number))' actionable,
   not exists(select 1 from public.icash_text_messages newer where newer.account_id=m.account_id and newer.thread_id=m.thread_id
    and newer.direction='incoming' and newer.state='received' and newer.created_at<finish and (public.icash_sms_reply_time(newer.id),newer.id)>(extract(epoch from m.source_at),m.id)) current_source,
   reply.accepted,reply.delivered,reply.dispatch_at,coalesce(reply.unsubmitted,false) unsubmitted,
   exists(select 1 from public.icash_text_messages h where h.account_id=m.account_id and h.thread_id=m.thread_id
    and h.direction='outgoing' and h.customer_author_id is not null and h.state in ('accepted','delivered') and nullif(h.provider_id,'') is not null
    and h.created_at between m.source_at and finish) later_customer_reply,
   exists(select 1 from public.icash_text_ai_jobs j where j.account_id=m.account_id and j.thread_id=m.thread_id and j.message_id=m.id) has_job,
   p.state progress_state,p.reason,p.next_check_at,
   case when m.source_time_known and reply.accepted and reply.dispatch_at between m.source_at and finish
    then extract(epoch from reply.dispatch_at-m.source_at) end latency
  from received m left join public.icash_seller_reply_progress p on p.message_id=m.id and p.account_id=m.account_id and p.thread_id=m.thread_id
  left join lateral (
   with bound as (
    select j.outgoing_id id from public.icash_text_ai_jobs j where j.account_id=m.account_id and j.thread_id=m.thread_id and j.message_id=m.id
    union select r.message_id from public.icash_seller_limited_text_replies r where r.account_id=m.account_id and r.thread_id=m.thread_id and r.source_id=m.id
    union select r.message_id from public.icash_seller_text_replies r where r.account_id=m.account_id and r.thread_id=m.thread_id and r.source_id=m.id
    union select o.interest_message_id from public.icash_sms_seller_openings o where o.account_id=m.account_id and o.thread_id=m.thread_id and o.owner_reply_id=m.id
   ) select bool_or(o.state in ('accepted','delivered') and nullif(o.provider_id,'') is not null) accepted,
    bool_or(o.state='delivered' and nullif(o.provider_id,'') is not null and o.last_delivery_at between m.source_at and finish) delivered,
    min(sp.dispatched_at) filter(where o.state in ('accepted','delivered') and nullif(o.provider_id,'') is not null and sp.dispatched_at between m.source_at and finish) dispatch_at,
    bool_or(o.state='ready' and o.provider_id is null and sp.operation_key is null) unsubmitted
   from bound b join public.icash_text_messages o on o.id=b.id and o.account_id=m.account_id and o.thread_id=m.thread_id
    and o.direction='outgoing' and o.created_at between m.source_at and finish
   left join public.icash_operation_spend sp on sp.account_id=o.account_id and sp.operation_key='text:'||o.id
  ) reply on true
 ), call_candidates as materialized (
  select r.* from (select * from recent_calls order by dial_claimed_at desc,id desc limit cap) r join customers a on a.id=r.account_id
  join public.icash_screening_jobs s on s.id=r.screening_id and s.account_id=r.account_id
  where r.party='seller' and r.call_sid is not null and r.dial_claimed_at>=start_at and r.dial_claimed_at<finish
   and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.snapshot->>'propertyId','') not like 'practice_%'
  order by r.dial_claimed_at desc,r.id desc limit cap+1
 ), calls as materialized (
  select r.id,c.id conversation_id,c.state='complete' and c.completed_at<=finish completed,
   c.state='complete' and c.completed_at<=finish and public.icash_call_has_seller_response(c.result) human_response
  from (select * from call_candidates order by dial_claimed_at desc,id desc limit cap) r
  left join lateral (select x.* from public.icash_live_conversations x where x.account_id=r.account_id and x.screening_id=r.screening_id
   and x.operation_key=r.operation_key and x.contact_key=r.contact_key and x.conversation_id=r.conversation_id and x.party='seller' and nullif(x.conversation_id,'') is not null
   order by x.completed_at desc nulls last,x.id desc limit 1) c on true
 ), offer_candidates as materialized (
  select e.* from (select * from recent_offers order by created_at desc,id desc limit cap) e join deals d on d.id=e.deal_id and d.account_id=e.account_id
  where e.created_at>=start_at and e.created_at<finish and (
   exists(select 1 from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
    where m.id=e.source_id and e.call_key='sms:'||m.id and m.account_id=e.account_id and t.deal_id=e.deal_id and t.party='seller'
     and m.direction='incoming' and m.state='received' and (m.event_id is not null or m.provider_id is not null)
     and e.state->>'processedSource'=m.id::text and e.state->>'textThreadId'=t.id::text)
   or exists(select 1 from public.icash_live_conversations c where c.id=e.source_id and e.call_key='outbound:'||c.id and c.account_id=e.account_id
    and c.screening_id=d.screening_id and c.party='seller' and c.conversation_id is not null and c.created_at<=e.created_at)
   or exists(select 1 from icash_seller_agreement_private.inbound_bindings b join icash_recorded_reception_private.sessions s on s.id=b.session_id and s.account_id=b.account_id
    where s.id=e.source_id and e.call_key='inbound:'||s.id and b.account_id=e.account_id and b.deal_id=e.deal_id and s.conversation_id is not null))
  order by e.created_at desc,e.id desc limit cap+1
 ), offer_deals as materialized (
  select distinct on (e.account_id,e.deal_id) e.account_id,e.deal_id,e.call_key,o.state
  from (select * from offer_candidates order by created_at desc,id desc limit cap) e
  join icash_call_offer_private.offers o on o.deal_id=e.deal_id and o.account_id=e.account_id and o.state=e.state and o.updated_at<=finish
  order by e.account_id,e.deal_id,e.created_at desc,e.id desc
 ), offers as materialized (
  select o.*,
   coalesce(o.state->>'quotedPriceCents','') ~ '^[1-9][0-9]{0,11}$' quoted,
   coalesce(o.state->>'acceptedPriceCents','') ~ '^[1-9][0-9]{0,11}$' and o.state->'acceptedPriceCents'=o.state->'quotedPriceCents' accepted,
   exists(select 1 from public.icash_text_ai_jobs j join public.icash_text_threads t on t.id=j.thread_id and t.account_id=j.account_id
    join public.icash_text_messages m on m.id=j.outgoing_id and m.account_id=j.account_id and m.thread_id=j.thread_id
    where j.account_id=o.account_id and t.deal_id=o.deal_id and j.analysis->>'offerPolicy'='seller-text-offer-v1'
     and (j.analysis->>'offerAction'='cash_offer' or (j.analysis->>'offerAction'='payoff' and m.body like 'As-is cash proposal:%'))
     and j.analysis#>'{offerState,quotedPriceCents}'=o.state->'quotedPriceCents' and j.analysis#>'{offerState,quoteRevision}'=o.state->'quoteRevision'
     and j.analysis#>>'{offerPlan,kind}'='message' and j.analysis#>>'{offerPlan,body}'=j.reply
     and m.body=j.reply and m.direction='outgoing' and m.state='delivered' and m.provider_id is not null and m.last_delivery_at<=finish) sms_delivered,
   exists(select 1 from public.icash_signing_envelopes e where e.account_id=o.account_id and e.deal_id=o.deal_id
    and e.kind='purchase' and e.updated_at<=finish and public.icash_learning_signature_verified(e)) signed
  from offer_deals o
 ), callback_candidates as materialized (
  select cb.id,cb.created_at,cb.due_at,cb.state from (select * from recent_callbacks order by created_at desc,id desc limit cap) cb join customers a on a.id=cb.account_id
  join public.icash_live_conversations c on c.id=cb.conversation_id and c.account_id=cb.account_id and c.screening_id=cb.screening_id
  join public.icash_screening_jobs s on s.id=c.screening_id and s.account_id=c.account_id
  where cb.created_at>=start_at and cb.created_at<finish and c.party='seller' and c.state='complete' and c.completed_at<=finish
   and c.conversation_id is not null and public.icash_call_has_seller_response(c.result)
   and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.snapshot->>'propertyId','') not like 'practice_%'
  order by cb.created_at desc,cb.id desc limit cap+1
 ), callbacks as materialized (select * from callback_candidates order by created_at desc,id desc limit cap)
 select jsonb_build_object('version','seller-conversion-v1','days',p_days,'startAt',start_at,'endAt',finish,'sampleLimit',cap,
  'scope','recent_source_samples','complete',not((select count(*)>cap from recent_received) or (select count(*)>cap from recent_calls)
   or (select count(*)>cap from recent_offers) or (select count(*)>cap from recent_callbacks)),
  'truncated',jsonb_build_object('replies',(select count(*)>cap from recent_received),'calls',(select count(*)>cap from recent_calls),
   'offerEvents',(select count(*)>cap from recent_offers),'callbacks',(select count(*)>cap from recent_callbacks)),
  'replies',(select jsonb_build_object('observed',count(*),'actionable',count(*) filter(where actionable),'restrictedOrAutomated',count(*) filter(where not actionable),
   'currentlyAccepted',count(*) filter(where accepted),'delivered',count(*) filter(where delivered),'sourceTimeUnknown',count(*) filter(where not source_time_known),
   'acceptedDispatchLatencyUnknown',count(*) filter(where accepted and latency is null),
   'dispatchLatencySeconds',jsonb_build_object('samples',count(latency),'p50',percentile_cont(0.5) within group(order by latency),'p90',percentile_cont(0.9) within group(order by latency),'max',max(latency)),
   'currentWithoutBoundAutomaticReply',count(*) filter(where actionable and current_source and not coalesce(accepted,false)),
   'laterCustomerReplies',count(*) filter(where actionable and current_source and not coalesce(accepted,false) and later_customer_reply),
   'currentUnsubmitted',count(*) filter(where actionable and current_source and not coalesce(accepted,false) and not later_customer_reply and unsubmitted),
   'currentMissingAiJob',count(*) filter(where actionable and current_source and not has_job and not later_customer_reply and not coalesce(accepted,false)),
   'customerControlled',count(*) filter(where actionable and current_source and controlled and not coalesce(accepted,false)),
   'dueProgressChecks',count(*) filter(where actionable and current_source and not controlled and not later_customer_reply and not coalesce(accepted,false) and progress_state='pending' and next_check_at<=finish),
   'oldestDueSeconds',max(extract(epoch from finish-next_check_at)) filter(where actionable and current_source and not controlled and not later_customer_reply and not coalesce(accepted,false) and progress_state='pending' and next_check_at<=finish),
   'reasons',coalesce((select jsonb_agg(x) from (select coalesce(reason,'unobserved') reason,count(*) count from reply_observations
    where actionable and current_source and not coalesce(accepted,false) group by coalesce(reason,'unobserved') order by count(*) desc,coalesce(reason,'unobserved') limit 12) x),'[]'::jsonb)) from reply_observations),
  'calls',(select jsonb_build_object('attempted',count(*),'completed',count(*) filter(where completed),'humanResponses',count(*) filter(where human_response),
   'humanResponseUnknown',count(*) filter(where not coalesce(completed,false))) from calls),
  'offers',(select jsonb_build_object('observedDeals',count(*),'quoteRecorded',count(*) filter(where quoted),'acceptanceRecorded',count(*) filter(where accepted),
   'currentQuoteSmsDelivered',count(*) filter(where quoted and sms_delivered),'verifiedPurchaseSigned',count(*) filter(where signed),
   'quotedWithoutAcceptance',count(*) filter(where quoted and not coalesce(accepted,false)),
   'acceptedWithoutVerifiedPurchaseOnDeal',count(*) filter(where accepted and not signed),
   'voiceQuoteDeliveryUnknown',count(*) filter(where quoted and call_key not like 'sms:%'),'currentOfferAuthority',null) from offers),
  'callbacks',(select jsonb_build_object('observed',count(*),'scheduledReviewsDue',count(*) filter(where state='pending_dispatch_review' and due_at<=finish),
   'oldestDueSeconds',max(extract(epoch from finish-due_at)) filter(where state='pending_dispatch_review' and due_at<=finish),
   'heldForHuman',count(*) filter(where state='held_for_human')) from callbacks)
 ) into report;
 return report;
end $$;
revoke all on function public.icash_seller_conversion_report(uuid,integer) from public,anon,authenticated;
grant execute on function public.icash_seller_conversion_report(uuid,integer) to service_role;
commit;
