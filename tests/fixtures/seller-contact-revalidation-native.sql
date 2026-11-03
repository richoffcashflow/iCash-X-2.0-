-- Disposable native lock fixture. Contact validators are explicit deterministic
-- substitutes here; the PGlite suite executes the actual contact/SMS functions.
create table icash_operating_budget(id integer primary key,enabled boolean);
insert into icash_operating_budget values(1,true);
create table icash_accounts(id uuid primary key,bot_paused boolean default false);
create table icash_screening_jobs(id uuid primary key,account_id uuid,state text,result jsonb,completed_at timestamptz,snapshot jsonb);
create table icash_property_controls(account_id uuid,property_id text,manual boolean);
create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text default 'draft',terms jsonb default '{}');
create table icash_operation_rates(id uuid primary key,expires_at timestamptz);
create table icash_operation_spend(operation_key text primary key,account_id uuid,state text,dispatched_at timestamptz);
create table icash_owner_contacts(account_id uuid,screening_id uuid,operation_key text);
create table icash_dnc_verification_sources(id uuid primary key,enabled boolean,source_reference text,expires_at timestamptz);
create table icash_dnc_verification_receipts(id uuid primary key,source_id uuid,checked_at timestamptz,expires_at timestamptz,clear boolean,revoked_at timestamptz);
create table icash_operational_contacts(id uuid primary key,account_id uuid,screening_id uuid,channel text,phone text,contact_key text,
 owner_user_id uuid,sending_principal text,source_hash text,timezone text,timezone_basis text,local_start_hour integer,local_end_hour integer,
 dnc_receipt_id uuid,eligibility_until timestamptz,revoked_at timestamptz);
create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,sender text,recipient text,timezone text,
 paused boolean default false,manual_only boolean default false,ai_mode text default 'auto',retired_at timestamptz,seller_intake_id uuid,
 operational_contact_id uuid,eligibility_until timestamptz,sms_rate_id uuid,dnc_checked_at timestamptz,dnc_clear boolean);
create table icash_sms_routes(sender text,recipient text,account_id uuid,needs_review boolean default false);
create table icash_seller_gaps(id uuid primary key,account_id uuid,deal_id uuid,screening_id uuid,thread_id uuid,source text,source_id uuid,
 reason text,stage text,channel text,quote text,state text,review_reason text,source_at timestamptz,due_at timestamptz,expires_at timestamptz,outgoing_id uuid,updated_at timestamptz);
create table icash_text_messages(id uuid primary key,account_id uuid,thread_id uuid,direction text,state text,provider_id text,event_id uuid,
 created_at timestamptz,body text,customer_author_id uuid);
create table icash_text_ai_jobs(id uuid,account_id uuid,thread_id uuid,message_id uuid,outgoing_id uuid,state text);
create table icash_seller_recovery_attempts(thread_id uuid);
create table icash_live_callbacks(account_id uuid,screening_id uuid,state text);
create table icash_live_conversations(account_id uuid,screening_id uuid,contact_key text,state text,completed_at timestamptz,conversation_id text,result jsonb);
create table icash_text_suppressions(phone text);
create table icash_contact_suppressions(contact_key text);
create table icash_cancellation_notices(account_id uuid,sms_id uuid);
create function icash_authority_no_mutation() returns trigger language plpgsql as $$begin raise exception 'Append-only evidence';end$$;
create function icash_operational_contact_current(uuid,uuid,text,boolean) returns boolean language sql set search_path='public' as $$
 select exists(select 1 from icash_operational_contacts c join icash_dnc_verification_receipts r on r.id=c.dnc_receipt_id
 where c.account_id=$1 and c.id=$2 and c.channel=$3 and c.revoked_at is null and c.eligibility_until>clock_timestamp()
 and r.clear and r.revoked_at is null and r.expires_at>clock_timestamp())$$;
create function icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql set search_path='public' as $$
 select exists(select 1 from icash_text_threads t where t.account_id=$1 and t.id=$2 and t.eligibility_until>clock_timestamp()
 and icash_operational_contact_current($1,t.operational_contact_id,'sms',$3))$$;
create function icash_seller_response_disposition(text) returns text language sql immutable as $$select case when $1='STOP' then 'opt_out' end$$;
create function icash_call_has_seller_response(jsonb) returns boolean language sql immutable as $$select false$$;
create function icash_seller_conversation_context(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
create function icash_seller_sms_permission_current(uuid,uuid,boolean) returns boolean language sql set search_path='public' as $$select false$$;
create function icash_current_viewing_slots(uuid,uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
