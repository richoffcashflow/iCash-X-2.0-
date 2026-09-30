-- Narrow customer-funded activation: explicit account, paid credits, lifetime customer cap.
create table public.icash_spend_activations(account_id uuid primary key references public.icash_accounts(id),enabled boolean not null default false,customer_cap_cents bigint not null check(customer_cap_cents between 1 and 100000),created_at timestamptz not null default now());
alter table public.icash_spend_activations enable row level security;
revoke all on public.icash_spend_activations from public,anon,authenticated;
grant all on public.icash_spend_activations to service_role;
alter function public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) rename to icash_reserve_before_activation;
create function public.icash_reserve_operation(p_account uuid,p_operation text,p_rate uuid,p_permission_until timestamptz,p_financial_checked_at timestamptz default null,p_financial_eligible boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare cap bigint;used numeric;charge bigint;b public.icash_operating_budget;
begin
 select * into b from public.icash_operating_budget where id=1 for update;
 if not b.require_company_reserve then
 select customer_cap_cents into cap from public.icash_spend_activations where account_id=p_account and enabled;
 if cap is null or not exists(select 1 from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null) then raise exception 'Account spending not activated';end if;
 if not exists(select 1 from public.icash_operation_spend where operation_key=p_operation) then
 select charge_cents into charge from public.icash_operation_rates where id=p_rate;
 select coalesce(sum(case when state='settled' then charged_cents else charge_cap_cents end),0) into used from public.icash_operation_spend where account_id=p_account and state in ('reserved','dispatched','settled');
 if charge is null or used+charge>cap then raise exception 'Activation spending cap reached';end if;
 end if;
 end if;
 return public.icash_reserve_before_activation(p_account,p_operation,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);
end $$;
alter function public.icash_claim_operation(text) rename to icash_claim_before_activation;
create function public.icash_claim_operation(p_operation text) returns boolean language plpgsql set search_path='' as $$
declare a uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from public.icash_operating_budget where id=1 and not require_company_reserve) then
 select account_id into a from public.icash_operation_spend where operation_key=p_operation;
 if not exists(select 1 from public.icash_spend_activations where account_id=a and enabled) then return false;end if;
 end if;
 return public.icash_claim_before_activation(p_operation);
end $$;
revoke all on function public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean),public.icash_claim_operation(text),public.icash_reserve_before_activation(uuid,text,uuid,timestamptz,timestamptz,boolean),public.icash_claim_before_activation(text) from public,anon,authenticated;
grant execute on function public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean),public.icash_claim_operation(text) to service_role;
