begin;
set local lock_timeout='3s';
-- A direct Meta request stays with its named principal. Never enter the
-- website's shared-lead allocation or create a second screening/deal/thread.
do $$declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure);
 needle:='and (numbers_passed or not exists';
 if position(needle in def)=0 then raise exception 'Seller assignment prerequisite changed';end if;
 execute replace(def,needle,'and contact_consent_scope is distinct from ''meta_direct_principal'' '||needle);
end $$;

create function public.icash_meta_promote_property(p_lead uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;l public.icash_seller_intakes;quote jsonb;parts jsonb;property_snapshot jsonb;manifest jsonb;total bigint;charge bigint;rate uuid;operation text;evidence text;deal uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_meta_leads where lead_id=p_lead for update;
 select * into l from public.icash_seller_intakes where id=p_lead for update;
 if m.lead_id is null then return jsonb_build_object('status','not_meta');end if;
 if exists(select 1 from public.icash_seller_matches where lead_id=l.id and account_id=m.account_id and screening_id=m.screening_id) then return jsonb_build_object('status','property_ready','leadId',l.id);end if;
 if l.state not in ('qualified','numbers_review') or l.property->>'id' is null or l.result->'property'->>'address' is null or l.checked_at<now()-interval '24 hours'
  or l.data_rights_until<=now() or not public.icash_research_state_allowed(l.property->>'state') then return jsonb_build_object('status','research_required');end if;
 if public.icash_seller_contact_evidence(m.account_id,m.screening_id,l.id,l.phone) is null or not public.icash_credit_acquisition_allowed(m.account_id)
  or not exists(select 1 from public.icash_accounts where id=m.account_id and not bot_paused) then return jsonb_build_object('status','account_or_contact_held');end if;
 select id into deal from public.icash_deal_files where account_id=m.account_id and screening_id=m.screening_id and stage='draft' and terms->>'intakeOnly'='true' for update;
 if deal is null then return jsonb_build_object('status','deal_review_required');end if;
 quote:=public.icash_seller_acquisition_quote(l.id);
 if quote is null or l.lookup_costs is null or l.lookup_cost_basis is null then return jsonb_build_object('status','acquisition_cost_required');end if;
 parts:=l.lookup_costs||jsonb_build_object('acquisition',(quote->>'costMicros')::bigint);
 select sum(value::numeric)::bigint into total from jsonb_each_text(parts);
 charge:=ceil(total::numeric*2/10000);if public.icash_vip_active(m.account_id) then charge:=ceil(charge*0.8);end if;
 if coalesce(charge,0)<=0 then return jsonb_build_object('status','cost_required');end if;
 operation:='seller-lead:'||l.id||':'||m.account_id;
 evidence:='meta-direct-acquisition-v1; pricing all-usage-2x-20261018; '||quote::text||'; '||l.lookup_cost_basis;
 property_snapshot:=jsonb_build_object('propertyId',l.property->>'id','propertyType','house','fetchedAt',l.property->>'fetchedAt','raw',l.property->'raw','sellerCostReserveCents',l.property->'sellerCostReserveCents','sellerRequest',jsonb_build_object('id',l.id,'ownerName',l.name,'phone',l.phone,'aiConsented',l.ai_consented,'consentVersion',l.consent_version,'consentText',l.consent_text,'consentScope',l.contact_consent_scope,'shared',false,'maximumBuyers',1));
 begin
  update public.icash_screening_jobs s set snapshot=property_snapshot,result=l.result,state='complete',completed_at=l.checked_at where s.id=m.screening_id and s.account_id=m.account_id and s.state='awaiting_address';
  if not found or not public.icash_claim_inventory(m.account_id,m.screening_id,l.phone) then raise exception 'Property contact allocation held';end if;
  insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled)
  values('seller_lead',operation,charge,parts,0,evidence,now(),least(now()+interval '24 hours',l.data_rights_until),true) returning id into rate;
  perform public.icash_reserve_operation(m.account_id,operation,rate,l.data_rights_until,l.checked_at,l.numbers_passed);
  if not public.icash_claim_operation(operation) then raise exception 'Acquisition admission held';end if;
  select jsonb_object_agg(key,jsonb_build_object('amountMicros',value,'evidenceRef',evidence)) into manifest from jsonb_each(parts);
  perform public.icash_settle_complete_costs(operation,charge,manifest,evidence);
  update public.icash_operation_spend set cost_basis='estimated' where operation_key=operation;
  update public.icash_deal_files set terms=(terms-'intakeOnly')||jsonb_build_object('address',l.property->>'address','state',l.property->>'state'),updated_at=now() where id=deal;
  insert into public.icash_seller_matches(lead_id,account_id,screening_id,operation_key,charge_cents) values(l.id,m.account_id,m.screening_id,operation,charge);
  update public.icash_seller_intakes set state='assigned',operation_key=operation,assigned_at=now(),next_assignment_at='9999-12-31T23:59:59Z',customer_costs=parts,customer_cost_basis=evidence,customer_lead_multiplier=2,hold_reason=null where id=l.id;
  update public.icash_meta_leads set offer_ready_at=case when l.numbers_passed then now() else null end,next_attempt_at=now()+interval '1 minute' where lead_id=l.id;
  return jsonb_build_object('status','property_ready','leadId',l.id,'accountId',m.account_id,'screeningId',m.screening_id,'offerReady',l.numbers_passed);
 exception when others then
  update public.icash_seller_intakes set hold_reason='Property research saved; account or allocation review required before promotion' where id=l.id;
  return jsonb_build_object('status','promotion_held','leadId',l.id);
 end;
end $$;

alter function public.icash_finish_seller_lookup(uuid,uuid,jsonb) rename to icash_finish_seller_lookup_before_meta;
create function public.icash_finish_seller_lookup(p_id uuid,p_token uuid,p_output jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare saved boolean;
begin
 saved:=public.icash_finish_seller_lookup_before_meta(p_id,p_token,p_output);
 if saved and exists(select 1 from public.icash_meta_leads where lead_id=p_id) then perform public.icash_meta_promote_property(p_id);end if;
 return saved;
end $$;

create function public.icash_meta_response_report(p_account uuid) returns jsonb
language sql security invoker set search_path='' as $$
 with cohorts as (
 select m.*,l.ad_cost_micros,l.state,l.property,
 (select q->>'costMicros' from (select public.icash_seller_acquisition_quote(l.id) q) price) acquisition_micros
 from public.icash_meta_leads m join public.icash_seller_intakes l on l.id=m.lead_id
 where (p_account is null or m.account_id=p_account) and m.submitted_at>=now()-interval '30 days'
 ), groups as (
 select form_id,campaign_id,count(*) leads,count(*) filter(where response_at is not null) responses,
 count(*) filter(where address_confirmed_at is not null) addresses,count(*) filter(where offer_ready_at is not null) offers,
 count(*) filter(where submitted_at<=now()-interval '24 hours') mature_leads,
 count(*) filter(where submitted_at<=now()-interval '24 hours' and response_at<=submitted_at+interval '24 hours') responses_24h,
 count(*) filter(where acquisition_micros is null) cost_missing,sum(acquisition_micros::numeric) cost_micros,
 percentile_cont(0.5) within group(order by extract(epoch from(first_outreach_at-submitted_at))) filter(where first_outreach_at is not null) median_response_seconds
 from cohorts group by form_id,campaign_id
 ) select coalesce(jsonb_agg(jsonb_build_object('formId',form_id,'campaignId',campaign_id,'leads',leads,'responses',responses,'addresses',addresses,'offers',offers,
 'matureLeads',mature_leads,'responses24h',responses_24h,'responseRate24h',case when mature_leads>0 then responses_24h::numeric/mature_leads else null end,
 'costPerResponseCents',case when cost_missing=0 and responses>0 then ceil(cost_micros/10000/responses) else null end,
 'costBasis','recorded ad costs or labeled source estimate','missingCostCount',cost_missing,'medianFirstOutreachSeconds',median_response_seconds)), '[]'::jsonb) from groups;
$$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'icash_meta_%'
 loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
revoke all on function public.icash_finish_seller_lookup(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_finish_seller_lookup(uuid,uuid,jsonb) to service_role;
commit;
