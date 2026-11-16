-- Ranking needs settled-use progress, not pending-cost or planning-relief reports.
-- Preserve the full customer target function and every final financial check.
-- The normal migration runner owns the transaction, including its ledger insert.
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path='';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $source$
declare p record;
begin
 select *,pg_get_functiondef(oid) definition into p from pg_proc
  where oid='public.icash_daily_work_target(uuid)'::regprocedure;
 if md5(p.definition) is distinct from '40c0467f3e5d457057a60806df8a29f1'
  or pg_get_userbyid(p.proowner) is distinct from 'postgres'
  or p.prosecdef or p.provolatile::text is distinct from 's'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or not has_function_privilege('service_role',p.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
   where acl.privilege_type='EXECUTE' and acl.grantee not in
    (p.proowner,(select oid from pg_roles where rolname='service_role'))) then
  raise exception 'Research priority target prerequisite changed';
 end if;
end $source$;

create function icash_work_private.daily_work_priority(p_account uuid) returns numeric
language sql stable security invoker set search_path='' as $priority$
 with budget as (
  select baseline_cents from public.icash_prospecting_budgets
  where account_id=p_account order by id desc limit 1
 ), usage as (
  select coalesce(sum(greatest(0,o.charged_cents-coalesce(c.covered_cents,0))),0)::bigint spent
  from public.icash_operation_spend o
  left join public.icash_duplicate_discovery_coverage c
   on c.operation_key=o.operation_key and c.account_id=o.account_id
  where o.account_id=p_account and o.state='settled'
   and o.settled_at>now()-interval '24 hours'
 ), target as (
  select floor(baseline_cents::numeric*0.50)::bigint cents from budget
 )
 select case when t.cents>0 then least(1,u.spent::numeric/t.cents) else 1 end
 from target t cross join usage u;
$priority$;
revoke all on function icash_work_private.daily_work_priority(uuid) from public,anon,authenticated;
grant execute on function icash_work_private.daily_work_priority(uuid) to service_role;

do $patch$
declare d text;actual record;new_hash text;continuation_before jsonb;step_before jsonb;headroom_before jsonb;
 needle text:='coalesce((public.icash_daily_work_target(d.account_id)->>''priorityRatio'')::numeric,1)';
begin
 if not exists(select 1 from public.icash_operating_budget where id=1) then
  raise exception 'Research priority budget unavailable';
 end if;
 select p.*,pg_get_functiondef(p.oid) definition into actual
  from pg_proc p where p.oid='public.icash_next_acquisition()'::regprocedure;
 if md5(actual.definition) is distinct from 'babca17c5b3e89dac4931c803ba61405'
  or pg_get_userbyid(actual.proowner) is distinct from 'postgres'
  or actual.prosecdef or actual.provolatile::text is distinct from 'v'
  or not has_function_privilege('service_role',actual.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) acl
   where acl.privilege_type='EXECUTE' and acl.grantee not in
    (actual.proowner,(select oid from pg_roles where rolname='service_role'))) then
  raise exception 'Research priority scheduler prerequisite changed';
 end if;
 -- Lock and validate the already active policy chain. Do not reactivate it or
 -- replace any other dependency hash, release receipt or fairness counter.
 perform 1 from icash_work_private.continuation_policy where id=1 for update;
 perform 1 from icash_work_private.preflight_step_policy where id=1 for update;
 perform 1 from icash_research_private.acquisition_headroom_policy where id=1 for update;
 if not exists(select 1 from icash_work_private.continuation_policy where id=1 and enabled
   and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
   and scheduler_hash=md5(actual.definition))
  or not exists(select 1 from icash_work_private.preflight_step_policy where id=1 and enabled
   and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
   and jsonb_typeof(function_hashes)='object'
   and (select count(*) from jsonb_object_keys(function_hashes))=18
   and function_hashes->>'public.icash_next_acquisition()'=md5(actual.definition))
  or not exists(select 1 from icash_research_private.acquisition_headroom_policy where id=1 and enabled
   and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
   and acquisition_hash=md5(actual.definition)) then
  raise exception 'Research priority activated manifest changed';
 end if;
 -- Capture under the same row locks so ordinary concurrent issuance cannot
 -- obscure proof that this migration preserves every non-target policy field.
 select to_jsonb(p)-'scheduler_hash' into continuation_before
  from icash_work_private.continuation_policy p where id=1;
 select to_jsonb(p) #- array['function_hashes','public.icash_next_acquisition()'] into step_before
  from icash_work_private.preflight_step_policy p where id=1;
 select to_jsonb(p)-'acquisition_hash' into headroom_before
  from icash_research_private.acquisition_headroom_policy p where id=1;
 d:=actual.definition;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then
  raise exception 'Research priority lock source changed';
 end if;
 execute replace(d,needle,'coalesce(icash_work_private.daily_work_priority(d.account_id),1)');
 new_hash:=md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure));
 update icash_work_private.continuation_policy set scheduler_hash=new_hash where id=1;
 update icash_work_private.preflight_step_policy set function_hashes=jsonb_set(function_hashes,
  array['public.icash_next_acquisition()'],to_jsonb(new_hash)) where id=1;
 update icash_research_private.acquisition_headroom_policy set acquisition_hash=new_hash where id=1;
 if (select to_jsonb(p)-'scheduler_hash' from icash_work_private.continuation_policy p where id=1)
   is distinct from continuation_before
  or (select to_jsonb(p) #- array['function_hashes','public.icash_next_acquisition()']
   from icash_work_private.preflight_step_policy p where id=1) is distinct from step_before
  or (select to_jsonb(p)-'acquisition_hash' from icash_research_private.acquisition_headroom_policy p where id=1)
   is distinct from headroom_before then
  raise exception 'Research priority policy preservation failed';
 end if;
end $patch$;
