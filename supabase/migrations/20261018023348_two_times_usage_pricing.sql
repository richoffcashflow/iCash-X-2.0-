-- Owner instruction 2026-10-17 (America/Chicago): 2x for all future usage.
-- Preserve completed charges, reservations and frozen lead prices. VIP retains 20% off.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Admission and policy rotation commit atomically. Never terminate an active call.
select 1 from public.icash_operating_budget where id=1 for update;

do $usage_reserve_before_fractional$
declare body text;
begin
 select pg_get_functiondef('public.icash_reserve_before_fractional'::regproc) into body;
 if (length(body)-length(replace(body,'b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=b.standard_cost_multiplier;','')))/length('b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=b.standard_cost_multiplier;')<>1 then raise exception 'Unexpected icash_reserve_before_fractional pricing definition';end if;
 body:=replace(body,'b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=b.standard_cost_multiplier;','b.standard_cost_multiplier:=b.standard_cost_multiplier*0.8;b.elevenlabs_cost_multiplier:=b.elevenlabs_cost_multiplier*0.8;');
 execute body;
end $usage_reserve_before_fractional$;

do $usage_reserve_flexible_voice$
declare body text;
begin
 select pg_get_functiondef('public.icash_reserve_flexible_voice'::regproc) into body;
 if (length(body)-length(replace(body,'b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;','')))/length('b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;')<>1 then raise exception 'Unexpected icash_reserve_flexible_voice pricing definition';end if;
 body:=replace(body,'b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;','b.standard_cost_multiplier:=b.standard_cost_multiplier*0.8;b.elevenlabs_cost_multiplier:=b.elevenlabs_cost_multiplier*0.8;');
 execute body;
end $usage_reserve_flexible_voice$;

do $usage_reserve_flexible_reception$
declare body text;
begin
 select pg_get_functiondef('public.icash_reserve_flexible_reception'::regproc) into body;
 if (length(body)-length(replace(body,'b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;','')))/length('b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;')<>1 then raise exception 'Unexpected icash_reserve_flexible_reception pricing definition';end if;
 body:=replace(body,'b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;','b.standard_cost_multiplier:=b.standard_cost_multiplier*0.8;b.elevenlabs_cost_multiplier:=b.elevenlabs_cost_multiplier*0.8;');
 execute body;
end $usage_reserve_flexible_reception$;

do $usage_reserve_direct_reception$
declare body text;
begin
 select pg_get_functiondef('public.icash_reserve_direct_reception'::regproc) into body;
 if (length(body)-length(replace(body,'b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;','')))/length('b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;')<>1 then raise exception 'Unexpected icash_reserve_direct_reception pricing definition';end if;
 body:=replace(body,'b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;','b.standard_cost_multiplier:=b.standard_cost_multiplier*0.8;b.elevenlabs_cost_multiplier:=b.elevenlabs_cost_multiplier*0.8;');
 execute body;
end $usage_reserve_direct_reception$;

do $usage_reserve_cancellation_voice$
declare body text;
begin
 select pg_get_functiondef('public.icash_reserve_cancellation_voice'::regproc) into body;
 if (length(body)-length(replace(body,'b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;','')))/length('b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;')<>1 then raise exception 'Unexpected icash_reserve_cancellation_voice pricing definition';end if;
 body:=replace(body,'b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;','b.standard_cost_multiplier:=b.standard_cost_multiplier*0.8;b.elevenlabs_cost_multiplier:=b.elevenlabs_cost_multiplier*0.8;');
 execute body;
end $usage_reserve_cancellation_voice$;

do $usage_reserve_question$
declare body text;
begin
 select pg_get_functiondef('public.icash_reserve_question'::regproc) into body;
 if (length(body)-length(replace(body,'then 2.4 else 3 end','')))/length('then 2.4 else 3 end')<>1 then raise exception 'Unexpected icash_reserve_question pricing definition';end if;
 body:=replace(body,'then 2.4 else 3 end','then 1.6 else 2 end');
 execute body;
end $usage_reserve_question$;

do $usage_assign_seller_lead_for$
declare body text;
begin
 select pg_get_functiondef('public.icash_assign_seller_lead_for'::regproc) into body;
 if (length(body)-length(replace(body,'case when l.customer_costs is not null then 3 when total>=threshold_cents*10000 then 2 else 3 end','')))/length('case when l.customer_costs is not null then 3 when total>=threshold_cents*10000 then 2 else 3 end')<>2 then raise exception 'Unexpected icash_assign_seller_lead_for pricing definition';end if;
 body:=replace(body,'case when l.customer_costs is not null then 3 when total>=threshold_cents*10000 then 2 else 3 end','case when l.customer_costs is not null then 3 else 2 end');
 if (length(body)-length(replace(body,'''thresholdCents'',threshold_cents','')))/length('''thresholdCents'',threshold_cents')<>1 then raise exception 'Unexpected icash_assign_seller_lead_for pricing definition';end if;
 body:=replace(body,'''thresholdCents'',threshold_cents','''pricingPolicy'',''all-usage-2x-20261018''');
 execute body;
end $usage_assign_seller_lead_for$;

do $usage_seller_lead_rate_multiplier$
declare body text;
begin
 select pg_get_functiondef('public.icash_seller_lead_rate_multiplier'::regproc) into body;
 if (length(body)-length(replace(body,'case when l.customer_costs is not null then 3 when total>=threshold*10000 then 2 else 3 end','')))/length('case when l.customer_costs is not null then 3 when total>=threshold*10000 then 2 else 3 end')<>1 then raise exception 'Unexpected icash_seller_lead_rate_multiplier pricing definition';end if;
 body:=replace(body,'case when l.customer_costs is not null then 3 when total>=threshold*10000 then 2 else 3 end','case when l.customer_costs is not null then 3 else 2 end');
 execute body;
end $usage_seller_lead_rate_multiplier$;

do $usage_begin_customer_phone_call$
declare body text;
begin
 select pg_get_functiondef('public.icash_begin_customer_phone_call'::regproc) into body;
 if (length(body)-length(replace(body,'hold:=ceil(total::numeric*3*1.2/10000);','')))/length('hold:=ceil(total::numeric*3*1.2/10000);')<>1 then raise exception 'Unexpected icash_begin_customer_phone_call pricing definition';end if;
 body:=replace(body,'hold:=ceil(total::numeric*3*1.2/10000);','hold:=ceil(total::numeric*2*1.2/10000);');
 if (length(body)-length(replace(body,'standard_cost_multiplier=3 and elevenlabs_cost_multiplier=3','')))/length('standard_cost_multiplier=3 and elevenlabs_cost_multiplier=3')<>1 then raise exception 'Unexpected icash_begin_customer_phone_call pricing definition';end if;
 body:=replace(body,'standard_cost_multiplier=3 and elevenlabs_cost_multiplier=3','standard_cost_multiplier=2 and elevenlabs_cost_multiplier=2');
 if (length(body)-length(replace(body,'''3x calling pricing required''','')))/length('''3x calling pricing required''')<>1 then raise exception 'Unexpected icash_begin_customer_phone_call pricing definition';end if;
 body:=replace(body,'''3x calling pricing required''','''2x calling pricing required''');
 if (length(body)-length(replace(body,'then ''customer-phone-recorded-v1:'' else ''customer-phone-3x-v1:''','')))/length('then ''customer-phone-recorded-v1:'' else ''customer-phone-3x-v1:''')<>1 then raise exception 'Unexpected icash_begin_customer_phone_call pricing definition';end if;
 body:=replace(body,'then ''customer-phone-recorded-v1:'' else ''customer-phone-3x-v1:''','then ''customer-phone-recorded-2x-v1:'' else ''customer-phone-2x-v1:''');
 execute body;
end $usage_begin_customer_phone_call$;

do $usage_settle_customer_phone_call$
declare body text;
begin
 select pg_get_functiondef('public.icash_settle_customer_phone_call'::regproc) into body;
 if (length(body)-length(replace(body,'ceil(sum(value::text::numeric)*3/10000)','')))/length('ceil(sum(value::text::numeric)*3/10000)')<>1 then raise exception 'Unexpected icash_settle_customer_phone_call pricing definition';end if;
 body:=replace(body,'ceil(sum(value::text::numeric)*3/10000)','ceil(sum(value::text::numeric)*case when r.version like ''customer-phone-2x-v1:%'' or r.version like ''customer-phone-recorded-2x-v1:%'' then o.standard_cost_multiplier else 3 end/10000)');
 execute body;
end $usage_settle_customer_phone_call$;

do $usage_automatic_components$
declare body text;
begin
 select pg_get_functiondef('icash_recorded_reception_private.automatic_components'::regproc) into body;
 if (length(body)-length(replace(body,'or (row((p->>''standard_cost_multiplier'')::numeric,(p->>''elevenlabs_cost_multiplier'')::numeric) is not distinct from row(3::numeric,3::numeric)
    and row(r.standard_cost_multiplier,r.elevenlabs_cost_multiplier) is not distinct from row(2.4::numeric,2.4::numeric))','')))/length('or (row((p->>''standard_cost_multiplier'')::numeric,(p->>''elevenlabs_cost_multiplier'')::numeric) is not distinct from row(3::numeric,3::numeric)
    and row(r.standard_cost_multiplier,r.elevenlabs_cost_multiplier) is not distinct from row(2.4::numeric,2.4::numeric))')<>1 then raise exception 'Unexpected automatic_components pricing definition';end if;
 body:=replace(body,'or (row((p->>''standard_cost_multiplier'')::numeric,(p->>''elevenlabs_cost_multiplier'')::numeric) is not distinct from row(3::numeric,3::numeric)
    and row(r.standard_cost_multiplier,r.elevenlabs_cost_multiplier) is not distinct from row(2.4::numeric,2.4::numeric))','or row(r.standard_cost_multiplier,r.elevenlabs_cost_multiplier) is not distinct from row((p->>''standard_cost_multiplier'')::numeric*0.8,(p->>''elevenlabs_cost_multiplier'')::numeric*0.8)');
 execute body;
end $usage_automatic_components$;

do $usage_reserve_recorded_reception$
declare body text;
begin
 select pg_get_functiondef('public.icash_reserve_recorded_reception'::regproc) into body;
 if (length(body)-length(replace(body,' if c.approved_at>t','')))/length(' if c.approved_at>t')<>1 then raise exception 'Unexpected icash_reserve_recorded_reception pricing definition';end if;
 body:=replace(body,' if c.approved_at>t',' if public.icash_vip_active(c.account_id) then b.standard_cost_multiplier:=b.standard_cost_multiplier*0.8;b.elevenlabs_cost_multiplier:=b.elevenlabs_cost_multiplier*0.8;end if;
 if c.approved_at>t');
 if (length(body)-length(replace(body,'row(p.standard_cost_multiplier,p.elevenlabs_cost_multiplier))','')))/length('row(p.standard_cost_multiplier,p.elevenlabs_cost_multiplier))')<>1 then raise exception 'Unexpected icash_reserve_recorded_reception pricing definition';end if;
 body:=replace(body,'row(p.standard_cost_multiplier,p.elevenlabs_cost_multiplier))','row(b.standard_cost_multiplier,b.elevenlabs_cost_multiplier))');
 execute body;
end $usage_reserve_recorded_reception$;

do $usage_vip_savings$
declare body text;
begin
 select pg_get_functiondef('public.icash_vip_savings'::regproc) into body;
 if (length(body)-length(replace(body,'o.standard_cost_multiplier=2.4 and o.elevenlabs_cost_multiplier=2.4','')))/length('o.standard_cost_multiplier=2.4 and o.elevenlabs_cost_multiplier=2.4')<>1 then raise exception 'Unexpected icash_vip_savings pricing definition';end if;
 body:=replace(body,'o.standard_cost_multiplier=2.4 and o.elevenlabs_cost_multiplier=2.4','o.standard_cost_multiplier in (1.6,2.4) and o.elevenlabs_cost_multiplier=o.standard_cost_multiplier');
 if (length(body)-length(replace(body,'o.actual_micros::numeric*2.4','')))/length('o.actual_micros::numeric*2.4')<>2 then raise exception 'Unexpected icash_vip_savings pricing definition';end if;
 body:=replace(body,'o.actual_micros::numeric*2.4','o.actual_micros::numeric*o.standard_cost_multiplier');
 if (length(body)-length(replace(body,'o.actual_micros::numeric*3','')))/length('o.actual_micros::numeric*3')<>2 then raise exception 'Unexpected icash_vip_savings pricing definition';end if;
 body:=replace(body,'o.actual_micros::numeric*3','o.actual_micros::numeric*(o.standard_cost_multiplier/0.8)');
 if (length(body)-length(replace(body,'case when o.standard_cost_multiplier=2.4','')))/length('case when o.standard_cost_multiplier=2.4')<>1 then raise exception 'Unexpected icash_vip_savings pricing definition';end if;
 body:=replace(body,'case when o.standard_cost_multiplier=2.4','case when o.standard_cost_multiplier in (1.6,2.4)');
 if (length(body)-length(replace(body,'q.cost_micros::numeric*3','')))/length('q.cost_micros::numeric*3')<>1 then raise exception 'Unexpected icash_vip_savings pricing definition';end if;
 body:=replace(body,'q.cost_micros::numeric*3','q.cost_micros::numeric*(q.multiplier/0.8)');
 if (length(body)-length(replace(body,'q.multiplier=2.4','')))/length('q.multiplier=2.4')<>1 then raise exception 'Unexpected icash_vip_savings pricing definition';end if;
 body:=replace(body,'q.multiplier=2.4','q.multiplier in (1.6,2.4)');
 if (length(body)-length(replace(body,'q.cost_micros::numeric*2.4','')))/length('q.cost_micros::numeric*2.4')<>1 then raise exception 'Unexpected icash_vip_savings pricing definition';end if;
 body:=replace(body,'q.cost_micros::numeric*2.4','q.cost_micros::numeric*q.multiplier');
 execute body;
end $usage_vip_savings$;

do $usage_outbound_search_due$
declare body text;
begin
 select pg_get_functiondef('public.icash_outbound_search_due'::regproc) into body;
 if (length(body)-length(replace(body,'ceil((select sum(value::numeric) from jsonb_each_text(coalesce(l.customer_costs,l.lookup_costs)))*3/10000)','')))/length('ceil((select sum(value::numeric) from jsonb_each_text(coalesce(l.customer_costs,l.lookup_costs)))*3/10000)')<>1 then raise exception 'Unexpected icash_outbound_search_due pricing definition';end if;
 body:=replace(body,'ceil((select sum(value::numeric) from jsonb_each_text(coalesce(l.customer_costs,l.lookup_costs)))*3/10000)','ceil(ceil((select sum(value::numeric) from jsonb_each_text(coalesce(l.customer_costs,case when public.icash_seller_acquisition_quote(l.id) is not null then l.lookup_costs||jsonb_build_object(''acquisition'',(public.icash_seller_acquisition_quote(l.id)->>''costMicros'')::bigint) end)))*coalesce(l.customer_lead_multiplier,case when l.customer_costs is not null then 3 else 2 end)/10000)*case when public.icash_vip_active(p_account) then 0.8 else 1 end)');
 execute body;
end $usage_outbound_search_due$;

do $usage_seller_sms_permission_current$
declare body text;
begin
 select pg_get_functiondef('public.icash_seller_sms_permission_current'::regproc) into body;
 if (length(body)-length(replace(body,'price is distinct from t.seller_sms_price_micros','')))/length('price is distinct from t.seller_sms_price_micros')<>1 then raise exception 'Unexpected icash_seller_sms_permission_current pricing definition';end if;
 body:=replace(body,'price is distinct from t.seller_sms_price_micros','price is null or t.seller_sms_price_micros is null or price>t.seller_sms_price_micros');
 execute body;
end $usage_seller_sms_permission_current$;

do $usage_seller_sms_permission_manual$
declare body text;
begin
 select pg_get_functiondef('public.icash_seller_sms_permission_manual'::regproc) into body;
 if (length(body)-length(replace(body,'price is distinct from t.seller_sms_price_micros','')))/length('price is distinct from t.seller_sms_price_micros')<>1 then raise exception 'Unexpected icash_seller_sms_permission_manual pricing definition';end if;
 body:=replace(body,'price is distinct from t.seller_sms_price_micros','price is null or t.seller_sms_price_micros is null or price>t.seller_sms_price_micros');
 execute body;
end $usage_seller_sms_permission_manual$;

do $usage_sms_review_before_owner_buyer_test$
declare body text;
begin
 select pg_get_functiondef('public.icash_sms_review_before_owner_buyer_test'::regproc) into body;
 if (length(body)-length(replace(body,'price is distinct from t.operational_sms_price_micros','')))/length('price is distinct from t.operational_sms_price_micros')<>1 then raise exception 'Unexpected icash_sms_review_before_owner_buyer_test pricing definition';end if;
 body:=replace(body,'price is distinct from t.operational_sms_price_micros','price is null or t.operational_sms_price_micros is null or price>t.operational_sms_price_micros');
 execute body;
end $usage_sms_review_before_owner_buyer_test$;

do $usage_sms_thread_review_before_operational$
declare body text;
begin
 select pg_get_functiondef('public.icash_sms_thread_review_before_operational'::regproc) into body;
 if (length(body)-length(replace(body,'price.customer_micros::text=req.verification->>''smsPriceMicros''','')))/length('price.customer_micros::text=req.verification->>''smsPriceMicros''')<>1 then raise exception 'Unexpected icash_sms_thread_review_before_operational pricing definition';end if;
 body:=replace(body,'price.customer_micros::text=req.verification->>''smsPriceMicros''','case when req.verification->>''smsPriceMicros'' ~ ''^[0-9]{1,15}$'' then price.customer_micros<=(req.verification->>''smsPriceMicros'')::bigint else false end');
 execute body;
end $usage_sms_thread_review_before_operational$;

-- Existing question receipts may contain the prior multipliers.
alter table public.icash_question_usage drop constraint icash_question_usage_multiplier_check;
alter table public.icash_question_usage add constraint icash_question_usage_multiplier_check check(multiplier in (3,2.4,2,1.6));

-- Price reductions fit within existing SMS approvals. Keep their original
-- review evidence, rate hashes, consent dates and message price snapshots.
do $usage_sms_price$
declare costs numeric;
begin
 select max((select sum(value::numeric) from jsonb_each_text(r.costs_micros))) into costs
 from public.icash_operation_rates r where r.enabled and r.expires_at>now() and r.operation='sms_send';
 if costs is distinct from 10000::numeric or exists(select 1 from public.icash_operation_rates where enabled and expires_at>now() and operation='sms_send' and (flat_customer_price_cents is not null or buffer_bps<>0)) then raise exception 'Reviewed SMS cost changed; review 2x transport price';end if;
 update public.icash_communication_prices set customer_micros=20000,source='Owner instruction 2026-10-17: 2x reviewed USD 0.01 SMS transport cost; AI billed separately from actual tokens',updated_at=now() where operation='sms_segment';
 if not found then raise exception 'SMS transport price required';end if;
end $usage_sms_price$;

-- Immutable inbound approvals get a new version with the same provider,
-- rates, permissions and review expiry. Historical sessions retain old evidence.
do $usage_inbound_policy$
declare old_config icash_recorded_reception_private.configs;new_config icash_recorded_reception_private.configs;
 old_policy icash_recorded_reception_private.cost_policies;new_policy icash_recorded_reception_private.cost_policies;next_version integer;
 authority constant text:='Owner instruction 2026-10-17: 2x cost for new usage, with existing 20% VIP discount; existing calling authorization unchanged.';
begin
 perform 1 from icash_reception_private.config where id=1 for update;
 if exists(select 1 from icash_recorded_reception_private.sessions where call_ended_at is null) then raise exception 'Wait for active inbound calls to finish before rotating pricing';end if;
 for old_config in select * from icash_recorded_reception_private.configs where enabled and call_profile='normal' for update loop
  select * into strict old_policy from icash_recorded_reception_private.cost_policies where id=old_config.cost_policy_id and enabled for share;
  if old_policy.standard_cost_multiplier=2 and old_policy.elevenlabs_cost_multiplier=2 then continue;end if;
  new_policy:=jsonb_populate_record(null::icash_recorded_reception_private.cost_policies,to_jsonb(old_policy)||jsonb_build_object('id',gen_random_uuid(),'version',old_policy.version||':2x-20261018','standard_cost_multiplier',2,'elevenlabs_cost_multiplier',2,'approved_at',now(),'approval_reference',authority,'created_at',now()));
  insert into icash_recorded_reception_private.cost_policies select (new_policy).*;
  select max(version)+1 into next_version from icash_recorded_reception_private.configs where account_id=old_config.account_id and called_number=old_config.called_number;
  new_config:=jsonb_populate_record(null::icash_recorded_reception_private.configs,to_jsonb(old_config)||jsonb_build_object('id',gen_random_uuid(),'version',next_version,'cost_policy_id',new_policy.id,'cost_policy_snapshot',to_jsonb(new_policy)-'enabled','approved_at',now(),'approval_reference',authority,'created_at',now()));
  update icash_recorded_reception_private.configs set enabled=false where id=old_config.id;
  insert into icash_recorded_reception_private.configs select (new_config).*;
 end loop;
end $usage_inbound_policy$;

update public.icash_operating_budget set standard_cost_multiplier=2,elevenlabs_cost_multiplier=2 where id=1;
commit;

