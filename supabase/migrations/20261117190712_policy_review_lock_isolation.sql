-- Separate optional review cursors from synchronous canonical policy pointers.
-- Run inside the migration runner's transaction, including its ledger write.
set local lock_timeout='1s';
set local statement_timeout='15s';
do $guard$
declare item record;
begin
 for item in select * from (values
  ('icash_learning_private.observe_policy_decision()','76d3f94ade8ea173659f058f3b55c549'),
  ('icash_learning_private.record_policy_application()','503334dfe3df197bdfbc4a09482ae086'),
  ('public.icash_record_learning_policy_hold(bigint,uuid,text)','8f5cff0fb9c04cc28da44ee45084d887'),
  ('public.icash_review_policy_cohorts()','eda5be44fa0b84b369edad854e83f558'),
  ('public.icash_advance_policy_proposal(bigint)','d2ce7d23e7de54aa0476aa6cb722c9a9')
 ) x(signature,expected) loop
  if md5(pg_get_functiondef(to_regprocedure(item.signature))) is distinct from item.expected then
   raise exception 'Policy review predecessor changed: %',item.signature;
  end if;
 end loop;
 if not exists(select 1 from pg_class where oid='icash_learning_private.policy_cohorts'::regclass and relkind='r' and relrowsecurity)
  or to_regclass('icash_learning_private.policy_cohort_sources') is not null
  or to_regclass('icash_learning_private.policy_cohort_reviews') is not null then
  raise exception 'Policy review relations changed';
 end if;
end $guard$;
-- Do not queue a schema lock behind ordinary dispatch or learning work.
lock table icash_learning_private.policy_cohorts in access exclusive mode nowait;
create temporary table icash_policy_review_split_before on commit drop as
 select * from icash_learning_private.policy_cohorts;
alter table icash_learning_private.policy_cohorts rename to policy_cohort_sources;
create table icash_learning_private.policy_cohort_reviews(
 domain text not null,context text not null,market text not null,policy_version text not null,
 last_reviewed_at timestamptz,last_error_at timestamptz,last_error_code text,
 primary key(domain,context,market,policy_version),
 foreign key(domain,context,market,policy_version)
  references icash_learning_private.policy_cohort_sources(domain,context,market,policy_version)
);
insert into icash_learning_private.policy_cohort_reviews
 select domain,context,market,policy_version,last_reviewed_at,last_error_at,last_error_code
 from icash_learning_private.policy_cohort_sources;
alter table icash_learning_private.policy_cohort_reviews enable row level security;
revoke all on icash_learning_private.policy_cohort_reviews from public,anon,authenticated,service_role;
grant select on icash_learning_private.policy_cohort_reviews to service_role;
drop index icash_learning_private.policy_cohort_review_due;
create index policy_cohort_review_due on icash_learning_private.policy_cohort_reviews
 (last_reviewed_at nulls first,domain,context,market,policy_version);
alter table icash_learning_private.policy_cohort_sources
 drop column last_reviewed_at,drop column last_error_at,drop column last_error_code;
-- Preserve the existing private read shape; callers see current source pointers
-- and current review diagnostics together, with the caller's original rights.
create view icash_learning_private.policy_cohorts with(security_invoker=true) as
 select s.domain,s.context,s.market,s.policy_version,s.latest_decision_id,s.latest_application_id,
  r.last_reviewed_at,r.last_error_at,r.last_error_code
 from icash_learning_private.policy_cohort_sources s
 join icash_learning_private.policy_cohort_reviews r using(domain,context,market,policy_version);
revoke all on icash_learning_private.policy_cohorts from public,anon,authenticated,service_role;
grant select on icash_learning_private.policy_cohorts to service_role;

-- Only a newly inserted source cohort needs a cursor. Existing decision/app
-- updates never write or conflict with a review cursor.
create function icash_learning_private.initialize_policy_cohort_review() returns trigger
 language plpgsql security invoker set search_path='' as $function$
begin
 insert into icash_learning_private.policy_cohort_reviews(domain,context,market,policy_version)
 values(new.domain,new.context,new.market,new.policy_version);
 return new;
end $function$;
revoke all on function icash_learning_private.initialize_policy_cohort_review() from public,anon,authenticated,service_role;
create trigger policy_cohort_review_initialize after insert on icash_learning_private.policy_cohort_sources
 for each row execute function icash_learning_private.initialize_policy_cohort_review();

do $patch$
declare signature text;d text;old_scan text:=$old$
 for c in select x.*,d.created_at decision_at,d.decision from icash_learning_private.policy_cohorts x join icash_learning_policy_private.decisions d on d.id=x.latest_decision_id
  where (x.last_reviewed_at is null or x.last_reviewed_at<=now()-interval '1 hour') and d.created_at>=now()-interval '6 hours'
  order by x.last_reviewed_at nulls first,x.domain,x.context,x.market,x.policy_version limit 20 for update of x skip locked$old$;
 new_scan text:=$new$
 for c in select x.*,r.last_reviewed_at,r.last_error_at,r.last_error_code,d.created_at decision_at,d.decision
  from icash_learning_private.policy_cohort_sources x
  join icash_learning_private.policy_cohort_reviews r using(domain,context,market,policy_version)
  join icash_learning_policy_private.decisions d on d.id=x.latest_decision_id
  where (r.last_reviewed_at is null or r.last_reviewed_at<=now()-interval '1 hour') and d.created_at>=now()-interval '6 hours'
  order by r.last_reviewed_at nulls first,x.domain,x.context,x.market,x.policy_version limit 20 for update of r skip locked$new$;
begin
 foreach signature in array array['icash_learning_private.observe_policy_decision()',
  'icash_learning_private.record_policy_application()',
  'public.icash_record_learning_policy_hold(bigint,uuid,text)'] loop
  d:=pg_get_functiondef(to_regprocedure(signature));
  execute replace(d,'icash_learning_private.policy_cohorts','icash_learning_private.policy_cohort_sources');
 end loop;
 d:=pg_get_functiondef('public.icash_review_policy_cohorts()'::regprocedure);
 if (length(d)-length(replace(d,old_scan,'')))<>length(old_scan) then raise exception 'Policy cohort scan changed';end if;
 d:=replace(d,old_scan,new_scan);
 d:=replace(d,'update icash_learning_private.policy_cohorts set last_reviewed_at',
  'update icash_learning_private.policy_cohort_reviews set last_reviewed_at');
 execute d;
end $patch$;
-- Verify the actual installed projection while the original source is still
-- locked. A changed pointer or omitted diagnostic aborts the whole migration.
do $verify$
begin
 if exists(
  (select * from pg_temp.icash_policy_review_split_before
   except all select * from icash_learning_private.policy_cohorts)
  union all
  (select * from icash_learning_private.policy_cohorts
   except all select * from pg_temp.icash_policy_review_split_before)
 ) then raise exception 'Policy cohort projection changed during migration';end if;
end $verify$;
