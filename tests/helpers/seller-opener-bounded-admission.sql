-- Disposable supplemental fixture, after seller-opener-bounded-scan.sql.
-- Queue, assignment, routing/price/opener triggers and early final Pause gate
-- are exact current captured functions. Source review/cadence remain isolated
-- deterministic fixture boundaries: this does not prove a complete paid send.
alter table icash_text_threads add sender text not null default '+17205550100',
 add seller_intake_id uuid,add retired_at timestamptz;
alter table icash_text_messages alter id set default gen_random_uuid(),alter created_at set default now(),
 add request_key uuid unique,add event_id text unique,add provider_id text unique,
 add asset_ids uuid[] not null default '{}',add attachments jsonb not null default '[]',
 add route_revision bigint,add customer_price_micros bigint,add last_delivery_at timestamptz,
 add updated_at timestamptz default now();
create table icash_customer_identities(account_id uuid primary key,principal text,company_name text);
create table icash_outreach_campaigns(account_id uuid primary key,enabled boolean default true);
create table icash_seller_opener_variants(key text primary key,body text,enabled boolean);
insert into icash_seller_opener_variants values('identity-v3','Original fixture identity',true);
create table icash_seller_opener_assignments(thread_id uuid primary key,account_id uuid,variant text,body text,
 learning_context text,message_id uuid,delivered_at timestamptz,first_reply_at timestamptz,opted_out boolean default false);
create table icash_sms_seller_openings(thread_id uuid primary key,account_id uuid,owner_question_id uuid);
create table icash_text_assets(id uuid,account_id uuid,deal_id uuid,url text,bytes integer,verified_until timestamptz);
create table icash_sms_routes(sender text,recipient text,account_id uuid,revision bigint default 1,needs_review boolean default false,primary key(sender,recipient));
create table icash_text_events(id text,payload jsonb);
create table icash_communication_prices(operation text primary key,customer_micros bigint);
insert into icash_communication_prices values('sms_segment',20800);
create table icash_sms_inbound_invitations(id uuid);
create table icash_seller_intakes(id uuid,phone text,name text);
create table icash_operation_spend(operation_key text primary key,account_id uuid,state text);
-- These are source-selection test boundaries, not financial/provider admission.
create function icash_sms_thread_review_current(a uuid,t uuid,check_hour boolean default true)
 returns boolean language sql as $$select review_allowed and permission_until>now() and (not check_hour or hours_allowed) from public.icash_text_threads where account_id=a and id=t$$;
create function icash_seller_text_cadence_current(a uuid,t uuid) returns boolean language sql as $$select review_allowed from public.icash_text_threads where account_id=a and id=t$$;
-- Unused source and routing exception branches fail closed.
create function icash_seller_contact_evidence(uuid,uuid,uuid,text) returns jsonb language sql as $$select null::jsonb$$;
create function icash_seller_recipient_opener(uuid,uuid,text,text,text) returns text language sql as $$select null::text$$;
create function icash_sms_owner_reply_resolution_current(uuid,uuid,uuid,bigint) returns boolean language sql as $$select false$$;
create function icash_seller_clarification_current(uuid,uuid,uuid,text,bigint) returns boolean language sql as $$select false$$;
create function icash_fresh_intake_opener_current(uuid,uuid,uuid,text,bigint) returns boolean language sql as $$select false$$;
create function fixture_seed_admission(n integer,a integer default 1) returns uuid language plpgsql as $$declare t uuid;begin
 t:=public.fixture_seed(n,a,true);
 insert into public.icash_customer_identities select account_id,'Fixture Investor',null from public.icash_text_threads where id=t on conflict do nothing;
 update public.icash_deal_files set terms='{"address":"123 Main St"}' where id=t;
 insert into public.icash_sms_routes(sender,recipient,account_id) select sender,recipient,account_id from public.icash_text_threads where id=t;
 return t;
end$$;
