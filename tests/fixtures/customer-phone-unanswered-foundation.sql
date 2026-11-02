create table public.icash_operating_budget(id int primary key);
insert into public.icash_operating_budget values(1);
create table public.icash_customer_phone_calls(
 id uuid primary key,account_id uuid,operation_key text,rate_id uuid,created_at timestamptz,
 connection_type text,connected_at timestamptz,recipient_answered_at timestamptz,ended_at timestamptz,settled_at timestamptz,
 parent_sid text,child_sid text,provider_account_sid text,business_phone text,callback_phone text,
 parent_receipt jsonb,child_receipt jsonb,recording_required boolean,recording_state text,
 recording_sid text,recording_deleted_at timestamptz,recording_receipt jsonb
);
create table public.icash_operation_spend(operation_key text primary key,account_id uuid,state text,charge_cap_cents bigint,standard_cost_multiplier numeric);
create table public.icash_operation_rates(id uuid primary key,operation text,version text,costs_micros jsonb);
create table public.settlements(operation text primary key,charge bigint,components jsonb);
create function public.icash_settle_complete_costs(k text,c bigint,p jsonb,e text) returns void language plpgsql as $$begin
 insert into public.settlements values(k,c,p);
 update public.icash_operation_spend set state='settled' where operation_key=k;
end$$;
