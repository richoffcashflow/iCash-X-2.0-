CREATE OR REPLACE FUNCTION public.icash_vip_savings(p_account uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with settled as (
  select o.*,r.operation from public.icash_operation_spend o
  join public.icash_operation_rates r on r.id=o.rate_id
  where o.account_id=p_account and o.state='settled' and o.settled_at is not null
   and o.charged_cents is not null and o.actual_micros is not null
 ), amounts as (
  select case
   when o.dealmachine_cost_multiplier=2.4 and o.standard_cost_multiplier=1.6 and o.elevenlabs_cost_multiplier=1.6 and o.customer_price_micros is null
    and o.charged_cents=ceil((o.actual_micros::numeric*o.standard_cost_multiplier+coalesce((cm.components->'dealmachine'->>'amountMicros')::numeric,0)*(o.dealmachine_cost_multiplier-o.standard_cost_multiplier))/10000)
    then greatest(0,ceil((o.actual_micros::numeric*o.standard_cost_multiplier+coalesce((cm.components->'dealmachine'->>'amountMicros')::numeric,0)*(o.dealmachine_cost_multiplier-o.standard_cost_multiplier))/0.8/10000)-o.charged_cents)*10000
   when o.operation='seller_lead' and o.standard_cost_multiplier in (1.6,2.4)
    and o.charged_cents=ceil(ceil(o.actual_micros::numeric*(o.standard_cost_multiplier/0.8)/10000)*0.8)
    then (ceil(o.actual_micros::numeric*(o.standard_cost_multiplier/0.8)/10000)-o.charged_cents)*10000
   when o.customer_price_micros is null and o.standard_cost_multiplier in (1.6,2.4) and o.elevenlabs_cost_multiplier=o.standard_cost_multiplier
    and o.charged_cents=ceil(o.actual_micros::numeric*o.standard_cost_multiplier/10000)
    then greatest(0,least(o.charge_cap_cents,ceil(o.actual_micros::numeric*(o.standard_cost_multiplier/0.8)/10000))-o.charged_cents)*10000
   when f.price_micros=o.customer_price_micros and f.charged_cents=o.charged_cents then
    case when o.standard_cost_multiplier in (1.6,2.4) and o.customer_price_micros=ceil(o.actual_micros::numeric*o.standard_cost_multiplier)
     then greatest(0,least(o.charge_cap_cents::numeric*10000,ceil(o.actual_micros::numeric*(o.standard_cost_multiplier/0.8)))-o.customer_price_micros)
    when m.customer_price_micros>0 and o.customer_price_micros=ceil(m.customer_price_micros::numeric*0.8)
     then m.customer_price_micros-o.customer_price_micros else 0 end
   else 0 end as savings_micros
  from settled o
  left join public.icash_cost_manifests cm on cm.operation_key=o.operation_key
  left join public.icash_fractional_usage f on f.operation_key=o.operation_key and f.account_id=p_account
  left join public.icash_text_messages m on o.operation_key='text:'||m.id and m.account_id=p_account
  union all
  select ceil(q.cost_micros::numeric*(q.multiplier/0.8))-q.price_micros
  from public.icash_question_usage q where q.account_id=p_account and q.state='settled'
   and q.settled_at is not null and q.provider_id is not null and q.multiplier in (1.6,2.4)
   and q.price_micros=ceil(q.cost_micros::numeric*q.multiplier) and q.charged_cents is not null
 ) select floor(coalesce(sum(greatest(0,savings_micros)),0)/10000)::bigint from amounts
$function$
;

