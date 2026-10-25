-- Restrict contact lookups to each active job before joining the contact union.
-- This changes query planning only; every row and terminal-receipt gate remains.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;
 old_join text:=$old$ left join public.icash_voice_contact_targets t on t.id=coalesce(j.permission_id,j.operational_contact_id) and t.account_id=j.account_id$old$;
begin
 d:=pg_get_functiondef('public.icash_active_voice_slots()'::regprocedure);
 if md5(d)<>'a5a548f0e07a96385ad49f8d28749c10' or position(old_join in d)=0 then raise exception 'Narrow capacity prerequisite changed';end if;
 execute replace(d,old_join,$new$ left join lateral (
  select target.contact_key from public.icash_voice_contact_targets target
  where target.id=coalesce(j.permission_id,j.operational_contact_id) and target.account_id=j.account_id
  offset 0
 ) t on true$new$);
end $patch$;
commit;
