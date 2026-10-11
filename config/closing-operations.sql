begin;
set local lock_timeout='3s';
-- One owner-only snapshot. No sends, retries, billing changes or inferred payments.
create function public.icash_closing_operations(p_actor uuid,p_days integer default 30,p_include_owner boolean default false) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare report jsonb;start_at timestamptz;end_at timestamptz:=now();result jsonb;
begin
 -- Reuse the installed owner authorization and reporting-period validation.
 report:=public.icash_owner_overview(p_actor,p_days,p_include_owner,'',1);
 start_at:=(report->>'startAt')::timestamptz;
 with accounts as materialized (
  select a.id from public.icash_accounts a where (p_include_owner or a.owner_user_id<>p_actor)
   and (not exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='test' and f.state='paid')
    or exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='live' and f.state='paid'))
 ), deals as materialized (
  select d.*,r.amount_cents received_cents,r.received_date,
   (select min(created_at) from public.icash_buyer_deposit_receipts where deal_id=d.id and account_id=d.account_id) deposit_at,
   (select min(u.created_at) from public.icash_closing_updates u join public.icash_title_replies t on t.id=u.reply_id and t.account_id=u.account_id and t.deal_id=u.deal_id and t.sender_verified where u.deal_id=d.id and u.account_id=d.account_id and u.kind='title_opened') title_at,
   (select min(u.created_at) from public.icash_closing_updates u join public.icash_title_replies t on t.id=u.reply_id and t.account_id=u.account_id and t.deal_id=u.deal_id and t.sender_verified where u.deal_id=d.id and u.account_id=d.account_id and u.kind='closed') closed_at,
   exists(select 1 from public.icash_signing_envelopes e where e.deal_id=d.id and e.account_id=d.account_id and e.kind='assignment' and e.state='completed' and not e.test_mode and nullif(e.provider_id,'') is not null) assignment_complete
  from public.icash_deal_files d join accounts a on a.id=d.account_id
  left join public.icash_proceeds_receipts r on r.deal_id=d.id and r.account_id=d.account_id
  where coalesce(d.terms->>'practice','false')='false' and exists(select 1 from public.icash_signing_envelopes e where e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and e.state='completed' and not e.test_mode and nullif(e.provider_id,'') is not null)
 ), current_stages as (
  select d.id,case when closed_at is not null then 'payment' when deposit_at is not null then 'title' when assignment_complete then 'deposit' else 'buyer' end key,
   coalesce(closed_at,deposit_at,case when assignment_complete then assignment_signed_at end,seller_signed_at,created_at) started_at
  from deals d where d.received_date is null and d.stage not in ('canceled','cancelled','cancellation_pending')
 ), stage_totals as (
  select key,count(*) count,round(avg(greatest(0,extract(epoch from(end_at-started_at))/86400))::numeric,1) average_days
  from current_stages group by key
 ), open_deals as materialized (
  select * from deals where stage not in ('closed','canceled','cancelled','cancellation_pending')
 ), issues as materialized (
  select d.id deal_id,d.account_id,d.terms->>'address' address,'Buyer needs help: '||b.kind reason,b.updated_at since
   from open_deals d join public.icash_deal_journeys j on j.deal_id=d.id and j.account_id=d.account_id join public.icash_journey_blockers b on b.journey_id=j.id and b.state='open'
  union all
  select d.id,d.account_id,d.terms->>'address','Buyer has not progressed',j.last_progress_at
   from open_deals d join public.icash_deal_journeys j on j.deal_id=d.id and j.account_id=d.account_id
   where j.state in ('collecting','ready','signing','deposit_due') and j.last_progress_at<end_at-interval '3 days'
   and not exists(select 1 from public.icash_journey_blockers b where b.journey_id=j.id and b.state='open')
  union all
  select d.id,d.account_id,d.terms->>'address','Deal message needs delivery review',m.created_at
   from open_deals d join public.icash_deal_journeys j on j.deal_id=d.id and j.account_id=d.account_id
   join public.icash_journey_messages m on m.journey_id=j.id and m.state='needs_review'
  union all
  select d.id,d.account_id,d.terms->>'address','Title request needs delivery review',t.updated_at
   from deals d join public.icash_title_requests t on t.deal_id=d.id and t.account_id=d.account_id
   where d.stage not in ('canceled','cancelled','cancellation_pending') and (t.state='needs_review' or t.state='dispatching' and t.updated_at<end_at-interval '15 minutes')
  union all
  select d.id,d.account_id,d.terms->>'address','Reply needs a response',a.created_at
   from deals d join public.icash_text_attention a on a.deal_id=d.id and a.account_id=d.account_id and a.state='open'
   where d.stage not in ('canceled','cancelled','cancellation_pending')
  union all
  select d.id,d.account_id,d.terms->>'address','Confirm payment receipt',d.closed_at
   from deals d where d.stage='closed' and d.closed_at is not null and d.received_date is null
 ), unique_issues as materialized (
  select deal_id,account_id,address,reason,min(since) since from issues group by deal_id,account_id,address,reason
 ) select jsonb_build_object(
  'signedContracts',(select count(*) from deals where seller_signed_at>=start_at and seller_signed_at<end_at),
  'closedDeals',(select count(*) from deals where closed_at>=start_at and closed_at<end_at),
  'deposits',(select count(*) from deals where deposit_at>=start_at and deposit_at<end_at),
  'receivedCents',coalesce((select sum(received_cents) from deals where received_date>=(start_at at time zone 'America/Chicago')::date and received_date<=(end_at at time zone 'America/Chicago')::date),0),
  'receivedDeals',(select count(*) from deals where received_date>=(start_at at time zone 'America/Chicago')::date and received_date<=(end_at at time zone 'America/Chicago')::date),
  'stages',coalesce((select jsonb_agg(jsonb_build_object('key',key,'count',count,'averageDays',average_days) order by key) from stage_totals),'[]'),
  'issueCount',(select count(*) from unique_issues),
  'issues',coalesce((select jsonb_agg(jsonb_build_object('dealId',deal_id,'accountId',account_id,'address',address,'reason',reason,'since',since) order by since,deal_id,reason) from(select * from unique_issues order by since,deal_id,reason limit 20) q),'[]')
 ) into result;
 return result;
end $$;
revoke all on function public.icash_closing_operations(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.icash_closing_operations(uuid,integer,boolean) to service_role;
commit;
