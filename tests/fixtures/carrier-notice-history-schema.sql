-- Extensions to the synthetic projection schema for exact current context readers.
alter table icash_accounts add column bot_paused boolean default false;
alter table icash_text_threads add column paused boolean default false, add column manual_only boolean default false;
alter table icash_live_conversations add column contact_key text,add column tool_token_hash text,add column tool_expires_at timestamptz,add column agent_id text;
alter table icash_operation_spend add column rate_id uuid,add column charge_cap_cents bigint;
alter table icash_voice_contact_targets add column contact_key text,add column revoked_at timestamptz,add column permission_until timestamptz;
create view icash_contact_permissions as select * from icash_voice_contact_targets;
create table icash_contact_suppressions(contact_key text);
create table icash_text_suppressions(phone text);
create table icash_property_controls(account_id uuid,property_id text,manual boolean);
create table icash_operation_rates(id uuid,operation text);
create table icash_inbound_voice_receipts(call_sid text,conversation_id text,binding_hash text,live_call_id uuid);
create table icash_voice_configs(account_id uuid,agent_id text,enabled boolean,reviewed_until timestamptz);
create table icash_owner_buyer_tests(thread_id uuid);
create table icash_sms_route_reviews(message_id uuid,account_id uuid,sender text,recipient text,candidate_threads uuid[],reason text,created_at timestamptz,resolved_at timestamptz);
create table icash_sms_routes(sender text,recipient text,account_id uuid,revision bigint,needs_review boolean);
create table icash_text_attention(id uuid,account_id uuid,message_id uuid,thread_id uuid,screening_id uuid,party text,kind text,quote text,state text);
create table icash_handoffs(id uuid,account_id uuid,screening_id uuid,party text,summary text,text_attention_id uuid,conversation_id uuid,closing_setup_id uuid,portal_journey_id uuid,state text);
alter table icash_sms_route_reviews enable row level security;
alter table icash_handoffs enable row level security;
revoke all on icash_sms_route_reviews,icash_handoffs from public,anon,authenticated;
grant select on icash_sms_route_reviews,icash_handoffs,icash_text_attention,icash_text_messages to service_role;

create schema icash_recorded_reception_private;
create schema icash_reception_private;
create schema icash_callback_private;
create table icash_recorded_reception_private.sessions(
 id uuid,config_id uuid,account_id uuid,operation_key text,nonce_hash text,state text,consent_at timestamptz,recording_authorized_at timestamptz,recording_sid text,
 register_claimed_at timestamptz,conversation_id text,end_requested_at timestamptz,call_ended_at timestamptz,from_phone text,call_deadline_at timestamptz,
 rate_id uuid,charge_cap_cents bigint,callback_route jsonb default '{}',configuration jsonb default '{}');
create table icash_recorded_reception_private.configs(id uuid,owner_user_id uuid,enabled boolean,approved_at timestamptz,reviewed_until timestamptz,context_policy text,context_policy_hash text,context_approval_reference text);
create table icash_reception_private.receipts(call_sid text,receipt_nonce text,state text,operation_key text,conversation_id text,account_id uuid,reserved_at timestamptz,max_duration_seconds integer,config_hash text,agent_id text,called_number text,branch_id text,reviewed_version_id text,call_profile text,rate_id uuid,customer_charge_cap_cents bigint);
create table icash_reception_private.config(id integer,account_id uuid,owner_user_id uuid,enabled boolean,approved_at timestamptz,reviewed_until timestamptz,context_policy text,context_policy_hash text,context_approval_reference text,allow_inbound_while_paused boolean,inbound_pause_approval_reference text,max_duration_seconds integer,config_hash text,agent_id text,called_number text,branch_id text,reviewed_version_id text,call_profile text,rate_id uuid,customer_charge_cap_cents bigint);
-- External admission helpers are deliberately fixed to inert local outcomes;
-- the real functions retain all receipt/nonce/account/contact joins above them.
create function icash_recorded_reception_private.clock_now() returns timestamptz language sql stable as $$select now()$$;
create function icash_recorded_reception_private.return_call_focus(uuid,text,timestamptz) returns uuid language sql as $$select null::uuid$$;
create function icash_callback_private.config_current(icash_recorded_reception_private.configs) returns boolean language sql as $$select true$$;
create function icash_callback_private.session_current(icash_recorded_reception_private.sessions) returns boolean language sql as $$select true$$;
create function icash_callback_private.call_context(icash_recorded_reception_private.sessions) returns jsonb language sql as $$select null::jsonb$$;
create function icash_recorded_reception_private.contact_first_name(uuid,uuid,text,text) returns text language sql as $$select null::text$$;
create function icash_buyer_package_data(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;

alter table icash_text_attention add column deal_id uuid,add column updated_at timestamptz default now();
alter table icash_handoffs add column created_at timestamptz default now(),add column updated_at timestamptz default now(),add column due_at timestamptz default now();
alter table icash_signing_envelopes add column id uuid;
create table icash_sms_call_requests(id uuid,account_id uuid,message_id uuid,thread_id uuid,screening_id uuid,deal_id uuid,requested_at timestamptz,state text);
create table icash_live_callbacks(id uuid,account_id uuid,screening_id uuid,state text,due_at timestamptz);
create table icash_title_tasks(id uuid,account_id uuid,deal_id uuid,state text,kind text,due_date date,updated_at timestamptz);
