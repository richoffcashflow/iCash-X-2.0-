-- The invoker recovery function uses only the table grants already assigned to
-- service_role. Other recording tables and private functions stay inaccessible.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
grant usage on schema icash_recording_private to service_role;
commit;
