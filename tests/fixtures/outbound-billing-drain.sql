-- Disposable synthetic data only. Canonical queue/readback functions load after this.
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end $$;
drop schema if exists icash_outbound_billing_private cascade;
drop schema public cascade;create schema public;
grant usage on schema public to anon,authenticated,service_role;
create table icash_operation_rates(id uuid primary key,operation text);
create table icash_operation_spend(operation_key text primary key,account_id uuid,rate_id uuid,state text,cost_basis text,charged_cents bigint,charge_cap_cents bigint,actual_micros bigint,credit_reservation_id uuid,settlement_evidence text);
create table icash_live_conversations(id uuid primary key,account_id uuid,operation_key text unique,party text,state text,completed_at timestamptz);
create table icash_credit_reservations(id uuid primary key,account_id uuid,operation_key text unique,amount_cents bigint,settled_cents bigint,status text);
create table icash_cost_manifests(operation_key text primary key,charge_cents bigint,actual_micros bigint,components jsonb,evidence_ref text);
create table icash_credit_ledger(account_id uuid,event_key text unique,kind text,delta_cents bigint,evidence_ref text);
insert into icash_operation_rates values('00000000-0000-4000-8000-000000000001','seller_call');
create function fixture_billing_seed(n integer,settled boolean default true,charge integer default 16) returns uuid language plpgsql as $$
declare c uuid:=('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
 a uuid:='00000000-0000-4000-8000-000000999999';op text:='voice:'||c;parts jsonb;
begin
 insert into icash_operation_spend values(op,a,'00000000-0000-4000-8000-000000000001','dispatched',null,null,65,null,c,null);
 insert into icash_credit_reservations values(c,a,op,65,null,'reserved');
 insert into icash_live_conversations values(c,a,op,'seller','complete',now());
 if settled then
  select jsonb_object_agg(k,jsonb_build_object('amountMicros',case when k='elevenlabs' then 29000 when k='twilio' then 12900 else 0 end,'basis','estimated')) into parts
  from unnest(array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other']) k;
  update icash_operation_spend set state='settled',cost_basis='estimated',charged_cents=charge,actual_micros=41900,settlement_evidence='SYNTHETIC' where operation_key=op;
  insert into icash_cost_manifests values(op,charge,41900,parts,'SYNTHETIC');
  update icash_credit_reservations set status=case when charge=0 then 'released' else 'settled' end,settled_cents=nullif(charge,0) where operation_key=op;
  if charge>0 then insert into icash_credit_ledger values(a,'usage:'||op,'usage',-charge,'SYNTHETIC');end if;
 end if;
 return c;
end $$;
