-- Reject already ineligible CHECKING quotes before reconstructing request proof.
-- Every existing predicate is retained. The STABLE function keeps the same
-- statement snapshot; waiting delegation and source/financial authority are unchanged.
-- The migration runner owns this transaction and its ledger receipt.
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path='';
select pg_advisory_xact_lock(726341927);
do $patch$
declare
 signature text:='icash_research_private.expired_preflight_ticket_current(uuid,uuid)';
 previous text:='0f0026b490932675588ecb802740b142';
 d text;updated text;entry record;policy record;i integer;
 old_parts text[]:=array[
 $old$  or t.created_at<p.created_at or t.completed_at<p.started_at
  or icash_research_private.expired_checking_original_proof(p.id) is null then return false;end if;$old$,
 $old$ select * into c from public.icash_discovery_configs where account_id=t.account_id;
 select * into r from public.icash_operation_rates where id=c.contact_rate_id;
 if s.id is null$old$,
 $old$  or r.id is null or r.charge_cents<=0 or(t.prospecting_quote_cents is not null and r.charge_cents>t.prospecting_quote_cents)
$old$];
 new_parts text[]:=array[
 $new$  or t.created_at<p.created_at or t.completed_at<p.started_at then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=t.account_id;
 select * into r from public.icash_operation_rates where id=c.contact_rate_id;
 if r.id is null or r.charge_cents<=0 or(t.prospecting_quote_cents is not null and r.charge_cents>t.prospecting_quote_cents) then return false;end if;
 if icash_research_private.expired_checking_original_proof(p.id) is null then return false;end if;$new$,
 $new$ if s.id is null$new$,
 ''];
 base_required text[]:=array[
  'public.icash_continue_expired_owner_preflight_ticket()',
  'public.icash_continued_owner_preflight(uuid,uuid,jsonb,boolean)',
  'icash_research_private.guard_continued_owner_preflight_creation()',
  'icash_research_private.expired_preflight_ticket_current(uuid,uuid)',
  'icash_research_private.guard_expired_preflight_ticket_continuation()',
  'icash_research_private.owner_preflight_cleanup_current(uuid,uuid)',
  'public.icash_claim_owner_preflight(uuid,jsonb,jsonb)',
  'public.icash_owner_enrichment_retry_current(uuid,uuid)',
  'public.icash_owner_enrichment_unstarted(uuid,uuid,text)',
  'public.icash_owner_enrichment_screening_hash(public.icash_screening_jobs)',
  'public.icash_owner_enrichment_ticket_hash(public.icash_automation_tickets)',
  'public.icash_record_owner_preflight_cleanup(uuid,uuid,jsonb)',
  'public.icash_immutable_owner_enrichment_recovery()',
  'public.icash_guard_owner_enrichment_recovery_credit()',
  'public.icash_guard_owner_enrichment_recovery_spend()',
  'icash_research_private.guard_owner_preflight()',
  'icash_research_private.guard_owner_preflight_generation()',
  'icash_research_private.owner_preflight_renewable(uuid)',
  'icash_research_private.owner_preflight_list_known(uuid,boolean)',
  'public.icash_owner_export_people_available(jsonb)',
  'public.icash_owner_targeting_pool(uuid,uuid)',
  'public.icash_membership_work_allowed(uuid)'];
 checking_required text[]:=array[
  'icash_research_private.expired_checking_original_proof(uuid)',
  'icash_research_private.expired_preflight_ticket_current(uuid,uuid)',
  'icash_research_private.expired_waiting_preflight_ticket_current(uuid,uuid)',
  'icash_research_private.capture_expired_checking_proof()',
  'icash_research_private.guard_expired_checking_proof()',
  'public.icash_admit_expired_checking_cleanup(uuid,uuid,uuid)',
  'public.icash_defer_expired_checking_cleanup(uuid,uuid,uuid,text,text,uuid)',
  'public.icash_defer_owner_enrichment(uuid,uuid,uuid,text,text)',
  'public.icash_continue_expired_owner_preflight_ticket()',
  'public.icash_continued_owner_preflight(uuid,uuid,jsonb,boolean)',
  'icash_research_private.guard_owner_preflight_quota_deferral()',
  'public.icash_take_dealmachine_request(text,uuid,text,uuid)',
  'public.icash_record_owner_preflight_cleanup(uuid,uuid,jsonb)',
  'icash_research_private.guard_continued_owner_preflight_creation()'];
begin
 -- Use the same budget-before-policy order as normal administration. The lock
 -- serializes journal effects; an in-flight caller can retain its old safe body.
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then raise exception 'Expired-checking eligibility budget prerequisite missing';end if;
 perform 1 from icash_research_private.expired_preflight_ticket_policy where id=1 for update;
 if not found then raise exception 'Expired-checking eligibility base policy missing';end if;
 perform 1 from icash_research_private.expired_checking_policy where id=1 for update;
 if not found then raise exception 'Expired-checking eligibility checking policy missing';end if;
 if current_user<>'postgres' or not exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
  where p.oid=to_regprocedure(signature) and r.rolname='postgres' and not p.prosecdef and p.provolatile='s'
   and p.proconfig=array['search_path=""']
   and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where acl.privilege_type='EXECUTE' and acl.grantee<>p.proowner))
  or has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
  or has_function_privilege('service_role',signature,'execute')
  then raise exception 'Expired-checking eligibility execution authority changed';end if;
 d:=pg_get_functiondef(signature::regprocedure);
 if md5(d) is distinct from previous then raise exception 'Expired-checking eligibility predecessor changed';end if;
 for i in 1..cardinality(old_parts) loop
  if(length(d)-length(replace(d,old_parts[i],'')))<>length(old_parts[i])
   then raise exception 'Expired-checking eligibility source marker changed: %',i;end if;
 end loop;
 for policy in
  select function_hashes,trigger_hashes,base_required required,
   array['expired_preflight_ticket_continuation_immutable','continued_owner_preflight_creation','icash_owner_enrichment_recovery_immutable','icash_owner_recovery_credit_guard','icash_owner_recovery_spend_guard','owner_preflight_immutable','owner_preflight_generation_immutable'] triggers
   from icash_research_private.expired_preflight_ticket_policy where id=1
  union all
  select function_hashes,trigger_hashes,checking_required,
   array['expired_checking_proof_immutable','expired_checking_proof_capture','owner_preflight_quota_immutable','expired_preflight_ticket_continuation_immutable','continued_owner_preflight_creation','icash_owner_enrichment_recovery_immutable','icash_owner_recovery_credit_guard','icash_owner_recovery_spend_guard','owner_preflight_immutable','owner_preflight_generation_immutable']
   from icash_research_private.expired_checking_policy where id=1
 loop
  if jsonb_typeof(policy.function_hashes) is distinct from 'object'
   or not(policy.function_hashes ?& policy.required)
   or(select count(*) from jsonb_object_keys(policy.function_hashes))<>cardinality(policy.required)
   or jsonb_typeof(policy.trigger_hashes) is distinct from 'object'
   or not(policy.trigger_hashes ?& policy.triggers)
   or(select count(*) from jsonb_object_keys(policy.trigger_hashes))<>cardinality(policy.triggers)
   then raise exception 'Expired-checking eligibility manifest changed';end if;
  for entry in select * from jsonb_each_text(policy.function_hashes) loop
   if to_regprocedure(entry.key) is null or md5(pg_get_functiondef(to_regprocedure(entry.key))) is distinct from entry.value
    then raise exception 'Expired-checking eligibility source changed: %',entry.key;end if;
  end loop;
  for entry in select * from jsonb_each_text(policy.trigger_hashes) loop
   if not exists(select 1 from(values
    ('expired_checking_proof_immutable','icash_research_private.expired_checking_proofs'::regclass,'icash_research_private.guard_expired_checking_proof()'::regprocedure),
    ('expired_checking_proof_capture','icash_research_private.expired_preflight_ticket_continuations'::regclass,'icash_research_private.capture_expired_checking_proof()'::regprocedure),
    ('owner_preflight_quota_immutable','icash_research_private.owner_preflight_quota_deferrals'::regclass,'icash_research_private.guard_owner_preflight_quota_deferral()'::regprocedure),
    ('expired_preflight_ticket_continuation_immutable','icash_research_private.expired_preflight_ticket_continuations'::regclass,'icash_research_private.guard_expired_preflight_ticket_continuation()'::regprocedure),
    ('continued_owner_preflight_creation','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_continued_owner_preflight_creation()'::regprocedure),
    ('icash_owner_enrichment_recovery_immutable','public.icash_owner_enrichment_recoveries'::regclass,'public.icash_immutable_owner_enrichment_recovery()'::regprocedure),
    ('icash_owner_recovery_credit_guard','public.icash_credit_reservations'::regclass,'public.icash_guard_owner_enrichment_recovery_credit()'::regprocedure),
    ('icash_owner_recovery_spend_guard','public.icash_operation_spend'::regclass,'public.icash_guard_owner_enrichment_recovery_spend()'::regprocedure),
    ('owner_preflight_immutable','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_owner_preflight()'::regprocedure),
    ('owner_preflight_generation_immutable','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_owner_preflight_generation()'::regprocedure)
   ) expected(name,relation,guard) join pg_trigger t on t.tgname=expected.name and t.tgrelid=expected.relation
   where expected.name=entry.key and not t.tgisinternal and t.tgenabled in('O','A') and t.tgfoid=expected.guard and md5(pg_get_triggerdef(t.oid))=entry.value)
   then raise exception 'Expired-checking eligibility trigger changed: %',entry.key;end if;
  end loop;
 end loop;
 -- The original ticket IF remains directly after SELECT t so FOUND retains
 -- its original meaning. Only the exact current rate/cap guard moves earlier.
 for i in 1..cardinality(old_parts) loop d:=replace(d,old_parts[i],new_parts[i]);end loop;
 execute d;
 updated:=md5(pg_get_functiondef(signature::regprocedure));
 update icash_research_private.expired_preflight_ticket_policy set function_hashes=jsonb_set(function_hashes,array[signature],to_jsonb(updated)) where id=1;
 update icash_research_private.expired_checking_policy set function_hashes=jsonb_set(function_hashes,array[signature],to_jsonb(updated)) where id=1;
end $patch$;
notify pgrst,'reload schema';
