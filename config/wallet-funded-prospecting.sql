-- Owner policy: continuously use available funded credits; daily targets are goals.
-- Keep immutable funding, actual charges, unresolved commitments and final admission.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;

do $guard$
declare item record;
begin
 for item in select * from (values
 ('icash_prospecting_available(uuid)','f5beb913ecab536ae5f22e8863202a96'),
 ('icash_prospecting_total_available(uuid)','b472353a64b992dc849ff7b35f7d7d9c'),
 ('icash_prospecting_released(bigint,timestamp with time zone)','012657cf4b7406519a1211fe701798da'),
 ('icash_prospecting_progress(uuid)','596b391defd49d249902c04be3e37de7'),
 ('icash_apply_prepaid_purchase(uuid)','740632960f397db80736571f46d53a45'),
 ('icash_activate_auto_recharge(uuid,text,text)','7a6792193429e1eed464f9b329d77e88')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(('public.'||item.signature)::regprocedure))<>item.checksum then
   raise exception 'Concurrent change to %',item.signature;
  end if;
 end loop;
end $guard$;

-- The hot admission path reads only outstanding operations, not lifetime usage.
create index icash_operation_spend_open_account on public.icash_operation_spend(account_id)
 include(charge_cap_cents) where state in ('reserved','dispatched');

create or replace function public.icash_prospecting_total_available(p_account uuid) returns bigint
language sql stable set search_path='' as $$
 select coalesce((
  select greatest(0,w.balance_cents-coalesce((
   select sum(o.charge_cap_cents) from public.icash_operation_spend o
   where o.account_id=p_account and o.state in ('reserved','dispatched')
  ),0))::bigint
  from public.icash_wallets w where w.account_id=p_account
   and exists(select 1 from public.icash_prospecting_budgets b where b.account_id=p_account)
 ),0);
$$;
create or replace function public.icash_prospecting_available(p_account uuid) returns bigint
language sql stable set search_path='' as $$
 select public.icash_prospecting_total_available(p_account);
$$;
create or replace function public.icash_prospecting_released(p_balance bigint,p_started timestamptz) returns bigint
language sql stable set search_path='' as $$
 select greatest(0,p_balance);
$$;

CREATE OR REPLACE FUNCTION public.icash_prospecting_progress(p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare b public.icash_prospecting_budgets;remaining bigint;minimum bigint;spent bigint;pending bigint;queued bigint;screened bigint;eligible bigint;attempted bigint;responded bigint;active boolean;paused boolean;
begin
 select * into b from public.icash_prospecting_budgets where account_id=p_account order by id desc limit 1;
 if not found then return null;end if;
 remaining:=public.icash_prospecting_available(p_account);
 select least(search.charge_cents,contacts.charge_cents) into minimum from public.icash_discovery_configs c join public.icash_operation_rates search on search.id=c.rate_id left join public.icash_operation_rates contacts on contacts.id=c.contact_rate_id where c.account_id=p_account;
 select coalesce(sum(public.icash_customer_discovery_charge(account_id,operation_key,charged_cents)) filter(where state='settled' and prospecting_budget_id=b.id),0),coalesce(sum(charge_cap_cents) filter(where state in ('reserved','dispatched')),0) into spent,pending from public.icash_operation_spend where account_id=p_account;
 select bot_paused into paused from public.icash_accounts where id=p_account;
 select count(*) filter(where s.state in ('queued','running')),count(*) filter(where s.state='complete'),count(*) filter(where s.state='complete' and s.result->'financialCheck'->>'status'='eligible')
  into queued,screened,eligible from public.icash_screening_jobs s where s.account_id=p_account and s.created_at>=b.created_at and s.state<>'archived';
 select count(*) filter(where o.attempted),count(*) filter(where o.responded and not o.opted_out) into attempted,responded
  from public.icash_opportunity_outcomes o where o.account_id=p_account and o.discovered_at>=b.created_at;
 active:=exists(select 1 from public.icash_automation_tickets where account_id=p_account and kind in ('discovery','contacts','voice_dispatch','seller_opener') and state='consumed' and created_at>now()-interval '2 minutes') or queued>0;
 return jsonb_build_object('budgetId',b.id,'startedAt',b.created_at,'spendingMode','available_balance','fundedBaselineCents',b.baseline_cents,'spentCents',spent,'pendingCents',pending,'remainingCents',remaining,
  'callsBudgetHeld',(select count(*) from public.icash_voice_jobs where account_id=p_account and state='held' and outcome='prospecting_budget_held' and provider_call_sid is null and conversation_id is null),'queued',queued,'screened',screened,'eligible',eligible,'contacted',attempted,'responded',responded,
  'status',case when paused then 'paused' when not public.icash_membership_work_allowed(p_account) then 'membership_required'
   when remaining<coalesce(minimum,1) and pending>0 then 'settling' when remaining<coalesce(minimum,1) then 'budget_reached' when active then 'working'
   when exists(select 1 from public.icash_discovery_configs where account_id=p_account and enabled and auto_enabled and data_rights_until>now()) then 'ready' else 'waiting' end);
end $function$;


-- New checkout text gets a new acceptance version. Keep every historical version
-- and require the separate explicit auto-recharge acceptance as before.
do $terms$
declare d text;name text;old text;replacement text;
begin
 foreach name in array array['icash_apply_prepaid_purchase(uuid)','icash_activate_auto_recharge(uuid,text,text)'] loop
  d:=pg_get_functiondef(('public.'||name)::regprocedure);
  old:=$old$'work-credits-2026-10-20.2:recharge-2026-10-10.1')$old$;
  replacement:=case when name='icash_apply_prepaid_purchase(uuid)' then
   $new$'work-credits-2026-10-20.2:recharge-2026-10-10.1','work-credits-2026-10-26.1','work-credits-2026-10-26.1:recharge-2026-10-10.1')$new$
   else $new$'work-credits-2026-10-20.2:recharge-2026-10-10.1','work-credits-2026-10-26.1:recharge-2026-10-10.1')$new$ end;
  if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Funding acceptance boundary changed';end if;
  execute replace(d,old,replacement);
 end loop;
end $terms$;
revoke all on function public.icash_prospecting_available(uuid),public.icash_prospecting_total_available(uuid),public.icash_prospecting_released(bigint,timestamptz),public.icash_prospecting_progress(uuid) from public,anon,authenticated;
grant execute on function public.icash_prospecting_available(uuid),public.icash_prospecting_total_available(uuid),public.icash_prospecting_released(bigint,timestamptz),public.icash_prospecting_progress(uuid) to service_role;
commit;
