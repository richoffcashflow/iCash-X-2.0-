-- Synthetic dependencies for the production read-only buffer function.
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end$$;
create table public.icash_opportunity_outcomes(account_id uuid,screening_id uuid,attempted boolean,responded boolean,opted_out boolean);
create table public.icash_customer_identities(account_id uuid primary key,principal text);
create table public.icash_operational_contacts(account_id uuid,screening_id uuid,source_hash text,sending_principal text,
 channel text,phone text,eligibility_until timestamptz,revoked_at timestamptz);
create table public.icash_contact_permissions(account_id uuid,screening_id uuid,phone text,permission_until timestamptz,revoked_at timestamptz);
create table public.icash_inventory_claims(resource_key text primary key,account_id uuid,screening_id uuid,cooldown_until timestamptz);
create function public.icash_owner_preflight_empty(uuid,uuid,jsonb) returns boolean language sql stable as $$select false$$;
create function public.fixture_phone_id(n integer) returns uuid language sql immutable as $$select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused) values
 (fixture_phone_id(1000),fixture_phone_id(1000),'Fixture',false),(fixture_phone_id(2000),fixture_phone_id(2000),'Other fixture',false);
insert into public.icash_wallets(account_id,balance_cents,reserved_cents) values(fixture_phone_id(1000),10000,735);
insert into public.icash_customer_identities values(fixture_phone_id(1000),'Current Buyer');
create function public.fixture_phone_seed(n integer,kind text default 'blocked') returns uuid language plpgsql as $$
declare a uuid:=fixture_phone_id(1000);s uuid:=fixture_phone_id(n);operation text:='owners:'||a||':'||s;
 phone text:='+1214555'||lpad(n::text,4,'0');result jsonb;
begin
 insert into icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at)
 values(s,a,'synthetic-phone-'||n,jsonb_build_object('propertyId','prop_'||n,'propertyType','house'),
 'complete','{"financialCheck":{"status":"eligible"}}',now());
 if kind='unprepared' then return s;end if;
 insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until,dispatched_at,settled_at)
 values(operation,a,fixture_phone_id(3000),fixture_phone_id(n+10000),105,100000,
 case when kind='unknown' then 'dispatched' else 'settled' end,now()+interval '1 day',now(),case when kind<>'unknown' then now() end);
 if kind='unknown' then return s;end if;
 result:=jsonb_build_object('propertyId','prop_'||n,'requestedPersonIds',jsonb_build_array('person_'||n),
 'contacts',jsonb_build_array(jsonb_build_object('personId','person_'||n,'likelyOwner',true,
 'phones',jsonb_build_array(jsonb_build_object('number',phone,'doNotCall',false)))));
 insert into icash_owner_contacts(screening_id,account_id,operation_key,result) values(s,a,operation,result);
 insert into icash_operational_contacts(account_id,screening_id,source_hash,sending_principal,channel,phone,eligibility_until)
 values(a,s,encode(sha256(convert_to(result::text,'UTF8')),'hex'),'Current Buyer','voice',phone,now()+interval '1 day');
 if kind='blocked' then insert into icash_inventory_claims values('phone:'||encode(sha256(convert_to(phone,'UTF8')),'hex'),fixture_phone_id(2000),s,now()+interval '1 day');end if;
 return s;
end$$;
select fixture_phone_seed(n) from generate_series(1,14)n;
select fixture_phone_seed(15,'available');
select fixture_phone_seed(n,'unprepared') from generate_series(16,18)n;
select fixture_phone_seed(n,'unknown') from generate_series(19,25)n;
create function public.fixture_phone_evidence() returns jsonb language sql stable as $$select jsonb_build_object(
 'contacts',(select jsonb_agg(to_jsonb(x) order by screening_id) from icash_owner_contacts x),
 'spend',(select jsonb_agg(to_jsonb(x) order by operation_key) from icash_operation_spend x),
 'claims',(select jsonb_agg(to_jsonb(x) order by resource_key) from icash_inventory_claims x),
 'operational',(select jsonb_agg(to_jsonb(x) order by screening_id,phone) from icash_operational_contacts x),
 'permissions',(select jsonb_agg(to_jsonb(x) order by screening_id,phone) from icash_contact_permissions x),
 'wallets',(select jsonb_agg(to_jsonb(x) order by account_id) from icash_wallets x),
 'tickets',(select jsonb_agg(to_jsonb(x) order by id) from icash_automation_tickets x))$$;
