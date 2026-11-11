-- Fictional accounts and explicit unchanged external gates. Real credit
-- admission, final prospecting guard, availability and settlement load separately.
create schema icash_work_private;
create table public.icash_prospecting_budgets(id bigint generated always as identity primary key,account_id uuid,baseline_cents bigint,created_at timestamptz default now());
create table public.icash_opportunity_outcomes(account_id uuid,attempted boolean,responded boolean,opted_out boolean,discovered_at timestamptz);
create function public.icash_customer_discovery_charge(uuid,text,bigint) returns bigint language sql as $$select $3$$;
create function public.icash_account_work_health(uuid) returns jsonb language sql as $$select '{"status":"ok"}'::jsonb$$;
alter table public.icash_operation_spend add column prospecting_budget_id bigint;
create view public.icash_duplicate_discovery_coverage as select operation_key,account_id,covered_cents from public.icash_usage_coverage where false;
create function public.icash_discovery_no_new_inventory(uuid,text) returns boolean language sql as $$select false$$;
create function public.icash_membership_work_allowed(uuid) returns boolean language sql as $$select true$$;
create function public.icash_general_reception_pause_exempt(uuid,text,bigint) returns boolean language sql as $$select false$$;
create function public.icash_customer_text_operation(uuid,text) returns boolean language sql as $$select false$$;
create function public.icash_new_prospect_operation(uuid,text,uuid) returns boolean language sql as $$select true$$;
create function public.icash_research_admission_quote(uuid,text,bigint) returns bigint language sql as $$select $3$$;
create function icash_work_private.warm_seller_due(uuid) returns boolean language sql as $$select false$$;
create function public.icash_research_waiting_on_outreach(uuid) returns boolean language sql as $$select false$$;
create function public.icash_prospecting_outreach_floor(uuid) returns bigint language sql as $$select 0::bigint$$;
create function public.icash_account_work_observations() returns table(account_id uuid,reason text) language sql stable as $$
 select '10000000-0000-4000-8000-000000000001'::uuid,'pending_work'::text;
$$;
create function public.icash_prospecting_available(uuid) returns bigint language sql as $$select public.icash_prospecting_total_available($1)$$;
insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused)
select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Fixture',n=3 from generate_series(1,4)n;
insert into public.icash_wallets(account_id,balance_cents) select id,case when right(id::text,1)='4' then 0 else 1000 end from public.icash_accounts;
insert into public.icash_prospecting_budgets(account_id,baseline_cents) select id,1000 from public.icash_accounts;
insert into public.icash_operating_budget(id,enabled,reserved_micros) values(1,true,700000);
insert into public.icash_operation_rates(id,operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled)
values('10000000-0000-4000-8000-000000000011','property_search','synthetic',200,'{}',0,'SYNTHETIC fixture',now(),now()+interval '1 day',true);
insert into public.icash_credit_reservations(account_id,operation_key,amount_cents)
values('10000000-0000-4000-8000-000000000001','old-call',900),('10000000-0000-4000-8000-000000000001','old-reserved',100),
 ('10000000-0000-4000-8000-000000000001','fresh',100),('10000000-0000-4000-8000-000000000002','other-old',100);
insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until,created_at,dispatched_at)
select operation_key,account_id,'10000000-0000-4000-8000-000000000011',id,amount_cents,amount_cents*500,
 case when operation_key='old-reserved' then 'reserved' else 'dispatched' end,'2027-01-01',
 case when operation_key='fresh' then '2026-11-11T01:00:00Z'::timestamptz else '2026-11-10T01:00:00Z'::timestamptz end,
 case when operation_key='old-reserved' then null else '2026-11-10T01:00:01Z'::timestamptz end
from public.icash_credit_reservations;

-- No provider path: exercises the real current final-spend trigger and credit
-- authorization with production lock order. External permission predicates above
-- are explicit fixture inputs, not claimed end-to-end provider validation.
create function public.fixture_relief_admit(p_account uuid,p_operation text,p_quote bigint) returns boolean language plpgsql as $$
declare reservation uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 reservation:=public.icash_reserve_credit(p_account,p_operation,p_quote);
 if exists(select 1 from public.icash_operation_spend where operation_key=p_operation) then return false;end if;
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until)
 values(p_operation,p_account,'10000000-0000-4000-8000-000000000011',reservation,p_quote,p_quote*500,now()+interval '1 day');
 update public.icash_operating_budget set reserved_micros=reserved_micros+p_quote*500 where id=1;
 return true;
end $$;
