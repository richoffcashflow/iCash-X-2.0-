-- Synthetic schema only; no production account or provider data.
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end$$;
create schema icash_reliability_private;grant usage on schema icash_reliability_private to service_role;
create table public.icash_accounts(
id uuid,
owner_user_id uuid,
assistant_name text,
legal_name text,
identity_verified_at timestamp with time zone,
bot_paused boolean,
daily_limit_cents bigint,
created_at timestamp with time zone,
billing_model text,
contact_phone text,
workspace_ack_version text,
workspace_ack_user_id uuid,
workspace_ack_hash text
);
create table public.icash_billing_reviews(
event_id text,
payment_id text,
reason text,
account_id uuid,
resolved_at timestamp with time zone,
created_at timestamp with time zone
);
create table public.icash_buyer_search_receipts(
deal_id uuid,
revision uuid,
page integer,
operation_key text,
has_next_page boolean,
receipt jsonb,
created_at timestamp with time zone
);
create table public.icash_control_events(
id uuid,
account_id uuid,
actor_user_id uuid,
action text,
property_id text,
created_at timestamp with time zone
);
create table public.icash_cost_manifests(
operation_key text,
charge_cents bigint,
actual_micros bigint,
components jsonb,
evidence_ref text,
created_at timestamp with time zone
);
create table public.icash_cost_observations(
provider text,
event_key text,
source_ref text,
amount numeric,
units text,
reconciled boolean,
observed_at timestamp with time zone
);
create table public.icash_credit_ledger(
id uuid,
account_id uuid,
event_key text,
kind text,
delta_cents bigint,
evidence_ref text,
created_at timestamp with time zone
);
create table public.icash_deal_files(
id uuid,
account_id uuid,
screening_id uuid,
terms jsonb,
stage text,
seller_signed_at timestamp with time zone,
assignment_signed_at timestamp with time zone,
title_verified_at timestamp with time zone,
funded_at timestamp with time zone,
created_at timestamp with time zone,
updated_at timestamp with time zone
);
create table public.icash_discovery_configs(
account_id uuid,
enabled boolean,
zip text,
rate_id uuid,
property_credit_micros bigint,
data_rights_until timestamp with time zone,
assignment_fee_cents bigint,
seller_cost_reserve_cents bigint,
per_page integer,
next_page integer,
revision uuid,
exhausted boolean,
auto_enabled boolean,
next_run_at timestamp with time zone,
interval_seconds integer,
contacts_enabled boolean,
contact_rate_id uuid,
contact_credit_cap integer,
max_open_prospects integer,
inventory_refreshed_at timestamp with time zone,
research_version integer,
research_list_id text
);
create table public.icash_discovery_results(
operation_key text,
account_id uuid,
result jsonb,
created_at timestamp with time zone
);
create table public.icash_funding_orders(
id uuid,
mode text,
guest_hash text,
account_id uuid,
pack_code text,
price_cents bigint,
credit_cents bigint,
currency text,
state text,
stripe_session_id text,
stripe_payment_id text,
payer_email text,
payer_phone text,
paid_at timestamp with time zone,
credited_at timestamp with time zone,
created_at timestamp with time zone,
run_days integer,
pacing_applied_at timestamp with time zone,
flexible_pacing boolean,
processing_fee_cents bigint,
tax_required boolean,
tax_cents bigint,
charged_total_cents bigint,
daily_plan_id uuid,
stripe_invoice_id text,
billing_period_start timestamp with time zone,
prepaid_applied_at timestamp with time zone,
auto_recharge boolean
);
create table public.icash_inventory_markets(
account_id uuid,
zip text,
priority integer,
eligible_until timestamp with time zone,
next_scan_at timestamp with time zone
);
create table public.icash_operation_rates(
id uuid,
operation text,
version text,
charge_cents bigint,
costs_micros jsonb,
buffer_bps integer,
evidence_ref text,
verified_at timestamp with time zone,
expires_at timestamp with time zone,
enabled boolean,
voice_max_duration_seconds integer,
flat_customer_price_cents bigint
);
create table public.icash_operation_spend(
operation_key text,
account_id uuid,
rate_id uuid,
credit_reservation_id uuid,
charge_cap_cents bigint,
reserved_micros bigint,
state text,
permission_until timestamp with time zone,
financial_checked_at timestamp with time zone,
actual_micros bigint,
charged_cents bigint,
settlement_evidence text,
created_at timestamp with time zone,
dispatched_at timestamp with time zone,
settled_at timestamp with time zone,
customer_price_micros bigint,
standard_cost_multiplier numeric,
elevenlabs_cost_multiplier numeric,
required_revenue_micros numeric,
cost_basis text,
estimate_checked_at timestamp with time zone,
dealmachine_cost_multiplier numeric,
data_unit_cost_micros bigint,
data_cost_basis text,
prospecting_budget_id bigint
);
create table public.icash_owner_contacts(
screening_id uuid,
account_id uuid,
operation_key text,
result jsonb,
created_at timestamp with time zone
);
create table public.icash_screening_jobs(
id uuid,
account_id uuid,
event_key text,
snapshot jsonb,
due_at timestamp with time zone,
state text,
attempts integer,
lease_token uuid,
lease_until timestamp with time zone,
result jsonb,
error_code text,
created_at timestamp with time zone,
completed_at timestamp with time zone
);
create table public.icash_support_cancel_requests(
id uuid,
account_id uuid,
user_id uuid,
mode text,
source text,
provider_email_id uuid,
state text,
nonce_hash text,
expires_at timestamp with time zone,
consumed_at timestamp with time zone,
confirmed_at timestamp with time zone,
result text,
created_at timestamp with time zone,
updated_at timestamp with time zone,
receipt_state text,
receipt_recipient text,
receipt_claimed_at timestamp with time zone,
receipt_completed_at timestamp with time zone,
receipt_provider_id uuid
);
create table public.icash_usage_coverage(
operation_key text,
account_id uuid,
gross_cents bigint,
customer_cents bigint,
covered_cents bigint,
evidence_ref text,
created_at timestamp with time zone
);
create table public.icash_wallets(
account_id uuid,
balance_cents bigint,
reserved_cents bigint,
currency text
);
alter table icash_accounts add primary key(id);
alter table icash_operation_spend add primary key(operation_key);
alter table icash_discovery_configs add primary key(account_id);
alter table icash_credit_ledger add unique(event_key);
alter table icash_credit_ledger alter column id set default gen_random_uuid();
alter table icash_credit_ledger alter column created_at set default now();
create table icash_operating_budget(id integer primary key,enabled boolean,standard_cost_multiplier numeric);
insert into icash_operating_budget values(1,true,2);
create table icash_automation_tickets(account_id uuid,kind text,state text,created_at timestamptz,expires_at timestamptz);
create table icash_text_messages(id uuid,account_id uuid,provider_id text,state text);
create table icash_text_ai_jobs(id uuid,account_id uuid,provider_id text,usage jsonb,state text);
create table icash_deal_emails(id uuid,account_id uuid,provider_id text,state text);
create table icash_title_requests(id uuid,account_id uuid,provider_id text,state text);
create table icash_title_tasks(id uuid,account_id uuid,email_provider_id text,email_state text);
create table icash_title_qualification_jobs(id uuid,account_id uuid,provider_id text,state text);
create table icash_signing_envelopes(id uuid,account_id uuid,provider_id text,test_mode boolean,state text);
create table icash_live_conversations(operation_key text,account_id uuid,state text,completed_at timestamptz);
create function icash_membership_work_allowed(uuid) returns boolean language sql stable set search_path=public as $$select true$$;
create function icash_prospecting_available(uuid) returns bigint language sql stable set search_path=public as $$select greatest(0,w.balance_cents-coalesce((select sum(charge_cap_cents) from icash_operation_spend where account_id=$1 and state in ('reserved','dispatched')),0))::bigint from icash_wallets w where account_id=$1$$;
create function icash_research_admission_quote(uuid,text,bigint) returns bigint language sql stable set search_path=public as $$select $3$$;
create function icash_settle_complete_costs(p_operation text,p_charge bigint,p_components jsonb,p_evidence text) returns void language plpgsql set search_path=public as $$declare a uuid;begin
 select account_id into a from icash_operation_spend where operation_key=p_operation;
 insert into icash_cost_manifests(operation_key,components) values(p_operation,p_components);
 update icash_operation_spend set state='settled',actual_micros=(select sum((value->>'amountMicros')::bigint) from jsonb_each(p_components)),charged_cents=p_charge,settlement_evidence=p_evidence,settled_at=now() where operation_key=p_operation;
 insert into icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref) values(a,'usage:'||p_operation,'usage',-p_charge,p_evidence);
 update icash_wallets set balance_cents=balance_cents-p_charge where account_id=a;
 if not icash_account_margin_ok(a,0,0,false) then update icash_accounts set bot_paused=true where id=a;end if;
end$$;
create schema icash_research_private;
create table icash_research_private.account_rates(account_id uuid primary key,base_rate uuid);
create table icash_research_private.rate_versions(base_rate uuid,unit_micros bigint,batch_rate uuid);
create table icash_research_private.stalled_searches(operation_key text primary key,account_id uuid,request_id uuid,zip text,configuration jsonb);
create schema icash_owner_review_private;
create table icash_owner_review_private.changes(kind text,record_key text,before_row jsonb,after_row jsonb,authority text,recorded_at timestamptz default now(),primary key(kind,record_key));
create function public.icash_prospecting_progress(p_account uuid) returns jsonb language plpgsql stable set search_path='' as $$declare b record;begin select 1 id into b;return jsonb_build_object('budgetId',b.id,'status','ready');end$$;
CREATE OR REPLACE FUNCTION public.icash_account_margin_ok(p_account uuid, p_charge bigint, p_cost bigint, p_pending boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select p_charge>=0 and p_cost>=0 and
 coalesce(sum(case when o.state='settled' then o.actual_micros::numeric*o.standard_cost_multiplier-coalesce((m.components->'elevenlabs'->>'amountMicros')::numeric,0)*(o.standard_cost_multiplier-o.elevenlabs_cost_multiplier)+coalesce((m.components->'dealmachine'->>'amountMicros')::numeric*(o.dealmachine_cost_multiplier-o.standard_cost_multiplier),0)
 when p_pending and o.state in ('reserved','dispatched') then coalesce(o.required_revenue_micros,o.reserved_micros*o.standard_cost_multiplier) else 0 end),0)
 +p_cost*(select standard_cost_multiplier from public.icash_operating_budget where id=1)
 <=coalesce(sum(case when o.state='settled' then coalesce(o.customer_price_micros,o.charged_cents*10000)
 when p_pending and o.state in ('reserved','dispatched') then coalesce(o.customer_price_micros,o.charge_cap_cents*10000) else 0 end),0)+p_charge*10000::numeric
 from public.icash_operation_spend o left join public.icash_cost_manifests m on m.operation_key=o.operation_key where o.account_id=p_account
$function$;

CREATE OR REPLACE FUNCTION public.icash_settle_estimate_before_sms_tokens(p_operation text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o public.icash_operation_spend;r public.icash_operation_rates;parts jsonb;proof boolean;charge bigint;total numeric;required numeric;evidence text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found then return false;end if;
 if o.state='settled' then return true;end if;
 if o.state<>'dispatched' then return false;end if;
 select * into strict r from public.icash_operation_rates where id=o.rate_id;
 -- A full-call quote is a reservation ceiling, never completed-call usage.
 if r.operation in ('seller_call','buyer_call','incoming_call') then return false;end if;
 proof:=exists(select 1 from public.icash_discovery_results where operation_key=o.operation_key and account_id=o.account_id)
 or exists(select 1 from public.icash_owner_contacts where operation_key=o.operation_key and account_id=o.account_id)
 or exists(select 1 from public.icash_buyer_search_receipts b join public.icash_deal_files d on d.id=b.deal_id where b.operation_key=o.operation_key and d.account_id=o.account_id)
 or exists(select 1 from public.icash_text_messages where 'text:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and state in ('accepted','delivered'))
 or exists(select 1 from public.icash_text_ai_jobs where 'sms-ai:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and usage is not null and state in ('drafted','queued','handoff','superseded'))
 or exists(select 1 from public.icash_deal_emails where 'deal-email:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and state='accepted')
 or exists(select 1 from public.icash_title_requests where 'title:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and state='sent')
 or exists(select 1 from public.icash_title_tasks where 'title-followup:'||id=o.operation_key and account_id=o.account_id and email_provider_id is not null and email_state='sent')
 or exists(select 1 from public.icash_title_qualification_jobs where 'title-qualify:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and state='sent')
 or exists(select 1 from public.icash_signing_envelopes where 'signing:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and not test_mode and state in ('awaiting_counterparty','customer_signature_needed','completed'))
 or exists(select 1 from public.icash_live_conversations where operation_key=o.operation_key and account_id=o.account_id and state='complete' and completed_at is not null);
 if not proof then return false;end if;
 evidence:='ESTIMATE: configured rate '||r.version||'; provider invoice costs not verified';
 select jsonb_object_agg(key,jsonb_build_object('amountMicros',value,'evidenceRef',evidence)),sum(value::text::numeric) into parts,total from jsonb_each(r.costs_micros);
 required:=total*o.standard_cost_multiplier-coalesce((r.costs_micros->>'elevenlabs')::numeric,0)*(o.standard_cost_multiplier-o.elevenlabs_cost_multiplier);
 charge:=ceil(required/10000);
 if charge>o.charge_cap_cents then return false;end if;
 -- The existing atomic ledger enforces reservations, fractional pricing, and margin checks.
 perform public.icash_settle_complete_costs(o.operation_key,charge,parts,evidence);
 update public.icash_operation_spend set cost_basis='estimated' where operation_key=o.operation_key;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_settle_dealmachine_usage(p_operation text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o public.icash_operation_spend;r public.icash_operation_rates;receipt jsonb;observed numeric;
 v_source_ref text;used numeric;part record;components jsonb:='{}';amount numeric;total numeric:=0;price numeric:=0;charge bigint;evidence text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.dealmachine_cost_multiplier is null or o.data_unit_cost_micros is null then return false;end if;
 select * into strict r from public.icash_operation_rates where id=o.rate_id;
 if r.operation not in ('property_search','owner_enrichment','buyer_discovery') then return false;end if;
 if o.state='settled' then return true;end if;
 if o.state<>'dispatched' then return false;end if;
 if r.operation='property_search' then
  select result into receipt from public.icash_discovery_results where operation_key=p_operation and account_id=o.account_id;
  v_source_ref:='dealmachine:search:'||p_operation;
 elsif r.operation='owner_enrichment' then
  select result into receipt from public.icash_owner_contacts where operation_key=p_operation and account_id=o.account_id;
  v_source_ref:='dealmachine:owners:'||p_operation;
 else
  select b.receipt into receipt from public.icash_buyer_search_receipts b join public.icash_deal_files d on d.id=b.deal_id and d.account_id=o.account_id where b.operation_key=p_operation;
  v_source_ref:=p_operation;
 end if;
 if receipt is null or jsonb_typeof(receipt->'creditsUsed') is distinct from 'number' then return false;end if;
 used:=(receipt->>'creditsUsed')::numeric;
 select c.amount into observed from public.icash_cost_observations c where c.provider='dealmachine' and c.event_key=p_operation and c.source_ref=v_source_ref and c.units='provider_credits';
 if used<0 or used<>trunc(used) or used is distinct from observed or used*o.data_unit_cost_micros>(r.costs_micros->>'dealmachine')::numeric then return false;end if;
 for part in select key,value from jsonb_each_text(r.costs_micros) loop
  amount:=case when part.key='dealmachine' then used*o.data_unit_cost_micros else part.value::numeric end;
  total:=total+amount;
  price:=price+amount*case when part.key='dealmachine' then o.dealmachine_cost_multiplier when part.key='elevenlabs' then o.elevenlabs_cost_multiplier else o.standard_cost_multiplier end;
  components:=components||jsonb_build_object(part.key,jsonb_build_object('amountMicros',amount,'basis','estimated','evidenceRef',case when part.key='dealmachine' then 'Observed DealMachine credits at saved '||o.data_cost_basis||' unit allocation: '||v_source_ref else 'Existing operation allocation: '||r.version end));
 end loop;
 charge:=ceil(price/10000);
 if charge>o.charge_cap_cents or total>o.reserved_micros then return false;end if;
 evidence:='DealMachine usage v1: '||p_operation;
 perform public.icash_settle_complete_costs(p_operation,charge,components,evidence);
 update public.icash_operation_spend set cost_basis='estimated' where operation_key=p_operation;
 return true;
end $function$;

grant select,insert,update,delete on all tables in schema public to service_role;


 create schema icash_seller_recovery_private;
 create table icash_seller_recovery_private.contact_refreshes(id uuid primary key default gen_random_uuid(),gap_id uuid unique,account_id uuid,operation_key text unique,rate_id uuid,unit_cost_micros bigint,request_id uuid,requested_at timestamptz,response jsonb,http_status integer,response_at timestamptz,state text default 'requested',original_contact_id uuid,original_snapshot jsonb,outcome text);
 create table icash_operational_contacts(id uuid primary key,account_id uuid,phone text);
 create table icash_seller_gaps(id uuid primary key,account_id uuid,reason text,state text,review_reason text,outgoing_id uuid,stage text,thread_id uuid,due_at timestamptz default now(),expires_at timestamptz default now()+interval '1 day',created_at timestamptz default now());
 create table icash_text_threads(id uuid primary key,account_id uuid,operational_contact_id uuid);
 create table icash_seller_recovery_private.contact_refresh_policy(id integer primary key,enabled boolean,activated_at timestamptz,scan_due_at timestamptz,scan_gap_id uuid);
 insert into icash_seller_recovery_private.contact_refresh_policy values(1,true,now()-interval '1 day',null,null);
 create table fixture_controls(only_gap uuid,quota_admitted boolean default true,late_current boolean default true,current_calls integer default 0,raise_for_gap uuid);
 insert into fixture_controls values(null,true,true,0,null);
 create function icash_seller_recovery_private.contact_refresh_current(uuid,uuid) returns boolean language plpgsql as $$declare n integer;begin update public.fixture_controls set current_calls=current_calls+1 returning current_calls into n;return (select (only_gap is null or only_gap=$1) and (n=1 or late_current) from public.fixture_controls);end$$;
 create function icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_dealmachine_capacity_available(integer) returns boolean language sql as $$select true$$;
 create function icash_seller_contact_revalidation_snapshot(uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('gap',$1,'contact',$2)$$;
 create function icash_take_dealmachine_request(p_kind text,p_account uuid,p_operation text,p_request uuid) returns boolean language plpgsql as $$declare allowed boolean;begin select quota_admitted into allowed from public.fixture_controls;insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at) values(p_request,p_kind,p_account,p_operation,allowed,clock_timestamp());return allowed;end$$;
 create table icash_data_cost_settings(provider text primary key,credit_micros bigint,cost_basis text);
 insert into icash_data_cost_settings values('dealmachine',10000,'synthetic planning estimate');
 create table icash_research_private.requests(id uuid primary key,kind text,account_id uuid,operation_key text,admitted boolean,created_at timestamptz);
 create table icash_prospecting_budgets(id bigint,account_id uuid);
 create table icash_credit_reservations(id uuid primary key default gen_random_uuid(),account_id uuid,operation_key text unique,amount_cents bigint,status text default 'reserved',settled_cents bigint);
 create table if not exists icash_usage_coverage(operation_key text primary key,account_id uuid,gross_cents bigint,customer_cents bigint,covered_cents bigint,evidence_ref text);
 create table icash_question_usage(account_id uuid,question_id uuid,state text);
 create table icash_voice_jobs(id uuid,account_id uuid);
 create table fixture_vips(account_id uuid primary key);
 alter table icash_operation_rates add primary key(id),add unique(version),alter column id set default gen_random_uuid();
 alter table icash_operation_spend alter column state set default 'reserved',alter column created_at set default now();
 alter table icash_cost_observations add primary key(provider,event_key);
 alter table icash_cost_manifests add primary key(operation_key);
 alter table icash_operating_budget add column elevenlabs_cost_multiplier numeric default 2,add column reserved_micros bigint default 0,add column spent_micros bigint default 0,add column funded_micros bigint default 1000000000,add column protected_micros bigint default 0,add column daily_limit_micros bigint default 1000000000,add column require_company_reserve boolean default true,add column hold_reason text;
 create function icash_vip_active(uuid) returns boolean language sql stable as $$select exists(select 1 from public.fixture_vips where account_id=$1)$$;
 create function icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_reception_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_limited_seller_voice(uuid,text) returns boolean language sql as $$select false$$;
 create function icash_cancellation_voice_current(uuid,text) returns boolean language sql as $$select false$$;
 create function icash_meta_voice_context(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_general_reception_pause_exempt(uuid,text,bigint) returns boolean language sql as $$select false$$;
 create function icash_customer_text_operation(uuid,text) returns boolean language sql as $$select false$$;
 create function icash_research_waiting_on_outreach(uuid) returns boolean language sql as $$select false$$;
 create function icash_prospecting_outreach_floor(uuid) returns bigint language sql as $$select 5::bigint$$;
 create function icash_operational_phone(text) returns text language sql immutable as $$select case when regexp_replace($1,'[^0-9]','','g') ~ '^1[2-9][0-9]{9}$' then '+'||regexp_replace($1,'[^0-9]','','g') when regexp_replace($1,'[^0-9]','','g') ~ '^[2-9][0-9]{9}$' then '+1'||regexp_replace($1,'[^0-9]','','g') end$$;
 create function icash_reserve_operation(p_account uuid,p_operation text,p_rate uuid,p_permission_until timestamptz,p_financial_checked_at timestamptz default null,p_financial_eligible boolean default false) returns jsonb language plpgsql as $$begin return public.icash_reserve_before_fractional(p_account,p_operation,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);end$$;
 create function icash_settle_estimated_operation(text) returns boolean language sql as $$select public.icash_settle_estimate_before_sms_tokens($1)$$;
 
CREATE OR REPLACE FUNCTION public.icash_reserve_before_fractional(p_account uuid, p_operation text, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.icash_operating_budget; r public.icash_operation_rates; o public.icash_operation_spend; cat text; n numeric; total numeric:=0; held bigint; daily numeric; cr uuid; required numeric; price numeric; dm_mult numeric; data_unit bigint; data_basis text;
begin
 if p_operation is null or length(p_operation) not between 1 and 160 then raise exception 'Invalid operation'; end if;
 select * into b from public.icash_operating_budget where id=1 for update;
 if not b.enabled then raise exception 'Automation on hold'; end if;
 select * into o from public.icash_operation_spend where operation_key=p_operation;
 if found then
  if o.account_id<>p_account or o.rate_id<>p_rate then raise exception 'Operation conflict'; end if;
  return jsonb_build_object('operationKey',o.operation_key,'state',o.state,'reservedMicros',o.reserved_micros);
 end if;
 select * into r from public.icash_operation_rates where id=p_rate for share;
 if not found or not r.enabled or r.verified_at>now() or r.expires_at<=now() then raise exception 'Verified rate required'; end if;
 if public.icash_voice_credit_bound(p_account,p_operation,p_rate) is not null then
  r.charge_cents:=(public.icash_voice_credit_bound(p_account,p_operation,p_rate)->>'charge_cents')::bigint;
  r.costs_micros:=public.icash_voice_credit_bound(p_account,p_operation,p_rate)->'costs_micros';
 end if;
 if public.icash_reception_credit_bound(p_account,p_operation,p_rate) is not null then
  r.charge_cents:=(public.icash_reception_credit_bound(p_account,p_operation,p_rate)->>'charge_cents')::bigint;
  r.costs_micros:=public.icash_reception_credit_bound(p_account,p_operation,p_rate)->'costs_micros';
 end if;
 if p_permission_until is null or p_permission_until<=now() then raise exception 'Permission expired'; end if;
 if r.operation='seller_call' and not public.icash_limited_seller_voice(p_account,p_operation) and not public.icash_cancellation_voice_current(p_account,p_operation) and not exists(select 1 from public.icash_voice_jobs meta_job where meta_job.account_id=p_account and 'voice:'||meta_job.id=p_operation and public.icash_meta_voice_context(p_account,meta_job.id) is not null) and (p_financial_eligible is distinct from true or p_financial_checked_at is null or p_financial_checked_at>now() or p_financial_checked_at<now()-interval '24 hours') then raise exception 'Financial screening required'; end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  if jsonb_typeof(r.costs_micros->cat) is distinct from 'number' then raise exception 'Unknown cost: %',cat; end if;
  n:=(r.costs_micros->>cat)::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid cost'; end if;
  total:=total+n;
 end loop;
 if public.icash_vip_active(p_account) then b.standard_cost_multiplier:=b.standard_cost_multiplier*0.8;b.elevenlabs_cost_multiplier:=b.elevenlabs_cost_multiplier*0.8;end if;
 if r.operation='seller_lead' then
  b.standard_cost_multiplier:=public.icash_seller_lead_rate_multiplier(p_account,p_operation,p_rate)*case when public.icash_vip_active(p_account) then 0.8 else 1 end;
  b.elevenlabs_cost_multiplier:=b.standard_cost_multiplier;
 end if;
 if r.operation in ('property_search','owner_enrichment','buyer_discovery') then
  dm_mult:=3*case when public.icash_vip_active(p_account) then 0.8 else 1 end;
  select credit_micros,cost_basis into strict data_unit,data_basis from public.icash_data_cost_settings where provider='dealmachine';
 end if;
 -- Match JS: round reserve up to a cent after adding buffer.
 held:=ceil(total*(10000+r.buffer_bps)/10000);
 required:=ceil((total*b.standard_cost_multiplier-(r.costs_micros->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier)+coalesce((r.costs_micros->>'dealmachine')::numeric*(dm_mult-b.standard_cost_multiplier),0))*(10000+r.buffer_bps)/10000);
 price:=r.charge_cents::numeric*10000;
 if r.operation='sms_send' then
 select customer_price_micros into price from public.icash_text_messages where 'text:'||id=p_operation and account_id=p_account;
 end if;

 if r.flat_customer_price_cents is not null then
  if r.operation<>'sms_send' or price is distinct from r.flat_customer_price_cents::numeric*10000 then raise exception 'SMS flat price snapshot mismatch';end if;
  -- Snapshot cost-coverage accounting only for this explicit flat-price operation.
  -- The existing fractional ledger charges the immutable customer_price_micros.
  required:=held;b.standard_cost_multiplier:=1;b.elevenlabs_cost_multiplier:=1;
 end if;
 if price is null or price<required then raise exception 'Price below provider cost multiplier';end if;
 if b.require_company_reserve and b.funded_micros::numeric-b.spent_micros-b.reserved_micros-b.protected_micros<held then raise exception 'Company budget exhausted'; end if;
 select coalesce(sum(actual_micros),0) into daily from public.icash_operation_spend where settled_at>now()-interval '24 hours';
 if b.require_company_reserve and daily+b.reserved_micros+held>b.daily_limit_micros then raise exception 'Company daily limit'; end if;
 cr:=public.icash_reserve_credit(p_account,p_operation,r.charge_cents);
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until,financial_checked_at)
 values(p_operation,p_account,p_rate,cr,r.charge_cents,held,p_permission_until,p_financial_checked_at);
 update public.icash_operation_spend set standard_cost_multiplier=b.standard_cost_multiplier,elevenlabs_cost_multiplier=b.elevenlabs_cost_multiplier,required_revenue_micros=required,dealmachine_cost_multiplier=dm_mult,data_unit_cost_micros=data_unit,data_cost_basis=data_basis where operation_key=p_operation;
 update public.icash_operating_budget set reserved_micros=reserved_micros+held where id=1;
 return jsonb_build_object('operationKey',p_operation,'state','reserved','reservedMicros',held);
end $function$;
CREATE OR REPLACE FUNCTION public.icash_claim_operation(p_operation text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.icash_operating_budget; o public.icash_operation_spend; r public.icash_operation_rates; a public.icash_accounts;
begin
 select * into b from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.state<>'reserved' or not b.enabled or (b.require_company_reserve and b.funded_micros::numeric-b.spent_micros-b.protected_micros<b.reserved_micros) then return false; end if;
 select * into a from public.icash_accounts where id=o.account_id for update;
 select * into r from public.icash_operation_rates where id=o.rate_id for share;
 if a.bot_paused or not r.enabled or r.expires_at<=now() or o.permission_until<=now() then return false; end if;
 if r.operation='seller_call' and (o.financial_checked_at is null or o.financial_checked_at<now()-interval '24 hours') then return false; end if;
 update public.icash_operation_spend set state='dispatched',dispatched_at=now() where operation_key=p_operation;
 return true;
end $function$;
CREATE OR REPLACE FUNCTION public.icash_reserve_credit(p_account uuid, p_operation text, p_amount bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare w public.icash_wallets; r public.icash_credit_reservations; a public.icash_accounts; used bigint; result uuid; allowance jsonb;
begin
 if p_operation is null or trim(p_operation)='' or p_amount is null or p_amount<=0 then raise exception 'Invalid reservation'; end if;
 select * into a from public.icash_accounts where id=p_account for update;
 if not found then raise exception 'Account missing'; end if;
 if not public.icash_membership_work_allowed(p_account) then raise exception 'Software membership is inactive';end if;
 select * into w from public.icash_wallets where account_id=p_account for update;
 if not found then raise exception 'Wallet missing'; end if;
 select * into r from public.icash_credit_reservations where operation_key=p_operation;
 if found then
  if r.account_id<>p_account or r.amount_cents<>p_amount then raise exception 'Idempotency conflict'; end if;
  if r.status<>'reserved' then raise exception 'Operation already resolved'; end if;
  if a.bot_paused and not public.icash_general_reception_pause_exempt(p_account,p_operation,p_amount) and not public.icash_customer_text_operation(p_account,p_operation) and not exists(select 1 from public.icash_question_usage q where q.account_id=p_account and 'question:'||q.question_id=p_operation and q.state='reserved' and p_amount=5) then raise exception 'Bot paused'; end if;
  return r.id;
 end if;
 if a.bot_paused and not public.icash_general_reception_pause_exempt(p_account,p_operation,p_amount) and not public.icash_customer_text_operation(p_account,p_operation) and not exists(select 1 from public.icash_question_usage q where q.account_id=p_account and 'question:'||q.question_id=p_operation and q.state='reserved' and p_amount=5) then raise exception 'Bot paused'; end if;
 if w.balance_cents<=0 then raise exception 'Insufficient credits'; end if;
 -- This row is an idempotent usage authorization, not a wallet hold.
 -- The work planner chooses affordable work; actual usage is deducted once.
 insert into public.icash_credit_reservations(account_id,operation_key,amount_cents)
 values(p_account,p_operation,p_amount) returning id into result;

 return result;
end; $function$;
CREATE OR REPLACE FUNCTION public.icash_finish_credit(p_account uuid, p_operation text, p_charge bigint, p_evidence text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.icash_credit_reservations; desired text; available bigint; covered bigint;
begin
 if p_charge is null or p_charge<0 or p_evidence is null or trim(p_evidence)='' then raise exception 'Invalid settlement'; end if;
 select balance_cents into available from public.icash_wallets where account_id=p_account for update;
 if not found then raise exception 'Wallet missing'; end if;
 select * into r from public.icash_credit_reservations where account_id=p_account and operation_key=p_operation for update;
 if not found then raise exception 'Reservation missing'; end if;
 desired:=case when p_charge=0 then 'released' else 'settled' end;
 if r.status<>'reserved' then
  if r.status=desired and coalesce(r.settled_cents,0)=p_charge then return r.status; end if;
  raise exception 'Settlement conflict';
 end if;
 if p_charge>r.amount_cents then raise exception 'Charge exceeds reservation'; end if;
 -- Concurrent completed work may consume the last credits before this receipt.
 -- Record platform-covered overrun explicitly; never debit below zero or retry a charge.
 covered:=greatest(0,p_charge-available);
 if covered>0 then
  insert into public.icash_usage_coverage(account_id,operation_key,gross_cents,customer_cents,covered_cents,evidence_ref)
  values(p_account,p_operation,p_charge,p_charge-covered,covered,p_evidence);
  insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref)
  values(p_account,'usage-coverage:'||p_operation,'grant',covered,'Platform-covered concurrent usage; no customer debt: '||p_evidence);
 end if;
 if p_charge>0 then
  insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref)
  values(p_account,'usage:'||p_operation,'usage',-p_charge,p_evidence);
 end if;
 update public.icash_wallets set balance_cents=balance_cents+covered-p_charge,reserved_cents=0 where account_id=p_account;
 update public.icash_credit_reservations set status=desired,settled_cents=case when p_charge>0 then p_charge else null end where id=r.id;
 return desired;
end; $function$;
CREATE OR REPLACE FUNCTION public.icash_settle_operation(p_operation text, p_charge bigint, p_actual_micros bigint, p_evidence text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o public.icash_operation_spend;
begin
 if p_charge is null or p_charge<0 or p_actual_micros is null or p_actual_micros<0 or p_evidence is null or trim(p_evidence)='' then raise exception 'Verified settlement required'; end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found then raise exception 'Operation missing'; end if;
 if o.state in ('settled','cancelled') then
  if row(o.charged_cents,o.actual_micros,o.settlement_evidence) is distinct from row(p_charge,p_actual_micros,p_evidence) then raise exception 'Settlement conflict'; end if;
  return;
 end if;
 if p_charge>o.charge_cap_cents then raise exception 'Charge exceeds approved amount'; end if;
 if o.state='reserved' and (p_charge<>0 or p_actual_micros<>0) then raise exception 'Undispatched operation can only be cancelled'; end if;
 perform public.icash_finish_credit(o.account_id,p_operation,p_charge,p_evidence);
 update public.icash_operating_budget set reserved_micros=reserved_micros-o.reserved_micros,spent_micros=spent_micros+p_actual_micros,
 enabled=case when p_actual_micros>o.reserved_micros then false else enabled end,
 hold_reason=case when p_actual_micros>o.reserved_micros then 'Actual cost exceeded reserve or margin floor; reconcile before resuming' else hold_reason end where id=1;
 update public.icash_operation_spend set state=case when o.state='reserved' then 'cancelled' else 'settled' end,actual_micros=p_actual_micros,charged_cents=p_charge,settlement_evidence=p_evidence,settled_at=now() where operation_key=p_operation;
 if not public.icash_account_margin_ok(o.account_id,0,0,false) then
 update public.icash_accounts set bot_paused=true where id=o.account_id;
 end if;
end $function$;
create or replace function public.icash_settle_complete_costs(p_operation text,p_charge bigint,p_components jsonb,p_evidence text) returns void language plpgsql set search_path='' as $$
declare cat text;n numeric;total numeric:=0;old public.icash_cost_manifests;
begin
 if p_evidence is null or length(trim(p_evidence))<10 or p_charge is null or p_charge<0 or jsonb_typeof(p_components) is distinct from 'object' then raise exception 'Verified complete cost evidence required';end if;
 if (select count(*) from jsonb_object_keys(p_components))<>16 then raise exception 'All cost categories required';end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  if jsonb_typeof(p_components->cat->'amountMicros') is distinct from 'number' or jsonb_typeof(p_components->cat->'evidenceRef') is distinct from 'string' or length(trim(p_components->cat->>'evidenceRef'))<10 then raise exception 'Verified cost category required: %',cat;end if;
  n:=(p_components->cat->>'amountMicros')::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid cost';end if;
  total:=total+n;
 end loop;
 if total>9007199254740991 then raise exception 'Cost total out of range';end if;
 -- Ledger lock first, matching reserve/settle lock order.
 perform 1 from public.icash_operating_budget where id=1 for update;
 insert into public.icash_cost_manifests(operation_key,charge_cents,actual_micros,components,evidence_ref) values(p_operation,p_charge,total,p_components,p_evidence) on conflict do nothing;
 select * into strict old from public.icash_cost_manifests where operation_key=p_operation;
 if row(old.charge_cents,old.actual_micros,old.components,old.evidence_ref) is distinct from row(p_charge,total::bigint,p_components,p_evidence) then raise exception 'Cost manifest conflict';end if;
 perform public.icash_settle_operation(p_operation,p_charge,total::bigint,p_evidence);
end $$;
create or replace function public.icash_record_cost_observation(p_provider text,p_event text,p_source text,p_amount numeric,p_units text) returns void
language plpgsql security invoker set search_path='' as $$
declare o public.icash_cost_observations;
begin
 if p_provider is null or trim(p_provider)='' or p_event is null or trim(p_event)='' or p_source is null or trim(p_source)='' or p_units is null or trim(p_units)='' or p_amount<0 then raise exception 'Invalid cost observation'; end if;
 insert into public.icash_cost_observations(provider,event_key,source_ref,amount,units) values(p_provider,p_event,p_source,p_amount,p_units) on conflict do nothing;
 select * into o from public.icash_cost_observations where provider=p_provider and event_key=p_event;
 if row(o.source_ref,o.amount,o.units) is distinct from row(p_source,p_amount,p_units) then raise exception 'Cost receipt conflict'; end if;
end $$;
create or replace function public.icash_new_prospect_operation(p_account uuid,p_operation text,p_rate uuid) returns boolean
language plpgsql stable set search_path='' as $$
declare kind text;screen uuid;
begin
 select operation into kind from public.icash_operation_rates where id=p_rate;
 if kind in ('property_search','owner_enrichment') then return true;end if;
 if kind='seller_call' then
  select t.screening_id into screen from public.icash_voice_jobs j
   join public.icash_voice_contact_targets t on t.id=coalesce(j.permission_id,j.operational_contact_id) and t.account_id=j.account_id
   where j.account_id=p_account and 'voice:'||j.id=p_operation and t.party='seller'
   and j.callback_id is null and j.sms_source_message_id is null and j.cancellation_notice_id is null;
 elsif kind in ('sms_send','mms_send') then
  select d.screening_id into screen from public.icash_text_messages m
   join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
   join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
   where m.account_id=p_account and 'text:'||m.id=p_operation and t.party='seller' and m.customer_author_id is null;
 else return false;end if;
 if screen is null then return false;end if;
 -- Replies, requested callbacks, customer-written messages, seller submissions
 -- and active contracts keep ordinary credit admission and existing pricing.
 return exists(select 1 from public.icash_screening_jobs s where s.id=screen and s.account_id=p_account and s.snapshot->'sellerRequest' is null)
 and not exists(select 1 from public.icash_deal_files d where d.account_id=p_account and d.screening_id=screen and d.stage<>'draft')
 and not exists(select 1 from public.icash_live_conversations c where c.account_id=p_account and c.screening_id=screen and c.party='seller' and c.state='complete' and public.icash_call_has_seller_response(c.result))
 and not exists(select 1 from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id
  join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
  where d.account_id=p_account and d.screening_id=screen and t.party='seller' and m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null));
end $$;
create or replace function public.icash_guard_prospecting_spend() returns trigger
language plpgsql set search_path='' as $$
declare kind text;required bigint;
begin
 if not public.icash_new_prospect_operation(new.account_id,new.operation_key,new.rate_id) then return new;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select operation into kind from public.icash_operation_rates where id=new.rate_id;
 required:=new.charge_cap_cents;
 if kind in ('property_search','owner_enrichment') then
  required:=public.icash_research_admission_quote(new.account_id,kind,required);
  if public.icash_research_waiting_on_outreach(new.account_id) then
   raise exception 'Prospecting budget reached' using detail=jsonb_build_object('quoteCents',required)::text;
  end if;
 elsif kind in ('sms_send','mms_send') and public.icash_research_waiting_on_outreach(new.account_id) then
  required:=required+public.icash_prospecting_outreach_floor(new.account_id);
 end if;
 if public.icash_prospecting_available(new.account_id)<required then
  raise exception 'Prospecting budget reached' using detail=jsonb_build_object('quoteCents',required)::text;
 end if;
 select id into new.prospecting_budget_id from public.icash_prospecting_budgets where account_id=new.account_id order by id desc limit 1;
 if new.prospecting_budget_id is null then raise exception 'Prospecting budget reached' using detail=jsonb_build_object('quoteCents',required)::text;end if;
 return new;
end $$;
create or replace function public.icash_research_admission_quote(p_account uuid,p_kind text,p_price bigint) returns bigint
language sql stable security invoker set search_path='' as $$
 select p_price+public.icash_prospecting_outreach_floor(p_account)
  +case when p_kind='property_search' then coalesce((select r.charge_cents from public.icash_discovery_configs c
   join public.icash_operation_rates r on r.id=c.contact_rate_id where c.account_id=p_account and c.contacts_enabled
    and r.enabled and r.expires_at>now() and r.operation='owner_enrichment'),0) else 0 end;
$$;
create trigger prospecting_guard before insert on icash_operation_spend for each row execute function icash_guard_prospecting_spend()
CREATE OR REPLACE FUNCTION public.icash_reserve_before_fractional(p_account uuid, p_operation text, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.icash_operating_budget; r public.icash_operation_rates; o public.icash_operation_spend; cat text; n numeric; total numeric:=0; held bigint; daily numeric; cr uuid; required numeric; price numeric; dm_mult numeric; data_unit bigint; data_basis text;
begin
 if p_operation is null or length(p_operation) not between 1 and 160 then raise exception 'Invalid operation'; end if;
 select * into b from public.icash_operating_budget where id=1 for update;
 if not b.enabled then raise exception 'Automation on hold'; end if;
 select * into o from public.icash_operation_spend where operation_key=p_operation;
 if found then
  if o.account_id<>p_account or o.rate_id<>p_rate then raise exception 'Operation conflict'; end if;
  return jsonb_build_object('operationKey',o.operation_key,'state',o.state,'reservedMicros',o.reserved_micros);
 end if;
 select * into r from public.icash_operation_rates where id=p_rate for share;
 if not found or not r.enabled or r.verified_at>now() or r.expires_at<=now() then raise exception 'Verified rate required'; end if;
 if public.icash_voice_credit_bound(p_account,p_operation,p_rate) is not null then
  r.charge_cents:=(public.icash_voice_credit_bound(p_account,p_operation,p_rate)->>'charge_cents')::bigint;
  r.costs_micros:=public.icash_voice_credit_bound(p_account,p_operation,p_rate)->'costs_micros';
 end if;
 if public.icash_reception_credit_bound(p_account,p_operation,p_rate) is not null then
  r.charge_cents:=(public.icash_reception_credit_bound(p_account,p_operation,p_rate)->>'charge_cents')::bigint;
  r.costs_micros:=public.icash_reception_credit_bound(p_account,p_operation,p_rate)->'costs_micros';
 end if;
 if p_permission_until is null or p_permission_until<=now() then raise exception 'Permission expired'; end if;
 if r.operation='seller_call' and not public.icash_limited_seller_voice(p_account,p_operation) and not public.icash_cancellation_voice_current(p_account,p_operation) and not exists(select 1 from public.icash_voice_jobs meta_job where meta_job.account_id=p_account and 'voice:'||meta_job.id=p_operation and public.icash_meta_voice_context(p_account,meta_job.id) is not null) and (p_financial_eligible is distinct from true or p_financial_checked_at is null or p_financial_checked_at>now() or p_financial_checked_at<now()-interval '24 hours') then raise exception 'Financial screening required'; end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  if jsonb_typeof(r.costs_micros->cat) is distinct from 'number' then raise exception 'Unknown cost: %',cat; end if;
  n:=(r.costs_micros->>cat)::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid cost'; end if;
  total:=total+n;
 end loop;
 if public.icash_vip_active(p_account) then b.standard_cost_multiplier:=b.standard_cost_multiplier*0.7;b.elevenlabs_cost_multiplier:=b.elevenlabs_cost_multiplier*0.7;end if;
 if r.operation='seller_lead' then
  b.standard_cost_multiplier:=public.icash_seller_lead_rate_multiplier(p_account,p_operation,p_rate)*case when public.icash_vip_active(p_account) then 0.7 else 1 end;
  b.elevenlabs_cost_multiplier:=b.standard_cost_multiplier;
 end if;
 if r.operation in ('property_search','owner_enrichment','buyer_discovery') then
  dm_mult:=3*case when public.icash_vip_active(p_account) then 0.7 else 1 end;
  select credit_micros,cost_basis into strict data_unit,data_basis from public.icash_data_cost_settings where provider='dealmachine';
 end if;
 -- Match JS: round reserve up to a cent after adding buffer.
 held:=ceil(total*(10000+r.buffer_bps)/10000);
 required:=ceil((total*b.standard_cost_multiplier-(r.costs_micros->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier)+coalesce((r.costs_micros->>'dealmachine')::numeric*(dm_mult-b.standard_cost_multiplier),0))*(10000+r.buffer_bps)/10000);
 price:=r.charge_cents::numeric*10000;
 if r.operation='sms_send' then
 select customer_price_micros into price from public.icash_text_messages where 'text:'||id=p_operation and account_id=p_account;
 end if;

 if r.flat_customer_price_cents is not null then
  if r.operation<>'sms_send' or price is distinct from r.flat_customer_price_cents::numeric*10000 then raise exception 'SMS flat price snapshot mismatch';end if;
  -- Snapshot cost-coverage accounting only for this explicit flat-price operation.
  -- The existing fractional ledger charges the immutable customer_price_micros.
  required:=held;b.standard_cost_multiplier:=1;b.elevenlabs_cost_multiplier:=1;
 end if;
 if price is null or price<required then raise exception 'Price below provider cost multiplier';end if;
 if b.require_company_reserve and b.funded_micros::numeric-b.spent_micros-b.reserved_micros-b.protected_micros<held then raise exception 'Company budget exhausted'; end if;
 select coalesce(sum(actual_micros),0) into daily from public.icash_operation_spend where settled_at>now()-interval '24 hours';
 if b.require_company_reserve and daily+b.reserved_micros+held>b.daily_limit_micros then raise exception 'Company daily limit'; end if;
 cr:=public.icash_reserve_credit(p_account,p_operation,r.charge_cents);
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until,financial_checked_at)
 values(p_operation,p_account,p_rate,cr,r.charge_cents,held,p_permission_until,p_financial_checked_at);
 update public.icash_operation_spend set standard_cost_multiplier=b.standard_cost_multiplier,elevenlabs_cost_multiplier=b.elevenlabs_cost_multiplier,required_revenue_micros=required,dealmachine_cost_multiplier=dm_mult,data_unit_cost_micros=data_unit,data_cost_basis=data_basis where operation_key=p_operation;
 update public.icash_operating_budget set reserved_micros=reserved_micros+held where id=1;
 return jsonb_build_object('operationKey',p_operation,'state','reserved','reservedMicros',held);
end $function$

CREATE OR REPLACE FUNCTION public.icash_new_prospect_operation(p_account uuid, p_operation text, p_rate uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare kind text;screen uuid;
begin
 select operation into kind from public.icash_operation_rates where id=p_rate;
 if kind in ('property_search','owner_enrichment') then return true;end if;
 if kind='seller_call' then
  select t.screening_id into screen from public.icash_voice_jobs j
   join public.icash_voice_contact_targets t on t.id=coalesce(j.permission_id,j.operational_contact_id) and t.account_id=j.account_id
   where j.account_id=p_account and 'voice:'||j.id=p_operation and t.party='seller'
   and j.callback_id is null and j.sms_source_message_id is null and j.cancellation_notice_id is null;
 elsif kind in ('sms_send','mms_send') then
  select d.screening_id into screen from public.icash_text_messages m
   join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
   join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
   where m.account_id=p_account and 'text:'||m.id=p_operation and t.party='seller' and m.customer_author_id is null;
 else return false;end if;
 if screen is null then return false;end if;
 -- Replies, requested callbacks, customer-written messages, seller submissions
 -- and active contracts keep ordinary credit admission and existing pricing.
 return exists(select 1 from public.icash_screening_jobs s where s.id=screen and s.account_id=p_account and s.snapshot->'sellerRequest' is null)
 and not exists(select 1 from public.icash_deal_files d where d.account_id=p_account and d.screening_id=screen and d.stage<>'draft')
 and not exists(select 1 from public.icash_live_conversations c where c.account_id=p_account and c.screening_id=screen and c.party='seller' and c.state='complete' and public.icash_call_has_seller_response(c.result))
 and not exists(select 1 from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id
  join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
  where d.account_id=p_account and d.screening_id=screen and t.party='seller' and m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null));
end $function$

CREATE OR REPLACE FUNCTION public.icash_guard_prospecting_spend()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare kind text;required bigint;
begin
 if not public.icash_new_prospect_operation(new.account_id,new.operation_key,new.rate_id) then return new;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select operation into kind from public.icash_operation_rates where id=new.rate_id;
 required:=new.charge_cap_cents;
 if kind in ('property_search','owner_enrichment') then
  required:=public.icash_research_admission_quote(new.account_id,kind,required);
  if public.icash_research_waiting_on_outreach(new.account_id) then
   raise exception 'Prospecting budget reached' using detail=jsonb_build_object('quoteCents',required)::text;
  end if;
 elsif kind in ('sms_send','mms_send') and public.icash_research_waiting_on_outreach(new.account_id) then
  required:=required+public.icash_prospecting_outreach_floor(new.account_id);
 end if;
 if public.icash_prospecting_available(new.account_id)<required then
  raise exception 'Prospecting budget reached' using detail=jsonb_build_object('quoteCents',required)::text;
 end if;
 select id into new.prospecting_budget_id from public.icash_prospecting_budgets where account_id=new.account_id order by id desc limit 1;
 if new.prospecting_budget_id is null then raise exception 'Prospecting budget reached' using detail=jsonb_build_object('quoteCents',required)::text;end if;
 return new;
end $function$

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

create or replace function public.icash_claim_seller_contact_refresh() returns jsonb
language plpgsql security definer set search_path='' as $$
declare item record;f icash_seller_recovery_private.contact_refreshes;bill jsonb;req uuid;stamp timestamptz;
 policy icash_seller_recovery_private.contact_refresh_policy;visited boolean:=false;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;if not found then return null;end if;
 select * into policy from icash_seller_recovery_private.contact_refresh_policy where id=1 and enabled for update;if not found then return null;end if;
 -- An ambiguous phone-check purchase stops this new workflow until its real
 -- receipt is reconciled. A failing provider cannot accumulate new holds.
 if exists(select 1 from icash_seller_recovery_private.contact_refreshes pending
  join public.icash_operation_spend spend on spend.operation_key=pending.operation_key
  where pending.response_at is null or (pending.outcome='cost_review' and spend.state<>'settled')) then return null;end if;
 -- At most one new provider request per scheduler minute. Unknown requests
 -- remain one-use holds forever; a new worker never repeats their HTTP call.
 if exists(select 1 from icash_seller_recovery_private.contact_refreshes where requested_at>clock_timestamp()-interval '1 minute') then return null;end if;
 for item in
  select g.id gap_id,g.due_at,g.account_id,t.operational_contact_id,cfg.contact_rate_id,cfg.property_credit_micros
  from public.icash_seller_gaps g
  join public.icash_text_threads t on t.id=g.thread_id and t.account_id=g.account_id
  join public.icash_discovery_configs cfg on cfg.account_id=g.account_id
  where g.state='needs_review' and g.review_reason='contact_checks_expired' and g.reason='no_response' and g.stage='draft'
   and g.outgoing_id is null and g.due_at<=now() and g.expires_at>now() and g.created_at>=policy.activated_at
   and (policy.scan_due_at is null or (g.due_at,g.id)>(policy.scan_due_at,policy.scan_gap_id))
   and not exists(select 1 from icash_seller_recovery_private.contact_refreshes prior where prior.gap_id=g.id)
  order by g.due_at,g.id limit 20
 loop
  visited:=true;
  -- Held, paused and unaffordable accounts cannot occupy every bounded scan.
  -- Advance outside the per-item subtransaction so an ordinary admission hold
  -- retains its place in the round-robin scan without changing the gap.
  update icash_seller_recovery_private.contact_refresh_policy set scan_due_at=item.due_at,scan_gap_id=item.gap_id where id=1;
  if not icash_seller_recovery_private.contact_refresh_current(item.gap_id,item.operational_contact_id)
   or not public.icash_sms_outreach_window_current(item.account_id,(select thread_id from public.icash_seller_gaps where id=item.gap_id))
   or not public.icash_dealmachine_capacity_available(1) then continue;end if;
  begin
   bill:=icash_seller_recovery_private.reserve_contact_refresh(item.account_id,item.gap_id,item.contact_rate_id,item.property_credit_micros);
   if bill is null then continue;end if;
   req:=gen_random_uuid();stamp:=clock_timestamp();
   insert into icash_seller_recovery_private.contact_refreshes(gap_id,account_id,original_contact_id,operation_key,rate_id,unit_cost_micros,request_id,requested_at,original_snapshot)
   values(item.gap_id,item.account_id,item.operational_contact_id,bill->>'operationKey',(bill->>'rateId')::uuid,(bill->>'unitCostMicros')::bigint,req,stamp,
    public.icash_seller_contact_revalidation_snapshot(item.gap_id,item.operational_contact_id)) returning * into f;
   -- Dependent mutations must be sequential: SQL may evaluate an EXISTS
   -- initplan before volatile operands in a single boolean expression.
   if not public.icash_claim_operation(f.operation_key) then raise exception 'Contact refresh admission held' using errcode='P7502';end if;
   if not public.icash_take_dealmachine_request('phone_dnc',f.account_id,f.operation_key,req) then raise exception 'Contact refresh admission held' using errcode='P7502';end if;
   if not icash_seller_recovery_private.contact_refresh_current(item.gap_id,item.operational_contact_id) then raise exception 'Contact refresh admission held' using errcode='P7502';end if;
   if not exists(select 1 from public.icash_operation_spend spend join public.icash_operation_rates rate on rate.id=spend.rate_id
      where spend.operation_key=f.operation_key and spend.state='dispatched' and spend.permission_until>clock_timestamp()
      and rate.enabled and rate.verified_at<=clock_timestamp() and rate.expires_at>clock_timestamp())
    then raise exception 'Contact refresh admission held' using errcode='P7502';end if;
   return jsonb_build_object('id',f.id,'requestId',req,'phone',(select phone from public.icash_operational_contacts where id=f.original_contact_id));
  exception when sqlstate 'P7502' then continue;
   when raise_exception then
    if sqlerrm=any(array['Account spending not activated','Activation spending cap reached','Software membership is inactive',
     'Bot paused','Insufficient credits','Daily budget reached','Prospecting budget reached','Company budget exhausted',
     'Company daily limit','Automation on hold','Verified rate required','Permission expired','Wallet missing']) then continue;end if;
    raise;
  end;
 end loop;
 if not visited then
  update icash_seller_recovery_private.contact_refresh_policy set scan_due_at=null,scan_gap_id=null where id=1;
 end if;
 return null;
end $$;
revoke all on function public.icash_claim_seller_contact_refresh() from public,anon,authenticated,service_role;grant execute on function public.icash_claim_seller_contact_refresh() to service_role;grant usage on schema public,icash_seller_recovery_private to service_role;
insert into icash_accounts(id,owner_user_id,bot_paused) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',false);
insert into icash_wallets(account_id,balance_cents,reserved_cents) values('00000000-0000-4000-8000-000000000001',1000,0);
insert into icash_prospecting_budgets(id,account_id) values(1,'00000000-0000-4000-8000-000000000001');
insert into icash_operation_rates(id,operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled) values('00000000-0000-4000-8000-000000000002','owner_enrichment','synthetic-owner',105,'{"dealmachine":250000,"elevenlabs":0,"twilio":0,"messaging":0,"email":0,"llm":0,"vercel":0,"railway":0,"supabase":0,"github":0,"payments":0,"title_and_signing":0,"support_and_overhead":40000,"acquisition":0,"refund_and_dispute_reserve":0,"other":0}',2000,'synthetic original reviewed costs',now()-interval '1 day',now()+interval '1 day',true);
insert into icash_discovery_configs(account_id,enabled,auto_enabled,contacts_enabled,contact_rate_id,property_credit_micros,data_rights_until) values('00000000-0000-4000-8000-000000000001',true,true,true,'00000000-0000-4000-8000-000000000002',10000,now()+interval '1 day');
insert into icash_seller_gaps(id,account_id,reason,state,review_reason,outgoing_id,stage,thread_id) values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','no_response','needs_review','contact_checks_expired',null,'draft','00000000-0000-4000-8000-000000000003');
insert into icash_operational_contacts values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','+12145550123');
insert into icash_text_threads values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004');