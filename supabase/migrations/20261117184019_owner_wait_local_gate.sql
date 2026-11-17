-- Skip global outreach inspection only when the exact contact source cannot exist.
-- The static hint omits retry clocks; the original wrapper remains authoritative.
-- The migration runner owns the transaction and migration history.
set local lock_timeout='2s';
set local statement_timeout='8s';
set local search_path='';
do $patch$
declare expected record;actual record;entry record;before_policy jsonb;after_policy jsonb;
 before_definition text;after_definition text;original_body text;
 target text:='icash_work_private.owner_enrichment_wait_candidate(uuid)';
 required text[]:=array[
  'icash_work_private.owner_enrichment_candidate_exists(uuid)',
  'icash_work_private.owner_enrichment_wait_candidate(uuid)',
  'icash_work_private.record_export_wait(uuid,timestamptz)',
  'public.icash_enrichment_before_prospecting_budget(uuid)',
  'public.icash_enrichment_before_provider_quota(uuid)'];
 hint text:=$hint$exists(select 1 from public.icash_screening_jobs s
 left join public.icash_automation_tickets t on t.screening_id=s.id
 where s.account_id=p_account and s.state='complete' and s.snapshot->>'propertyType'='house'
 and s.snapshot->'sellerRequest' is null and public.icash_research_state_allowed(s.snapshot->'raw'->'data'->>'state')
 and s.result->'financialCheck'->>'status'='eligible' and s.completed_at>now()-interval '24 hours'
 and (t.id is null or (t.kind='contacts' and t.state='held' and
 ((t.outcome='expired' and t.issue_attempts<3 and not exists(select 1 from public.icash_operation_spend o where o.operation_key='owners:'||s.account_id||':'||s.id))
 or (t.outcome='owner_preview_rate_limited' and t.owner_preview_deferrals>0)))))$hint$;
begin
 perform pg_advisory_xact_lock(726341927);
 select to_jsonb(p) into before_policy from icash_work_private.continuation_policy p where id=1 for update;
 if before_policy is null or jsonb_typeof(before_policy->'owner_wait_hashes') is distinct from 'object'
  or not((before_policy->'owner_wait_hashes') ?& required)
  or (select count(*) from jsonb_object_keys(before_policy->'owner_wait_hashes'))<>cardinality(required)
 then raise exception 'Owner wait local gate policy changed';end if;
 for expected in select * from(values
  ('icash_work_private.owner_enrichment_wait_candidate(uuid)','089ebb9dd46fedfe4e46b8aaf69012f4'),
  ('icash_work_private.owner_enrichment_candidate_exists(uuid)','7cbb08234d4d09c6aa39190be39b9aeb')
 ) source(signature,hash) loop
  select p.*,pg_get_functiondef(p.oid) definition into actual from pg_proc p where p.oid=to_regprocedure(expected.signature);
  if not found or md5(actual.definition) is distinct from expected.hash
   or pg_get_userbyid(actual.proowner) is distinct from 'postgres' or actual.prosecdef
   or actual.provolatile::text is distinct from 's' or actual.proparallel::text is distinct from 'u'
   or actual.proisstrict or actual.proleakproof or actual.proconfig is distinct from array['search_path=""']::text[]
   or actual.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}'
  then raise exception 'Owner wait local gate source or metadata changed: %',expected.signature;end if;
  if expected.signature=target then before_definition:=actual.definition;end if;
 end loop;
 for entry in select * from jsonb_each_text(before_policy->'owner_wait_hashes') loop
  if to_regprocedure(entry.key) is null or md5(pg_get_functiondef(to_regprocedure(entry.key))) is distinct from entry.value
  then raise exception 'Owner wait local gate manifest changed: %',entry.key;end if;
 end loop;
 original_body:=split_part(split_part(before_definition,'AS $function$',2),'$function$',1);
 after_definition:=split_part(before_definition,'AS $function$',1)||'AS $function$'
  ||E'\n select case when '||hint||E' then (\n'||regexp_replace(original_body,';\s*$','')
  ||E'\n ) else false end;\n$function$\n';
 execute after_definition;
 select p.*,pg_get_functiondef(p.oid) definition into actual from pg_proc p where p.oid=to_regprocedure(target);
 if actual.definition is distinct from after_definition or md5(actual.definition) is distinct from '9e35917f3f2fc3802907a8c1f1d243be'
  or pg_get_userbyid(actual.proowner) is distinct from 'postgres' or actual.prosecdef
  or actual.provolatile::text is distinct from 's' or actual.proparallel::text is distinct from 'u'
  or actual.proisstrict or actual.proleakproof or actual.proconfig is distinct from array['search_path=""']::text[]
  or actual.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}'
 then raise exception 'Owner wait local gate result or metadata changed';end if;
 update icash_work_private.continuation_policy
 set owner_wait_hashes=jsonb_set(owner_wait_hashes,array[target],to_jsonb('9e35917f3f2fc3802907a8c1f1d243be'::text))
 where id=1;
 select to_jsonb(p) into after_policy from icash_work_private.continuation_policy p where id=1;
 if after_policy is distinct from jsonb_set(before_policy,array['owner_wait_hashes',target],to_jsonb('9e35917f3f2fc3802907a8c1f1d243be'::text))
 then raise exception 'Owner wait local gate changed unrelated policy fields';end if;
end $patch$;
