-- Retain assistant replies and their billing references while allowing a clean workspace.
begin;
set local lock_timeout='5s';
alter table public.icash_workspace_questions add column if not exists archived_at timestamptz;
commit;
