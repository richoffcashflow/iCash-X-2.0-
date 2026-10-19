-- Local instrumentation only; never execute against a live database.

create role anon;create role authenticated;create role service_role;
create table icash_operating_budget(id int primary key);insert into icash_operating_budget values(1);
create table icash_accounts(id uuid primary key,bot_paused bool default false);
create table icash_voice_configs(account_id uuid primary key,enabled bool default true,reviewed_until timestamptz default now()+interval '1 day');
create table icash_screening_jobs(id uuid primary key,account_id uuid,state text default 'complete',result jsonb default '{"financialCheck":{"status":"eligible"}}');
create table icash_dnc_verification_receipts(id uuid primary key,evidence_kind text default 'national_provider_observation');
create table icash_operational_contacts(id uuid primary key,account_id uuid,screening_id uuid,channel text default 'voice',phone text,contact_key text,dnc_receipt_id uuid,eligibility_until timestamptz default now()+interval '1 day',created_at timestamptz default now(),revoked_at timestamptz);
create index contact_scope on icash_operational_contacts(account_id,screening_id,channel);
create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,phone text,contact_key text);
create table icash_outreach_campaigns(account_id uuid primary key,mode text);
create table icash_voice_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,permission_id uuid,operational_contact_id uuid,callback_id uuid,due_at timestamptz default now(),state text default 'ready',outcome text);
create unique index first_once on icash_voice_jobs(operational_contact_id) where callback_id is null;
create unique index callback_once on icash_voice_jobs(callback_id) where callback_id is not null;
create sequence fixture_route_visits;
create function fixture_route_id(value uuid) returns uuid language plpgsql volatile as $$begin perform nextval('public.fixture_route_visits');return value;end$$;
-- Only instrument the view's identity projection to count route traversal.
-- Both branches and the operational receipt/channel membership match production.
create view icash_voice_contact_targets as
 select fixture_route_id(id) id,account_id,screening_id,contact_key from icash_contact_permissions
 union all select fixture_route_id(c.id),c.account_id,c.screening_id,c.contact_key
 from icash_operational_contacts c join icash_dnc_verification_receipts d on d.id=c.dnc_receipt_id where c.channel='voice';
create table icash_live_conversations(id uuid primary key,account_id uuid,state text,party text,result jsonb,contact_key text);
create table icash_live_callbacks(id uuid primary key,account_id uuid,conversation_id uuid,screening_id uuid,state text,due_at timestamptz);
create table fixture_checks(contact_id uuid primary key,account_id uuid,allowed boolean);
create table fixture_calls(contact_id uuid);
create function icash_prepare_operational_contacts() returns int language sql as $$select 0$$;
create function icash_queue_voice_jobs_before_operational() returns void language plpgsql as $$begin end$$;
create table fixture_channels(account_id uuid primary key,enabled bool);
create sequence fixture_channel_visits;
create function icash_outreach_voice_current(uuid) returns bool language plpgsql stable set search_path=public as $$begin perform nextval('public.fixture_channel_visits');return (select enabled from fixture_channels where account_id=$1);end$$;
create function icash_operational_contact_current(uuid,uuid,text,boolean) returns bool language plpgsql set search_path=public as $$begin insert into fixture_calls values($2);return exists(select 1 from fixture_checks where contact_id=$2 and account_id=$1 and allowed) and $3='voice' and $4=false;end$$;
