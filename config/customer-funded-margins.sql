-- Customer credits fund work; no fictional company cash top-up.
alter table public.icash_operating_budget add column require_company_reserve boolean not null default true,
 add column standard_cost_multiplier numeric not null default 5 check(standard_cost_multiplier>=1),
 add column elevenlabs_cost_multiplier numeric not null default 3 check(elevenlabs_cost_multiplier>=1);
alter table public.icash_operation_spend add column standard_cost_multiplier numeric not null default 5,
 add column elevenlabs_cost_multiplier numeric not null default 5,
 add column required_revenue_micros numeric;
CREATE OR REPLACE FUNCTION public.icash_reserve_before_fractional(p_account uuid, p_operation text, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.icash_operating_budget; r public.icash_operation_rates; o public.icash_operation_spend; cat text; n numeric; total numeric:=0; held bigint; daily numeric; cr uuid; required numeric; price numeric;
begin
 if p_operation is null or length(p_operation) not between 1 and 160 then raise exception 'Invalid operation'; end if;
 select * into b from public.icash_operating_budget where id=1 for update;
 if not b.enabled then raise exception 'Automation on hold'; end if;
 select * into o from public.icash_operation_spend where operation_key=p_operation;
 if found then
  if o.account_id<>p_account or o.rate_id<>p_rate then raise exception 'Operation conflict'; end if;
  return jsonb_build_object('operationKey',o.operation_key,'state',o.state,'reservedMicros',o.reserved_micros);
 end if;
 select * into r from public.icash_operation_rates where id=p_rate for share;
 if not found or not r.enabled or r.verified_at>now() or r.expires_at<=now() then raise exception 'Verified rate required'; end if;
 if p_permission_until is null or p_permission_until<=now() then raise exception 'Permission expired'; end if;
 if r.operation='seller_call' and (p_financial_eligible is distinct from true or p_financial_checked_at is null or p_financial_checked_at>now() or p_financial_checked_at<now()-interval '24 hours') then raise exception 'Financial screening required'; end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  if jsonb_typeof(r.costs_micros->cat) is distinct from 'number' then raise exception 'Unknown cost: %',cat; end if;
  n:=(r.costs_micros->>cat)::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid cost'; end if;
  total:=total+n;
 end loop;
 -- Match JS: round reserve up to a cent after adding buffer.
 held:=ceil(total*(10000+r.buffer_bps)/10000);
 required:=ceil((total*b.standard_cost_multiplier-(r.costs_micros->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/10000);
 price:=r.charge_cents::numeric*10000;
 if r.operation='sms_send' then
 select customer_price_micros into price from public.icash_text_messages where 'text:'||id=p_operation and account_id=p_account;
 end if;
 if price is null or price<required then raise exception 'Price below provider cost multiplier';end if;
 if b.require_company_reserve and b.funded_micros::numeric-b.spent_micros-b.reserved_micros-b.protected_micros<held then raise exception 'Company budget exhausted'; end if;
 select coalesce(sum(actual_micros),0) into daily from public.icash_operation_spend where settled_at>now()-interval '24 hours';
 if b.require_company_reserve and daily+b.reserved_micros+held>b.daily_limit_micros then raise exception 'Company daily limit'; end if;
 -- Protect 20% of daily credits from new search spending while follow-up work exists.
 if r.operation='property_search' and (
 exists(select 1 from public.icash_voice_jobs where account_id=p_account and callback_id is not null and state in ('ready','issued','dispatching','dispatched'))
 or exists(select 1 from public.icash_deal_files where account_id=p_account and stage in ('under_contract','buyer_selected','title_open','closing'))
 ) then
 perform 1 from public.icash_accounts where id=p_account for update;
 perform 1 from public.icash_wallets where account_id=p_account for update;
 if (select w.balance_cents-w.reserved_cents-r.charge_cents<ceil(a.daily_limit_cents*0.20) from public.icash_wallets w join public.icash_accounts a on a.id=w.account_id where w.account_id=p_account)
 then raise exception 'Credits protected for active deals and callbacks'; end if;
 end if;
 cr:=public.icash_reserve_credit(p_account,p_operation,r.charge_cents);
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until,financial_checked_at)
 values(p_operation,p_account,p_rate,cr,r.charge_cents,held,p_permission_until,p_financial_checked_at);
 update public.icash_operation_spend set standard_cost_multiplier=b.standard_cost_multiplier,elevenlabs_cost_multiplier=b.elevenlabs_cost_multiplier,required_revenue_micros=required where operation_key=p_operation;
 update public.icash_operating_budget set reserved_micros=reserved_micros+held where id=1;
 return jsonb_build_object('operationKey',p_operation,'state','reserved','reservedMicros',held);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_claim_operation(p_operation text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.icash_operating_budget; o public.icash_operation_spend; r public.icash_operation_rates; a public.icash_accounts;
begin
 select * into b from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.state<>'reserved' or not b.enabled or (b.require_company_reserve and b.funded_micros::numeric-b.spent_micros-b.protected_micros<b.reserved_micros) then return false; end if;
 select * into a from public.icash_accounts where id=o.account_id for update;
 select * into r from public.icash_operation_rates where id=o.rate_id for share;
 if a.bot_paused or not r.enabled or r.expires_at<=now() or o.permission_until<=now() then return false; end if;
 if r.operation='seller_call' and (o.financial_checked_at is null or o.financial_checked_at<now()-interval '24 hours') then return false; end if;
 update public.icash_operation_spend set state='dispatched',dispatched_at=now() where operation_key=p_operation;
 return true;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_launch_checks(p_account uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
select jsonb_build_object(
 'cashReserve',exists(select 1 from public.icash_operating_budget where id=1 and enabled and (not require_company_reserve or funded_micros::numeric-spent_micros-protected_micros-reserved_micros>0)),
 'discovery',exists(select 1 from public.icash_discovery_configs d join public.icash_operation_rates r on r.id=d.rate_id join public.icash_operation_rates e on e.id=d.contact_rate_id where (p_account is null or d.account_id=p_account) and d.enabled and d.auto_enabled and not d.exhausted and d.contacts_enabled and d.data_rights_until>now() and r.enabled and r.operation='property_search' and r.expires_at>now() and e.enabled and e.operation='owner_enrichment' and e.expires_at>now()),
 'voice',exists(select 1 from public.icash_voice_configs c join public.icash_operation_rates r on r.id=c.seller_rate_id where (p_account is null or c.account_id=p_account) and c.enabled and c.reviewed_until>now() and r.enabled and r.expires_at>now() and r.operation='seller_call' and r.voice_max_duration_seconds>=c.max_duration_seconds),
 'contactPermission',exists(select 1 from public.icash_contact_permissions p where (p_account is null or p.account_id=p_account) and p.revoked_at is null and p.permission_until>now() and p.dnc_clear and p.dnc_checked_at between now()-interval '30 days' and now() and not exists(select 1 from public.icash_contact_suppressions s where s.contact_key=p.contact_key)),
 'productionContracts',(select count(distinct kind)>=2 from public.icash_signing_templates t join public.icash_operation_rates r on r.id=t.rate_id where t.enabled and not t.test_mode and t.reviewed_until>now() and r.enabled and r.expires_at>now()),
 'unresolvedDispatches',exists(select 1 from public.icash_voice_jobs where (p_account is null or account_id=p_account) and ((state='held' and outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')) or (state='dispatching' and updated_at<now()-interval '2 minutes')))
);
$function$
;
create or replace function public.icash_account_margin_ok(p_account uuid,p_charge bigint,p_cost bigint,p_pending boolean)
 returns boolean language sql stable set search_path='' as $$
 select p_charge>=0 and p_cost>=0 and
 coalesce(sum(case when o.state='settled' then
  o.actual_micros::numeric*o.standard_cost_multiplier
  - coalesce((m.components->'elevenlabs'->>'amountMicros')::numeric,0)*(o.standard_cost_multiplier-o.elevenlabs_cost_multiplier)
  when p_pending and o.state in ('reserved','dispatched') then coalesce(o.required_revenue_micros,o.reserved_micros*o.standard_cost_multiplier) else 0 end),0)+p_cost*5::numeric
 <= coalesce(sum(case when o.state='settled' then coalesce(o.customer_price_micros,o.charged_cents*10000)
  when p_pending and o.state in ('reserved','dispatched') then coalesce(o.customer_price_micros,o.charge_cap_cents*10000) else 0 end),0)+p_charge*10000::numeric
 from public.icash_operation_spend o left join public.icash_cost_manifests m on m.operation_key=o.operation_key where o.account_id=p_account
$$;
-- Deployment does not change existing production enablement or funding mode.
