alter table icash_call_recordings
 add column id uuid primary key default gen_random_uuid(),add column operation_key text,
 add column state text default 'recording',add column last_action text,add column conversation_id text,
 add column recording_sid text,add column start_claimed_at timestamptz,
 add column provider_account_sid text,add column call_sid text,add column from_phone text,add column to_phone text;
create schema icash_recording_private;
create table icash_recording_private.terminal_cost_receipts(recording_id uuid primary key,receipt jsonb);
create table icash_operation_spend(operation_key text primary key,account_id uuid,state text);
