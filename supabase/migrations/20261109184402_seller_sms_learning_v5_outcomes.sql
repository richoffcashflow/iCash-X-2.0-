-- Prospective identity-v5 outcomes use original dispatch/receipt evidence.
-- No source messages, provider results, assignments or financial rows change.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function public.icash_seller_sms_interest_v5_at(p_account uuid,p_thread uuid,p_start timestamptz,p_end timestamptz)
returns timestamptz language sql stable security invoker set search_path='' as $function$
 select min(reply.created_at)
 from public.icash_seller_opener_assignments a
 join public.icash_sms_seller_openings opening on opening.thread_id=a.thread_id and opening.account_id=a.account_id and opening.owner_question_id=a.message_id
 join public.icash_text_messages question on question.id=opening.interest_message_id and question.thread_id=opening.thread_id and question.account_id=opening.account_id
 join public.icash_operation_spend operation on operation.operation_key='text:'||question.id and operation.account_id=question.account_id
 join public.icash_text_messages reply on reply.thread_id=opening.thread_id and reply.account_id=opening.account_id
 where a.account_id=p_account and a.thread_id=p_thread and a.learning_context='identity-v5'
  and question.body='Would you be interested in selling your property for all cash?'
  and question.direction='outgoing' and question.state='delivered' and nullif(question.provider_id,'') is not null
  and question.last_delivery_at between operation.dispatched_at and now()
  and operation.dispatched_at>=question.created_at and operation.dispatched_at between p_start and least(p_end,now())
  and reply.direction='incoming' and reply.state='received' and (nullif(reply.provider_id,'') is not null or nullif(reply.event_id,'') is not null)
  and reply.created_at>operation.dispatched_at and reply.created_at between p_start and least(p_end,now())
  and lower(trim(reply.body)) ~ '^(yes|yeah|yep|sure|interested|i am interested|i''m interested|yes i am|yes i am interested|yes, i am interested|yes interested|yes, interested)[.! ]*$'
  and not exists(select 1 from public.icash_text_messages m
   left join public.icash_operation_spend sent on sent.account_id=m.account_id and sent.operation_key='text:'||m.id
   where m.thread_id=a.thread_id and m.account_id=a.account_id and m.id not in (question.id,reply.id)
   and ((m.direction='incoming' and m.state='received' and m.created_at between operation.dispatched_at and reply.created_at)
    or (m.direction='outgoing' and nullif(m.provider_id,'') is not null and m.state in ('accepted','delivered')
     and (sent.dispatched_at between operation.dispatched_at and reply.created_at
      or (sent.dispatched_at is null and (m.created_at between operation.dispatched_at and reply.created_at
       or m.last_delivery_at between operation.dispatched_at and reply.created_at))))));
$function$;

create function public.icash_refresh_seller_interest_v5(p_account uuid) returns void
language plpgsql security invoker set search_path='' as $function$
begin
 -- The account refresh already holds this same transaction lock. Direct
 -- service calls also replace only this context atomically and idempotently.
 perform pg_advisory_xact_lock(hashtextextended(p_account::text,81021));
 delete from public.icash_learning_rollups where account_id=p_account and domain='seller_sms' and context='identity-v5';
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
   and m.direction='outgoing' and m.state='delivered' and nullif(m.provider_id,'') is not null
  join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
  join public.icash_text_threads t on t.id=a.thread_id and t.account_id=a.account_id and t.party='seller'
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join properties p on p.id=d.screening_id
  where a.account_id=p_account and a.learning_context='identity-v5' and a.learning_policy_version='evidence-v2'
   and a.learning_decision_id is not null and a.learning_selection_mode in ('control','explore','shared')
   and a.variant in ('identity_cash_v5','identity_as_is_v5','identity_timing_v5')
   and public.icash_seller_sms_learning_eligible(p_account,t.id)
   and o.dispatched_at>=greatest(a.created_at,m.created_at) and o.dispatched_at between now()-interval '90 days' and now()
   and a.delivered_at between o.dispatched_at and now() and m.last_delivery_at between o.dispatched_at and now()
 ), first_exposures as materialized (
  -- One property is one experiment unit across every recipient and variant.
  -- Re-screening the same provider property cannot duplicate a signed deal.
  select distinct on (property_key) * from eligible order by property_key,started_at,thread_id
 ), base as materialized (
  select b.*,e.purchase_at,e.closed_at from first_exposures b
  join property_outcomes e on e.property_key=b.property_key
  where (e.purchase_at is null or e.purchase_at>=b.started_at)
   -- Prior outreach cannot be relabelled as a fresh v5 treatment. Missing
   -- canonical clocks on known sends are conservative, never inferred fresh.
   and not exists(select 1 from properties p join public.icash_deal_files d on d.screening_id=p.id and d.account_id=p_account
    join public.icash_text_threads t on t.deal_id=d.id and t.account_id=p_account and t.party='seller'
    join public.icash_text_messages m on m.thread_id=t.id and m.account_id=p_account
    left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key='text:'||m.id
    where p.property_key=b.property_key and m.id<>b.message_id and m.direction='outgoing' and m.state in ('accepted','delivered')
     and nullif(m.provider_id,'') is not null and coalesce(o.dispatched_at,m.created_at)<b.started_at)
   and not exists(select 1 from properties p join public.icash_call_recordings r on r.screening_id=p.id and r.account_id=p_account and r.party='seller'
    left join public.icash_operation_spend o on o.account_id=r.account_id and o.operation_key=r.operation_key
    where p.property_key=b.property_key and (nullif(r.call_sid,'') is not null or r.dial_claimed_at is not null or o.dispatched_at is not null)
     and coalesce(o.dispatched_at,r.dial_claimed_at,r.created_at)<b.started_at)
   and not exists(select 1 from properties p join public.icash_live_conversations c on c.screening_id=p.id and c.account_id=p_account and c.party='seller'
    left join public.icash_operation_spend o on o.account_id=c.account_id and o.operation_key=c.operation_key
    where p.property_key=b.property_key and nullif(c.conversation_id,'') is not null and coalesce(o.dispatched_at,c.created_at)<b.started_at)
 ), exposures as materialized (
  select b.*,public.icash_seller_sms_interest_v5_at(p_account,b.thread_id,b.started_at,b.started_at+interval '72 hours') interest_at,
   coalesce(b.opted_out,false) or coalesce(sms.opted_out,false) or coalesce(calls.opted_out,false) contact_opted_out,
   coalesce(sms.held,false) or coalesce(calls.held,false) contact_held
  from base b
  left join lateral (
   select bool_or(public.icash_seller_response_disposition(m.body)='opt_out') opted_out,
    bool_or(public.icash_seller_response_disposition(m.body) is not null) held
   from public.icash_text_messages m where m.account_id=p_account and m.thread_id=b.thread_id and m.direction='incoming' and m.state='received'
    and (nullif(m.provider_id,'') is not null or nullif(m.event_id,'') is not null)
    and m.created_at between b.started_at and least(b.started_at+interval '72 hours',now())
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
 ), keys as (
  -- Include the opener and every incurred send in its contact window, even
  -- when queued earlier. Missing original operation evidence stays incomplete.
  select e.thread_id,'text:'||m.id operation_key from exposures e
  join properties p on p.property_key=e.property_key
  join public.icash_deal_files d on d.account_id=p_account and d.screening_id=p.id
  join public.icash_text_threads t on t.account_id=p_account and t.deal_id=d.id and t.party='seller'
  join public.icash_text_messages m on m.account_id=p_account and m.thread_id=t.id and m.direction='outgoing'
  left join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id
  where m.id=e.message_id or ((o.operation_key is not null or nullif(m.provider_id,'') is not null)
   and (coalesce(o.dispatched_at,o.created_at,m.created_at) between e.started_at and least(e.started_at+interval '72 hours',now())
    or (o.dispatched_at is null and m.last_delivery_at between e.started_at and least(e.started_at+interval '72 hours',now()))))
  union
  select e.thread_id,'sms-ai:'||j.id from exposures e
  join properties p on p.property_key=e.property_key
  join public.icash_deal_files d on d.account_id=p_account and d.screening_id=p.id
  join public.icash_text_threads t on t.account_id=p_account and t.deal_id=d.id and t.party='seller'
  join public.icash_text_ai_jobs j on j.account_id=p_account and j.thread_id=t.id
  left join public.icash_operation_spend o on o.account_id=j.account_id and o.operation_key='sms-ai:'||j.id
  where (o.operation_key is not null or nullif(j.provider_id,'') is not null or j.usage is not null or j.state='analyzing')
   and coalesce(o.dispatched_at,o.created_at,j.created_at) between e.started_at and least(e.started_at+interval '72 hours',now())
  union
  -- A missing carrier ID never turns an admitted or uncertain call into free work.
  select e.thread_id,r.operation_key from exposures e
  join properties p on p.property_key=e.property_key
  join public.icash_call_recordings r on r.account_id=p_account and r.screening_id=p.id and r.party='seller'
  left join public.icash_operation_spend o on o.account_id=r.account_id and o.operation_key=r.operation_key
  where coalesce(o.dispatched_at,r.dial_claimed_at,o.created_at,r.created_at) between e.started_at and least(e.started_at+interval '72 hours',now())
 ), costs as (
  select k.thread_id,coalesce(sum(o.charged_cents) filter(where o.state='settled' and o.charged_cents>=0),0) cents,
   bool_and(coalesce(o.state='settled' and o.cost_basis='verified' and o.actual_micros>=0 and o.charged_cents>=0
    and o.settled_at<=now() and nullif(o.settlement_evidence,'') is not null,false)) is true complete
  from keys k left join public.icash_operation_spend o on o.operation_key=k.operation_key and o.account_id=p_account group by k.thread_id
 )
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,
  contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete)
 select p_account,'seller_sms','identity-v5','*',e.variant,count(*),
  -- Early answers remain observable in their source conversation, but all
  -- experiment arms finish the same window before producing positive labels.
  count(*) filter(where e.started_at>now()-interval '72 hours'),
  count(*) filter(where e.started_at<=now()-interval '72 hours' and e.interest_at is not null and not e.contact_opted_out and not e.contact_held),count(*) filter(where e.contact_opted_out),
  count(*) filter(where e.started_at<=now()-interval '30 days'),
  count(*) filter(where e.started_at<=now()-interval '30 days' and e.purchase_at between e.started_at and e.started_at+interval '30 days'),
  count(*) filter(where e.started_at<=now()-interval '60 days'),
  count(*) filter(where e.started_at<=now()-interval '60 days' and e.closed_at between e.started_at and e.started_at+interval '60 days'),
  coalesce(sum(c.cents),0),bool_and(c.complete) is true
 from exposures e left join costs c on c.thread_id=e.thread_id group by e.variant;
end $function$;

revoke all on function public.icash_seller_sms_interest_v5_at(uuid,uuid,timestamptz,timestamptz),public.icash_refresh_seller_interest_v5(uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_sms_interest_v5_at(uuid,uuid,timestamptz,timestamptz),public.icash_refresh_seller_interest_v5(uuid) to service_role;

-- Preserve the exact existing legacy refresh and append the new context.
do $refresh$
declare definition text;original text;addition constant text:=E' select public.icash_refresh_seller_interest_v5(p_account);\n';
begin
 definition:=pg_get_functiondef('public.icash_refresh_seller_interest(uuid)'::regprocedure);
 original:=replace(definition,addition,'');
 if md5(original)<>'05e319c36da14ddb129b9b3859d05bbe' then raise exception 'Seller legacy interest refresh changed';end if;
 if definition=original then
  execute replace(definition,E'group by e.variant;\n',E'group by e.variant;\n'||addition);
 end if;
end $refresh$;
commit;
