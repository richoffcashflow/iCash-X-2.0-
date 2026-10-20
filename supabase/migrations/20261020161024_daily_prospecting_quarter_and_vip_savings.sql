-- 2026-10-20 owner policy: 25% rolling daily prospecting; 30% VIP savings.
-- Existing 50% lifetime search allowance, wallet floor, replies, controls and
-- historical/in-flight prices remain intact. No paid work is dispatched here.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;

do $preflight$ begin
 if md5(pg_get_functiondef('public.icash_assign_seller_lead_for'::regproc))<>'8cb4b592ae3bb3917cfe0c4010eab3f8' then raise exception 'Concurrent change to icash_assign_seller_lead_for';end if;
 if md5(pg_get_functiondef('public.icash_meta_promote_property'::regproc))<>'0e1b0b40b3a40f7c06a325c16c89f2e4' then raise exception 'Concurrent change to icash_meta_promote_property';end if;
 if md5(pg_get_functiondef('public.icash_prospecting_available'::regproc))<>'3db540097ef0b7e9a8b17c103ab7597a' then raise exception 'Concurrent change to icash_prospecting_available';end if;
 if md5(pg_get_functiondef('public.icash_prospecting_progress'::regproc))<>'d768a65e51ecab4a204ad073d990cd53' then raise exception 'Concurrent change to icash_prospecting_progress';end if;
 if md5(pg_get_functiondef('public.icash_prospecting_released'::regproc))<>'012657cf4b7406519a1211fe701798da' then raise exception 'Concurrent change to icash_prospecting_released';end if;
 if md5(pg_get_functiondef('public.icash_reserve_before_fractional'::regproc))<>'5796df52245c2039dac906eda2d99a57' then raise exception 'Concurrent change to icash_reserve_before_fractional';end if;
 if md5(pg_get_functiondef('public.icash_reserve_cancellation_voice'::regproc))<>'896dcd7098e8927bfe842a5d15f92990' then raise exception 'Concurrent change to icash_reserve_cancellation_voice';end if;
 if md5(pg_get_functiondef('public.icash_reserve_direct_reception'::regproc))<>'15491cbe730c0a499ec05392ab188dbb' then raise exception 'Concurrent change to icash_reserve_direct_reception';end if;
 if md5(pg_get_functiondef('public.icash_reserve_flexible_reception'::regproc))<>'dfc50d162414e4e403267018500b1b7d' then raise exception 'Concurrent change to icash_reserve_flexible_reception';end if;
 if md5(pg_get_functiondef('public.icash_reserve_flexible_voice'::regproc))<>'b019eafb737d7bf562a4100e1a42fa4f' then raise exception 'Concurrent change to icash_reserve_flexible_voice';end if;
 if md5(pg_get_functiondef('public.icash_reserve_operation'::regproc))<>'37b574da834be669055dd0779d8cedd9' then raise exception 'Concurrent change to icash_reserve_operation';end if;
 if md5(pg_get_functiondef('public.icash_reserve_question'::regproc))<>'73ecf46b2b2ef5bcf9d0292decda32a1' then raise exception 'Concurrent change to icash_reserve_question';end if;
 if md5(pg_get_functiondef('public.icash_reserve_recorded_reception'::regproc))<>'e9da3a97a765195f5411e73c9fd7196c' then raise exception 'Concurrent change to icash_reserve_recorded_reception';end if;
 if md5(pg_get_functiondef('public.icash_search_due_before_prospecting_budget'::regproc))<>'a4481be7e795cedb03c09961a11c39a8' then raise exception 'Concurrent change to icash_search_due_before_prospecting_budget';end if;
 if md5(pg_get_functiondef('public.icash_usage_loop_context'::regproc))<>'978b3051a2753eec7e405a5e9dfbaa0d' then raise exception 'Concurrent change to icash_usage_loop_context';end if;
 if md5(pg_get_functiondef('public.icash_vip_savings'::regproc))<>'1574ba30b73ae628f3bed39b0dafc0ab' then raise exception 'Concurrent change to icash_vip_savings';end if;
 if md5(pg_get_functiondef('icash_recorded_reception_private.automatic_components'::regproc))<>'bd7b5a56e6883dc41db8bdd8b1f334d0' then raise exception 'Concurrent change to automatic_components';end if;
end $preflight$;

-- BEGIN icash_prospecting_available
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_prospecting_available'::regproc);
 if (length(d)-length(replace(d,$old$b.limit_cents-usage.recent_amount$old$,'')))/length($old$b.limit_cents-usage.recent_amount$old$)<>1 then raise exception 'Unexpected icash_prospecting_available policy boundary';end if;
 d:=replace(d,$old$b.limit_cents-usage.recent_amount$old$,$new$b.baseline_cents/4-usage.recent_amount$new$);
 if (length(d)-length(replace(d,$old$least(b.limit_cents,greatest(500,ceil(b.limit_cents/10.0)))$old$,'')))/length($old$least(b.limit_cents,greatest(500,ceil(b.limit_cents/10.0)))$old$)<>1 then raise exception 'Unexpected icash_prospecting_available policy boundary';end if;
 d:=replace(d,$old$least(b.limit_cents,greatest(500,ceil(b.limit_cents/10.0)))$old$,$new$least(b.baseline_cents/4,greatest(500,ceil(b.limit_cents/10.0)))$new$);
 execute d;
end $patch$;
-- END icash_prospecting_available

-- BEGIN icash_prospecting_released
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_prospecting_released'::regproc);
 if (length(d)-length(replace(d,$old$least(total,greatest(500,ceil(total/10.0)))$old$,'')))/length($old$least(total,greatest(500,ceil(total/10.0)))$old$)<>1 then raise exception 'Unexpected icash_prospecting_released policy boundary';end if;
 d:=replace(d,$old$least(total,greatest(500,ceil(total/10.0)))$old$,$new$least(p_balance/4,greatest(500,ceil(total/10.0)))$new$);
 if (length(d)-length(replace(d,$old$(12*3600)$old$,'')))/length($old$(12*3600)$old$)<>1 then raise exception 'Unexpected icash_prospecting_released policy boundary';end if;
 d:=replace(d,$old$(12*3600)$old$,$new$(24*3600)$new$);
 execute d;
end $patch$;
-- END icash_prospecting_released

-- BEGIN icash_prospecting_progress
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_prospecting_progress'::regproc);
 if (length(d)-length(replace(d,$old$'pacingHours',12$old$,'')))/length($old$'pacingHours',12$old$)<>1 then raise exception 'Unexpected icash_prospecting_progress policy boundary';end if;
 d:=replace(d,$old$'pacingHours',12$old$,$new$'pacingHours',24,'dailyPercent',25,'dailyLimitCents',b.baseline_cents/4$new$);
 if (length(d)-length(replace(d,$old$least(b.limit_cents,greatest(500,ceil(b.limit_cents/10.0)))$old$,'')))/length($old$least(b.limit_cents,greatest(500,ceil(b.limit_cents/10.0)))$old$)<>1 then raise exception 'Unexpected icash_prospecting_progress policy boundary';end if;
 d:=replace(d,$old$least(b.limit_cents,greatest(500,ceil(b.limit_cents/10.0)))$old$,$new$least(b.baseline_cents/4,greatest(500,ceil(b.limit_cents/10.0)))$new$);
 execute d;
end $patch$;
-- END icash_prospecting_progress

-- VIP admission: affect only new snapshots. Idempotent retries keep their original prices.

-- BEGIN icash_assign_seller_lead_for
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_assign_seller_lead_for'::regproc);
 if (length(d)-length(replace(d,$old$0.8$old$,'')))/length($old$0.8$old$)<>2 then raise exception 'Unexpected icash_assign_seller_lead_for policy boundary';end if;
 d:=replace(d,$old$0.8$old$,$new$0.7$new$);
 execute d;
end $patch$;
-- END icash_assign_seller_lead_for

-- BEGIN icash_meta_promote_property
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_meta_promote_property'::regproc);
 if (length(d)-length(replace(d,$old$0.8$old$,'')))/length($old$0.8$old$)<>1 then raise exception 'Unexpected icash_meta_promote_property policy boundary';end if;
 d:=replace(d,$old$0.8$old$,$new$0.7$new$);
 execute d;
end $patch$;
-- END icash_meta_promote_property

-- BEGIN icash_reserve_before_fractional
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_reserve_before_fractional'::regproc);
 if (length(d)-length(replace(d,$old$0.8$old$,'')))/length($old$0.8$old$)<>4 then raise exception 'Unexpected icash_reserve_before_fractional policy boundary';end if;
 d:=replace(d,$old$0.8$old$,$new$0.7$new$);
 execute d;
end $patch$;
-- END icash_reserve_before_fractional

-- BEGIN icash_reserve_cancellation_voice
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_reserve_cancellation_voice'::regproc);
 if (length(d)-length(replace(d,$old$0.8$old$,'')))/length($old$0.8$old$)<>2 then raise exception 'Unexpected icash_reserve_cancellation_voice policy boundary';end if;
 d:=replace(d,$old$0.8$old$,$new$0.7$new$);
 execute d;
end $patch$;
-- END icash_reserve_cancellation_voice

-- BEGIN icash_reserve_direct_reception
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_reserve_direct_reception'::regproc);
 if (length(d)-length(replace(d,$old$0.8$old$,'')))/length($old$0.8$old$)<>2 then raise exception 'Unexpected icash_reserve_direct_reception policy boundary';end if;
 d:=replace(d,$old$0.8$old$,$new$0.7$new$);
 execute d;
end $patch$;
-- END icash_reserve_direct_reception

-- BEGIN icash_reserve_flexible_reception
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_reserve_flexible_reception'::regproc);
 if (length(d)-length(replace(d,$old$0.8$old$,'')))/length($old$0.8$old$)<>2 then raise exception 'Unexpected icash_reserve_flexible_reception policy boundary';end if;
 d:=replace(d,$old$0.8$old$,$new$0.7$new$);
 execute d;
end $patch$;
-- END icash_reserve_flexible_reception

-- BEGIN icash_reserve_flexible_voice
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_reserve_flexible_voice'::regproc);
 if (length(d)-length(replace(d,$old$0.8$old$,'')))/length($old$0.8$old$)<>2 then raise exception 'Unexpected icash_reserve_flexible_voice policy boundary';end if;
 d:=replace(d,$old$0.8$old$,$new$0.7$new$);
 execute d;
end $patch$;
-- END icash_reserve_flexible_voice

-- BEGIN icash_reserve_operation
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_reserve_operation'::regproc);
 if (length(d)-length(replace(d,$old$0.8$old$,'')))/length($old$0.8$old$)<>1 then raise exception 'Unexpected icash_reserve_operation policy boundary';end if;
 d:=replace(d,$old$0.8$old$,$new$0.7$new$);
 if (length(d)-length(replace(d,$old$20% usage reduction$old$,'')))/length($old$20% usage reduction$old$)<>1 then raise exception 'Unexpected icash_reserve_operation policy boundary';end if;
 d:=replace(d,$old$20% usage reduction$old$,$new$30% usage reduction$new$);
 execute d;
end $patch$;
-- END icash_reserve_operation

-- BEGIN icash_reserve_recorded_reception
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_reserve_recorded_reception'::regproc);
 if (length(d)-length(replace(d,$old$0.8$old$,'')))/length($old$0.8$old$)<>2 then raise exception 'Unexpected icash_reserve_recorded_reception policy boundary';end if;
 d:=replace(d,$old$0.8$old$,$new$0.7$new$);
 execute d;
end $patch$;
-- END icash_reserve_recorded_reception

-- BEGIN icash_search_due_before_prospecting_budget
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_search_due_before_prospecting_budget'::regproc);
 if (length(d)-length(replace(d,$old$0.8$old$,'')))/length($old$0.8$old$)<>1 then raise exception 'Unexpected icash_search_due_before_prospecting_budget policy boundary';end if;
 d:=replace(d,$old$0.8$old$,$new$0.7$new$);
 execute d;
end $patch$;
-- END icash_search_due_before_prospecting_budget

-- BEGIN icash_usage_loop_context
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_usage_loop_context'::regproc);
 if (length(d)-length(replace(d,$old$0.8$old$,'')))/length($old$0.8$old$)<>1 then raise exception 'Unexpected icash_usage_loop_context policy boundary';end if;
 d:=replace(d,$old$0.8$old$,$new$0.7$new$);
 execute d;
end $patch$;
-- END icash_usage_loop_context

-- Preserve all historical question multipliers; permit the new 30% discount.
alter table public.icash_question_usage drop constraint icash_question_usage_multiplier_check;
alter table public.icash_question_usage add constraint icash_question_usage_multiplier_check check(multiplier in (3,2.4,2,1.6,1.4));

-- BEGIN icash_reserve_question
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_reserve_question'::regproc);
 if (length(d)-length(replace(d,$old$then 1.6 else 2 end$old$,'')))/length($old$then 1.6 else 2 end$old$)<>1 then raise exception 'Unexpected icash_reserve_question policy boundary';end if;
 d:=replace(d,$old$then 1.6 else 2 end$old$,$new$then 1.4 else 2 end$new$);
 execute d;
end $patch$;
-- END icash_reserve_question

-- BEGIN automatic_components
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('icash_recorded_reception_private.automatic_components'::regproc);
 if (length(d)-length(replace(d,$old$or row(r.standard_cost_multiplier,r.elevenlabs_cost_multiplier) is not distinct from row((p->>'standard_cost_multiplier')::numeric*0.8,(p->>'elevenlabs_cost_multiplier')::numeric*0.8)$old$,'')))/length($old$or row(r.standard_cost_multiplier,r.elevenlabs_cost_multiplier) is not distinct from row((p->>'standard_cost_multiplier')::numeric*0.8,(p->>'elevenlabs_cost_multiplier')::numeric*0.8)$old$)<>1 then raise exception 'Unexpected automatic_components policy boundary';end if;
 d:=replace(d,$old$or row(r.standard_cost_multiplier,r.elevenlabs_cost_multiplier) is not distinct from row((p->>'standard_cost_multiplier')::numeric*0.8,(p->>'elevenlabs_cost_multiplier')::numeric*0.8)$old$,$new$or row(r.standard_cost_multiplier,r.elevenlabs_cost_multiplier) is not distinct from row((p->>'standard_cost_multiplier')::numeric*0.8,(p->>'elevenlabs_cost_multiplier')::numeric*0.8)
   or row(r.standard_cost_multiplier,r.elevenlabs_cost_multiplier) is not distinct from row((p->>'standard_cost_multiplier')::numeric*0.7,(p->>'elevenlabs_cost_multiplier')::numeric*0.7)$new$);
 execute d;
end $patch$;
-- END automatic_components

-- BEGIN icash_vip_savings
CREATE OR REPLACE FUNCTION public.icash_vip_savings(p_account uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with settled as (
  select o.*,r.operation,case when o.standard_cost_multiplier in (1.4,2.1) then 0.7 else 0.8 end vip_ratio from public.icash_operation_spend o
  join public.icash_operation_rates r on r.id=o.rate_id
  where o.account_id=p_account and o.state='settled' and o.settled_at is not null
   and o.charged_cents is not null and o.actual_micros is not null
 ), amounts as (
  select case
   when ((o.dealmachine_cost_multiplier=2.4 and o.standard_cost_multiplier=1.6) or (o.dealmachine_cost_multiplier=2.1 and o.standard_cost_multiplier=1.4)) and o.elevenlabs_cost_multiplier=o.standard_cost_multiplier and o.customer_price_micros is null
    and o.charged_cents=ceil((o.actual_micros::numeric*o.standard_cost_multiplier+coalesce((cm.components->'dealmachine'->>'amountMicros')::numeric,0)*(o.dealmachine_cost_multiplier-o.standard_cost_multiplier))/10000)
    then greatest(0,ceil((o.actual_micros::numeric*o.standard_cost_multiplier+coalesce((cm.components->'dealmachine'->>'amountMicros')::numeric,0)*(o.dealmachine_cost_multiplier-o.standard_cost_multiplier))/o.vip_ratio/10000)-o.charged_cents)*10000
   when o.operation='seller_lead' and o.standard_cost_multiplier in (1.4,2.1,1.6,2.4)
    and o.charged_cents=ceil(ceil(o.actual_micros::numeric*(o.standard_cost_multiplier/o.vip_ratio)/10000)*o.vip_ratio)
    then (ceil(o.actual_micros::numeric*(o.standard_cost_multiplier/o.vip_ratio)/10000)-o.charged_cents)*10000
   when o.customer_price_micros is null and o.standard_cost_multiplier in (1.4,2.1,1.6,2.4) and o.elevenlabs_cost_multiplier=o.standard_cost_multiplier
    and o.charged_cents=ceil(o.actual_micros::numeric*o.standard_cost_multiplier/10000)
    then greatest(0,least(o.charge_cap_cents,ceil(o.actual_micros::numeric*(o.standard_cost_multiplier/o.vip_ratio)/10000))-o.charged_cents)*10000
   when f.price_micros=o.customer_price_micros and f.charged_cents=o.charged_cents then
    case when o.standard_cost_multiplier in (1.4,2.1,1.6,2.4) and o.customer_price_micros=ceil(o.actual_micros::numeric*o.standard_cost_multiplier)
     then greatest(0,least(o.charge_cap_cents::numeric*10000,ceil(o.actual_micros::numeric*(o.standard_cost_multiplier/o.vip_ratio)))-o.customer_price_micros)
    when m.customer_price_micros>0 and o.customer_price_micros in (ceil(m.customer_price_micros::numeric*0.8),ceil(m.customer_price_micros::numeric*0.7))
     then m.customer_price_micros-o.customer_price_micros else 0 end
   else 0 end as savings_micros
  from settled o
  left join public.icash_cost_manifests cm on cm.operation_key=o.operation_key
  left join public.icash_fractional_usage f on f.operation_key=o.operation_key and f.account_id=p_account
  left join public.icash_text_messages m on o.operation_key='text:'||m.id and m.account_id=p_account
  union all
  select ceil(q.cost_micros::numeric*(q.multiplier/(case when q.multiplier=1.4 then 0.7 else 0.8 end)))-q.price_micros
  from public.icash_question_usage q where q.account_id=p_account and q.state='settled'
   and q.settled_at is not null and q.provider_id is not null and q.multiplier in (1.4,1.6,2.4)
   and q.price_micros=ceil(q.cost_micros::numeric*q.multiplier) and q.charged_cents is not null
 ) select floor(coalesce(sum(greatest(0,savings_micros)),0)/10000)::bigint from amounts
$function$
;
-- END icash_vip_savings

-- New accepted terms version; retain old receipts and all payment/account checks.
-- BEGIN icash_activate_auto_recharge
do $terms$ declare d text;begin
 d:=pg_get_functiondef('public.icash_activate_auto_recharge'::regproc);
 if md5(d)<>'b57b962544a5fd14921d36d33d33d6c0' then raise exception 'Concurrent change to icash_activate_auto_recharge';end if;
 d:=replace(d,$old$'work-credits-2026-10-10.1:recharge-2026-10-10.1'$old$,$new$'work-credits-2026-10-10.1:recharge-2026-10-10.1','work-credits-2026-10-20.1:recharge-2026-10-10.1'$new$);
 execute d;
end $terms$;
-- END icash_activate_auto_recharge
-- BEGIN icash_apply_prepaid_purchase
do $terms$ declare d text;begin
 d:=pg_get_functiondef('public.icash_apply_prepaid_purchase'::regproc);
 if md5(d)<>'cc783adc5262a2ae02fffc23c7a7362e' then raise exception 'Concurrent change to icash_apply_prepaid_purchase';end if;
 d:=replace(d,$old$'work-credits-2026-10-10.1:recharge-2026-10-10.1'$old$,$new$'work-credits-2026-10-10.1:recharge-2026-10-10.1','work-credits-2026-10-20.1:recharge-2026-10-10.1','work-credits-2026-10-20.1'$new$);
 execute d;
end $terms$;
-- END icash_apply_prepaid_purchase

-- CREATE OR REPLACE preserves existing ownership and restricted EXECUTE ACLs.
commit;
