begin;
set local lock_timeout='3s';
select 1 from public.icash_operating_budget where id=1 for update;

-- Append-only owner reports. Estimates are never presented as vendor receipts.
create table public.icash_seller_cost_records (
 id bigint generated always as identity primary key,
 request_id uuid not null unique,
 kind text not null check(kind in ('lead','estimate')),
 lead_id uuid references public.icash_seller_intakes(id),
 source text not null check(source in ('meta','google','youtube','tiktok','direct','other')),
 campaign text not null check(length(campaign)<=100 and campaign !~ '[^a-zA-Z0-9_-]'),
 cost_micros bigint not null check(cost_micros between 0 and 10000000000),
 note text not null check(length(note) between 5 and 500),
 recorded_by uuid not null,
 created_at timestamptz not null default now(),
 check((kind='lead')=(lead_id is not null))
);
create index icash_seller_cost_lead_idx on public.icash_seller_cost_records(lead_id,id desc) where kind='lead';
create index icash_seller_cost_estimate_idx on public.icash_seller_cost_records(source,campaign,id desc) where kind='estimate';
alter table public.icash_seller_cost_records enable row level security;
create policy service_only on public.icash_seller_cost_records for all to service_role using(true) with check(true);
revoke all on public.icash_seller_cost_records from public,anon,authenticated;
grant select,insert on public.icash_seller_cost_records to service_role;
grant usage,select on sequence public.icash_seller_cost_records_id_seq to service_role;

-- New lead prices freeze this multiplier on their first completed assignment.
alter table public.icash_seller_intakes add column customer_lead_multiplier integer check(customer_lead_multiplier in (2,3));
create table public.icash_seller_cost_settings (
 id integer primary key check(id=1),threshold_cents bigint not null check(threshold_cents between 1 and 1000000),
 updated_at timestamptz not null default now(),updated_by uuid
);
insert into public.icash_seller_cost_settings(id,threshold_cents) values(1,1000);
alter table public.icash_seller_cost_settings enable row level security;
create policy service_only on public.icash_seller_cost_settings for all to service_role using(true) with check(true);
revoke all on public.icash_seller_cost_settings from public,anon,authenticated;
grant select,update on public.icash_seller_cost_settings to service_role;
create function public.icash_save_seller_cost_threshold(p_actor uuid,p_cents bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required';end if;
 if p_cents is null or p_cents not between 1 and 1000000 then raise exception 'Valid threshold required';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 update public.icash_seller_cost_settings set threshold_cents=p_cents,updated_at=now(),updated_by=p_actor where id=1;
 return jsonb_build_object('saved',true);
end $$;

create function public.icash_record_seller_acquisition_cost(p_actor uuid,p_request uuid,p_kind text,p_lead uuid,p_source text,p_campaign text,p_cents bigint,p_note text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.icash_seller_intakes;prior public.icash_seller_cost_records;record_id bigint;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 if p_request is null or p_kind is null or p_kind not in ('lead','estimate') or p_cents is null or p_cents not between 0 and 1000000
 or p_note is null or length(btrim(p_note)) not between 5 and 500 then raise exception 'Valid cost and note required';end if;
 if p_kind='lead' then
  select * into l from public.icash_seller_intakes where id=p_lead for update;
  if not found or l.canonical_id is not null or l.state='duplicate' or l.contact_consent_scope='icash_x_demo' then raise exception 'Real unique lead required';end if;
  p_source:=coalesce(l.attribution->>'source','other');p_campaign:=coalesce(l.attribution->>'campaign','');
 elsif p_lead is not null then raise exception 'Estimate cannot target a lead';end if;
 if p_source is null or p_source not in ('meta','google','youtube','tiktok','direct','other') or p_campaign is null
 or length(p_campaign)>100 or p_campaign ~ '[^a-zA-Z0-9_-]' then raise exception 'Valid source and campaign required';end if;
 select * into prior from public.icash_seller_cost_records where request_id=p_request;
 if found then
  if row(prior.kind,prior.lead_id,prior.source,prior.campaign,prior.cost_micros,prior.note,prior.recorded_by)
  is distinct from row(p_kind,p_lead,p_source,p_campaign,p_cents*10000,btrim(p_note),p_actor) then raise exception 'Cost retry conflict';end if;
  return jsonb_build_object('saved',true,'recordId',prior.id,'replayed',true);
 end if;
 insert into public.icash_seller_cost_records(request_id,kind,lead_id,source,campaign,cost_micros,note,recorded_by)
 values(p_request,p_kind,p_lead,p_source,p_campaign,p_cents*10000,btrim(p_note),p_actor) returning id into record_id;
 -- Wake only unpriced work. Never reprice or rebill an existing assignment.
 update public.icash_seller_intakes set next_assignment_at=least(next_assignment_at,now())
 where customer_costs is null and state in ('qualified','numbers_review') and
 ((p_kind='lead' and id=p_lead) or (p_kind='estimate' and attribution->>'source'=p_source and (p_campaign='' or attribution->>'campaign'=p_campaign)));
 return jsonb_build_object('saved',true,'recordId',record_id,'replayed',false);
end $$;

create function public.icash_seller_acquisition_quote(p_lead uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare l public.icash_seller_intakes;r public.icash_seller_cost_records;source_name text;campaign_name text;
begin
 select * into l from public.icash_seller_intakes where id=p_lead;if not found then return null;end if;
 if l.contact_consent_scope='icash_x_demo' then return jsonb_build_object('costMicros',0,'kind','demo','note','Private demo; no paid acquisition');end if;
 select * into r from public.icash_seller_cost_records where kind='lead' and lead_id=l.id order by id desc limit 1;
 if found then return jsonb_build_object('costMicros',r.cost_micros,'kind','reported','note',r.note,'recordId',r.id);end if;
 if l.ad_cost_micros is not null and l.ad_cost_receipt is not null then
  return jsonb_build_object('costMicros',l.ad_cost_micros,'kind','campaign_report','note','Allocated advertising spend','receipt',l.ad_cost_receipt);end if;
 -- Preserve the acquisition estimate actually used when this lead was priced.
 if l.customer_cost_basis like 'lead_acquisition_v1:%' and l.customer_costs is not null then
  return jsonb_build_object('costMicros',(l.customer_costs->>'acquisition')::bigint,'kind','estimate','note','Saved estimate at first assignment');end if;
 source_name:=coalesce(l.attribution->>'source','other');campaign_name:=coalesce(l.attribution->>'campaign','');
 -- An old zero-acquisition snapshot is not evidence of zero advertising spend.
 if l.customer_costs is not null and source_name<>'direct' then return null;end if;
 select * into r from public.icash_seller_cost_records where kind='estimate' and source=source_name and campaign in ('',campaign_name)
 order by (campaign=campaign_name) desc,id desc limit 1;
 if found then return jsonb_build_object('costMicros',r.cost_micros,'kind','estimate','note',r.note,'recordId',r.id);end if;
 if source_name='direct' then return jsonb_build_object('costMicros',0,'kind','organic','note','Direct request; no paid source recorded');end if;
 return null;
end $$;

-- Patch only the price inputs; retain current allocation, consent and wallet gates.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure);
 needle:='match_count integer;';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Lead pricing declaration changed';end if;
 definition:=replace(definition,needle,'match_count integer;cost_quote jsonb;lead_multiplier integer;threshold_cents bigint;');
 needle:=$old$parts:=coalesce(l.customer_costs,l.lookup_costs||jsonb_build_object('acquisition',0));$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Lead pricing input changed';end if;
 definition:=replace(definition,needle,$new$parts:=l.customer_costs;
 if parts is null then
  cost_quote:=public.icash_seller_acquisition_quote(l.id);
  if cost_quote is null then
   update public.icash_seller_intakes set next_assignment_at=now()+interval '15 minutes',hold_reason='Record ad cost or a source estimate in Lead costs' where id=l.id;
   return jsonb_build_object('status','acquisition_cost_required','leadId',l.id);
  end if;
  parts:=l.lookup_costs||jsonb_build_object('acquisition',(cost_quote->>'costMicros')::bigint);
 end if;$new$);
 needle:='charge:=ceil(total::numeric*3/10000);';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then raise exception 'Lead charge calculation changed';end if;
 definition:=replace(definition,needle,$new$select s.threshold_cents into threshold_cents from public.icash_seller_cost_settings s where id=1;
 lead_multiplier:=coalesce(l.customer_lead_multiplier,case when l.customer_costs is not null then 3 when total>=threshold_cents*10000 then 2 else 3 end);
 charge:=ceil(total::numeric*lead_multiplier/10000);$new$);
 needle:=$old$evidence:=coalesce(l.customer_cost_basis,'ESTIMATE: recorded property research and operating allocations; advertising tracked separately; '||l.lookup_cost_basis);$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Lead pricing evidence changed';end if;
 definition:=replace(definition,needle,$new$evidence:=coalesce(l.customer_cost_basis,'lead_acquisition_v1: '||(cost_quote||jsonb_build_object('multiplier',lead_multiplier,'thresholdCents',threshold_cents))::text||'; recorded research and operating allocations: '||l.lookup_cost_basis);$new$);
 needle:='set customer_costs=parts,customer_cost_basis=evidence,';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Lead price snapshot changed';end if;
 definition:=replace(definition,needle,'set customer_costs=parts,customer_cost_basis=evidence,customer_lead_multiplier=lead_multiplier,');
 execute definition;
end $patch$;

-- The central reservation gate must enforce the same lead-specific price.
-- Other usage categories retain their current multipliers and cost checks.
create function public.icash_seller_lead_rate_multiplier(p_account uuid,p_operation text,p_rate uuid) returns numeric
language plpgsql stable security invoker set search_path='' as $$
declare l public.icash_seller_intakes;r public.icash_operation_rates;parts jsonb;quote jsonb;total numeric;threshold bigint;
begin
 select * into r from public.icash_operation_rates where id=p_rate;
 select * into l from public.icash_seller_intakes where 'seller-lead:'||id||':'||p_account=p_operation;
 if not found or r.operation is distinct from 'seller_lead' or r.version is distinct from p_operation then raise exception 'Lead rate binding required';end if;
 parts:=l.customer_costs;
 if parts is null then
  quote:=public.icash_seller_acquisition_quote(l.id);if quote is null then raise exception 'Lead acquisition cost required';end if;
  parts:=l.lookup_costs||jsonb_build_object('acquisition',(quote->>'costMicros')::bigint);
 end if;
 if r.costs_micros is distinct from parts then raise exception 'Lead cost snapshot mismatch';end if;
 select sum(value::numeric) into total from jsonb_each_text(parts);
 select threshold_cents into threshold from public.icash_seller_cost_settings where id=1;
 return coalesce(l.customer_lead_multiplier,case when l.customer_costs is not null then 3 when total>=threshold*10000 then 2 else 3 end);
end $$;
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_reserve_before_fractional(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 needle:='-- Match JS: round reserve up to a cent after adding buffer.';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Reservation cost gate changed';end if;
 definition:=replace(definition,needle,$new$if r.operation='seller_lead' then
  b.standard_cost_multiplier:=public.icash_seller_lead_rate_multiplier(p_account,p_operation,p_rate)*case when public.icash_vip_active(p_account) then 0.8 else 1 end;
  b.elevenlabs_cost_multiplier:=b.standard_cost_multiplier;
 end if;
 -- Match JS: round reserve up to a cent after adding buffer.$new$);
 execute definition;
end $patch$;

create function public.icash_owner_seller_costs(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare leads jsonb;estimates jsonb;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required';end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.source,r.campaign),'[]'::jsonb) into estimates from (
  select distinct on(source,campaign) source,campaign,cost_micros as "costMicros",note,created_at as "updatedAt"
  from public.icash_seller_cost_records where kind='estimate' order by source,campaign,id desc
 ) r;
 select coalesce(jsonb_agg(to_jsonb(r) order by r."createdAt" desc),'[]'::jsonb) into leads from (
  select l.id,l.address,l.state,l.created_at as "createdAt",coalesce(l.attribution->>'source','other') as source,
  coalesce(l.attribution->>'campaign','') as campaign,public.icash_seller_acquisition_quote(l.id) as acquisition,
  (select sum(value::numeric)::bigint from jsonb_each_text(l.lookup_costs) where key<>'acquisition') as "processingMicros",
  (select coalesce(sum(charge_cents),0) from public.icash_seller_matches where lead_id=l.id) as "collectedCents",
  (select count(*) from public.icash_seller_matches where lead_id=l.id) as recipients,
  l.hold_reason as "holdReason"
  from public.icash_seller_intakes l where l.contact_consent_scope is distinct from 'icash_x_demo'
  and l.canonical_id is null and l.state<>'duplicate' order by l.created_at desc,l.id desc limit 50
 ) r;
 return jsonb_build_object('estimates',estimates,'leads',leads,'thresholdCents',(select threshold_cents from public.icash_seller_cost_settings where id=1));
end $$;

do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_vip_savings(uuid)'::regprocedure);
 needle:=$old$when o.operation='seller_lead' and o.standard_cost_multiplier=2.4
    and o.charged_cents=ceil(ceil(o.actual_micros::numeric*3/10000)*0.8)
    then (ceil(o.actual_micros::numeric*3/10000)-o.charged_cents)*10000$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'VIP lead savings calculation changed';end if;
 definition:=replace(definition,needle,$new$when o.operation='seller_lead' and o.standard_cost_multiplier in (1.6,2.4)
    and o.charged_cents=ceil(ceil(o.actual_micros::numeric*(o.standard_cost_multiplier/0.8)/10000)*0.8)
    then (ceil(o.actual_micros::numeric*(o.standard_cost_multiplier/0.8)/10000)-o.charged_cents)*10000$new$);
 execute definition;
end $patch$;

revoke all on function public.icash_record_seller_acquisition_cost(uuid,uuid,text,uuid,text,text,bigint,text),public.icash_seller_acquisition_quote(uuid),public.icash_owner_seller_costs(uuid) from public,anon,authenticated;
grant execute on function public.icash_record_seller_acquisition_cost(uuid,uuid,text,uuid,text,text,bigint,text),public.icash_seller_acquisition_quote(uuid),public.icash_owner_seller_costs(uuid) to service_role;
revoke all on function public.icash_save_seller_cost_threshold(uuid,bigint) from public,anon,authenticated;
grant execute on function public.icash_save_seller_cost_threshold(uuid,bigint) to service_role;
revoke all on function public.icash_seller_lead_rate_multiplier(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_lead_rate_multiplier(uuid,text,uuid) to service_role;
commit;
