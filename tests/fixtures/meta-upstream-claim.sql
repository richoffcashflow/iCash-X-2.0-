-- Snapshot of the deployed admission chain before meta-first-call-admission.
-- No provider calls or customer rows. Keep the actual final financial predicate
-- in this fixture so a queued initial call cannot masquerade as a dispatch test.
create or replace function public.icash_claim_before_activation(p_operation text) returns boolean
language plpgsql set search_path='' as $$
declare b public.icash_operating_budget;o public.icash_operation_spend;r public.icash_operation_rates;a public.icash_accounts;
begin
 select * into b from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.state<>'reserved' or not b.enabled or (b.require_company_reserve and b.funded_micros::numeric-b.spent_micros-b.protected_micros<b.reserved_micros) then return false;end if;
 select * into a from public.icash_accounts where id=o.account_id for update;
 select * into r from public.icash_operation_rates where id=o.rate_id for share;
 if (a.bot_paused and not public.icash_general_reception_pause_exempt(o.account_id,p_operation,o.charge_cap_cents) and not public.icash_customer_text_operation(o.account_id,p_operation)) or not r.enabled or r.expires_at<=now() or o.permission_until<=now() then return false;end if;
 if r.operation='seller_call' and not public.icash_limited_seller_voice(o.account_id,p_operation) and not public.icash_cancellation_voice_current(o.account_id,p_operation) and (o.financial_checked_at is null or o.financial_checked_at<now()-interval '24 hours') then return false;end if;
 update public.icash_operation_spend set state='dispatched',dispatched_at=now() where operation_key=p_operation;
 return true;
end $$;
create or replace function public.icash_claim_before_membership(p_operation text) returns boolean
language plpgsql set search_path='' as $$
declare a uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from public.icash_operating_budget where id=1 and not require_company_reserve) then
  select account_id into a from public.icash_operation_spend where operation_key=p_operation;
  if not exists(select 1 from public.icash_spend_activations where account_id=a and enabled) then return false;end if;
 end if;
 return public.icash_claim_before_activation(p_operation);
end $$;
create or replace function public.icash_claim_operation(p_operation text) returns boolean
language plpgsql set search_path='' as $$
declare a uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select account_id into a from public.icash_operation_spend where operation_key=p_operation;
 if not public.icash_membership_work_allowed(a) then return false;end if;
 perform 1 from public.icash_wallets where account_id=a and balance_cents>0 for update;
 if not found then return false;end if;
 return public.icash_claim_before_membership(p_operation);
end $$;
