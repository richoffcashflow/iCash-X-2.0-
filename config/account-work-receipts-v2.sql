-- INACTIVE comparison reader only. This does not replace the public observer,
-- activate a policy, dispatch work, settle costs or modify the frozen schema2.
-- A separately reviewed activation must record the definition and cutover time.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $guard$
begin
 if md5(pg_get_functiondef('public.icash_account_work_observations()'::regprocedure))<>'8722d21bc188e089ec00f454b08ffe1c'
  or md5(pg_get_functiondef('public.icash_dealmachine_owner_source_started_at(uuid,uuid)'::regprocedure))<>'e0fbc50e300c514073b838487084debc'
  or md5(pg_get_functiondef('public.icash_dealmachine_saved_owner_result_valid(jsonb)'::regprocedure))<>'8774def4b68c71f9aa370b201327eda8'
  or md5(pg_get_functiondef('public.icash_owner_export_result_valid(jsonb)'::regprocedure))<>'2df5bd6597bc65680b5869cf253200a5'
  or md5(pg_get_functiondef('public.icash_dealmachine_request_started_at(jsonb)'::regprocedure))<>'9a815d5a6563521f67e5caafee310db9'
 then raise exception 'Receipt-progress v2 source prerequisite changed';end if;
end $guard$;

-- Existing private export tables deliberately deny service_role SELECT. Expose
-- only exact-bound original completion metadata through this narrow reader;
-- never broaden table/schema grants or expose raw paid/export receipts.
create function icash_reliability_private.owner_work_output_v2(p_account uuid,p_screening uuid,p_at timestamptz)
returns table(source_recorded_at timestamptz,completed_at timestamptz,export_completed_at timestamptz,source_started_at timestamptz,batch_id uuid)
language plpgsql stable security definer set search_path='' rows 1 as $function$
declare c public.icash_owner_contacts;started timestamptz;finalized timestamptz;source_batch uuid;
begin
 if p_at is distinct from now() or not isfinite(p_at) then return;end if;
 select * into c from public.icash_owner_contacts where account_id=p_account and screening_id=p_screening;
 if not found or not isfinite(c.created_at) or c.created_at>p_at
  or not public.icash_dealmachine_saved_owner_result_valid(c.result) then return;end if;
 started:=public.icash_dealmachine_owner_source_started_at(p_account,p_screening);
 if started is null or not isfinite(started) or started>c.created_at then return;end if;
 if c.result->'allocation'->>'method'='active-export-used-order-v1' then
  -- The canonical helper above already matched this exact text to a real batch
  -- UUID. Cast only after that proof, keeping the export primary-key lookup.
  select e.id,e.completed_at into source_batch,finalized from icash_research_private.owner_exports e
   where e.id=(c.result->'allocation'->>'batchId')::uuid;
  if not found or finalized is null or not isfinite(finalized) or finalized>p_at then return;end if;
 end if;
 return query select c.created_at,greatest(c.created_at,finalized),finalized,started,source_batch;
end $function$;
revoke all on function icash_reliability_private.owner_work_output_v2(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function icash_reliability_private.owner_work_output_v2(uuid,uuid,timestamptz) to service_role;

create function icash_reliability_private.account_work_receipts_v2(p_account uuid,p_at timestamptz)
returns table(last_completed_output_at timestamptz,last_attempted_outreach_at timestamptz,evidence jsonb)
language sql stable security invoker set search_path='' as $function$
 with research as materialized (
  select d.operation_key,d.created_at
  from public.icash_discovery_results d
  join public.icash_operation_spend o on o.operation_key=d.operation_key and o.account_id=d.account_id
  join public.icash_operation_rates rate on rate.id=o.rate_id and rate.operation='property_search'
  where d.account_id=p_account and o.state in ('dispatched','settled')
   and isfinite(d.created_at) and d.created_at<=p_at
   and o.dispatched_at between o.created_at and d.created_at
   and jsonb_typeof(d.result->'rows')='array'
   and public.icash_dealmachine_request_started_at(d.result) between o.dispatched_at and d.created_at
  order by d.created_at desc,d.operation_key limit 1
 ), enrichment as materialized (
  select c.operation_key,c.screening_id,proof.source_recorded_at,proof.completed_at,
   proof.export_completed_at,proof.source_started_at,proof.batch_id
  from public.icash_owner_contacts c
  join public.icash_operation_spend o on o.operation_key=c.operation_key and o.account_id=c.account_id
  join public.icash_operation_rates rate on rate.id=o.rate_id and rate.operation='owner_enrichment'
  join lateral icash_reliability_private.owner_work_output_v2(c.account_id,c.screening_id,p_at) proof on true
  where c.account_id=p_account and o.state in ('dispatched','settled')
   and c.operation_key='owners:'||c.account_id||':'||c.screening_id
   and isfinite(c.created_at) and c.created_at<=p_at
   and o.dispatched_at between o.created_at and c.created_at
   and proof.source_started_at<=o.created_at
  order by completed_at desc,c.screening_id limit 1
 ), calls as materialized (
  select r.id,r.voice_job_id,r.operation_key,r.call_sid,r.dial_claimed_at,r.provider_started_at,r.state,j.outcome
  from public.icash_call_recordings r
  join public.icash_voice_jobs j on j.id=r.voice_job_id and j.account_id=r.account_id
   and j.operation_key=r.operation_key and j.provider_call_sid=r.call_sid
  join public.icash_operation_spend o on o.operation_key=r.operation_key and o.account_id=r.account_id
  where r.account_id=p_account and nullif(r.call_sid,'') is not null
   and isfinite(r.dial_claimed_at) and r.dial_claimed_at between r.created_at and p_at
   and o.dispatched_at between o.created_at and r.dial_claimed_at
  order by r.dial_claimed_at desc,r.id limit 1
 ), texts as materialized (
  select m.id,m.provider_id,m.state,o.operation_key,o.dispatched_at
  from public.icash_text_messages m
  join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
  where m.account_id=p_account and m.direction='outgoing' and nullif(m.provider_id,'') is not null
   and isfinite(o.dispatched_at) and o.dispatched_at between greatest(m.created_at,o.created_at) and p_at
  order by o.dispatched_at desc,m.id limit 1
 )
 select greatest((select created_at from research),(select completed_at from enrichment)),
  greatest((select dial_claimed_at from calls),(select dispatched_at from texts)),
  jsonb_build_object('definitionVersion','receipt-progress-v2','activation','inactive-comparison-only','activationBoundary',null,
   'evaluatedAt',p_at,'sourcePublicObserverMd5','8722d21bc188e089ec00f454b08ffe1c',
   'canonicalOwnerSourceMd5','e0fbc50e300c514073b838487084debc','frozenSnapshotSchemaUnchanged',2,
   'research',(select jsonb_build_object('operationId',operation_key,'completedOutputAt',created_at,'sourceTable','icash_discovery_results') from research),
   'enrichment',(select jsonb_build_object('operationId',operation_key,'screeningId',screening_id,'batchId',batch_id,'completedOutputAt',completed_at,'sourceRecordedAt',source_recorded_at,'exportCompletedAt',export_completed_at,'sourceStartedAt',source_started_at,'sourceTable','icash_owner_contacts') from enrichment),
   'callAttempt',(select jsonb_build_object('operationId',operation_key,'jobId',voice_job_id,'recordingId',id,'providerId',call_sid,'dialClaimedAt',dial_claimed_at,'recordingStartedAt',provider_started_at,'recordingState',state,'jobOutcome',outcome,'timingBasis','original_source_bound_dial_claim') from calls),
   'textAttempt',(select jsonb_build_object('operationId',operation_key,'messageId',id,'providerId',provider_id,'messageState',state,'dispatchedAt',dispatched_at,'timingBasis','original_dispatch_lower_bound_not_acceptance_time') from texts),
   'verifiedHumanAnswer',null,'verifiedTextDelivery',null,
   'unknowns',jsonb_build_array('Missing or invalid original sources are not proof of zero work.','Call attempts and acknowledged texts are not completed outputs.','Terminal answers and delivery require separate canonical evidence.','Current source state is not historical as-of reconstruction.'))
 -- The timestamp bounds current evidence; mutable source state cannot recreate
 -- a historical snapshot. Past/future requests return no row, not zero activity.
 where p_at=now() and isfinite(p_at);
$function$;
revoke all on function icash_reliability_private.account_work_receipts_v2(uuid,timestamptz) from public,anon,authenticated;
grant execute on function icash_reliability_private.account_work_receipts_v2(uuid,timestamptz) to service_role;

do $comparison$
declare source text:=pg_get_functiondef('public.icash_account_work_observations()'::regprocedure);old text;replacement text;
begin
 source:=replace(source,'public.icash_account_work_observations()','icash_reliability_private.account_work_observations_v2()');
 old:='last_completed_at timestamp with time zone, available_cents bigint)';
 replacement:='last_completed_output_at timestamp with time zone, available_cents bigint, last_attempted_outreach_at timestamp with time zone, outreach_evidence_state text, definition_version text, evidence jsonb)';
 if position(old in source)=0 then raise exception 'Receipt-progress v2 return shape changed';end if;
 source:=replace(source,old,replacement);
 old:=$old$select f.*,greatest(work.settled_at,receipt.created_at) completed,
   greatest(f.created_at,f.credited_at,case when action='resume' then control_at end,work.settled_at,receipt.created_at) last_progress,$old$;
 replacement:=$new$select f.*,receipts.last_completed_output_at completed,
   receipts.last_attempted_outreach_at,receipts.evidence,
   greatest(f.created_at,f.credited_at,case when action='resume' then control_at end,receipts.last_completed_output_at) last_progress,$new$;
 if position(old in source)=0 then raise exception 'Receipt-progress v2 progress expression changed';end if;
 source:=replace(source,old,replacement);
 old:=$old$left join lateral(select settled_at from public.icash_operation_spend where account_id=f.id and state='settled' and (actual_micros>0 or charged_cents>0) order by settled_at desc limit 1) work on true
  left join lateral(select created_at from public.icash_discovery_results where account_id=f.id order by created_at desc limit 1) receipt on true$old$;
 if position(old in source)=0 then raise exception 'Receipt-progress v2 source expression changed';end if;
 source:=replace(source,old,'left join lateral icash_reliability_private.account_work_receipts_v2(f.id,now()) receipts on true');
 old:='else last_progress end,completed,available from classified where problem is not null;';
 if position(old in source)=0 then raise exception 'Receipt-progress v2 classification expression changed';end if;
 source:=replace(source,old,$new$else last_progress end,completed,available,last_attempted_outreach_at,
  case when last_attempted_outreach_at>=now()-interval '30 minutes' then 'recent_attempt_not_completed_output'
   when last_attempted_outreach_at is not null then 'older_attempt_not_completed_output'
   else 'no_verified_attempt_source' end,'receipt-progress-v2',evidence from classified where problem is not null;$new$);
 execute source;
end $comparison$;
revoke all on function icash_reliability_private.account_work_observations_v2() from public,anon,authenticated;
grant execute on function icash_reliability_private.account_work_observations_v2() to service_role;
comment on function icash_reliability_private.account_work_observations_v2() is
 'INACTIVE receipt-progress-v2. Public observer and frozen schema2 unchanged. No activation function is supplied. Compare original receipts, validate all consumers and record a separately reviewed cutover before use.';
commit;
