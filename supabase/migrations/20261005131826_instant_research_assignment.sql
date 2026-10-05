begin;
-- User policy: research finishes -> funded assignment -> immediate contact.
-- Advertising receipts are platform reporting, not an admission dependency.
-- Freeze the cost basis at first assignment; historical prices stay intact.
alter table public.icash_seller_intakes add column customer_costs jsonb, add column customer_cost_basis text;
update public.icash_seller_intakes i set customer_costs=r.costs_micros,customer_cost_basis=r.evidence_ref
from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id
where o.operation_key=(select m.operation_key from public.icash_seller_matches m where m.lead_id=i.id order by m.assigned_at,m.account_id limit 1);

do $patch$
declare def text;needle text;
begin
 def:=pg_get_functiondef('public.icash_assign_seller_lead()'::regprocedure);
 def:=replace(def,'icash_assign_seller_lead()','icash_assign_seller_lead_for(p_lead uuid)');
 needle:=$old$where state in ('qualified','assigned') and ad_cost_micros is not null and next_assignment_at<=now()$old$;
 if position(needle in def)=0 then raise exception 'Assignment selection changed';end if;
 def:=replace(def,needle,$new$where state in ('qualified','assigned') and (p_lead is null or id=p_lead) and next_assignment_at<=now()$new$);
 needle:=$old$parts:=l.lookup_costs||jsonb_build_object('acquisition',l.ad_cost_micros);$old$;
 if position(needle in def)=0 then raise exception 'Assignment price calculation changed';end if;
 def:=replace(def,needle,$new$parts:=coalesce(l.customer_costs,l.lookup_costs||jsonb_build_object('acquisition',0));
 if parts is null or jsonb_typeof(parts)<>'object' or nullif(l.lookup_cost_basis,'') is null then return jsonb_build_object('status','research_cost_required');end if;$new$);
 needle:=$old$evidence:='ESTIMATE: allocated ad receipt '||l.ad_cost_receipt||'; '||l.lookup_cost_basis;$old$;
 if position(needle in def)=0 then raise exception 'Assignment evidence changed';end if;
 def:=replace(def,needle,$new$evidence:=coalesce(l.customer_cost_basis,'ESTIMATE: recorded property research and operating allocations; advertising tracked separately; '||l.lookup_cost_basis);$new$);
 needle:=$old$update public.icash_seller_intakes set state='assigned',assigned_account=$old$;
 if position(needle in def)=0 then raise exception 'Assignment update changed';end if;
 def:=replace(def,needle,$new$update public.icash_seller_intakes set customer_costs=parts,customer_cost_basis=evidence,state='assigned',assigned_account=$new$);
 def:=replace(def,$old$return jsonb_build_object('status','assigned','chargeCents',charge);$old$,$new$return jsonb_build_object('status','assigned','leadId',l.id,'accountId',a.id,'chargeCents',charge);$new$);
 execute def;
end $patch$;
revoke all on function public.icash_assign_seller_lead_for(uuid) from public,anon,authenticated;
grant execute on function public.icash_assign_seller_lead_for(uuid) to service_role;
create or replace function public.icash_assign_seller_lead() returns jsonb language sql security invoker set search_path='' as $$select public.icash_assign_seller_lead_for(null)$$;

-- Cost reports may arrive after contact starts. They never modify the frozen
-- customer price, charge a wallet, or lift the three-recipient schedule.
do $patch$
declare def text;needle text;
begin
 def:=pg_get_functiondef('public.icash_allocate_seller_ad_cost(text,text,text,timestamp with time zone,timestamp with time zone,bigint,text,uuid)'::regprocedure);
 needle:=$old$market_qualified and state='qualified' and ad_cost_receipt is null$old$;
 if position(needle in def)=0 then raise exception 'Advertising report selection changed';end if;
 execute replace(def,needle,$new$market_qualified and state in ('qualified','assigned') and ad_cost_receipt is null$new$);
 def:=pg_get_functiondef('public.icash_seller_demand_summary()'::regprocedure);
 if position(' and i.ad_cost_micros is not null' in def)=0 then raise exception 'Demand selection changed';end if;
 execute replace(def,' and i.ad_cost_micros is not null','');
 def:=pg_get_functiondef('public.icash_seller_funnel_summary()'::regprocedure);
 needle:=$old$'waitingForCosts',(select count(*) from public.icash_seller_intakes where state='qualified' and ad_cost_micros is null)$old$;
 if position(needle in def)=0 then raise exception 'Funnel cost selection changed';end if;
 def:=replace(def,needle,$new$'waitingForCosts',0$new$);
 def:=replace(def,$old$where state='qualified' and ad_cost_micros is not null$old$,$new$where state='qualified'$new$);
 execute def;
end $patch$;
-- A cost receipt used to be the only event waking these qualified requests.
update public.icash_seller_intakes set next_assignment_at=now() where state='qualified' and ad_cost_micros is null;
commit;
