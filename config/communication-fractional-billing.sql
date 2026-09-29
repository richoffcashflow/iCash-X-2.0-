-- Preserve fractions of a cent; never round each 2.08-cent SMS to 3 cents.
alter table public.icash_text_messages add column customer_price_micros bigint check(customer_price_micros>=0);
create function public.icash_snapshot_sms_price() returns trigger language plpgsql set search_path='' as $$
begin
 if new.direction='outgoing' and cardinality(new.asset_ids)=0 then
 select customer_micros into new.customer_price_micros from public.icash_communication_prices where operation='sms_segment';
 end if;return new;
end $$;
create trigger icash_sms_price_snapshot before insert on public.icash_text_messages for each row execute function public.icash_snapshot_sms_price();
alter table public.icash_operation_spend add column customer_price_micros bigint check(customer_price_micros>=0);
create table public.icash_fractional_credit_carry(account_id uuid primary key references public.icash_accounts(id),remaining_micros bigint not null default 0 check(remaining_micros between 0 and 9999));
create table public.icash_fractional_usage(operation_key text primary key references public.icash_operation_spend(operation_key),account_id uuid not null references public.icash_accounts(id),price_micros bigint not null check(price_micros>=0),charged_cents bigint not null check(charged_cents>=0),created_at timestamptz not null default now());
alter table public.icash_fractional_credit_carry enable row level security;
alter table public.icash_fractional_usage enable row level security;
revoke all on public.icash_fractional_credit_carry,public.icash_fractional_usage from public,anon,authenticated;
grant all on public.icash_fractional_credit_carry,public.icash_fractional_usage to service_role;
alter function public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) rename to icash_reserve_before_fractional;
create function public.icash_reserve_operation(p_account uuid,p_operation text,p_rate uuid,p_permission_until timestamptz,p_financial_checked_at timestamptz default null,p_financial_eligible boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare price bigint;r public.icash_operation_rates;result jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into r from public.icash_operation_rates where id=p_rate;
 if r.operation='sms_send' then
 select m.customer_price_micros into price from public.icash_text_messages m where 'text:'||m.id=p_operation and m.account_id=p_account and m.direction='outgoing' and cardinality(m.asset_ids)=0;
 if price is null then raise exception 'SMS customer price missing';end if;
 if r.charge_cents<ceil(price::numeric/10000) then raise exception 'SMS credit reservation insufficient';end if;
 end if;
 result:=public.icash_reserve_before_fractional(p_account,p_operation,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);
 if price is not null then
 update public.icash_operation_spend set customer_price_micros=price where operation_key=p_operation and customer_price_micros is null;
 if exists(select 1 from public.icash_operation_spend where operation_key=p_operation and customer_price_micros<>price) then raise exception 'SMS price changed after reservation';end if;
 end if;
 return result;
end $$;
alter function public.icash_settle_complete_costs(text,bigint,jsonb,text) rename to icash_settle_costs_before_fractional;
create function public.icash_settle_complete_costs(p_operation text,p_charge bigint,p_components jsonb,p_evidence text) returns void language plpgsql set search_path='' as $$
declare o public.icash_operation_spend;prior public.icash_fractional_usage;carry bigint;charge bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if o.customer_price_micros is null then
 perform public.icash_settle_costs_before_fractional(p_operation,p_charge,p_components,p_evidence);return;
 end if;
 select * into prior from public.icash_fractional_usage where operation_key=p_operation;
 if found then perform public.icash_settle_costs_before_fractional(p_operation,prior.charged_cents,p_components,p_evidence);return;end if;
 insert into public.icash_fractional_credit_carry(account_id) values(o.account_id) on conflict do nothing;
 select remaining_micros into carry from public.icash_fractional_credit_carry where account_id=o.account_id for update;
 charge:=(carry+o.customer_price_micros)/10000;
 -- Costs still require the complete verified manifest. Unknown provider cost cannot be settled as zero.
 perform public.icash_settle_costs_before_fractional(p_operation,charge,p_components,p_evidence);
 insert into public.icash_fractional_usage(operation_key,account_id,price_micros,charged_cents) values(p_operation,o.account_id,o.customer_price_micros,charge);
 update public.icash_fractional_credit_carry set remaining_micros=mod(carry+o.customer_price_micros,10000) where account_id=o.account_id;
end $$;
revoke all on function public.icash_snapshot_sms_price(),public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean),public.icash_settle_complete_costs(text,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function public.icash_snapshot_sms_price(),public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean),public.icash_settle_complete_costs(text,bigint,jsonb,text) to service_role;
