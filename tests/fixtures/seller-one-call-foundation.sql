-- Synthetic local dependencies only; guarded queue/claim/reserve/create/transition
-- definitions come from the unchanged source snapshot beside this fixture.
do $$begin create role anon;exception when duplicate_object then null;end$$;
do $$begin create role authenticated;exception when duplicate_object then null;end$$;
do $$begin create role service_role bypassrls;exception when duplicate_object then null;end$$;
create schema icash_recording_private;
create schema icash_text_receipt_private;
create table icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false);
create table icash_operating_budget(id integer primary key);insert into icash_operating_budget values(1);
create table fixture_checks(k text primary key,allowed boolean not null default true);
insert into fixture_checks(k) values('context'),('voice'),('operational'),('hours'),('phone'),('inventory'),('capacity'),('operation');
create table icash_screening_jobs(id uuid primary key,account_id uuid,state text default 'complete',snapshot jsonb default '{"propertyId":"fixture-property"}');
create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text default 'draft',terms jsonb default '{}');
create table icash_property_controls(account_id uuid,property_id text,manual boolean);
create table icash_handoffs(account_id uuid,screening_id uuid,state text);
create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,party text default 'seller',phone text,contact_key text,
 timezone text default 'America/Chicago',local_start_hour int default 9,local_end_hour int default 20,permission_evidence text,permission_until timestamptz,
 dnc_clear boolean default false,dnc_checked_at timestamptz,revoked_at timestamptz,seller_intake_id uuid,review_request_id uuid,buyer_id uuid);
create table icash_operational_contacts(id uuid primary key,account_id uuid,screening_id uuid,channel text,phone text,contact_key text,source_hash text,dnc_receipt_id uuid,
 owner_user_id uuid,sending_principal text,revoked_at timestamptz,eligibility_until timestamptz);
create table icash_voice_contact_targets(like icash_contact_permissions including defaults);
alter table icash_voice_contact_targets add primary key(id),add column eligibility_source text default 'operator_record';
create table icash_voice_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,permission_id uuid,operational_contact_id uuid,
 state text default 'ready',due_at timestamptz default now(),created_at timestamptz default now(),updated_at timestamptz default now(),operation_key text,
 callback_id uuid,sms_source_message_id uuid,sms_requested_at timestamptz,sms_requested_by uuid,cancellation_notice_id uuid,meta_offer_lead_id uuid,meta_followup_lead_id uuid,meta_retry_of uuid,
 provider_call_sid text,conversation_id text,outcome text,
 constraint icash_voice_sms_source check(sms_source_message_id is null or (permission_id is not null and operational_contact_id is null and callback_id is null and sms_requested_at is not null)));
create unique index icash_voice_operational_first_once on icash_voice_jobs(operational_contact_id) where callback_id is null;
create unique index icash_voice_sms_source_once on icash_voice_jobs(sms_source_message_id) where not(state='canceled' and outcome is not distinct from 'context_rejected_before_dial');
create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,seller_intake_id uuid,operational_contact_id uuid,party text default 'seller',
 sender text default '+12025550101',recipient text,paused boolean default false,manual_only boolean default false,ai_mode text default 'auto',retired_at timestamptz);
create table icash_text_messages(id uuid primary key default gen_random_uuid(),account_id uuid,thread_id uuid,direction text,state text,body text,
 event_id text,provider_id text,route_revision int default 1,customer_author_id uuid,created_at timestamptz default clock_timestamp(),updated_at timestamptz default clock_timestamp());
create table icash_sms_routes(account_id uuid,sender text,recipient text,revision int default 1,needs_review boolean default false);
create table icash_meta_leads(lead_id uuid primary key,account_id uuid,screening_id uuid,source_id uuid,voice_paused boolean default false,paused boolean default false,declined_at timestamptz,
 first_outreach_at timestamptz,response_at timestamptz,response_channel text);
create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
create table icash_seller_intakes(id uuid primary key,phone text,hold_reason text);
create table icash_text_suppressions(phone text primary key,reason text);
create table icash_contact_suppressions(contact_key text primary key);
create table icash_sms_call_requests(account_id uuid,thread_id uuid,requested_at timestamptz,state text,updated_at timestamptz);
create table icash_text_attention(account_id uuid,thread_id uuid,kind text,state text,updated_at timestamptz);
create table icash_text_ai_jobs(account_id uuid,thread_id uuid,state text,updated_at timestamptz);
create table icash_voice_configs(account_id uuid primary key,enabled boolean default true,reviewed_until timestamptz,agent_id text default 'agent_fixture',max_duration_seconds int default 600,seller_rate_id uuid,buyer_rate_id uuid);
create table icash_operation_rates(id uuid primary key,operation text default 'seller_call',charge_cents bigint default 977,voice_max_duration_seconds int default 600);
create table icash_operation_spend(operation_key text primary key,account_id uuid,state text default 'reserved',permission_until timestamptz,rate_id uuid,customer_price_micros bigint,charge_cap_cents bigint default 977,dispatched_at timestamptz);
create table icash_wallets(account_id uuid primary key,balance_cents bigint default 10000);
create table icash_live_conversations(id uuid primary key default gen_random_uuid(),account_id uuid,screening_id uuid,party text,contact_key text,state text,operation_key text,agent_id text,conversation_id text,strategy_key text,tool_token_hash text,tool_expires_at timestamptz);
create table icash_live_callbacks(id uuid primary key,account_id uuid,state text,due_at timestamptz);
create table icash_timezone_names(name text primary key);insert into icash_timezone_names values('America/Chicago');
create table icash_recording_private.capacity_quarantines(operation_key text);
create function icash_recording_private.clock_now() returns timestamptz language sql volatile as $$select clock_timestamp()$$;
create function icash_recording_private.keys(p jsonb,required text[],optional text[] default '{}') returns boolean language sql immutable as $$select p?&required and not exists(select 1 from jsonb_object_keys(p) k where not k=any(required||optional))$$;
create function icash_text_receipt_private.canonical_update(icash_text_messages,icash_text_messages) returns boolean language sql as $$select false$$;
create function icash_seller_contact_evidence(a uuid,s uuid,l uuid,phone text) returns jsonb language sql as $$select jsonb_build_object('evidence',permission_evidence,'timezone',timezone,'until',permission_until) from public.icash_contact_permissions where account_id=a and screening_id=s and seller_intake_id=l and icash_contact_permissions.phone=$4 and permission_evidence='fixture-source'$$;
create function icash_outreach_voice_current(uuid) returns boolean language sql as $$select allowed from public.fixture_checks where k='voice'$$;
create function icash_operational_contact_current(a uuid,t uuid,ch text,h boolean) returns boolean language sql as $$select allowed and exists(select 1 from public.icash_operational_contacts where id=t and account_id=a and channel=ch and revoked_at is null and eligibility_until>clock_timestamp()) from public.fixture_checks where k='operational'$$;
create function icash_voice_outreach_hours_current(uuid,uuid) returns boolean language sql as $$select allowed from public.fixture_checks where k='hours'$$;
create function icash_seller_phone_call_current(uuid,uuid) returns boolean language sql as $$select allowed from public.fixture_checks where k='phone'$$;
create function icash_claim_inventory(uuid,uuid,text) returns boolean language sql as $$select allowed from public.fixture_checks where k='inventory'$$;
create function icash_voice_capacity_available(uuid,text,text,text,boolean) returns boolean language sql as $$select allowed from public.fixture_checks where k='capacity'$$;
create function icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
create function icash_property_call_sender(uuid,uuid,text) returns text language sql as $$select '+12025550101'$$;
create function icash_buyer_voice_context(uuid) returns jsonb language sql as $$select null::jsonb$$;
create function icash_seller_callback_voice_pending_before_now(uuid) returns boolean language sql as $$select false$$;
create function icash_reserve_operation(a uuid,op text,r uuid,until_at timestamptz,f timestamptz,eligible boolean) returns void language plpgsql as $$begin insert into public.icash_operation_spend(operation_key,account_id,rate_id,permission_until) values(op,a,r,until_at) on conflict do nothing;end$$;
create function icash_claim_operation(op text) returns boolean language plpgsql as $$declare a uuid;begin
 select account_id into a from public.icash_operation_spend where operation_key=op;
 if not public.icash_seller_response_operation_allowed(a,op) or not (select allowed from public.fixture_checks where k='operation') then return false;end if;
 update public.icash_operation_spend set state='dispatched',dispatched_at=clock_timestamp() where operation_key=op and state='reserved';return found;end$$;

-- Real contact-spacing/context dependencies. No constant-true spacing shortcut.
alter table icash_operational_contacts add column timezone_basis text default 'source_record';
alter table icash_meta_leads add column voice_job_id uuid,add column address_confirmed_at timestamptz,add column offer_ready_at timestamptz,add column offer_authorized_at timestamptz;
alter table icash_seller_intakes add column request_id uuid,add column contact_consent_scope text;
alter table icash_live_conversations add column completed_at timestamptz,add column result jsonb;
alter table icash_live_callbacks add column conversation_id uuid,add column screening_id uuid;
create table icash_customer_phone_calls(recipient_phone text,child_sid text,created_at timestamptz);
create table icash_optin_call_requests(expires_at timestamptz,lead_id uuid,request_id uuid,phone text,account_id uuid,source text);
create function icash_call_has_seller_response(jsonb) returns boolean language sql as $$select false$$;
create function icash_cancellation_voice_current(uuid,text) returns boolean language sql as $$select false$$;
create function icash_owner_demo_call_current(uuid,uuid) returns boolean language sql as $$select false$$;
create function icash_meta_followup_call_current(uuid,uuid) returns boolean language sql as $$select false$$;

-- Intake context stays the real intake-only function; operational sources must
-- prove their own narrow call context rather than use a generic fixture {}.
alter table icash_accounts add column assistant_name text default 'Alex';
alter table icash_screening_jobs add column result jsonb default '{"financialCheck":{"status":"eligible"}}',add column completed_at timestamptz default clock_timestamp();
alter table icash_deal_files alter column terms set default '{"address":"123 Example Road"}';
alter table icash_text_threads add column timezone text default 'America/Chicago';
create table icash_customer_identities(account_id uuid primary key,principal text);
create function icash_seller_sms_permission_current(uuid,uuid,boolean) returns boolean language sql as $$select allowed from public.fixture_checks where k='context'$$;
create function icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select allowed from public.fixture_checks where k='context'$$;
create function icash_seller_viewing_context(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;

create table icash_owner_buyer_tests(thread_id uuid);
alter table icash_text_ai_jobs add column id uuid default gen_random_uuid(),add column message_id uuid unique,add column analysis jsonb,add column reply text,add column next_attempt_at timestamptz default now();
create function icash_outreach_sms_current(uuid) returns boolean language sql as $$select true$$;
create function icash_prepare_sms_inbound_reply(uuid,uuid,uuid) returns void language sql as $$select null::void$$;
create function icash_prepare_seller_text_event_before_call_now(text) returns jsonb language sql as $$select null::jsonb$$;
