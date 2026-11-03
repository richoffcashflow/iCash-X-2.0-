alter table icash_text_threads add column party text default 'seller',add column deal_id uuid,add column seller_intake_id uuid,add column retired_at timestamptz;
alter table icash_text_messages add column route_revision bigint,add column event_id text,add column request_key uuid,add column asset_ids uuid[] default '{}';
create table icash_sms_routes(sender text,recipient text,account_id uuid,revision bigint,needs_review boolean);
create table icash_accounts(id uuid primary key);
create table icash_workspace_revisions(account_id uuid primary key,revision bigint default 1,changed_at timestamptz default now());
create table icash_learning_queue(account_id uuid primary key,due_at timestamptz default now(),generation bigint default 1);
create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text);
create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
create table icash_meta_leads(lead_id uuid primary key,account_id uuid,first_outreach_at timestamptz);
create table icash_seller_opener_assignments(thread_id uuid,account_id uuid,body text,message_id uuid,delivered_at timestamptz,first_reply_at timestamptz,opted_out boolean default false);
create table icash_seller_recovery_attempts(account_id uuid,thread_id uuid,message_id uuid,delivered_at timestamptz,responded_at timestamptz,opted_out_at timestamptz);
create table icash_seller_gaps(account_id uuid,thread_id uuid,outgoing_id uuid,state text,created_at timestamptz default now(),updated_at timestamptz default now());
create table fixture_opened_gaps(account_id uuid,thread_id uuid,source_id uuid,kind text);
-- Sentinel downstream side effect: the original production trigger must never
-- reach this routine during canonical recovery or later duplicate callbacks.
create function icash_open_seller_gap(uuid,uuid,text,uuid,text,text,timestamptz) returns void language sql as $$
 insert into public.fixture_opened_gaps values($1,$2,$4,$5);
$$;
grant usage on schema public to service_role,anon,authenticated;
grant select,insert,update on all tables in schema public to service_role;
