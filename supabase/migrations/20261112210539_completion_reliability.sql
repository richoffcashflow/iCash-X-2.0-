-- Backend-only completion repairs. Original requests, money and identity stay bound.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- BEGIN export recovery
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_claim_export_capacity_probe(uuid,text)'::regprocedure);
 if md5(d)<>'8d81600dd283fe5b96a9468d86b3ee44' then raise exception 'Export probe predecessor changed';end if;
 needle:='probe=case p_probe when ''pending'' then ''inventory'' else ''pending'' end';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Export probe dependency changed';end if;
 d:=replace(d,needle,'probe=''inventory''');
 execute replace(d,'interval ''45 seconds''','interval ''60 seconds''');

 d:=pg_get_functiondef('public.icash_finish_automatic_export_capacity(uuid)'::regprocedure);
 if md5(d)<>'cf59c8ef44b05ffb82edeb8468622e61' then raise exception 'Export finish predecessor changed';end if;
 d:=replace(d,'interval ''45 seconds''','interval ''60 seconds''');
 execute replace(d,'interval ''20 seconds''','interval ''30 seconds''');
end $patch$;
-- END export recovery

-- BEGIN sender health
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('icash_text_receipt_private.sender_opener_available(text)'::regprocedure);
 if md5(d)<>'298ceef9b89fd406c751ad4a8a2906f0' then raise exception 'Sender health predecessor changed';end if;
 -- The original signed delay remains authoritative until a post-delay send
 -- is delivered. Elapsed time permits one ordinary eligible probe per five
 -- minutes, never full-rate recovery. Existing identities and holds are intact.
 d:=replace(d,'between extract(epoch from now()-interval ''1 hour'') and extract(epoch from now()+interval ''5 seconds'')',
  '<= extract(epoch from now()+interval ''5 seconds'')');
 d:=replace(d,'o.dispatched_at between now()-interval ''1 hour'' and now()','o.dispatched_at<=now()');
 execute d;
end $patch$;
-- END sender health

-- BEGIN learning catchup
create function public.icash_refresh_learning_due() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare batch integer:=2;
begin
 -- Two every 15 seconds cannot refresh even 626 unchanged accounts hourly.
 -- Catch up in bounded batches using the existing per-account locks, error
 -- isolation and generation checks. Do not change training labels or gates.
 if exists(select 1 from public.icash_learning_queue where due_at<now()-interval '5 minutes')
  or (select count(*) from (select 1 from public.icash_learning_queue where due_at<=now() limit 21) due)>20 then batch:=5;end if;
 return public.icash_refresh_shared_learning(batch);
end $$;
revoke all on function public.icash_refresh_learning_due() from public,anon,authenticated;
grant execute on function public.icash_refresh_learning_due() to service_role;
do $$
declare j record;
begin
 select * into j from cron.job where jobname='icash-shared-learning-refresh';
 if not found or j.schedule<>'15 seconds' or not j.active
  or j.command<>'set lock_timeout=''1s'';set statement_timeout=''12s'';select public.icash_refresh_shared_learning(2);' then
  raise exception 'Learning schedule predecessor changed';end if;
 perform cron.alter_job(j.jobid,command:='set lock_timeout=''1s'';set statement_timeout=''12s'';select public.icash_refresh_learning_due();');
end $$;
-- END learning catchup

-- BEGIN receipt deadlines
create function public.icash_review_operation_deadlines() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_evidence jsonb;p icash_learning_private.improvement_proposals;
begin
 if not pg_try_advisory_xact_lock(810245) then return jsonb_build_object('reviewed',false);end if;
 select * into p from icash_learning_private.improvement_proposals where category='operation_receipt_deadline' order by version desc limit 1 for update;
 if found and p.last_reviewed_at>now()-interval '1 hour' then return jsonb_build_object('reviewed',false);end if;
 with overdue as materialized (
  select split_part(operation_key,':',1) kind,account_id,charge_cap_cents,coalesce(dispatched_at,created_at) started_at
  from public.icash_operation_spend where state in ('reserved','dispatched') and coalesce(dispatched_at,created_at)<now()-interval '24 hours'
 ), groups as (
  select kind,count(*) operations,count(distinct account_id) accounts,min(started_at) oldest_at,coalesce(sum(charge_cap_cents),0) held_cap_cents
  from overdue group by kind
 ) select jsonb_build_object('source','original_operation_deadline_v1','checkedAt',now(),'deadlineHours',24,
  'operations',(select count(*) from overdue),'accounts',(select count(distinct account_id) from overdue),
  'groups',coalesce((select jsonb_agg(to_jsonb(g) order by kind) from groups g),'[]'::jsonb),
  'businessSuccess',false,'action','reconcile_original_receipt_only','moneyReleased',false) into v_evidence;
 if p.id is null and (v_evidence->>'operations')::integer=0 then return jsonb_build_object('reviewed',true,'operations',0);end if;
 if p.id is null then
  insert into icash_learning_private.improvement_proposals(category,evidence) values('operation_receipt_deadline',v_evidence) returning * into p;
 else
  update icash_learning_private.improvement_proposals set observations=observations+1,last_observed_at=now(),last_reviewed_at=now(),evidence=v_evidence
   where id=p.id;
 end if;
 insert into icash_learning_private.proposal_events(proposal_id,status,evidence) values(p.id,p.status,v_evidence);
 return jsonb_build_object('reviewed',true,'operations',v_evidence->'operations');
end $$;
revoke all on function public.icash_review_operation_deadlines() from public,anon,authenticated;
grant execute on function public.icash_review_operation_deadlines() to service_role;
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_review_learning_operations()'::regprocedure);
 if md5(d)<>'c87629ff5ae25509352fe7360b23e9c3' then raise exception 'Operations review predecessor changed';end if;
 execute replace(d,'b:=public.icash_review_policy_cohorts();','b:=public.icash_review_policy_cohorts();perform public.icash_review_operation_deadlines();');
end $patch$;
-- END receipt deadlines

-- BEGIN no-dispatch cost evidence
create function public.icash_verified_predial_no_cost(p_operation text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.icash_operation_spend o join icash_recording_private.predial_aborts a
   on a.operation_key=o.operation_key and a.account_id=o.account_id and a.dispatched_at=o.dispatched_at
  join public.icash_voice_jobs j on j.id=a.job_id and j.account_id=a.account_id and j.operation_key=o.operation_key
  where o.operation_key=p_operation and o.operation_key='voice:'||j.id and o.state='settled' and o.actual_micros=0 and o.charged_cents=0
   and a.boundary='before_recording_create_v1' and a.created_at>=o.dispatched_at and o.settled_at>=o.dispatched_at
   and o.settlement_evidence='voice-predial-abort-v1:'||a.ticket_id||':'||a.reason
   and j.state='held' and j.outcome=a.reason and j.provider_call_sid is null and j.conversation_id is null
   and not exists(select 1 from public.icash_call_recordings r where r.operation_key=o.operation_key or r.voice_job_id=j.id)
   and not exists(select 1 from public.icash_live_conversations c where c.operation_key=o.operation_key)
   and not exists(select 1 from icash_private.provider_costs c where c.operation_key=o.operation_key)
   and not exists(select 1 from public.icash_cost_observations c where c.source_ref=o.operation_key or c.event_key=o.operation_key
    or (c.source_ref collate "C">=(o.operation_key||':') collate "C" and c.source_ref collate "C"<(o.operation_key||';') collate "C")
    or (c.event_key collate "C">=(o.operation_key||':') collate "C" and c.event_key collate "C"<(o.operation_key||';') collate "C"))
 );
$$;
revoke all on function public.icash_verified_predial_no_cost(text) from public,anon,authenticated;
grant execute on function public.icash_verified_predial_no_cost(text) to service_role;
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_owner_cost_evidence(uuid,integer,boolean)'::regprocedure);
 if md5(d)<>'bf33b2ac3e40b9a7022ccd8fc98d07ba' then raise exception 'Cost evidence predecessor changed';end if;
 d:=replace(d,'m.actual_micros manifest_micros','m.actual_micros manifest_micros,case when m.operation_key is null then public.icash_verified_predial_no_cost(o.operation_key) else false end no_dispatch');
 d:=replace(d,'''missingManifestCount'',','''verifiedNoDispatchCount'',(select count(*) from completed where no_dispatch),''missingManifestCount'',');
 execute replace(d,'from completed where components is null)','from completed where components is null and not no_dispatch)');
end $patch$;
-- END no-dispatch cost evidence
commit;
