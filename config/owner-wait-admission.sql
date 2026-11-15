-- Keep wait bookkeeping distinct from exact current phase admission.
-- The release runner owns the enclosing schema and migration-ledger transaction.
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path='';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;

do $guard$
declare expected record;definition_hash text;actual record;manifest jsonb;entry record;
begin
 if not exists(select 1 from public.icash_operating_budget where id=1) then
  raise exception 'Owner wait admission budget unavailable';
 end if;
 for expected in select * from (values
  ('icash_work_private.record_export_wait(uuid,timestamptz)','96f6087abd08fd4d233b5f14ee1d8cb9',false,'v'),
  ('public.icash_enrichment_before_provider_quota(uuid)','84dd60f566dfc6fc61a88231505d085c',false,'s'),
  ('public.icash_enrichment_before_prospecting_budget(uuid)','20eec96525e745360af5a7e8bb9264c7',false,'s'),
  ('icash_work_private.owner_preflight_step_due(uuid)','7205169e58cbff51c411fa7694fcc0ae',true,'s')
 ) dependency(signature,hash,definer,volatility) loop
  select p.*,md5(pg_get_functiondef(p.oid)) definition_md5 into actual
   from pg_proc p where p.oid=expected.signature::regprocedure;
  if actual.definition_md5 is distinct from expected.hash
   or pg_get_userbyid(actual.proowner) is distinct from 'postgres'
   or actual.prosecdef is distinct from expected.definer
   or actual.provolatile::text is distinct from expected.volatility
   or not has_function_privilege('service_role',actual.oid,'EXECUTE')
   or exists(select 1 from aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) acl
    where acl.privilege_type='EXECUTE' and acl.grantee not in
     (actual.proowner,(select oid from pg_roles where rolname='service_role')))
   then raise exception 'Owner wait admission prerequisite changed: %',expected.signature;end if;
 end loop;
 -- Upgrade only the already activated, reviewed scheduler chain. Keep all
 -- existing activation receipts, counters and exact-count manifests intact.
 definition_hash:=md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure));
 if definition_hash is distinct from '74354d757bc909e3c21923f47c368e24'
  or not exists(select 1 from icash_work_private.continuation_policy where id=1 and enabled
   and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
   and scheduler_hash=definition_hash
   and recorder_hash=md5(pg_get_functiondef('icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean)'::regprocedure)))
  or not exists(select 1 from icash_work_private.preflight_step_policy where id=1 and enabled
   and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
   and function_hashes->>'public.icash_next_acquisition()'=definition_hash
   and function_hashes->>'icash_work_private.owner_preflight_step_due(uuid)'='7205169e58cbff51c411fa7694fcc0ae')
  or not exists(select 1 from icash_research_private.acquisition_headroom_policy where id=1 and enabled
   and activated_at is not null and release_sha~'^[a-f0-9]{40}$' and acquisition_hash=definition_hash)
   then raise exception 'Owner wait admission activated manifest changed';end if;
 select continued_original_hashes into manifest from icash_work_private.continuation_policy where id=1;
 if jsonb_typeof(manifest) is distinct from 'object' or (select count(*) from jsonb_object_keys(manifest))<>4
  or not (manifest ?& array[
   'icash_work_private.continued_owner_preflight_source(uuid,uuid,uuid)',
   'icash_work_private.continued_owner_preflight_deadline(uuid,uuid)',
   'icash_work_private.live_owner_preflight_deadline(uuid,uuid)',
   'public.icash_enrichment_before_prospecting_budget(uuid)']) then
  raise exception 'Owner wait admission source manifest changed';
 end if;
 for entry in select * from jsonb_each_text(manifest) loop
  if to_regprocedure(entry.key) is null
   or md5(pg_get_functiondef(entry.key::regprocedure)) is distinct from entry.value then
   raise exception 'Owner wait admission source definition changed: %',entry.key;
  end if;
 end loop;
end $guard$;

-- Derive existence from the exact post-deadline candidate. Keep its materialized
-- original-source CTE and every final predicate; discard only the selected ID,
-- ranking and LIMIT. No score/deadline ordering can affect boolean existence.
do $candidate$
declare d text:=pg_get_functiondef('public.icash_enrichment_before_prospecting_budget(uuid)'::regprocedure);
 body text;needle text;position_at integer;
begin
 needle:='public.icash_enrichment_before_prospecting_budget(p_account uuid)';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner wait candidate signature changed';end if;
 d:=replace(d,needle,'icash_work_private.owner_enrichment_candidate_exists(p_account uuid)');
 if (length(d)-length(replace(d,' RETURNS uuid','')))<>length(' RETURNS uuid') then raise exception 'Owner wait candidate result changed';end if;
 d:=replace(d,' RETURNS uuid',' RETURNS boolean');
 body:=split_part(split_part(d,'AS $function$',2),'$function$',1);
 needle:=' order by case when exists(select 1 from icash_work_private.continuation_policy where id=1 and enabled and issued%3<>2)';
 if (length(body)-length(replace(body,needle,'')))<>length(needle) then raise exception 'Owner wait candidate ordering changed';end if;
 position_at:=strpos(body,needle);
 body:=left(body,position_at-1);
 needle:='select (c.screening).id from source_candidates c';
 if (length(body)-length(replace(body,needle,'')))<>length(needle) then raise exception 'Owner wait candidate projection changed';end if;
 body:=replace(body,needle,'select exists(select 1 from source_candidates c')||');'||E'\n';
 execute split_part(d,'AS $function$',1)||'AS $function$'||body||'$function$';
end $candidate$;

-- The original wrapper also owns outreach priority, current rate and quote
-- affordability. Clone those exact predicates, replacing only its result.
do $wrapper$
declare d text:=pg_get_functiondef('public.icash_enrichment_before_provider_quota(uuid)'::regprocedure);body text;needle text;
begin
 needle:='public.icash_enrichment_before_provider_quota(p_account uuid)';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner wait wrapper signature changed';end if;
 d:=replace(d,needle,'icash_work_private.owner_enrichment_wait_candidate(p_account uuid)');
 if (length(d)-length(replace(d,' RETURNS uuid','')))<>length(' RETURNS uuid') then raise exception 'Owner wait wrapper result changed';end if;
 d:=replace(d,' RETURNS uuid',' RETURNS boolean');
 body:=split_part(split_part(d,'AS $function$',2),'$function$',1);
 needle:='public.icash_enrichment_before_prospecting_budget(p_account)';
 if (length(body)-length(replace(body,needle,'')))<>length(needle) then raise exception 'Owner wait wrapper source changed';end if;
 body:=replace(body,needle,'icash_work_private.owner_enrichment_candidate_exists(p_account)');
 body:=' select coalesce(('||regexp_replace(body,';\s*$','')||'),false);'||E'\n';
 execute split_part(d,'AS $function$',1)||'AS $function$'||body||'$function$';
end $wrapper$;
revoke all on function icash_work_private.owner_enrichment_candidate_exists(uuid),
 icash_work_private.owner_enrichment_wait_candidate(uuid) from public,anon,authenticated,service_role;
grant execute on function icash_work_private.owner_enrichment_candidate_exists(uuid),
 icash_work_private.owner_enrichment_wait_candidate(uuid) to service_role;

do $wait$
declare d text:=pg_get_functiondef('icash_work_private.record_export_wait(uuid,timestamptz)'::regprocedure);needle text;
begin
 needle:=' if public.icash_enrichment_before_provider_quota(p_account) is null then return false;end if;';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner wait bookkeeping source changed';end if;
 execute replace(d,needle,$replacement$
 -- A coarse quota wait must not intercept a phase already admitted by the
 -- unchanged exact live-list gate. That gate owns source/turn/two-request
 -- eligibility and currently rejects genuine export_busy. Cleaned renewals,
 -- unknown receipts and ordinary two-token turns cannot use this exception.
 if icash_work_private.owner_preflight_step_due(p_account) is true then return false;end if;
 if icash_work_private.owner_enrichment_wait_candidate(p_account) is distinct from true then return false;end if;$replacement$);
end $wait$;

-- These functions are an additive bookkeeping upgrade. No prior policy hash,
-- activation receipt, fair turn, wait row, request counter or balance is reset.
alter table icash_work_private.continuation_policy add column owner_wait_hashes jsonb not null default '{}';
update icash_work_private.continuation_policy set owner_wait_hashes=(
 select jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure))) from unnest(array[
  'icash_work_private.owner_enrichment_candidate_exists(uuid)',
  'icash_work_private.owner_enrichment_wait_candidate(uuid)',
  'icash_work_private.record_export_wait(uuid,timestamptz)',
  'public.icash_enrichment_before_prospecting_budget(uuid)',
  'public.icash_enrichment_before_provider_quota(uuid)'
 ]) signature) where id=1;
