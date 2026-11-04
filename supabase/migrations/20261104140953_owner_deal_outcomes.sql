begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Read-only signing cohorts. Owner activity never enters the customer column.
-- A bounded sample is labelled explicitly; missing data is not a zero outcome.
create function public.icash_owner_deal_outcomes(p_actor uuid,p_days integer default 30)
returns jsonb language plpgsql stable security invoker set search_path='' as $function$
declare owner_id constant uuid:='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
 start_at timestamptz;end_at timestamptz:=now();result jsonb;
begin
 if p_actor is distinct from owner_id then raise exception 'Owner required' using errcode='42501';end if;
 if p_days is null or p_days not in (1,7,30) then raise exception 'Invalid report period';end if;
 start_at:=((end_at at time zone 'America/Chicago')::date-(p_days-1))::timestamp at time zone 'America/Chicago';
 with candidates as materialized (
  select e.id,e.deal_id,e.account_id,e.created_at,a.owner_user_id,
   case when a.owner_user_id=owner_id then 'owner' else 'customers' end cohort
  from public.icash_signing_envelopes e
  join public.icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id
  join public.icash_accounts a on a.id=e.account_id
  where e.kind='purchase' and not e.test_mode and e.created_at>=start_at and e.created_at<end_at
   and coalesce(d.terms->>'practice','false')='false'
   and (not exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='test' and f.state='paid')
    or exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='live' and f.state='paid'))
  order by e.created_at,e.id limit 10001
 ), selected as materialized (
  select * from candidates order by created_at,id limit 10000
 ), evidence as materialized (
  select c.*,e.state,
   e.updated_at<=end_at and public.icash_learning_signature_verified(e) purchase_verified,
   assignment.updated_at assignment_at,assignment.verified assignment_verified
  from selected c join public.icash_signing_envelopes e on e.id=c.id
  left join lateral (
   select a.updated_at,public.icash_learning_signature_verified(a) verified
   from public.icash_signing_envelopes a where a.account_id=c.account_id and a.deal_id=c.deal_id
    and a.kind='assignment' and not a.test_mode and a.state<>'cancelled' and a.updated_at<=end_at
   order by a.updated_at,a.id limit 1
  ) assignment on true
 ), outcomes as materialized (
  select e.*,closing.id closed_id,receipt.amount_cents received_cents
  from evidence e
  left join lateral (
   select u.id from public.icash_closing_updates u
   join public.icash_title_replies r on r.id=u.reply_id and r.account_id=u.account_id and r.deal_id=u.deal_id and r.sender_verified
   where u.account_id=e.account_id and u.deal_id=e.deal_id and u.kind='closed'
    and e.purchase_verified and e.assignment_verified
    and u.created_at between e.assignment_at and end_at and r.received_at<=u.created_at
    and u.effective_date<=(end_at at time zone 'America/Chicago')::date
    and (u.confirmed_by is not null or u.confirmation_source='verified_title_format')
   order by u.created_at,u.id limit 1
  ) closing on true
  left join lateral (
   select p.amount_cents from public.icash_proceeds_receipts p
   join public.icash_closing_updates u on u.id=p.closing_update_id and u.account_id=p.account_id and u.deal_id=p.deal_id and u.kind='funds_disbursed'
   join public.icash_title_replies r on r.id=u.reply_id and r.account_id=u.account_id and r.deal_id=u.deal_id and r.sender_verified
   where p.account_id=e.account_id and p.deal_id=e.deal_id and closing.id is not null
    and p.confirmed_by=e.owner_user_id and p.amount_cents=u.amount_cents and p.amount_cents>0
    and r.received_at<=u.created_at and u.created_at<=p.created_at and p.created_at<=end_at
    and (u.confirmed_by is not null or u.confirmation_source='verified_title_format')
    and p.received_date between u.effective_date and (end_at at time zone 'America/Chicago')::date
   order by p.created_at,p.id limit 1
  ) receipt on true
 ), totals as (
  select cohort,count(*) signing_started,
   count(*) filter(where state='awaiting_counterparty') awaiting_seller,
   count(*) filter(where state='customer_signature_needed') awaiting_customer,
   count(*) filter(where state='needs_review' or state='completed' and not purchase_verified) needs_review,
   count(*) filter(where purchase_verified) purchases,
   count(*) filter(where purchase_verified and assignment_verified) assignments,
   count(closed_id) closings,count(received_cents) received_deals,coalesce(sum(received_cents),0) received_cents
  from outcomes group by cohort
 ) select jsonb_build_object('days',p_days,'startAt',start_at,'endAt',end_at,'maxDeals',10000,
  'truncated',(select count(*)>10000 from candidates),
  'cohorts',(select jsonb_agg(jsonb_build_object('key',k.key,'signingStarted',coalesce(t.signing_started,0),
   'awaitingSeller',coalesce(t.awaiting_seller,0),'awaitingCustomer',coalesce(t.awaiting_customer,0),
   'needsReview',coalesce(t.needs_review,0),'verifiedPurchases',coalesce(t.purchases,0),
   'verifiedAssignments',coalesce(t.assignments,0),'verifiedClosings',coalesce(t.closings,0),
   'receivedDeals',coalesce(t.received_deals,0),'receivedCents',coalesce(t.received_cents,0)) order by k.key)
   from (values('customers'),('owner')) k(key) left join totals t on t.cohort=k.key)) into result;
 return result;
end $function$;
revoke all on function public.icash_owner_deal_outcomes(uuid,integer) from public,anon,authenticated;
grant execute on function public.icash_owner_deal_outcomes(uuid,integer) to service_role;
commit;
