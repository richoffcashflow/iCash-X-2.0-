begin;

-- Promotional credits require a separate, recorded approval. Do not treat every
-- grant in the wallet as paid funding or authorize previously unreviewed grants.
create table public.icash_authorized_credit_grants (
 grant_id uuid primary key references public.icash_credit_ledger(id),
 authorization_ref text not null check(length(trim(authorization_ref))>0),
 authorized_at timestamptz not null default now()
);
alter table public.icash_authorized_credit_grants enable row level security;
revoke all on public.icash_authorized_credit_grants from public,anon,authenticated;
grant all on public.icash_authorized_credit_grants to service_role;

create function public.icash_authorized_grant_cents(p_account uuid)
returns bigint language sql stable security invoker set search_path='' as $$
 select coalesce(sum(l.delta_cents),0)::bigint
 from public.icash_credit_ledger l join public.icash_authorized_credit_grants g on g.grant_id=l.id
 where l.account_id=p_account and l.kind='grant' and l.delta_cents>0;
$$;
revoke all on function public.icash_authorized_grant_cents(uuid) from public,anon,authenticated;
grant execute on function public.icash_authorized_grant_cents(uuid) to service_role;

-- A top-up previously replaced an approved promotional allowance with only the
-- sum of paid receipts. Preserve separately approved grants on each funding path.
do $$
declare item record;definition text;needle text;
begin
 for item in select * from (values
  ('public.icash_apply_prepaid_purchase(uuid)','a.id'),
  ('public.icash_daily_claim(uuid)','p_account'),
  ('public.icash_settle_auto_recharge(uuid,text,bigint,text,text,text)','t.account_id')
 ) as f(signature,account_expression) loop
  definition:=pg_get_functiondef(item.signature::regprocedure);
  needle:='select coalesce(sum(credit_cents),0) into funded from public.icash_funding_orders where account_id='||item.account_expression;
  if position(needle in definition)=0 then raise exception 'Funding definition changed: %',item.signature;end if;
  execute replace(definition,needle,'select coalesce(sum(credit_cents),0)+public.icash_authorized_grant_cents('||item.account_expression||') into funded from public.icash_funding_orders where account_id='||item.account_expression);
 end loop;
end $$;

create or replace function public.icash_manual_text_reason(p_account uuid,p_thread uuid,p_exclude uuid default null)
returns text language plpgsql stable security invoker set search_path='' as $$
declare t public.icash_text_threads;screening uuid;reason text;charge bigint;available bigint;cap bigint;used bigint;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found then return 'Conversation unavailable.';end if;
 select screening_id into screening from public.icash_deal_files where id=t.deal_id and account_id=p_account;
 reason:=public.icash_manual_contact_reason(p_account,screening,t.recipient,'sms',p_exclude);
 if reason is not null then return reason;end if;
 if not exists(select 1 from public.icash_text_senders where phone=t.sender and enabled) then return 'Business texting number is unavailable.';end if;
 select greatest(r.charge_cents,ceil(p.customer_micros::numeric/10000)::bigint) into charge from public.icash_operation_rates r cross join public.icash_communication_prices p where r.id=t.sms_rate_id and r.enabled and r.expires_at>now() and r.operation='sms_send' and p.operation='sms_segment';
 if charge is null then return 'Texting setup needs a rate refresh. Your draft is saved.';end if;
 if not public.icash_membership_work_allowed(p_account) then return 'Update your subscription to send texts.';end if;
 select balance_cents-reserved_cents into available from public.icash_wallets where account_id=p_account;
 if coalesce(available,0)<charge then return 'Add credits to send. Your draft is saved.';end if;
 if (select coalesce(sum(-delta_cents),0) from public.icash_credit_ledger where account_id=p_account and kind='usage' and created_at>now()-interval '24 hours')+(select reserved_cents from public.icash_wallets where account_id=p_account)+charge>(select daily_limit_cents from public.icash_accounts where id=p_account) then return 'Daily budget reached. Your draft is saved.';end if;
 if exists(select 1 from public.icash_operating_budget where id=1 and not require_company_reserve) then
  select customer_cap_cents into cap from public.icash_spend_activations where account_id=p_account and enabled;
  if cap is null then return 'Texting credit authorization is unavailable. Your draft is saved.';end if;
  select coalesce(sum(case when state='settled' then charged_cents else charge_cap_cents end),0) into used from public.icash_operation_spend
  where account_id=p_account and state in ('reserved','dispatched','settled') and operation_key is distinct from 'text:'||p_exclude;
  if used+charge>cap then return 'Spending allowance reached. Your draft is saved.';end if;
 end if;
 return null;
end $$;
revoke all on function public.icash_manual_text_reason(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_manual_text_reason(uuid,uuid,uuid) to service_role;
commit;
