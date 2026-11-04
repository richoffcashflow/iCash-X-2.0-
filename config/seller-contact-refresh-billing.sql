-- One-phone follow-up checks use the existing DealMachine credit allocation,
-- 3x data/VIP policy, customer wallet and prospecting allowance. No legacy
-- owner purchase, rate, reservation or settlement is changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- The narrow operation kind prevents a DNC request masquerading as a second
-- immutable owners:<account>:<screening> purchase. Preserve the current guard
-- bodies and fail migration when their expected policy boundary has changed.
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_reserve_before_fractional(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 needle:=$old$r.operation in ('property_search','owner_enrichment','buyer_discovery')$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'DealMachine reserve policy changed';end if;
 execute replace(d,needle,$new$r.operation in ('property_search','owner_enrichment','buyer_discovery','contact_revalidation')$new$);
 d:=pg_get_functiondef('public.icash_new_prospect_operation(uuid,text,uuid)'::regprocedure);
 needle:=$old$if kind in ('property_search','owner_enrichment') then return true;end if;$old$;
 if strpos(d,needle)=0 then raise exception 'Prospecting classification changed';end if;
 execute replace(d,needle,$new$if kind in ('property_search','owner_enrichment','contact_revalidation') then return true;end if;$new$);
 d:=pg_get_functiondef('public.icash_guard_prospecting_spend()'::regprocedure);
 needle:=$old$elsif kind in ('sms_send','mms_send') and public.icash_research_waiting_on_outreach(new.account_id) then$old$;
 if strpos(d,needle)=0 then raise exception 'Prospecting outreach reserve changed';end if;
 execute replace(d,needle,$new$elsif kind='contact_revalidation' then
  required:=public.icash_research_admission_quote(new.account_id,kind,required);
 $new$||needle);
end $patch$;

-- Caller already owns the exact gap/recipient/source locks. This helper may
-- only prepare a new operation once; the caller rolls back if its provider
-- request claim or any final contact control loses a race.
create function icash_seller_recovery_private.reserve_contact_refresh(
 p_account uuid,p_gap uuid,p_rate_expected uuid,p_unit_expected bigint
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.icash_discovery_configs;r public.icash_operation_rates;
 b public.icash_operating_budget;s public.icash_data_cost_settings;
 costs jsonb;part record;price numeric:=0;quote bigint;rate uuid;v_version text;
 op text:='dnc:'||p_gap;reservation jsonb;stamp timestamptz:=clock_timestamp();
begin
 if p_account is null or p_gap is null or p_rate_expected is null or p_unit_expected is null or p_unit_expected<=0 then return null;end if;
 select * into b from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return null;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
 if not found or not coalesce(public.icash_membership_work_allowed(p_account),false)
  or exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null)
  or exists(select 1 from public.icash_operation_spend where operation_key=op)
  or exists(select 1 from icash_seller_recovery_private.contact_refreshes where gap_id=p_gap) then return null;end if;
 perform 1 from public.icash_seller_gaps where id=p_gap and account_id=p_account
  and reason='no_response' and state='needs_review' and review_reason='contact_checks_expired'
  and outgoing_id is null and stage='draft' for update;
 if not found then return null;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account for share;
 if not found or not c.enabled or not c.auto_enabled or not c.contacts_enabled or c.data_rights_until<=stamp
  or c.contact_rate_id is distinct from p_rate_expected or c.property_credit_micros is distinct from p_unit_expected then return null;end if;
 select * into s from public.icash_data_cost_settings where provider='dealmachine' for share;
 if not found or s.credit_micros is distinct from p_unit_expected then return null;end if;
 select * into r from public.icash_operation_rates where id=c.contact_rate_id for share;
 stamp:=clock_timestamp();
 if not found or c.data_rights_until<=stamp or r.operation<>'owner_enrichment' or not r.enabled or r.verified_at>stamp or r.expires_at<=stamp
  or jsonb_typeof(r.costs_micros->'dealmachine') is distinct from 'number'
  or (r.costs_micros->>'dealmachine')::numeric<p_unit_expected then return null;end if;
 costs:=jsonb_set(r.costs_micros,'{dealmachine}',to_jsonb(p_unit_expected));
 -- Inherit every existing allocation. Only the maximum data units change to
 -- one; the underlying reserve function verifies all 16 categories again.
 for part in select key,value from jsonb_each_text(costs) loop
  price:=price+part.value::numeric*case when part.key='dealmachine' then 3
   when part.key='elevenlabs' then b.elevenlabs_cost_multiplier else b.standard_cost_multiplier end;
 end loop;
 quote:=greatest(1,ceil(price*(10000+r.buffer_bps)/100000000)::bigint);
 if quote>r.charge_cents then return null;end if;
 if public.icash_prospecting_available(p_account)<public.icash_research_admission_quote(p_account,'contact_revalidation',quote) then return null;end if;
 v_version:='dnc-one-credit-v1-'||md5(r.id::text||':'||p_unit_expected||':'||quote);
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled)
 values('contact_revalidation',v_version,quote,costs,r.buffer_bps,
  'One-phone DNC check; inherited allocation from rate '||r.id||'; https://api.docs.dealmachine.com/api-reference/phones/check-dnc',
  r.verified_at,r.expires_at,r.enabled) on conflict(version) do nothing;
 select id into rate from public.icash_operation_rates where icash_operation_rates.version=v_version
  and operation='contact_revalidation' and charge_cents=quote and costs_micros=costs
  and buffer_bps=r.buffer_bps and verified_at=r.verified_at and expires_at=r.expires_at and enabled;
 if rate is null then return null;end if;
 reservation:=public.icash_reserve_operation(p_account,op,rate,least(c.data_rights_until,r.expires_at),null,false);
 if reservation->>'state' is distinct from 'reserved' then raise exception 'New contact-check reservation required';end if;
 return reservation||jsonb_build_object('rateId',rate,'unitCostMicros',p_unit_expected);
end $$;

-- This function never treats a missing/ambiguous response as zero credits.
-- Actual spend uses only the immutable raw response for this exact request;
-- monthly dedup is honored only when the provider reports it.
create function icash_seller_recovery_private.settle_contact_refresh(p_operation text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare f icash_seller_recovery_private.contact_refreshes;o public.icash_operation_spend;
 r public.icash_operation_rates;body jsonb;item jsonb;field text;used integer;people integer;dedup integer;
 source text;phone text;components jsonb:='{}';part record;amount numeric;total numeric:=0;price numeric:=0;charge bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.dealmachine_cost_multiplier is null or o.data_unit_cost_micros is null then return false;end if;
 select * into f from icash_seller_recovery_private.contact_refreshes where operation_key=p_operation and account_id=o.account_id for share;
 if not found or f.rate_id is distinct from o.rate_id or f.unit_cost_micros is distinct from o.data_unit_cost_micros
  or p_operation is distinct from 'dnc:'||f.gap_id or f.request_id is null or f.requested_at is null
  or f.response is null or f.response_at is null or f.response_at<f.requested_at or f.response_at>clock_timestamp() then return false;end if;
 select * into r from public.icash_operation_rates where id=o.rate_id;
 if not found or r.operation<>'contact_revalidation' then return false;end if;
 if o.state='settled' then return true;end if;
 if o.state<>'dispatched' then return false;end if;
 select c.phone into phone from public.icash_operational_contacts c where c.id=f.original_contact_id and c.account_id=f.account_id;
 if phone is null or f.http_status is distinct from 200 then return false;end if;
 body:=f.response;
 foreach field in array array['used','people','deduplicated'] loop
  if jsonb_typeof(body->'credits'->field) is distinct from 'number' or (body->'credits'->>field) !~ '^[01]$' then return false;end if;
 end loop;
 used:=(body->'credits'->>'used')::integer;people:=(body->'credits'->>'people')::integer;dedup:=(body->'credits'->>'deduplicated')::integer;
 if used+dedup<>people or used*o.data_unit_cost_micros>(r.costs_micros->>'dealmachine')::numeric
  or jsonb_typeof(body->'data') is distinct from 'array' then return false;end if;
 if jsonb_array_length(body->'data')<>1 then return false;end if;
 item:=body->'data'->0;
 if public.icash_operational_phone(item->'input'->>'number') is distinct from phone
  or item->'matched' not in ('true'::jsonb,'false'::jsonb) or item->'matched' is null
  or people<>(case when item->'matched'='true'::jsonb then 1 else 0 end)
  or body->'totals'->'submitted' is distinct from '1'::jsonb
  or body->'totals'->'matched' is distinct from to_jsonb(people)
  or body->'totals'->'unmatched' is distinct from to_jsonb(1-people) then return false;end if;
 if not exists(select 1 from icash_research_private.requests req where req.id=f.request_id
  and req.account_id=f.account_id and req.operation_key=f.operation_key and req.kind='phone_dnc'
  and req.admitted and req.created_at<=f.response_at) then return false;end if;
 source:='dealmachine:dnc:'||f.request_id;
 perform public.icash_record_cost_observation('dealmachine',p_operation,source,used,'provider_credits');
 for part in select key,value from jsonb_each_text(r.costs_micros) loop
  amount:=case when part.key='dealmachine' then used*o.data_unit_cost_micros else part.value::numeric end;
  total:=total+amount;
  price:=price+amount*case when part.key='dealmachine' then o.dealmachine_cost_multiplier when part.key='elevenlabs' then o.elevenlabs_cost_multiplier else o.standard_cost_multiplier end;
  components:=components||jsonb_build_object(part.key,jsonb_build_object('amountMicros',amount,'basis','estimated','evidenceRef',
   case when part.key='dealmachine' then 'Observed one-phone DNC credits at saved '||o.data_cost_basis||': '||source else 'Inherited operation allocation: '||r.version end));
 end loop;
 charge:=ceil(price/10000);
 if charge>o.charge_cap_cents or total>o.reserved_micros then return false;end if;
 perform public.icash_settle_complete_costs(p_operation,charge,components,'DealMachine one-phone DNC usage v1: '||p_operation);
 update public.icash_operation_spend set cost_basis='estimated' where operation_key=p_operation;
 return true;
end $$;

-- Maintenance may finish the same saved response after a worker crash. It may
-- never settle an unknown DNC request from the maximum quote.
alter function public.icash_settle_estimated_operation(text) rename to icash_settle_estimate_before_contact_refresh;
create function public.icash_settle_estimated_operation(p_operation text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id
  where o.operation_key=p_operation and r.operation='contact_revalidation') then
  return icash_seller_recovery_private.settle_contact_refresh(p_operation);
 end if;
 return public.icash_settle_estimate_before_contact_refresh(p_operation);
end $$;
revoke all on function icash_seller_recovery_private.reserve_contact_refresh(uuid,uuid,uuid,bigint),
 icash_seller_recovery_private.settle_contact_refresh(text),public.icash_settle_estimate_before_contact_refresh(text)
 from public,anon,authenticated,service_role;
revoke all on function public.icash_settle_estimated_operation(text) from public,anon,authenticated;
grant execute on function public.icash_settle_estimated_operation(text) to service_role;
commit;
