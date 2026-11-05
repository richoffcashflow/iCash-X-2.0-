-- Only the additional source columns used by unknown-response recovery.
alter table icash_research_private.owner_batches add column primary_screening uuid,add column results jsonb;
create table public.icash_automation_tickets(id uuid primary key,account_id uuid,screening_id uuid,kind text,state text,created_at timestamptz,expires_at timestamptz,completed_at timestamptz,outcome text,issue_attempts integer);
