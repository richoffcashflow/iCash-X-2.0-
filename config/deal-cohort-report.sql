set local lock_timeout='2s';
set local statement_timeout='8s';
-- Read-only same-deal observations. Reuse the reviewed complete cost graph;
-- do not infer all deal costs from calls or turn sparse observations into a winner.
create function public.icash_deal_cohort_supplement(p_account uuid,p_trials jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='8s' as $$
declare bound jsonb;cost_trials jsonb;costs jsonb;offers jsonb;complete boolean;
begin
 if p_account is null or jsonb_typeof(p_trials) is distinct from 'array' or jsonb_array_length(p_trials)>200 then return null;end if;
 select coalesce(jsonb_agg(jsonb_build_object('dealId',d.id,'propertyId',s.snapshot->>'propertyId','startedAt',t."startedAt")),'[]') into bound
 from jsonb_to_recordset(p_trials) t("dealId" uuid,"startedAt" timestamptz)
 join public.icash_deal_files d on d.id=t."dealId" and d.account_id=p_account
 join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
 where coalesce(d.terms->>'practice','false')<>'true' and coalesce(s.snapshot->>'practice','false')<>'true'
 and coalesce(s.snapshot->>'propertyId','') not like 'practice_%' and nullif(s.snapshot->>'propertyId','') is not null
 and isfinite(t."startedAt") and t."startedAt"<=now();
 if jsonb_array_length(bound)<>jsonb_array_length(p_trials) or (select count(distinct x->>'dealId') from jsonb_array_elements(bound) x)<>jsonb_array_length(bound) then return null;end if;
 select coalesce(jsonb_agg(jsonb_build_object('property_id',b->>'propertyId','started_at',b->>'startedAt','window_days',days)),'[]') into cost_trials
 from jsonb_array_elements(bound) b cross join (values(30),(60)) windows(days)
 where (b->>'startedAt')::timestamptz+make_interval(days=>days)<=now();
 select coalesce(jsonb_agg(jsonb_build_object('dealId',b->>'dealId','startedAt',c.started_at,'windowDays',c.window_days,'costs',c.costs)),'[]') into costs
 from icash_learning_private.outcome_window_cost_batch(p_account,cost_trials) c
 join jsonb_array_elements(bound) b on b->>'propertyId'=c.property_id and (b->>'startedAt')::timestamptz=c.started_at;
 with events as materialized (
  select e.* from icash_call_offer_private.events e
  join jsonb_array_elements(bound) b on e.deal_id=(b->>'dealId')::uuid
  where e.account_id=p_account and e.created_at between (b->>'startedAt')::timestamptz and least(now(),(b->>'startedAt')::timestamptz+interval '60 days')
  order by e.created_at,e.id limit 2001
 ) select coalesce(jsonb_agg(jsonb_build_object('dealId',e.deal_id,'at',e.created_at,
  'quoted',coalesce(e.state->>'quotedPriceCents','') ~ '^[1-9][0-9]{0,11}$',
  'accepted',coalesce(e.state->>'acceptedPriceCents','') ~ '^[1-9][0-9]{0,11}$' and e.state->'acceptedPriceCents'=e.state->'quotedPriceCents',
  'deliveredAt',(select min(m.last_delivery_at) from public.icash_text_ai_jobs j
    join public.icash_text_threads t on t.id=j.thread_id and t.account_id=j.account_id
    join public.icash_text_messages m on m.id=j.outgoing_id and m.account_id=j.account_id and m.thread_id=j.thread_id
    where j.account_id=e.account_id and t.deal_id=e.deal_id and j.analysis->>'offerPolicy'='seller-text-offer-v1'
    and (j.analysis->>'offerAction'='cash_offer' or (j.analysis->>'offerAction'='payoff' and m.body like 'As-is cash proposal:%'))
    and j.analysis#>'{offerState,quotedPriceCents}'=e.state->'quotedPriceCents' and j.analysis#>'{offerState,quoteRevision}'=e.state->'quoteRevision'
    and j.analysis#>>'{offerPlan,kind}'='message' and j.analysis#>>'{offerPlan,body}'=j.reply and m.body=j.reply
    and m.direction='outgoing' and m.state='delivered' and m.provider_id is not null and m.last_delivery_at<=now())
 )),'[]'),count(*)<=2000 into offers,complete from events e;
 return jsonb_build_object('complete',complete,'offers',offers,'costs',costs);
end $$;
revoke all on function public.icash_deal_cohort_supplement(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_deal_cohort_supplement(uuid,jsonb) to service_role;
