-- Owner-requested return to daily funding. Existing receipts, subscriptions and
-- operation price snapshots are preserved; no card is charged by this migration.
alter table public.icash_daily_quotes drop constraint icash_daily_quotes_budget_cents_check;
alter table public.icash_daily_quotes add constraint icash_daily_quotes_budget_cents_check check(budget_cents between 500 and 100000);
insert into public.icash_credit_packs(code,price_cents,credit_cents,enabled) values('budget_five',500,500,true) on conflict(code) do nothing;
alter table public.icash_accounts drop constraint icash_accounts_billing_model_check;
alter table public.icash_accounts add constraint icash_accounts_billing_model_check check(billing_model in ('legacy','prepaid','membership_credits','daily'));
alter table public.icash_daily_plans add column activated_at timestamptz;

-- A guest/account cannot start both recurring billing models in parallel.
-- Existing subscriptions are left intact; this only guards new plan creation.
create function public.icash_guard_recurring_model() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(coalesce(new.account_id::text,new.guest_hash),0));
 if tg_table_name='icash_daily_plans' then
  if exists(select 1 from public.icash_memberships m where m.mode=new.mode and m.state<>'cancelled' and (m.guest_hash=new.guest_hash or (new.account_id is not null and m.account_id=new.account_id))) then raise exception 'Resolve existing software subscription before starting daily billing';end if;
 else
  if exists(select 1 from public.icash_daily_plans d where d.mode=new.mode and d.state<>'stopped' and (d.guest_hash=new.guest_hash or (new.account_id is not null and d.account_id=new.account_id))) then raise exception 'Stop existing daily plan before starting another billing model';end if;
 end if;
 return new;
end $$;
create trigger icash_daily_model_guard before insert on public.icash_daily_plans for each row execute function public.icash_guard_recurring_model();
create trigger icash_membership_model_guard before insert on public.icash_memberships for each row execute function public.icash_guard_recurring_model();
revoke all on function public.icash_guard_recurring_model() from public,anon,authenticated;
grant execute on function public.icash_guard_recurring_model() to service_role;

create or replace function public.icash_daily_claim(p_account uuid) returns void language plpgsql security invoker set search_path='' as $$
declare a public.icash_accounts;p public.icash_daily_plans;last_budget bigint;funded bigint;
begin
 select * into a from public.icash_accounts where id=p_account for update;
 if not found or a.billing_model='membership_credits' then return;end if;
 update public.icash_daily_plans d set account_id=p_account where d.account_id is null and exists(select 1 from public.icash_funding_orders o where o.daily_plan_id=d.id and o.account_id=p_account);
 select * into p from public.icash_daily_plans where account_id=p_account and mode='live' and state='active' order by created_at desc limit 1 for update;
 if not found then return;end if;
 select credit_cents into last_budget from public.icash_funding_orders where account_id=p_account and daily_plan_id=p.id and mode='live' and state='paid' and credited_at is not null order by billing_period_start desc nulls last,paid_at desc,created_at desc,id desc limit 1;
 if last_budget is null then return;end if;
 update public.icash_accounts set daily_limit_cents=last_budget where id=p_account;
 if p.consent_version not like 'daily-2026-10-04.1%' or exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null) then return;end if;
 select coalesce(sum(credit_cents),0) into funded from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null;
 if funded not between 1 and 100000000 then return;end if;
 if p.activated_at is not null then
  -- Renewals grow an already-authorized cap, but never undo Pause or a review hold.
  update public.icash_spend_activations set customer_cap_cents=funded where account_id=p_account and enabled;
  return;
 end if;
 insert into public.icash_spend_activations(account_id,enabled,customer_cap_cents) values(p_account,true,funded)
 on conflict(account_id) do update set enabled=true,customer_cap_cents=excluded.customer_cap_cents;
 update public.icash_accounts set billing_model='daily',bot_paused=false where id=p_account;
 update public.icash_daily_plans set activated_at=now() where id=p.id;
end $$;
revoke all on function public.icash_daily_claim(uuid) from public,anon,authenticated;
grant execute on function public.icash_daily_claim(uuid) to service_role;

-- New reservations use 3x; unsettled/settled operations retain their snapshotted multipliers.
update public.icash_operating_budget set standard_cost_multiplier=3,elevenlabs_cost_multiplier=3,minimum_margin_bps=6666 where id=1;
create or replace function public.icash_account_margin_ok(p_account uuid,p_charge bigint,p_cost bigint,p_pending boolean) returns boolean language sql stable set search_path='' as $$
 select p_charge>=0 and p_cost>=0 and
 coalesce(sum(case when o.state='settled' then o.actual_micros::numeric*o.standard_cost_multiplier-coalesce((m.components->'elevenlabs'->>'amountMicros')::numeric,0)*(o.standard_cost_multiplier-o.elevenlabs_cost_multiplier)
 when p_pending and o.state in ('reserved','dispatched') then coalesce(o.required_revenue_micros,o.reserved_micros*o.standard_cost_multiplier) else 0 end),0)
 +p_cost*(select standard_cost_multiplier from public.icash_operating_budget where id=1)
 <=coalesce(sum(case when o.state='settled' then coalesce(o.customer_price_micros,o.charged_cents*10000)
 when p_pending and o.state in ('reserved','dispatched') then coalesce(o.customer_price_micros,o.charge_cap_cents*10000) else 0 end),0)+p_charge*10000::numeric
 from public.icash_operation_spend o left join public.icash_cost_manifests m on m.operation_key=o.operation_key where o.account_id=p_account
$$;
-- Rate evidence is immutable. Create versions for future non-voice work rather
-- than editing rates referenced by historical or in-flight operations.
-- Fail the transaction if a message could be repriced while changing a thread's
-- future rate. Historical delivered/received messages remain untouched.
lock table public.icash_text_messages in share row exclusive mode;
do $$ begin
 if exists(select 1 from public.icash_text_messages where direction='outgoing' and state not in ('delivered','failed','cancelled','accepted')) then raise exception 'Pending outbound messages require settlement before switching future SMS rates'; end if;
end $$;
create temporary table daily_three_rate_map(old_id uuid primary key,new_id uuid not null) on commit drop;
insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds,flat_customer_price_cents)
 select operation,version||':3x-20261004',greatest(1,ceil((select sum(value::numeric) from jsonb_each_text(costs_micros))*3*(10000+case when operation='sms_send' then 0 else buffer_bps end)/100000000))::bigint,costs_micros,case when operation='sms_send' then 0 else buffer_bps end,evidence_ref||'; customer markup changed to 3x by owner on 2026-10-04; supplier evidence and expiry unchanged',now(),expires_at,enabled,voice_max_duration_seconds,null
 from public.icash_operation_rates where enabled and expires_at>now() and operation not in ('seller_call','buyer_call','incoming_call') and version not like '%:3x-20261004';
insert into daily_three_rate_map select old.id,new.id from public.icash_operation_rates old join public.icash_operation_rates new on new.version=old.version||':3x-20261004';
update public.icash_discovery_configs c set rate_id=m.new_id from daily_three_rate_map m where c.rate_id=m.old_id;
update public.icash_discovery_configs c set contact_rate_id=m.new_id from daily_three_rate_map m where c.contact_rate_id=m.old_id;
update public.icash_buyer_search_configs c set rate_id=m.new_id,revision=gen_random_uuid() from daily_three_rate_map m where c.rate_id=m.old_id;
update public.icash_text_ai_settings c set rate_id=m.new_id from daily_three_rate_map m where c.rate_id=m.old_id;
update public.icash_signing_templates c set rate_id=m.new_id from daily_three_rate_map m where c.rate_id=m.old_id;
update public.icash_title_contacts c set rate_id=m.new_id from daily_three_rate_map m where c.rate_id=m.old_id;
update public.icash_text_threads c set sms_rate_id=m.new_id from daily_three_rate_map m where c.sms_rate_id=m.old_id;
update public.icash_text_threads c set mms_rate_id=m.new_id from daily_three_rate_map m where c.mms_rate_id=m.old_id;
-- Message amounts are copied at insertion; existing queued message snapshots
-- and operation reservations are never repriced by changing this default.
update public.icash_communication_prices set customer_micros=(select max(ceil((select sum(value::numeric) from jsonb_each_text(r.costs_micros))*3*(10000+r.buffer_bps)/10000)) from public.icash_operation_rates r join daily_three_rate_map m on r.id=m.new_id where r.operation='sms_send') where operation='sms_segment' and exists(select 1 from public.icash_operation_rates r join daily_three_rate_map m on r.id=m.new_id where r.operation='sms_send');
