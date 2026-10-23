-- Prospective, distinct seller SMS copy; learn from selling interest, not ownership replies.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;

alter table public.icash_seller_opener_assignments add column learning_context text not null default 'opener-v1'
 check(learning_context in ('opener-v1','interest-v2'));
insert into public.icash_seller_opener_variants(key,body) values
 ('ownership_cash_v2','Is this {owner} of {address}? I am reaching out about a possible cash offer.'),
 ('ownership_timing_v2','Is this {owner} of {address}? I am asking if a cash sale fits your timing.'),
 ('ownership_as_is_v2','Is this {owner} of {address}? I am asking about buying as is for cash.');

-- Use conservative success per settled cent. Pending attempts cannot inflate a
-- rate by being removed from its denominator. This is an allocation heuristic,
-- not a significance test. Higher funnel outcomes need complete cohort windows.
create function public.icash_seller_interest_winner(p_choices text[]) returns text
language plpgsql stable security invoker set search_path='' as $$
declare stats jsonb;s jsonb;objective text:='positive';trials numeric;score numeric;best numeric:=0;winner text;
begin
 if cardinality(p_choices)<2 then return null;end if;
 stats:=public.icash_shared_learning_stats('seller_sms','interest-v2','*');
 if (select count(*) from jsonb_array_elements(stats) r where r->>'variant'=any(p_choices)
  and (r->>'contributors')::int>=3 and (r->>'effective_attempts')::numeric-(r->>'effective_pending')::numeric>=100
  and (r->>'effective_opted_out')::numeric/greatest(1,(r->>'effective_attempts')::numeric)<=0.05
  and (r->>'costs_complete')::boolean and (r->>'effective_cost_cents')::numeric>0)<>cardinality(p_choices) then return null;end if;
 if (select bool_and((r->>'effective_closing_trials')::numeric>=100 and (r->>'effective_closings')::numeric>=5) from jsonb_array_elements(stats) r where r->>'variant'=any(p_choices)) then objective:='closings';
 elsif (select bool_and((r->>'effective_contract_trials')::numeric>=100 and (r->>'effective_contracts')::numeric>=5) from jsonb_array_elements(stats) r where r->>'variant'=any(p_choices)) then objective:='contracts';end if;
 for s in select value from jsonb_array_elements(stats) where value->>'variant'=any(p_choices) order by value->>'variant' loop
  trials:=case objective when 'closings' then (s->>'effective_closing_trials')::numeric when 'contracts' then (s->>'effective_contract_trials')::numeric else (s->>'effective_attempts')::numeric end;
  score:=greatest(0,public.icash_learning_lower((s->>('effective_'||objective))::numeric,trials)*trials-0.5*(s->>'effective_opted_out')::numeric)/((s->>'effective_cost_cents')::numeric+1000);
  if score>best then best:=score;winner:=s->>'variant';end if;
 end loop;
 return winner;
end $$;

create or replace function public.icash_assign_seller_opener(p_account uuid,p_thread uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare existing public.icash_seller_opener_assignments;t public.icash_text_threads;chosen public.icash_seller_opener_variants;
 choices text[];challengers text[];winner text;bucket bigint;context text;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' for update;
 if not found then return null;end if;
 select * into existing from public.icash_seller_opener_assignments where thread_id=p_thread and account_id=p_account;
 if found then return jsonb_build_object('variant',existing.variant,'body',existing.body,'context',existing.learning_context);end if;
 context:=case when t.seller_intake_id is null then 'interest-v2' else 'opener-v1' end;
 select array_agg(key order by key) into choices from public.icash_seller_opener_variants where enabled
 and case when context='interest-v2' then key in ('ownership_cash_v2','ownership_timing_v2','ownership_as_is_v2') else key in ('direct','timing') end;
 if cardinality(choices) is null then return null;end if;
 bucket:=('x'||substr(md5(p_account::text||p_thread::text||context),1,8))::bit(32)::bigint%10000;
 if context='interest-v2' then winner:=public.icash_seller_interest_winner(choices);end if;
 if winner is not null then
  select array_agg(c order by c) into challengers from unnest(choices) c where c<>winner;
  select * into chosen from public.icash_seller_opener_variants where key=case when bucket<6000 then winner else challengers[1+(bucket-6000)%cardinality(challengers)] end;
 else select * into chosen from public.icash_seller_opener_variants where key=choices[1+bucket%cardinality(choices)];end if;
 insert into public.icash_seller_opener_assignments(thread_id,account_id,variant,body,learning_context)
 values(p_thread,p_account,chosen.key,chosen.body,context);
 return jsonb_build_object('variant',chosen.key,'body',chosen.body,'context',context);
end $$;

-- Preserve the current queue implementation and every contact/budget gate.
-- Historical and inbound copy keeps its existing interpretation. Only fresh
-- outbound assignments get new copy; the exact expanded body is snapshotted.
do $queue$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure);
 needle:='message_body text;message uuid;';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Seller queue declaration changed';end if;
 definition:=replace(definition,needle,'message_body text;message uuid;choice jsonb;');
 needle:='if public.icash_assign_seller_opener(p_account,t.id) is null then return null;end if;';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Seller queue assignment changed';end if;
 definition:=replace(definition,needle,$new$choice:=public.icash_assign_seller_opener(p_account,t.id);
 if choice is null then return null;end if;
 if choice->>'context'='interest-v2' then
  message_body:=replace(replace(choice->>'body','{owner}',case when seller is null then '' else seller||', ' end||'the owner'),'{address}',address);
  -- Any invalid expansion rolls back the new assignment along with this call.
  if length(message_body)>160 or message_body ~ '[^A-Za-z0-9 .,!?]' then raise exception 'Seller experiment copy requires review';end if;
 end if;$new$);
 execute definition;
end $queue$;

-- A YES must answer the actually sent selling-interest question on this exact
-- account/thread. Neither ownership confirmation nor an arbitrary reply wins.
create function public.icash_seller_sms_interest_at(p_account uuid,p_thread uuid,p_start timestamptz,p_end timestamptz) returns timestamptz
language sql stable security invoker set search_path='' as $$
 select min(reply.created_at) from public.icash_sms_seller_openings opening
 join public.icash_text_messages question on question.id=opening.interest_message_id and question.thread_id=opening.thread_id and question.account_id=opening.account_id
 join public.icash_text_messages reply on reply.thread_id=opening.thread_id and reply.account_id=opening.account_id
 where opening.account_id=p_account and opening.thread_id=p_thread
 and question.direction='outgoing' and question.state in ('accepted','delivered') and question.provider_id is not null
 and reply.direction='incoming' and reply.state='received' and (reply.provider_id is not null or reply.event_id is not null)
 and reply.created_at>question.created_at and reply.created_at between p_start and least(p_end,now())
 and lower(trim(reply.body)) ~ '^(yes|yeah|yep|sure|interested|i am interested|i''m interested|yes i am|yes i am interested|yes, i am interested|yes interested|yes, interested)[.! ]*$'
 and not exists(select 1 from public.icash_text_messages m where m.thread_id=opening.thread_id and m.account_id=opening.account_id
  and m.created_at>question.created_at and m.created_at<reply.created_at
  and ((m.direction='outgoing' and m.provider_id is not null and m.state in ('accepted','delivered')) or (m.direction='incoming' and m.state='received')));
$$;

create function public.icash_refresh_seller_interest(p_account uuid) returns void
language sql security invoker set search_path='' as $$
 with exposures as materialized (
  select a.*,m.created_at started_at,greatest(a.delivered_at,m.last_delivery_at,m.created_at) receipt_at,t.recipient,e.*,
   least(public.icash_seller_sms_interest_at(p_account,t.id,m.created_at,greatest(a.delivered_at,m.last_delivery_at,m.created_at)+interval '72 hours'),
    (select min(c.completed_at) from public.icash_call_recordings r join public.icash_live_conversations c on c.account_id=r.account_id and c.operation_key=r.operation_key
     where r.account_id=p_account and r.screening_id=e.screening_id and r.party='seller' and r.to_phone=t.recipient and r.call_sid is not null
      and c.screening_id=e.screening_id and c.party='seller' and c.state='complete' and c.conversation_id is not null
      and c.result->'interested'='true'::jsonb and coalesce(c.result->>'optedOut','false')<>'true'
      and c.created_at>=m.created_at and c.completed_at between c.created_at and least(greatest(a.delivered_at,m.last_delivery_at,m.created_at)+interval '72 hours',now()))) interest_at
  from public.icash_seller_opener_assignments a
  join public.icash_text_messages m on m.id=a.message_id and m.account_id=a.account_id and m.thread_id=a.thread_id and m.body=a.body
   and m.direction='outgoing' and m.state='delivered' and m.provider_id is not null
  join public.icash_text_threads t on t.id=a.thread_id and t.account_id=a.account_id and t.party='seller' and t.seller_intake_id is null
  join public.icash_learning_deal_outcomes(p_account) e on e.deal_id=t.deal_id
  where a.account_id=p_account and a.learning_context='interest-v2'
   and a.delivered_at between now()-interval '90 days' and now() and greatest(a.delivered_at,m.last_delivery_at,m.created_at)<=now()
 ), keys as (
  select e.thread_id,'text:'||m.id operation_key from exposures e join public.icash_text_messages m
   on m.account_id=p_account and m.thread_id=e.thread_id and m.direction='outgoing'
   and m.created_at between e.started_at and least(e.receipt_at+interval '72 hours',now())
   where m.id=e.message_id or m.provider_id is not null or exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='text:'||m.id)
  union select e.thread_id,r.operation_key from exposures e join public.icash_call_recordings r
   on r.account_id=p_account and r.screening_id=e.screening_id and r.party='seller' and r.to_phone=e.recipient
   and r.created_at between e.started_at and least(e.receipt_at+interval '72 hours',now()) and r.call_sid is not null
 ), costs as (
  select k.thread_id,coalesce(sum(o.charged_cents) filter(where o.state='settled'),0) cents,
   bool_and(coalesce(o.state='cancelled' or (o.state='settled' and o.charged_cents is not null and o.charged_cents>=0),false)) is true complete
  from keys k left join public.icash_operation_spend o on o.operation_key=k.operation_key and o.account_id=p_account group by k.thread_id
 )
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,
  contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete)
 select p_account,'seller_sms','interest-v2','*',e.variant,count(*),
  count(*) filter(where e.receipt_at>now()-interval '72 hours' and e.interest_at is null and not e.opted_out),
  count(*) filter(where e.interest_at is not null and not e.opted_out),count(*) filter(where e.opted_out),
  count(*) filter(where e.receipt_at<=now()-interval '30 days'),count(*) filter(where e.receipt_at<=now()-interval '30 days' and e.purchase_at between e.started_at and e.receipt_at+interval '30 days'),
  count(*) filter(where e.receipt_at<=now()-interval '60 days'),count(*) filter(where e.receipt_at<=now()-interval '60 days' and e.closed_at between e.started_at and e.receipt_at+interval '60 days'),
  coalesce(sum(c.cents),0),bool_and(c.complete) is true
 from exposures e left join costs c on c.thread_id=e.thread_id group by e.variant;
$$;

do $refresh$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_refresh_learning_account(uuid)'::regprocedure);
 needle:=substring(definition from '( -- Legacy SMS experiments only count a receipt for the assigned exact body\.[\s\S]*?)(?= -- Only prospective, actually dispatched versioned call assignments count\.)');
 if needle is null or position('a.first_reply_at' in needle)=0 then raise exception 'Seller learning refresh prerequisite changed';end if;
 execute replace(definition,needle,E' -- Versioned seller texts count confirmed selling interest, never ownership replies.\n perform public.icash_refresh_seller_interest(p_account);\n');
end $refresh$;

revoke all on function public.icash_seller_interest_winner(text[]),public.icash_seller_sms_interest_at(uuid,uuid,timestamptz,timestamptz),public.icash_refresh_seller_interest(uuid),public.icash_assign_seller_opener(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_interest_winner(text[]),public.icash_seller_sms_interest_at(uuid,uuid,timestamptz,timestamptz),public.icash_refresh_seller_interest(uuid),public.icash_assign_seller_opener(uuid,uuid) to service_role;
-- Existing bounded refresh workers replace derived legacy reply totals. No
-- historical message, assignment, charge, permission or recipient is rewritten.
insert into public.icash_learning_queue(account_id) select distinct account_id from public.icash_seller_opener_assignments
on conflict(account_id) do update set due_at=least(public.icash_learning_queue.due_at,now());
commit;
