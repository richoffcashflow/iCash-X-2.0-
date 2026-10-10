begin;
set local lock_timeout='3s';
select 1 from public.icash_operating_budget where id=1 for update;

-- The same ARV tiers and 70%-after-repairs budget used by cash-offer-math.ts.
-- This is an asking-price check, not a promise of resale profit or closing costs.
create function public.icash_buyer_assignment_pricing(p_price bigint,p_snapshot jsonb,p_fee bigint default null) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare data jsonb;arv numeric;repairs numeric;budget bigint;target bigint;fee bigint;room bigint;
begin
 if p_price is null or p_price not between 1 and 99999000000 then
  return jsonb_build_object('ready',false,'reason','purchase_price_required');end if;
 if p_price%100000<>0 then
  return jsonb_build_object('ready',false,'reason','rounded_purchase_required');end if;
 data:=p_snapshot->'raw'->'data';
 if p_snapshot->>'propertyType' is distinct from 'house'
 or jsonb_typeof(data->'estimated_value') is distinct from 'number'
 or jsonb_typeof(data->'estimated_repair_cost') is distinct from 'number' then
  return jsonb_build_object('ready',false,'reason','research_required');end if;
 arv:=(data->>'estimated_value')::numeric*100;
 repairs:=(data->>'estimated_repair_cost')::numeric*100;
 if arv<=0 or repairs<0 or arv>9007199254740991 or repairs>9007199254740991
 or arv<>trunc(arv) or repairs<>trunc(repairs) then
  return jsonb_build_object('ready',false,'reason','research_required');end if;
 budget:=floor(greatest(arv-repairs,0)*7000/10000)::bigint;
 target:=case when arv>=30000000 then 2000000 else 1000000 end;
 room:=floor((budget-p_price)::numeric/100000)::bigint*100000;
 if room<1000000 then
  return jsonb_build_object('ready',false,'reason','insufficient_margin');end if;
 fee:=coalesce(p_fee,least(target,room));
 if fee not between 1000000 and 100000000000 or fee%100000<>0 then
  return jsonb_build_object('ready',false,'reason','rounded_fee_required');end if;
 if fee>room or p_price+fee>100000000000 then
  return jsonb_build_object('ready',false,'reason','fee_exceeds_buyer_budget');end if;
 return jsonb_build_object('ready',true,'assignmentFeeCents',fee,
  'assignmentDepositCents',least(fee/5,500000),'askingPriceCents',p_price+fee,
  'buyerCeilingCents',budget,'targetFeeCents',target);
end $$;

-- Preserve every existing release, including legacy fractional signed prices.
-- No contracts, packages, messages or deal rows are rewritten by this migration.
alter function public.icash_prepare_disposition_before_deposit(uuid,uuid) rename to icash_prepare_disposition_before_tiers;
create function public.icash_prepare_disposition_before_deposit(p_account uuid,p_deal uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare d public.icash_deal_files;e public.icash_signing_envelopes;s public.icash_screening_jobs;
 a public.icash_disposition_authorities;price bigint;fee bigint;plan jsonb;deadline timestamptz;market_name text;
begin
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if not found or d.stage not in ('under_contract','buyer_selected','title_open','closing') then return false;end if;
 select * into a from public.icash_disposition_authorities where deal_id=d.id and account_id=p_account;
 if found and a.pricing_policy<>'signed_purchase_budgeted_tiers_v3' then
  return public.icash_prepare_disposition_before_tiers(p_account,p_deal);end if;
 select e0.* into e from public.icash_signing_envelopes e0 join public.icash_signing_templates t on t.id=e0.template_id
 where e0.deal_id=d.id and e0.account_id=p_account and e0.kind='purchase' and e0.state='completed' and not e0.test_mode
 and t.template_scope='standard' and t.kind='purchase' and t.provider='docuseal'
 and e0.terms->'priceCents'=d.terms->'priceCents' and e0.terms->'address'=d.terms->'address'
 and e0.terms-array['assignee','assignmentFeeCents','assignmentDepositCents','payoutMethod','payoutHandle']
 =d.terms-array['assignee','assignmentFeeCents','assignmentDepositCents','payoutMethod','payoutHandle']
 order by e0.updated_at desc limit 1;
 if not found or jsonb_typeof(e.terms->'priceCents') is distinct from 'number'
 or (e.terms->>'priceCents')::numeric<>trunc((e.terms->>'priceCents')::numeric) then return false;end if;
 price:=(e.terms->>'priceCents')::bigint;
 if a.deal_id is not null then
  -- Repeated preparation never reprices published terms after research changes.
  return a.purchase_envelope_id=e.id and a.expires_at>now()
   and a.asking_price_cents=price+(d.terms->>'assignmentFeeCents')::bigint;end if;
 if exists(select 1 from public.icash_signing_envelopes where deal_id=d.id and kind='assignment' and not test_mode)
 or exists(select 1 from public.icash_buyer_package_links where deal_id=d.id) then return false;end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account and state='complete';
 if not found or coalesce(d.terms->>'practice','false')='true' then return false;end if;
 plan:=public.icash_buyer_assignment_pricing(price,s.snapshot,(d.terms->>'assignmentFeeCents')::bigint);
 if (plan->>'ready')::boolean is distinct from true then return false;end if;
 fee:=(plan->>'assignmentFeeCents')::bigint;
 market_name:=coalesce(nullif(s.snapshot->'raw'->'data'->>'city',''),nullif(s.snapshot->'raw'->'data'->>'zip',''));
 if market_name is null then return false;end if;
 deadline:=least(e.updated_at+interval '30 days',case when nullif(d.terms->>'closingDate','') is null then e.updated_at+interval '30 days' else ((d.terms->>'closingDate')::date+1)::timestamptz end);
 if deadline<=now() then return false;end if;
 update public.icash_deal_files set terms=jsonb_set(terms,'{assignmentFeeCents}',to_jsonb(fee)) where id=d.id;
 insert into public.icash_disposition_authorities(deal_id,account_id,purchase_envelope_id,market,property_type,asking_price_cents,repairs_cents,marketing_evidence,expires_at,pricing_policy,marketing_scope)
 values(d.id,p_account,e.id,market_name,'house',price+fee,((s.snapshot->'raw'->'data'->>'estimated_repair_cost')::numeric*100)::bigint,
  'Owner pricing policy 2026-10-10: $10000 target below $300000 ARV, $20000 at or above; whole $1000 fees within 70% of (ARV minus repairs). Larger saved fees require the same budget. No contact consent or title clearance asserted.',
  deadline,'signed_purchase_budgeted_tiers_v3','Contract-interest buyer package and eligible buyer outreach');
 return true;
end $$;

-- Owner workspace explanation for an unpublished deal. Never sent to buyers.
create function public.icash_unreleased_buyer_pricing(p_account uuid,p_deal uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.icash_buyer_assignment_pricing((d.terms->>'priceCents')::bigint,s.snapshot,(d.terms->>'assignmentFeeCents')::bigint)
 from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
 where d.id=p_deal and d.account_id=p_account and d.stage in ('under_contract','buyer_selected','title_open','closing')
 and not exists(select 1 from public.icash_disposition_authorities where deal_id=d.id and account_id=p_account)
$$;
revoke all on function public.icash_buyer_assignment_pricing(bigint,jsonb,bigint),public.icash_unreleased_buyer_pricing(uuid,uuid),public.icash_prepare_disposition_before_deposit(uuid,uuid),public.icash_prepare_disposition_before_tiers(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_buyer_assignment_pricing(bigint,jsonb,bigint),public.icash_unreleased_buyer_pricing(uuid,uuid),public.icash_prepare_disposition_before_deposit(uuid,uuid),public.icash_prepare_disposition_before_tiers(uuid,uuid) to service_role;
commit;
