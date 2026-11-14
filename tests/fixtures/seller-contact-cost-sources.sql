-- Minimal synthetic source tables for the actual private72h cost reader.
create schema if not exists icash_learning_private;
create schema if not exists icash_recorded_reception_private;
create schema if not exists icash_seller_agreement_private;
create schema if not exists icash_reception_private;
create schema if not exists icash_seller_recovery_private;
create table if not exists icash_seller_gaps(id uuid,account_id uuid,thread_id uuid);
create table if not exists icash_seller_recovery_private.contact_refreshes(id uuid,account_id uuid,original_contact_id uuid,gap_id uuid,operation_key text,requested_at timestamptz,response_at timestamptz);
create table if not exists icash_contract_text_resends(id uuid,account_id uuid,envelope_id uuid,state text,created_at timestamptz,updated_at timestamptz);
create table if not exists icash_text_ai_jobs(id uuid,account_id uuid,thread_id uuid,state text,provider_id text,usage jsonb,created_at timestamptz);
create table if not exists icash_voice_jobs(id uuid,account_id uuid,permission_id uuid,operational_contact_id uuid,operation_key text,provider_call_sid text,state text,created_at timestamptz);
create table if not exists icash_contact_permissions(id uuid,account_id uuid,screening_id uuid,party text);
create table if not exists icash_operational_contacts(id uuid,account_id uuid,screening_id uuid);
create table if not exists icash_customer_phone_calls(id uuid,account_id uuid,screening_id uuid,operation_key text,created_at timestamptz,connected_at timestamptz);
create table if not exists icash_recorded_reception_private.sessions(id uuid,account_id uuid,operation_key text,created_at timestamptz,call_started_at timestamptz,contact_key text);
create table if not exists icash_seller_agreement_private.inbound_bindings(session_id uuid,account_id uuid,deal_id uuid,thread_id uuid);
create table if not exists icash_reception_private.receipts(account_id uuid,operation_key text,reserved_at timestamptz,terminal_at timestamptz,caller_hash text);
create table if not exists icash_deal_emails(id uuid,account_id uuid,deal_id uuid,direction text,contact_key text,state text,provider_id uuid,created_at timestamptz,updated_at timestamptz);
