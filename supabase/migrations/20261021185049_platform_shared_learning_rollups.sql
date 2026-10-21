-- Staged shared-learning rollout: private helpers before policy activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Rebuild one account atomically. No transcripts, phones, names or addresses
-- enter these rollups. Fixed outcome windows avoid rewarding older variants.
create function public.icash_refresh_learning_account(p_account uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare zip_code text;s jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_account::text,81021));
 perform public.icash_refresh_opportunity_outcomes(p_account);
 delete from public.icash_learning_rollups where account_id=p_account;
 for zip_code in select distinct zip from public.icash_discovery_filter_pages where account_id=p_account and created_at>now()-interval '90 days' loop
  for s in select value from jsonb_array_elements(public.icash_discovery_filter_feedback(p_account,zip_code)) loop
   insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,cost_cents,costs_complete,contract_trials,contracts,closing_trials,closings)
   select p_account,'seller_filters','seller-filters-v1',zip_code,s->>'strategy',(s->>'attempted')::bigint,(s->>'pendingAttempts')::bigint,(s->>'interested')::bigint,(s->>'optedOut')::bigint,(s->>'costCents')::bigint,(s->>'costsComplete')::boolean,
    count(*) filter(where p.created_at<=now()-interval '30 days'),
    count(*) filter(where p.created_at<=now()-interval '30 days' and e.purchase_at between p.created_at and p.created_at+interval '30 days'),
    count(*) filter(where p.created_at<=now()-interval '60 days'),
    count(*) filter(where p.created_at<=now()-interval '60 days' and e.closed_at between p.created_at and p.created_at+interval '60 days')
   from public.icash_discovery_filter_pages p join public.icash_discovery_filter_attribution a on a.operation_key=p.operation_key and a.account_id=p.account_id
   left join public.icash_learning_deal_outcomes(p_account) e on e.screening_id=a.screening_id
   where p.account_id=p_account and p.zip=zip_code and p.plan->>'version'='seller-filters-v1' and p.plan->>'strategy'=s->>'strategy' and p.created_at between now()-interval '90 days' and now();
  end loop;
 end loop;
 -- Market learning uses verified signatures, never an optimistic deal stage.
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,contract_trials,contracts,closing_trials,closings,costs_complete)
 select p_account,'market','research-v1',o.zip,'market',count(*),0,count(*) filter(where o.interested and not o.opted_out),count(*) filter(where o.opted_out),
 count(*) filter(where o.discovered_at<=now()-interval '30 days'),count(*) filter(where o.discovered_at<=now()-interval '30 days' and e.purchase_at between o.discovered_at and o.discovered_at+interval '30 days'),
 count(*) filter(where o.discovered_at<=now()-interval '60 days'),count(*) filter(where o.discovered_at<=now()-interval '60 days' and e.closed_at between o.discovered_at and o.discovered_at+interval '60 days'),false
 from public.icash_opportunity_outcomes o left join public.icash_learning_deal_outcomes(p_account) e on e.screening_id=o.screening_id
 where o.account_id=p_account and o.research_source and o.discovered_at between now()-interval '90 days' and now()-interval '72 hours' group by o.zip;
 -- Recovery: one first delivered attempt per deal/context, 30-day contract and
 -- 60-day closing windows. Disabled copy remains disabled.
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete)
 select p_account,'seller_recovery',a.reason||':'||a.stage||':'||a.source_channel,'*',a.variant,count(*),count(*) filter(where a.delivered_at>now()-interval '30 days'),
 count(*) filter(where a.delivered_at<=now()-interval '30 days' and a.responded_at between a.delivered_at and a.delivered_at+interval '30 days' and a.opted_out_at is null),count(*) filter(where a.opted_out_at is not null),
 count(*) filter(where a.delivered_at<=now()-interval '30 days'),count(*) filter(where a.delivered_at<=now()-interval '30 days' and e.purchase_at between a.delivered_at and a.delivered_at+interval '30 days'),
 count(*) filter(where a.delivered_at<=now()-interval '60 days'),count(*) filter(where a.delivered_at<=now()-interval '60 days' and e.closed_at between a.delivered_at and a.delivered_at+interval '60 days'),
 coalesce(sum(o.charged_cents) filter(where o.state='settled'),0),bool_and(o.state='settled' and o.charged_cents is not null) is true
 from (select distinct on (deal_id,reason,stage,source_channel) * from public.icash_seller_recovery_attempts where account_id=p_account and delivered_at between now()-interval '180 days' and now() order by deal_id,reason,stage,source_channel,delivered_at,gap_id) a
 join public.icash_learning_deal_outcomes(p_account) e on e.deal_id=a.deal_id
 left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key='text:'||a.message_id group by a.reason,a.stage,a.source_channel,a.variant;
 -- Legacy SMS experiments only count a receipt for the assigned exact body.
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,cost_cents,costs_complete)
 select p_account,'seller_sms','opener-v1','*',a.variant,count(*),count(*) filter(where a.delivered_at>now()-interval '72 hours'),
 count(*) filter(where a.delivered_at<=now()-interval '72 hours' and a.first_reply_at between a.delivered_at and a.delivered_at+interval '72 hours' and not a.opted_out),count(*) filter(where a.opted_out),
 coalesce(sum(o.charged_cents) filter(where o.state='settled'),0),bool_and(o.state='settled' and o.charged_cents is not null) is true
 from public.icash_seller_opener_assignments a join public.icash_text_messages m on m.id=a.message_id and m.account_id=a.account_id and m.thread_id=a.thread_id and m.body=a.body and m.state='delivered' and m.provider_id is not null
 join public.icash_text_threads t on t.id=a.thread_id and t.account_id=a.account_id join public.icash_learning_deal_outcomes(p_account) e on e.deal_id=t.deal_id
 left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key='text:'||m.id
 where a.account_id=p_account and a.delivered_at between now()-interval '90 days' and now() group by a.variant;
 -- Only prospective, actually dispatched versioned call assignments count.
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete)
 select p_account,'seller_calls',a.context,'*',a.variant,count(*),count(*) filter(where c.created_at>now()-interval '72 hours'),
 count(*) filter(where c.created_at<=now()-interval '72 hours' and c.state='complete' and c.completed_at<=c.created_at+interval '72 hours' and c.result->'interested'='true'::jsonb and coalesce(c.result->>'optedOut','false')<>'true'),
 count(*) filter(where c.result->'optedOut'='true'::jsonb),count(*) filter(where c.created_at<=now()-interval '30 days'),count(*) filter(where c.created_at<=now()-interval '30 days' and e.purchase_at between c.created_at and c.created_at+interval '30 days'),
 count(*) filter(where c.created_at<=now()-interval '60 days'),count(*) filter(where c.created_at<=now()-interval '60 days' and e.closed_at between c.created_at and c.created_at+interval '60 days'),
 coalesce(sum(o.charged_cents) filter(where o.state='settled'),0),bool_and(o.state='settled' and o.charged_cents is not null) is true
 from public.icash_learning_assignments a join lateral(select c.* from public.icash_live_conversations c where c.account_id=a.account_id and c.screening_id::text||':'||c.contact_key=a.subject and c.strategy_key=a.variant and c.party='seller' and c.conversation_id is not null and c.created_at>=a.created_at and exists(select 1 from public.icash_call_recordings r where r.operation_key=c.operation_key and r.account_id=c.account_id and r.call_context->>'strategyKey'=a.variant and position('REVIEWED INTEREST QUESTION (shared-v1/'||a.context||'):' in r.call_context->>'prompt')>0) order by c.created_at,c.id limit 1) c on true
 join public.icash_learning_deal_outcomes(p_account) e on e.screening_id=c.screening_id
 join public.icash_operation_spend o on o.operation_key=c.operation_key and o.account_id=p_account and o.dispatched_at is not null
 where a.account_id=p_account and a.domain='seller_calls' and a.policy_version='shared-v1'
 and not exists(select 1 from public.icash_live_conversations earlier join public.icash_call_recordings er on er.account_id=earlier.account_id and er.operation_key=earlier.operation_key where earlier.account_id=p_account and earlier.screening_id=c.screening_id and earlier.party='seller' and earlier.conversation_id is not null and row(earlier.created_at,earlier.id)<row(c.created_at,c.id) and position('REVIEWED INTEREST QUESTION (shared-v1/' in er.call_context->>'prompt')>0) and c.created_at between now()-interval '180 days' and now() group by a.context,a.variant;
 -- Buyer policies are assigned per deal/revision. Qualification is an explicit
 -- reviewed buyer match; an owner lookup or an email click is not qualification.
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete)
 select p_account,'buyer_search','order-v1',a.market,a.variant,count(*),count(*) filter(where first_receipt.at>now()-interval '30 days'),
 count(*) filter(where first_receipt.at<=now()-interval '30 days' and exists(select 1 from public.icash_buyer_matches m where m.deal_id=d.id and m.ready and m.qualification_request_id is not null and m.created_at between first_receipt.at and first_receipt.at+interval '30 days')),0,
 count(*) filter(where first_receipt.at<=now()-interval '30 days'),count(*) filter(where first_receipt.at<=now()-interval '30 days' and e.assignment_at between first_receipt.at and first_receipt.at+interval '30 days'),
 count(*) filter(where first_receipt.at<=now()-interval '60 days'),count(*) filter(where first_receipt.at<=now()-interval '60 days' and e.closed_at between first_receipt.at and first_receipt.at+interval '60 days'),coalesce(sum(cost.cents),0),bool_and(cost.complete) is true
 from public.icash_learning_assignments a join public.icash_deal_files d on d.account_id=a.account_id and a.subject like d.id::text||':%'
 join public.icash_learning_deal_outcomes(p_account) e on e.deal_id=d.id
 join lateral(select min(r.created_at) at from public.icash_buyer_search_receipts r where r.deal_id=d.id and a.subject=d.id::text||':'||r.revision and r.created_at>=a.created_at) first_receipt on first_receipt.at is not null
 cross join lateral(select coalesce(sum(o.charged_cents) filter(where o.state='settled'),0) cents,bool_and(case when r.operation_key is null then r.receipt->'emptyEstimate'='true'::jsonb else o.state='settled' and o.charged_cents is not null end) complete from public.icash_buyer_search_receipts r left join public.icash_operation_spend o on o.operation_key=r.operation_key and o.account_id=p_account where r.deal_id=d.id and a.subject=d.id::text||':'||r.revision) cost
 where a.account_id=p_account and a.domain='buyer_search' and a.policy_version='shared-v1' and a.context='order-v1' and first_receipt.at between now()-interval '180 days' and now() group by a.market,a.variant;
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['icash_refresh_learning_account']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;end $$;
commit;
