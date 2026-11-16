-- Preserve the complete immutable original through selection and the handler.
-- No ticket, provider request, quota, hold, deadline or financial authority changes.
-- The migration runner owns the transaction and final ledger receipt.
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path='';
select pg_advisory_xact_lock(726341927);

do $guard$
declare expected record;actual record;entry record;policy record;manifest jsonb;signature text;
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
 if current_user<>'postgres' then raise exception 'Continued cohort owner required';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then raise exception 'Continued cohort budget missing';end if;
 perform 1 from icash_work_private.continuation_policy where id=1 for update;
 if not found then raise exception 'Continued cohort policy missing';end if;
 perform 1 from icash_research_private.expired_preflight_ticket_policy where id=1 for update;
 perform 1 from icash_research_private.expired_checking_policy where id=1 for update;
 for expected in select * from(values
  ('public.icash_owner_batch_candidates(uuid,uuid)','e229f7a8b42a84ddf2d5e2130971aea7',true,true),
  ('icash_work_private.continued_owner_preflight_source(uuid,uuid,uuid)','949c01f994e622dbd634f3f3582e4655',true,false),
  ('public.icash_enrichment_before_prospecting_budget(uuid)','20eec96525e745360af5a7e8bb9264c7',false,true),
  ('icash_work_private.owner_enrichment_candidate_exists(uuid)','0f37cd91fd0210b03a0b70424e936379',false,true),
  ('icash_research_private.owner_preflight_cohort(uuid,uuid)','8f08b730770d9a7365cc9f056906707a',false,false),
  ('icash_research_private.expired_preflight_ticket_current(uuid,uuid)','d4d626dd408cbf8264a95a5b86bc4d9c',false,false)
 ) source(signature,hash,definer,service_execute) loop
  select p.*,md5(pg_get_functiondef(p.oid)) definition_hash into actual from pg_proc p where p.oid=to_regprocedure(expected.signature);
  if not found or actual.definition_hash is distinct from expected.hash
   or pg_get_userbyid(actual.proowner) is distinct from 'postgres' or actual.prosecdef is distinct from expected.definer
   or actual.provolatile<>'s' or actual.proconfig is distinct from array['search_path=""']
   or has_function_privilege('service_role',actual.oid,'execute') is distinct from expected.service_execute
   or exists(select 1 from aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) acl
    where acl.privilege_type='EXECUTE' and acl.grantee<>actual.proowner
     and (acl.is_grantable or not expected.service_execute or acl.grantee<>(select oid from pg_roles where rolname='service_role')))
   then raise exception 'Continued cohort prerequisite changed: %',expected.signature;end if;
 end loop;
 if to_regprocedure('icash_work_private.continued_owner_batch_cohort(uuid,uuid)') is not null
  or to_regprocedure('icash_work_private.continued_owner_handoff_current(uuid,uuid)') is not null
  then raise exception 'Continued cohort helper already exists';end if;
 if not exists(select 1 from icash_work_private.continuation_policy where id=1 and enabled and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
   and scheduler_hash=md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))
   and recorder_hash=md5(pg_get_functiondef('icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean)'::regprocedure)))
  or not exists(select 1 from icash_work_private.preflight_step_policy where id=1 and enabled and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
   and function_hashes->>'public.icash_next_acquisition()'=md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure)))
  or not exists(select 1 from icash_research_private.acquisition_headroom_policy where id=1 and enabled and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
   and acquisition_hash=md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure)))
  or not exists(select 1 from icash_research_private.expired_preflight_ticket_policy where id=1 and enabled and activated_at is not null and release_sha~'^[a-f0-9]{40}$')
  or not exists(select 1 from icash_research_private.expired_checking_policy where id=1 and enabled and activated_at is not null and release_sha~'^[a-f0-9]{40}$')
  then raise exception 'Continued cohort activated policies changed';end if;
 for policy in
  select continued_original_hashes hashes,array[
   'icash_work_private.continued_owner_preflight_source(uuid,uuid,uuid)',
   'icash_work_private.continued_owner_preflight_deadline(uuid,uuid)',
   'icash_work_private.live_owner_preflight_deadline(uuid,uuid)',
   'public.icash_enrichment_before_prospecting_budget(uuid)'] required
   from icash_work_private.continuation_policy where id=1
  union all select owner_wait_hashes,array[
   'icash_work_private.owner_enrichment_candidate_exists(uuid)',
   'icash_work_private.owner_enrichment_wait_candidate(uuid)',
   'icash_work_private.record_export_wait(uuid,timestamptz)',
   'public.icash_enrichment_before_prospecting_budget(uuid)',
   'public.icash_enrichment_before_provider_quota(uuid)']
   from icash_work_private.continuation_policy where id=1
 loop
  if jsonb_typeof(policy.hashes) is distinct from 'object' or not(policy.hashes ?& policy.required)
   or(select count(*) from jsonb_object_keys(policy.hashes))<>cardinality(policy.required)
   then raise exception 'Continued cohort handoff manifest changed';end if;
  for entry in select * from jsonb_each_text(policy.hashes) loop
   if to_regprocedure(entry.key) is null or md5(pg_get_functiondef(to_regprocedure(entry.key))) is distinct from entry.value
    then raise exception 'Continued cohort handoff source changed: %',entry.key;end if;
  end loop;
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
   then raise exception 'Continued cohort manifest changed';end if;
  for entry in select * from jsonb_each_text(policy.function_hashes) loop
   if to_regprocedure(entry.key) is null or md5(pg_get_functiondef(to_regprocedure(entry.key))) is distinct from entry.value
    then raise exception 'Continued cohort source changed: %',entry.key;end if;
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
   ) expected_trigger(name,relation,guard) join pg_trigger t on t.tgname=expected_trigger.name and t.tgrelid=expected_trigger.relation
   where expected_trigger.name=entry.key and not t.tgisinternal and t.tgenabled in('O','A') and t.tgfoid=expected_trigger.guard and md5(pg_get_triggerdef(t.oid))=entry.value)
   then raise exception 'Continued cohort trigger changed: %',entry.key;end if;
  end loop;
 end loop;
end $guard$;


-- A source read, never admission. Ordinary live cohorts retain their own rules.
-- Journaled originals additionally retain their first ticket deadline, complete
-- audience and current whole-batch affordability through cleanup and renewal.
create function icash_work_private.continued_owner_batch_cohort(p_account uuid,p_primary uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare j icash_research_private.expired_preflight_ticket_continuations;
 t public.icash_automation_tickets;p icash_research_private.owner_export_preflights;
 child icash_research_private.owner_export_preflights;s public.icash_screening_jobs;
 c public.icash_discovery_configs;r public.icash_operation_rates;
 original_deadline timestamptz;deadline_at timestamptz;checked timestamptz:=clock_timestamp();
 receipt jsonb;current_proof jsonb;bound jsonb;live jsonb;item jsonb;n integer;children integer;
begin
 if p_account is null or p_primary is null then return null;end if;
 if(select count(*) from icash_research_private.expired_preflight_ticket_continuations
  where account_id=p_account and screening_id=p_primary)<>1 then return null;end if;
 select * into j from icash_research_private.expired_preflight_ticket_continuations
  where account_id=p_account and screening_id=p_primary;
 if not found then return null;end if;
 select * into t from public.icash_automation_tickets where id=j.ticket_id;
 if not found or t.account_id is distinct from p_account or t.screening_id is distinct from p_primary
  or t.kind is distinct from 'contacts' or j.operation_key is distinct from 'owners:'||p_account||':'||p_primary
  or t.owner_preview_deferrals not between 1 and 7 or t.owner_preview_retry_after is null or t.owner_preview_retry_after>checked
  or t.owner_preview_retry_until is null or t.owner_preview_retry_until<=checked
  or t.owner_preview_screening_hash is distinct from j.before_ticket->>'owner_preview_screening_hash'
  or j.recorded_at>checked then return null;end if;
 -- The route atomically consumes the freshly issued token before the handler.
 -- Neither a historical generic hold nor an old consumed capability qualifies.
 if t.state='held' then
  if t.outcome is distinct from 'owner_preview_rate_limited' then return null;end if;
 elsif t.state in('issued','consumed') then
  if t.outcome is not null or t.created_at<j.recorded_at or t.created_at>checked or t.expires_at<=checked then return null;end if;
 else return null;end if;
 begin original_deadline:=(j.before_ticket->>'owner_preview_retry_until')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then return null;end;
 if original_deadline is null or t.owner_preview_retry_until is distinct from original_deadline then return null;end if;
 select * into p from icash_research_private.owner_export_preflights where id=j.preflight_id and account_id=p_account;
 if not found or p.items is distinct from j.preflight->'items' or p.request is distinct from j.preflight->'request'
  or p.fingerprint is distinct from j.preflight->>'fingerprint'
  or p.items->0->>'screeningId' is distinct from p_primary::text
  or p.fingerprint is distinct from md5(jsonb_build_array(p.items,p.request)::text)
  or jsonb_typeof(p.items) is distinct from 'array' or jsonb_array_length(p.items) not between 1 and 5
  or (select count(distinct x->>'screeningId') from jsonb_array_elements(p.items) x)<>jsonb_array_length(p.items)
  or icash_research_private.owner_preflight_list_known(p.id) is distinct from true
  or public.icash_owner_export_people_available(p.request->'people_ids') is distinct from true
  then return null;end if;
 select * into s from public.icash_screening_jobs where id=p_primary and account_id=p_account;
 if not found or public.icash_owner_enrichment_screening_hash(s) is distinct from t.owner_preview_screening_hash
  or public.icash_owner_enrichment_retry_current(p_account,p_primary) is distinct from true then return null;end if;
 begin deadline_at:=least(original_deadline,p.created_at+interval '24 hours',s.completed_at+interval '24 hours',
  (s.snapshot->>'fetchedAt')::timestamptz+interval '24 hours');
 exception when invalid_datetime_format or datetime_field_overflow then return null;end;
 if deadline_at is null or deadline_at<=checked then return null;end if;
 if not exists(select 1 from public.icash_owner_enrichment_recoveries recovery
  where recovery.ticket_id=j.ticket_id and recovery.account_id=p_account and recovery.screening_id=p_primary
   and recovery.operation_key=j.operation_key and recovery.code_stage='owner_preview_expired_known_list_v1'
   and recovery.expected_screening_hash=t.owner_preview_screening_hash
   and recovery.approved_max_charge_cents=j.approved_max_charge_cents
   and recovery.reviewed_source_hash=encode(sha256(convert_to(
    jsonb_build_array(j.before_ticket,j.preflight,j.configuration,j.rate)::text,'UTF8')),'hex')) then return null;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account;
 select * into r from public.icash_operation_rates where id=c.contact_rate_id;
 if coalesce(c.research_version,0) not in(1,2) or not c.enabled or not c.contacts_enabled or c.data_rights_until<=checked
  or r.id is null or not r.enabled or r.operation<>'owner_enrichment' or r.expires_at<=checked
  or r.charge_cents>j.approved_max_charge_cents
  or(t.prospecting_quote_cents is not null and r.charge_cents>t.prospecting_quote_cents)
  or public.icash_prospecting_available(p_account)<public.icash_research_admission_quote(p_account,'owner_enrichment',r.charge_cents)
  then return null;end if;
 -- This is the existing batch bound including its outreach reserve, unchanged.
 n:=least(5,greatest(0,floor((least(public.icash_prospecting_available(p_account),coalesce((select balance_cents-reserved_cents from public.icash_wallets where account_id=p_account),0))-public.icash_prospecting_outreach_floor(p_account))::numeric/greatest(1,r.charge_cents))::integer));
 if jsonb_array_length(p.items)>n then return null;end if;
 if p.deleted_at is null then
  -- Known local refusal is not an unknown DELETE or a new cleanup attempt.
  if p.cleanup_attempts<>0 or p.cleanup_token is not null or p.cleanup_until is not null
   or p.cleanup_receipts<>'[]'::jsonb then return null;end if;
  if p.state='checking' then
   current_proof:=icash_research_private.expired_checking_original_proof(p.id);
   if current_proof is null or not exists(select 1 from icash_research_private.expired_checking_proofs
    where preflight_id=p.id and ticket_id=j.ticket_id and expired_checking_proofs.proof=current_proof) then return null;end if;
  elsif p.state='waiting' then
   if icash_research_private.owner_preflight_cleanup_current(p_account,p.id) is distinct from true then return null;end if;
  else return null;end if;
 else
  if p.deleted_at>checked or p.deleted_at<p.created_at+interval '30 minutes'
   or p.cleanup_token is null or p.cleanup_attempts not between 1 and 3 then return null;end if;
  select e->'receipt' into receipt from jsonb_array_elements(p.cleanup_receipts) e where e->>'token'=p.cleanup_token::text;
  begin
   if ((receipt->>'rawText')::jsonb=receipt->'raw' and
    ((receipt->'httpStatus'='200'::jsonb and receipt#>'{raw,data,deleted}'='true'::jsonb) or receipt->'httpStatus'='404'::jsonb))
    is distinct from true then return null;end if;
  exception when invalid_text_representation then return null;end;
 end if;
 -- Only the direct, unchanged live child can supersede this cleaned original.
 -- A future generation or unknown child never falls back to the old parent.
 select count(*) into children from icash_research_private.owner_export_preflights x
  where x.account_id=p.account_id and x.fingerprint=p.fingerprint and x.generation>p.generation;
 if children>0 then
  if children<>1 or p.deleted_at is null then return null;end if;
  select * into child from icash_research_private.owner_export_preflights x
   where x.account_id=p.account_id and x.fingerprint=p.fingerprint and x.generation>p.generation;
  live:=icash_research_private.owner_preflight_cohort(p_account,p_primary);
  if child.supersedes is distinct from p.id or child.generation<>p.generation+1
   or child.items is distinct from p.items or child.request is distinct from p.request
   or child.created_at<p.deleted_at or child.created_at>checked or live is distinct from child.items
   then return null;end if;
 elsif p.deleted_at is not null and icash_research_private.owner_preflight_renewable(p.id) is distinct from true then
  return null;
 end if;
 bound:=public.icash_continued_owner_preflight(p_account,p_primary,p.items,coalesce((p.request->>'mobile_only')::boolean,false));
 if bound->>'status' is distinct from 'bound' or bound->>'preflightId' is distinct from p.id::text then return null;end if;
 -- Repeat every actual batch-member predicate. In particular, an existing
 -- sibling ticket remains a hold regardless of missing financial evidence.
 for item in select value from jsonb_array_elements(p.items) loop
  select * into s from public.icash_screening_jobs where id=(item->>'screeningId')::uuid and account_id=p_account;
  if not found or s.snapshot is distinct from item->'snapshot' or s.state is distinct from 'complete'
   or(s.completed_at between checked-interval '24 hours' and checked) is distinct from true
   or s.result->'financialCheck'->>'status' is distinct from 'eligible' or s.snapshot ? 'sellerRequest'
   or s.snapshot->>'propertyType' is distinct from 'house'
   or public.icash_research_state_allowed(s.snapshot->'raw'->'data'->>'state') is distinct from true
   or public.icash_owner_preflight_sibling_waiting(p_account,s.id,s.snapshot,p_primary) is distinct from false
   or public.icash_owner_preflight_empty(p_account,s.id,s.snapshot) is distinct from false
   or exists(select 1 from public.icash_property_controls pc where pc.account_id=p_account and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
   or exists(select 1 from public.icash_owner_contacts oc join public.icash_screening_jobs prior on prior.id=oc.screening_id
    where oc.account_id=p_account and prior.snapshot->>'propertyId'=s.snapshot->>'propertyId' and oc.created_at>checked-interval '30 days')
   or exists(select 1 from public.icash_operation_spend spent join public.icash_screening_jobs prior on spent.operation_key='owners:'||p_account||':'||prior.id
    where prior.account_id=p_account and prior.snapshot->>'propertyId'=s.snapshot->>'propertyId' and spent.state in('reserved','dispatched'))
   or exists(select 1 from public.icash_operation_spend where operation_key='owners:'||p_account||':'||s.id)
   or(s.id<>p_primary and exists(select 1 from public.icash_automation_tickets where screening_id=s.id))
   then return null;end if;
 end loop;
 return p.items;
end $function$;
revoke all on function icash_work_private.continued_owner_batch_cohort(uuid,uuid) from public,anon,authenticated,service_role;

create function icash_work_private.continued_owner_handoff_current(p_account uuid,p_primary uuid)
returns boolean language sql stable security definer set search_path='' as $function$
 select not exists(select 1 from icash_research_private.expired_preflight_ticket_continuations
  where account_id=p_account and screening_id=p_primary)
  or icash_work_private.continued_owner_batch_cohort(p_account,p_primary) is not null;
$function$;
revoke all on function icash_work_private.continued_owner_handoff_current(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function icash_work_private.continued_owner_handoff_current(uuid,uuid) to service_role;

do $patch$
declare d text;needle text;signature text;
begin
 d:=pg_get_functiondef('public.icash_owner_batch_candidates(uuid,uuid)'::regprocedure);
 needle:='n integer;result jsonb;pinned jsonb;';
 if(length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Continued cohort batch declaration changed';end if;
 d:=replace(d,needle,needle||'continued boolean:=false;');
 needle:=' pinned:=icash_research_private.owner_preflight_cohort(p_account,p_screening);';
 if(length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Continued cohort batch pin changed';end if;
 d:=replace(d,needle,$new$ if exists(select 1 from icash_research_private.expired_preflight_ticket_continuations where account_id=p_account and screening_id=p_screening) then
  continued:=true;
  pinned:=icash_work_private.continued_owner_batch_cohort(p_account,p_screening);
  if pinned is null then return '[]';end if;
 else pinned:=icash_research_private.owner_preflight_cohort(p_account,p_screening);end if;$new$);
 needle:='order by (id=p_screening) desc,id),''[]'') into result';
 if(length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Continued cohort batch order changed';end if;
 d:=replace(d,needle,$new$order by case when continued then (select i.ordinality from jsonb_array_elements(pinned) with ordinality i(item,ordinality) where i.item->>'screeningId'=id::text) end,(id=p_screening) desc,id),'[]') into result$new$);
 execute d;
 -- Both continuation and ordinary turns must use the same handoff boundary.
 foreach signature in array array['public.icash_enrichment_before_prospecting_budget(uuid)','icash_work_private.owner_enrichment_candidate_exists(uuid)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  needle:='where not exists(select 1 from public.icash_property_controls pc where pc.account_id=(c.screening).account_id';
  if(length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Continued cohort selector changed: %',signature;end if;
  execute replace(d,needle,'where icash_work_private.continued_owner_handoff_current((c.screening).account_id,(c.screening).id) and not exists(select 1 from public.icash_property_controls pc where pc.account_id=(c.screening).account_id');
 end loop;
 d:=pg_get_functiondef('icash_work_private.continued_owner_preflight_source(uuid,uuid,uuid)'::regprocedure);
 needle:='  bound:=public.icash_continued_owner_preflight(p_account,j.screening_id,p.items,coalesce((p.request->>''mobile_only'')::boolean,false));';
 if(length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Continued cohort scheduling source changed';end if;
 execute replace(d,needle,'  if icash_work_private.continued_owner_batch_cohort(p_account,j.screening_id) is distinct from p.items then continue;end if;'||E'\n'||needle);
end $patch$;

-- Preserve exact-count existing manifests and every activation/turn receipt.
update icash_work_private.continuation_policy set
 continued_original_hashes=continued_original_hashes||(
  select jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure))) from unnest(array[
   'icash_work_private.continued_owner_preflight_source(uuid,uuid,uuid)',
   'public.icash_enrichment_before_prospecting_budget(uuid)']) signature),
 owner_wait_hashes=owner_wait_hashes||(
  select jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure))) from unnest(array[
   'icash_work_private.owner_enrichment_candidate_exists(uuid)',
   'public.icash_enrichment_before_prospecting_budget(uuid)']) signature) where id=1;
alter table icash_work_private.continuation_policy add column continued_cohort_hashes jsonb not null default '{}';
update icash_work_private.continuation_policy set continued_cohort_hashes=(
 select jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure))) from unnest(array[
  'icash_work_private.continued_owner_batch_cohort(uuid,uuid)',
  'icash_work_private.continued_owner_handoff_current(uuid,uuid)',
  'public.icash_owner_batch_candidates(uuid,uuid)']) signature) where id=1;
notify pgrst,'reload schema';
