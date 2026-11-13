-- Evaluate each account's classification once, including its read-only evidence.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare definition text;needle text:='classified as (';
begin
 definition:=pg_get_functiondef('public.icash_account_work_observations()'::regprocedure);
 if md5(definition)<>'ac207f34d43ecba970e86200a960ba9c'
  or md5(pg_get_functiondef('icash_reliability_private.account_outreach_wait_evidence(uuid,timestamptz,timestamptz)'::regprocedure))<>'724bd1b882007feedd68a7775b3d215a'
  or not exists(select 1 from icash_reliability_private.outreach_wait_settings where id=1 and not enabled)
 then raise exception 'Inactive account classification predecessor changed';end if;
 if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Account classification boundary changed';end if;
 execute replace(definition,needle,'classified as materialized (');
end $patch$;
commit;
