begin;
set local lock_timeout='3s';
-- A distinct entitlement keeps $50 VIP from being mistaken for a downgrade.
alter table public.icash_memberships add column vip_retained_at timestamptz;
alter table public.icash_plan_changes drop constraint icash_plan_changes_action_check;
alter table public.icash_plan_changes add constraint icash_plan_changes_action_check
 check(action in ('upgrade','downgrade','keep_vip','retain_vip'));

create or replace function public.icash_begin_plan_change(p_membership uuid,p_account uuid,p_action text,p_period_end timestamptz) returns public.icash_plan_changes
language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;c public.icash_plan_changes;
begin
 select * into strict m from public.icash_memberships where id=p_membership and account_id=p_account for update;
 if m.state<>'active' or m.paid_through is null or m.paid_through<=now() or m.cancel_at_period_end or m.stripe_subscription_id is null or p_period_end is distinct from m.paid_through then raise exception 'Active paid period required';end if;
 select * into c from public.icash_plan_changes where membership_id=m.id and state in ('pending','paid');
 if found then if c.action<>p_action then raise exception 'Finish the pending plan change first';end if;return c;end if;
 if m.vip_retained_at is not null then raise exception 'VIP already renews at the retained rate';end if;
 if p_action='retain_vip' then
  if m.price_cents not in (5000,10000) or m.paid_through<=now()+interval '1 hour' then raise exception 'Retention unavailable; cancellation remains available';end if;
 elsif p_action='upgrade' and (m.price_cents<>5000 or m.vip_until>now())
  or p_action='downgrade' and (m.price_cents<>10000 or coalesce(m.vip_until<=now(),true))
  or p_action='keep_vip' and (m.price_cents<>5000 or coalesce(m.vip_until<=now(),true))
  or p_action not in ('upgrade','downgrade','keep_vip') then raise exception 'Plan changed; refresh';end if;
 insert into public.icash_plan_changes(membership_id,account_id,action,period_end,from_price,to_price)
 values(m.id,m.account_id,p_action,p_period_end,m.price_cents,case when p_action in ('downgrade','retain_vip') then 5000 else 10000 end) returning * into c;
 return c;
end $$;

create or replace function public.icash_apply_plan_change(p_change uuid,p_subscription text,p_price text) returns void
language plpgsql security invoker set search_path='' as $$
declare c public.icash_plan_changes;m public.icash_memberships;
begin
 select * into strict c from public.icash_plan_changes where id=p_change;
 select * into strict m from public.icash_memberships where id=c.membership_id for update;
 select * into strict c from public.icash_plan_changes where id=p_change for update;
 if c.state='applied' then return;end if;
 if m.account_id<>c.account_id or m.state<>'active' or m.cancel_at_period_end or m.paid_through is null or m.paid_through<=now()
  or m.price_cents<>c.from_price or m.stripe_subscription_id is distinct from p_subscription
  or c.price_id is null or c.price_id is distinct from p_price
  or (c.action='upgrade' and (c.state<>'paid' or c.payment_id is null)) then raise exception 'Plan settlement conflict';end if;
 if c.action='retain_vip' and (c.state<>'pending' or c.to_price<>5000 or c.period_end is distinct from m.paid_through
  or not exists(select 1 from public.icash_purchase_acceptances a where a.kind='vip' and a.reference_id=c.id
   and a.account_id=m.account_id and a.mode=m.mode and a.version='vip-retention-50-ongoing-v1' and a.amount_cents=5000)) then
  raise exception 'Accepted VIP retention terms required';
 end if;
 update public.icash_memberships set price_cents=c.to_price,
  vip_until=case when c.action in ('upgrade','retain_vip') then greatest(vip_until,c.period_end) else vip_until end,
  vip_retained_at=case when c.action='retain_vip' then now() else vip_retained_at end,updated_at=now() where id=m.id;
 update public.icash_plan_changes set state='applied',applied_at=now() where id=c.id;
end $$;

-- Record the customer's explicit recurring-price acceptance before any Stripe
-- mutation. Keep the original acceptance and all invoice evidence immutable.
do $acceptance$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_record_purchase_acceptance(text,uuid,text,uuid,text,text,text,bigint,text,text,jsonb)'::regprocedure);
 needle:=$old$c.action='upgrade' and c.state='pending'$old$;
 if position(needle in definition)=0 then raise exception 'VIP acceptance prerequisite changed';end if;
 execute replace(definition,needle,$new$(c.action='upgrade' or (c.action='retain_vip' and p_version='vip-retention-50-ongoing-v1' and c.to_price=5000)) and c.state='pending'$new$);
end $acceptance$;

do $renewal$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_settle_membership_invoice_v2(uuid,text,text,text,text,bigint,text,text,timestamptz,timestamptz,text)'::regprocedure);
 needle:='vip_until=case when price_cents=10000 then';
 if position(needle in definition)=0 then raise exception 'VIP renewal prerequisite changed';end if;
 definition:=replace(definition,needle,'vip_until=case when price_cents=10000 or vip_retained_at is not null then');
 needle:='select * into m from public.icash_memberships where id=p_membership for update;';
 if position(needle in definition)=0 then raise exception 'Invoice lock prerequisite changed';end if;
 definition:=replace(definition,needle,needle||$guard$
 if m.vip_retained_at is not null and (m.price_cents<>5000 or p_discount is not null) then raise exception 'Retained VIP invoice mismatch';end if;
$guard$);
 execute definition;
end $renewal$;
revoke all on function public.icash_begin_plan_change(uuid,uuid,text,timestamptz),public.icash_apply_plan_change(uuid,text,text) from public,anon,authenticated;
grant execute on function public.icash_begin_plan_change(uuid,uuid,text,timestamptz),public.icash_apply_plan_change(uuid,text,text) to service_role;
create index icash_question_usage_vip_savings on public.icash_question_usage(account_id) where state='settled' and multiplier=2.4;

-- Compare settled customer prices with the Standard rate for the same work.
-- Unknown, cancelled and merely reserved work never counts as savings.
create function public.icash_vip_savings(p_account uuid) returns bigint
language sql stable security invoker set search_path='' as $$
 with settled as (
  select o.*,r.operation from public.icash_operation_spend o
  join public.icash_operation_rates r on r.id=o.rate_id
  where o.account_id=p_account and o.state='settled' and o.settled_at is not null
   and o.charged_cents is not null and o.actual_micros is not null
 ), amounts as (
  select case
   when o.operation='seller_lead' and o.standard_cost_multiplier=2.4
    and o.charged_cents=ceil(ceil(o.actual_micros::numeric*3/10000)*0.8)
    then (ceil(o.actual_micros::numeric*3/10000)-o.charged_cents)*10000
   when o.customer_price_micros is null and o.standard_cost_multiplier=2.4 and o.elevenlabs_cost_multiplier=2.4
    and o.charged_cents=ceil(o.actual_micros::numeric*2.4/10000)
    then greatest(0,least(o.charge_cap_cents,ceil(o.actual_micros::numeric*3/10000))-o.charged_cents)*10000
   when f.price_micros=o.customer_price_micros and f.charged_cents=o.charged_cents then
    case when o.standard_cost_multiplier=2.4 and o.customer_price_micros=ceil(o.actual_micros::numeric*2.4)
     then greatest(0,least(o.charge_cap_cents::numeric*10000,ceil(o.actual_micros::numeric*3))-o.customer_price_micros)
    when m.customer_price_micros>0 and o.customer_price_micros=ceil(m.customer_price_micros::numeric*0.8)
     then m.customer_price_micros-o.customer_price_micros else 0 end
   else 0 end as savings_micros
  from settled o
  left join public.icash_fractional_usage f on f.operation_key=o.operation_key and f.account_id=p_account
  left join public.icash_text_messages m on o.operation_key='text:'||m.id and m.account_id=p_account
  union all
  select ceil(q.cost_micros::numeric*3)-q.price_micros
  from public.icash_question_usage q where q.account_id=p_account and q.state='settled'
   and q.settled_at is not null and q.provider_id is not null and q.multiplier=2.4
   and q.price_micros=ceil(q.cost_micros::numeric*2.4) and q.charged_cents is not null
 ) select floor(coalesce(sum(greatest(0,savings_micros)),0)/10000)::bigint from amounts
$$;
revoke all on function public.icash_vip_savings(uuid) from public,anon,authenticated;
grant execute on function public.icash_vip_savings(uuid) to service_role;
commit;
