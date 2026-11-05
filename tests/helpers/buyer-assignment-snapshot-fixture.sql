-- Disposable fixture dependencies only. The claim, wrapper and journey gate
-- are loaded from their actual repository/production function definitions.
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end$$;
create schema if not exists auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now());
create table icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false);
create table icash_screening_jobs(id uuid primary key,account_id uuid,state text default 'complete',snapshot jsonb default '{"propertyId":"prop_123"}');
create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text default 'under_contract',terms jsonb,updated_at timestamptz default now(),buyer_hold boolean default false);
create table icash_signing_envelopes(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,kind text,state text,test_mode boolean default false);
create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,recipient text,paused boolean default false,manual_only boolean default false,retired_at timestamptz,contact_current boolean default true);
create table icash_text_suppressions(phone text primary key);
create table icash_property_controls(account_id uuid,property_id text,manual boolean);
create table icash_handoffs(account_id uuid,screening_id uuid,state text);
create table icash_deal_journeys(id uuid primary key,account_id uuid,deal_id uuid,thread_id uuid,state text default 'ready',expires_at timestamptz default now()+interval '1 day',buyer_details jsonb,review_reason text,updated_at timestamptz default now(),next_run_at timestamptz default now());
create table icash_journey_blockers(journey_id uuid primary key,state text,kind text);
create function icash_signing_action_allowed(uuid,uuid) returns boolean language sql stable as $$select true$$;
create function icash_buyer_outreach_held(a uuid,d uuid) returns boolean language sql stable as $$select coalesce((select buyer_hold from public.icash_deal_files where id=d and account_id=a),true)$$;
create function icash_sms_thread_review_current(a uuid,t uuid,boolean) returns boolean language sql stable as $$select exists(select 1 from public.icash_text_threads where id=t and account_id=a and contact_current)$$;
create function icash_buyer_package_data(a uuid,d uuid) returns jsonb language sql stable as $$
 select jsonb_build_object('askingPriceCents',(terms->>'priceCents')::bigint+(terms->>'assignmentFeeCents')::bigint,'depositCents',terms->'assignmentDepositCents','reserved',false)
 from public.icash_deal_files where id=d and account_id=a
$$;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000001','owner@example.invalid');
insert into icash_accounts(id,owner_user_id) values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
insert into icash_screening_jobs(id,account_id) values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002');
insert into icash_deal_files(id,account_id,screening_id,terms) values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',
 '{"seller":"Fixture Seller","buyer":"Fixture Principal","address":"100 Fixture Lane","legalDescription":"Lot 1, Fixture Subdivision","state":"TX","priceCents":9200000,"priceSource":"seller_reported","assignmentFeeCents":1000000,"assignmentDepositCents":200000,"closingDate":"2099-12-04","assignee":""}');
insert into icash_text_threads(id,account_id,deal_id,recipient) values('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','+12145550123');
insert into icash_signing_envelopes(account_id,deal_id,kind,state) values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','purchase','completed');
insert into icash_deal_journeys(id,account_id,deal_id,thread_id,buyer_details) values('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005',
 '{"legalName":"Fixture Buyer LLC","signerName":"Fixture Buyer","email":"buyer@example.invalid","askingPriceCents":10200000,"depositCents":200000,"fundsReady":true,"authorized":true}');
