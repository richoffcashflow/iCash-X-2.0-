do $$begin create role anon;exception when duplicate_object then null;end$$;
do $$begin create role authenticated;exception when duplicate_object then null;end$$;
do $$begin create role service_role;exception when duplicate_object then null;end$$;
create schema icash_recording_private;
create function icash_recording_private.audit_immutable() returns trigger language plpgsql as $$begin raise exception 'Immutable recording audit';end$$;
create function icash_recording_private.clock_now() returns timestamptz language sql volatile as $$select clock_timestamp()$$;
create function icash_recording_private.keys(p jsonb,required text[],optional text[] default '{}') returns boolean language sql immutable as $$select p?&required and not exists(select 1 from jsonb_object_keys(p) k where not k=any(required||optional))$$;
create table icash_accounts(id uuid primary key,bot_paused boolean default false);
create table icash_operation_rates(id uuid primary key,operation text,version text,charge_cents bigint,voice_max_duration_seconds integer);
create table icash_operating_budget(id integer primary key,reserved_micros bigint,spent_micros bigint default 0,enabled boolean default true,minimum_margin_bps integer default 0,hold_reason text);
insert into icash_operating_budget(id,reserved_micros) values(1,0);
create table icash_credit_reservations(id uuid primary key,account_id uuid,operation_key text,amount_cents bigint,status text);
create table icash_operation_spend(operation_key text primary key,account_id uuid,rate_id uuid,credit_reservation_id uuid,charge_cap_cents bigint,reserved_micros bigint,state text,dispatched_at timestamptz,actual_micros bigint,charged_cents bigint,settled_at timestamptz,settlement_evidence text,customer_price_micros bigint,permission_until timestamptz);
create table icash_voice_jobs(id uuid primary key,account_id uuid,operation_key text,state text,outcome text,provider_call_sid text,conversation_id text,permission_id uuid,operational_contact_id uuid,updated_at timestamptz);
create table icash_voice_contact_targets(id uuid primary key,account_id uuid,screening_id uuid,party text,phone text,contact_key text,revoked_at timestamptz,permission_until timestamptz,dnc_clear boolean);
create table icash_voice_configs(account_id uuid primary key,agent_id text,max_duration_seconds integer,enabled boolean,reviewed_until timestamptz,seller_rate_id uuid,buyer_rate_id uuid);
create table icash_automation_tickets(id uuid primary key,token text,account_id uuid,voice_job_id uuid,kind text,state text,expires_at timestamptz,created_at timestamptz,completed_at timestamptz,outcome text);
create table icash_call_recordings(id uuid primary key default gen_random_uuid(),operation_key text unique,voice_job_id uuid,account_id uuid,entry_policy text,party text,dial_claimed_at timestamptz,
 provider_account_sid text,call_sid text,recording_sid text,conversation_id text,nonce_hash text,stop_token_hash text,disclosure_version text,pricing_policy jsonb,from_phone text,to_phone text,branch_id text,version_id text,call_context jsonb,
 permission_id uuid,operational_contact_id uuid,screening_id uuid,contact_key text,agent_id text,rate_id uuid,charge_cap_cents bigint,max_total_seconds integer,created_at timestamptz,consent_deadline_at timestamptz,updated_at timestamptz,next_reconcile_at timestamptz);
create table icash_live_conversations(id uuid primary key default gen_random_uuid(),operation_key text);
create table icash_cost_observations(source_ref text,event_key text);
create table icash_cost_manifests(operation_key text);
create schema if not exists icash_private;
create table icash_private.provider_costs(operation_key text);
create table icash_recording_private.capacity_quarantines(operation_key text primary key);
create table fixture_margin(allowed boolean);
insert into fixture_margin values(true);
create function icash_account_margin_ok(uuid,bigint,bigint,boolean) returns boolean language sql set search_path=public as $$select allowed from fixture_margin$$;
create table fixture_credit_finishes(operation_key text primary key,charge bigint,evidence text);
create function icash_finish_credit(p_account uuid,p_operation text,p_charge bigint,p_evidence text) returns void language plpgsql set search_path=public as $$begin
 insert into fixture_credit_finishes values(p_operation,p_charge,p_evidence);
 update icash_credit_reservations set status=case when p_charge=0 then 'released' else 'settled' end where account_id=p_account and operation_key=p_operation;
end$$;
create function icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
create function icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql as $$select false$$;
create function icash_property_call_sender(uuid,uuid,text) returns text language sql as $$select '+12025550101'::text$$;
create function fixture_predial_seed(n integer) returns jsonb language plpgsql as $$
declare a uuid:='00000000-0000-4000-8000-000000000001';r uuid:='00000000-0000-4000-8000-000000000002';
 j uuid:=('00000000-0000-4000-8000-'||lpad((n*10)::text,12,'0'))::uuid;
 ticket uuid:=('00000000-0000-4000-8000-'||lpad((n*10+1)::text,12,'0'))::uuid;
 reservation uuid:=('00000000-0000-4000-8000-'||lpad((n*10+2)::text,12,'0'))::uuid;
 token text:=ticket::text||ticket::text;stamp timestamptz:=clock_timestamp();op text:='voice:'||j;
begin
 insert into icash_accounts(id) values(a) on conflict do nothing;
 insert into icash_operation_rates values(r,'seller_call','required-audio-30d-speech-v1:fixture',977,600) on conflict do nothing;
 insert into icash_voice_configs values(a,'agent_fixture',600,true,stamp+interval '1 day',r,null) on conflict do nothing;
 insert into icash_credit_reservations values(reservation,a,op,977,'reserved');
 insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,dispatched_at,permission_until) values(op,a,r,reservation,977,1000000,'dispatched',stamp,stamp+interval '1 day');
 update icash_operating_budget set reserved_micros=reserved_micros+1000000 where id=1;
 insert into icash_voice_jobs values(j,a,op,'dispatching',null,null,null,j,null,stamp);
 insert into icash_voice_contact_targets values(j,a,j,'seller','+12025550102','bound-fixture-contact',null,stamp+interval '1 day',true);
 insert into icash_automation_tickets values(ticket,token,a,j,'voice_dispatch','consumed',stamp+interval '2 minutes',stamp-interval '1 second',null,null);
 return jsonb_build_object('account',a,'job',j,'operation',op,'ticket',ticket,'token',token,'dispatchedAt',stamp,'reservation',reservation);
end$$;
