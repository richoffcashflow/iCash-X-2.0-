-- Owner-approved planning baseline, not a claim that DealMachine invoices $0.01 per credit.
create table public.icash_data_cost_settings(
 provider text primary key check(provider='dealmachine'),
 credit_micros bigint not null check(credit_micros>0),
 cost_basis text not null,source_ref text not null,
 updated_at timestamptz not null default now()
);
alter table public.icash_data_cost_settings enable row level security;
revoke all on public.icash_data_cost_settings from public,anon,authenticated;
grant all on public.icash_data_cost_settings to service_role;
insert into public.icash_data_cost_settings(provider,credit_micros,cost_basis,source_ref)
 values('dealmachine',10000,'owner_approved_planning_estimate','Owner baseline 2026-09-29; credit units documented at https://api.docs.dealmachine.com/concepts/credits. Replace allocation using actual plan invoice/usable credits.');

-- Quotes use provider credit counts, not request count or a fixed skip-trace price.
create function public.icash_quote_dealmachine(p_credits integer) returns jsonb language plpgsql stable set search_path='' as $$
declare s public.icash_data_cost_settings;mult numeric;
begin
 if p_credits is null or p_credits<0 or p_credits>1000000 then raise exception 'Invalid credit count';end if;
 select * into strict s from public.icash_data_cost_settings where provider='dealmachine';
 select standard_cost_multiplier into strict mult from public.icash_operating_budget where id=1;
 return jsonb_build_object('providerCredits',p_credits,'unitCostMicros',s.credit_micros,
 'estimatedDataCostMicros',p_credits::bigint*s.credit_micros,
 'dataPriceMicros',ceil(p_credits::numeric*s.credit_micros*mult),
 'multiplier',mult,'costBasis',s.cost_basis,'excludes','Infrastructure, payment costs, outreach and other overhead');
end $$;
revoke all on function public.icash_quote_dealmachine(integer) from public,anon,authenticated;
grant execute on function public.icash_quote_dealmachine(integer) to service_role;

-- Operational reservation baselines. Allocations below are estimates, not invoice observations.
-- New versions are immutable. These rates do not enable a campaign or waive data rights/permissions.
do $$
declare op text;credit_cap integer;unit bigint;c jsonb;total numeric;mult numeric;
begin
 select credit_micros into unit from public.icash_data_cost_settings where provider='dealmachine';
 select standard_cost_multiplier into mult from public.icash_operating_budget where id=1;
 foreach op in array array['property_search','owner_enrichment','buyer_discovery'] loop
 credit_cap:=case when op='owner_enrichment' then 25 else 10 end;
 c:=jsonb_build_object('dealmachine',credit_cap*unit,'elevenlabs',0,'twilio',0,'messaging',0,'email',0,'llm',0,
 'vercel',3000,'railway',3000,'supabase',3000,'github',1000,'payments',10000,'title_and_signing',0,
 'support_and_overhead',5000,'acquisition',10000,'refund_and_dispute_reserve',5000,'other',0);
 select sum(value::numeric) into total from jsonb_each_text(c);
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled)
 values(op,op||'-planning-2026-09-29-v1',ceil(total*1.2*mult/10000),c,2000,
 'PLANNING ESTIMATE: owner-approved $0.01/vendor credit; 10-credit search page or 25-credit owner allowance. $0.04/job overhead allocation plus 20% buffer. Not actual invoice cost. Source https://api.docs.dealmachine.com/concepts/credits . No outreach included; actual receipts reconcile separately.',
 now(),now()+interval '30 days',true);
 end loop;
end $$;
