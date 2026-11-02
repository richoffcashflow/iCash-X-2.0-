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
