-- Synchronize the existing provider list without enabling its use in ordinary
-- research queries. Disabled at install; no creation, recovery or reserve grant.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table icash_research_private.settings add column exclusion_sync_enabled boolean not null default false;
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_claim_research_exclusions()'::regprocedure);
 if md5(d)<>'2acad0140b2f0491097e81f8686851cf' then raise exception 'Exclusion sync claim prerequisite changed';end if;
 needle:='where id=1 and enabled and exclusions_enabled)';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Exclusion sync settings boundary changed';end if;
 d:=replace(d,needle,'where id=1 and enabled and (exclusions_enabled or exclusion_sync_enabled))');
 needle:=' if s.list_id is null then action:=';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Exclusion sync action boundary changed';end if;
 -- Inspect the original saved list under the existing row lock. The independent
 -- switch can only issue a sync lease for this exact ready list. Full legacy
 -- authorization still controls list creation/recovery and ordinary query use.
 execute replace(d,needle,$boundary$
 if not exists(select 1 from icash_research_private.settings where id=1 and enabled and exclusions_enabled) then
  if s.list_id is null or s.state<>'ready' or not exists(select 1 from icash_research_private.settings
   where id=1 and enabled and exclusion_sync_enabled) then return null;end if;
 end if;
$boundary$||needle);
end $patch$;
-- The starter claim retains its original reserve-only body and exact list proof.
-- Its existing ordinary-capacity delegate calls the updated global claim; the
-- independent switch never authorizes use of the protected starter allowance.
-- Finish/admission/configuration functions and all saved receipts are unchanged.
commit;
