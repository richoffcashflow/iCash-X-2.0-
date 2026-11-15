begin;
do $test$
declare account constant uuid:='00000000-0000-4000-8000-000000000001';
 screening constant uuid:='00000000-0000-4000-8000-000000000011';
 batch constant uuid:='00000000-0000-4000-8000-000000000012';
 voice constant uuid:='00000000-0000-4000-8000-000000000013';
 message constant uuid:='00000000-0000-4000-8000-000000000014';
 other constant uuid:='00000000-0000-4000-8000-000000000015';
 evidence_before jsonb;receipts record;result jsonb;age interval;source_definition text;
begin
 source_definition:=pg_get_functiondef('public.icash_account_work_observations()'::regprocedure);
 if md5(source_definition)<>'8722d21bc188e089ec00f454b08ffe1c' then raise exception 'Public observer changed on install';end if;
 if (select reason from icash_reliability_private.account_work_observations_v2()) is distinct from 'pending_work' then raise exception 'Original nine-operation boundary lost';end if;

 -- Late billing of an old operation, with no result or original dial, currently
 -- hides all nine originals. v2 must retain their finding without touching money.
 insert into public.icash_operation_spend(operation_key,account_id,state,actual_micros,charged_cents,created_at,dispatched_at,settled_at)
 values('fixture-costed-failure',account,'settled',100000,10,now()-interval '2 days',now()-interval '1 day',now());
 if exists(select 1 from public.icash_account_work_observations()) then raise exception 'Did not reproduce billing-only false progress';end if;
 if (select reason from icash_reliability_private.account_work_observations_v2()) is distinct from 'pending_work' then raise exception 'Costed failure cleared original holds';end if;
 select * into receipts from icash_reliability_private.account_work_receipts_v2(account,now());
 if receipts.last_completed_output_at is not null or receipts.last_attempted_outreach_at is not null then raise exception 'Cost alone became work';end if;

 -- Above the research quote, no completed output remains visible as such.
 delete from public.icash_operation_spend where operation_key like 'synthetic-original:%';
 update public.icash_wallets set balance_cents=500;
 if (select reason from icash_reliability_private.account_work_observations_v2()) is distinct from 'no_completed_work' then raise exception 'Missing output hidden by cost';end if;
 insert into public.icash_voice_jobs values(voice,account,'fixture-costed-failure','CA_fixture_original','ended_before_recording');
 insert into public.icash_call_recordings values(voice,account,voice,'fixture-costed-failure','CA_fixture_original',now()-interval '23 hours',null,'ended_before_recording',now()-interval '1 day');
 select * into receipts from icash_reliability_private.account_work_receipts_v2(account,now());
 if receipts.last_attempted_outreach_at is distinct from now()-interval '23 hours' or receipts.last_completed_output_at is not null then raise exception 'Late billing moved original dial or invented output';end if;
 if (select outreach_evidence_state from icash_reliability_private.account_work_observations_v2())<>'older_attempt_not_completed_output' then raise exception 'Old dial promoted by new settlement';end if;
 update public.icash_call_recordings set dial_claimed_at=now()-interval '1 minute';
 if (select reason from icash_reliability_private.account_work_observations_v2())<>'no_completed_work'
  or (select outreach_evidence_state from icash_reliability_private.account_work_observations_v2())<>'recent_attempt_not_completed_output' then raise exception 'Real failed dial not separately recorded';end if;
 update public.icash_voice_jobs set provider_call_sid='CA_wrong';
 if (select last_attempted_outreach_at from icash_reliability_private.account_work_receipts_v2(account,now())) is not null then raise exception 'Wrong provider identity accepted';end if;
 update public.icash_voice_jobs set provider_call_sid='CA_fixture_original',account_id=other;
 if (select last_attempted_outreach_at from icash_reliability_private.account_work_receipts_v2(account,now())) is not null then raise exception 'Cross-account dial accepted';end if;
 delete from public.icash_voice_jobs;delete from public.icash_call_recordings;

 -- Queued text, a top-level delivered state without provider identity, and a
 -- missing original dispatch are not verified attempts or terminal deliveries.
 insert into public.icash_text_messages(id,account_id,provider_id,state,direction,created_at) values(message,account,null,'delivered','outgoing',now()-interval '1 day');
 insert into public.icash_operation_spend(operation_key,account_id,state,created_at,dispatched_at) values('text:'||message,account,'settled',now()-interval '1 day',now()-interval '2 minutes');
 if (select last_attempted_outreach_at from icash_reliability_private.account_work_receipts_v2(account,now())) is not null then raise exception 'Unacknowledged text became an attempt';end if;
 update public.icash_text_messages set provider_id='text_original_provider',state='accepted';
 select * into receipts from icash_reliability_private.account_work_receipts_v2(account,now());
 if receipts.last_attempted_outreach_at is distinct from now()-interval '2 minutes' or receipts.last_completed_output_at is not null
  or receipts.evidence->'verifiedTextDelivery' is distinct from 'null'::jsonb then raise exception 'Text acceptance claimed output/delivery';end if;
 update public.icash_operation_spend set dispatched_at=null where operation_key='text:'||message;
 if (select last_attempted_outreach_at from icash_reliability_private.account_work_receipts_v2(account,now())) is not null then raise exception 'Missing text timing invented';end if;

 -- A completed research result uses its original result time, not later billing.
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,state,created_at,dispatched_at,settled_at)
 values('fixture-research',account,'00000000-0000-4000-8000-000000000002','settled',now()-interval '2 hours',now()-interval '90 minutes',now());
 insert into public.icash_discovery_results values('fixture-research',account,jsonb_build_object('rows','[]'::jsonb,'fetchedAt',now()-interval '89 minutes'),now()-interval '1 hour');
 if (select last_completed_output_at from icash_reliability_private.account_work_receipts_v2(account,now())) is distinct from now()-interval '1 hour' then raise exception 'Research receipt timing changed';end if;
 for age in select unnest(array[interval '29 minutes 59 seconds',interval '30 minutes',interval '30 minutes 1 second']) loop
  update public.icash_discovery_results set created_at=now()-age;
  if exists(select 1 from icash_reliability_private.account_work_observations_v2()) is distinct from (age>=interval '30 minutes') then raise exception 'Completed-output boundary %',age;end if;
 end loop;
 update public.icash_discovery_results set account_id=other;
 if (select last_completed_output_at from icash_reliability_private.account_work_receipts_v2(account,now())) is not null then raise exception 'Cross-account research accepted';end if;
 delete from public.icash_discovery_results;

 -- Exact active-export completion is useful enrichment, even if its operation
 -- still awaits billing. Missing/mismatched canonical export proof stays unknown.
 result:=jsonb_build_object('propertyId','fixture_property','contacts',jsonb_build_array(jsonb_build_object('personId','per_fixture','likelyOwner',true,'ownershipVerified',false,'outreachAuthorized',false,
  'phones',jsonb_build_array(jsonb_build_object('number','2025550100','doNotCall',false,'permission','unverified','activity','active','activityBasis','provider_export_filter')))),
  'requestedPersonIds',jsonb_build_array('per_fixture'),'outreachAuthorized',false,'creditsUsed',1,'peopleCredits',1,'providerCredits',jsonb_build_object('used',1,'people',1),
  'allocation',jsonb_build_object('method','active-export-used-order-v1','batchId',batch,'sharedContacts',0),
  'activityEvidence',jsonb_build_object('contract','owner-active-export-v1','exportId','fixture_export','artifactSha256',repeat('a',64)));
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,state,created_at,dispatched_at)
 values('owners:'||account||':'||screening,account,'00000000-0000-4000-8000-000000000003','dispatched',now()-interval '3 minutes',now()-interval '2 minutes');
 insert into public.icash_owner_contacts values(screening,account,'owners:'||account||':'||screening,result,now()-interval '1 minute');
 insert into icash_research_private.owner_batches values(batch,account,'complete',now()-interval '4 minutes',jsonb_build_object('export_id','fixture_export','credits',result->'providerCredits'),
  jsonb_build_array(jsonb_build_object('screeningId',screening,'ids',result->'requestedPersonIds','snapshot',jsonb_build_object('propertyId','fixture_property'))),
  jsonb_build_array(jsonb_build_object('screeningId',screening,'result',result)));
 insert into icash_research_private.owner_batch_items values(batch,screening,'owners:'||account||':'||screening);
 if (select last_completed_output_at from icash_reliability_private.account_work_receipts_v2(account,now())) is not null then raise exception 'Missing canonical export proof accepted';end if;
 insert into icash_research_private.owner_exports values(batch,now()-interval '1 minute','synthetic csv',repeat('a',64),jsonb_build_object('raw',jsonb_build_object('export_id','fixture_export','credits',result->'providerCredits')));
 if (select last_completed_output_at from icash_reliability_private.account_work_receipts_v2(account,now())) is distinct from now()-interval '1 minute'
  or exists(select 1 from icash_reliability_private.account_work_observations_v2()) then raise exception 'Canonical enrichment not recognized';end if;
 set local role service_role;
 select * into receipts from icash_reliability_private.account_work_receipts_v2(account,now());
 reset role;
 if receipts.last_completed_output_at is distinct from now()-interval '1 minute' then raise exception 'Service reader cannot access narrowly exposed canonical completion';end if;
 if has_schema_privilege('service_role','icash_research_private','usage')
  or has_table_privilege('service_role','icash_research_private.owner_exports','select') then raise exception 'Private export table access was broadened';end if;
 update icash_research_private.owner_exports set completed_at=now()+interval '1 day';
 if (select last_completed_output_at from icash_reliability_private.account_work_receipts_v2(account,now())) is not null then raise exception 'Future canonical finalization accepted';end if;
 update icash_research_private.owner_exports set completed_at='infinity';
 if (select last_completed_output_at from icash_reliability_private.account_work_receipts_v2(account,now())) is not null then raise exception 'Infinite canonical finalization accepted';end if;
 update icash_research_private.owner_exports set completed_at=now()-interval '30 seconds';
 if (select last_completed_output_at from icash_reliability_private.account_work_receipts_v2(account,now())) is distinct from now()-interval '30 seconds' then raise exception 'Actual post-save export finalization time lost';end if;
 if exists(select 1 from icash_reliability_private.account_work_receipts_v2(account,now()-interval '1 hour'))
  or exists(select 1 from icash_reliability_private.account_work_receipts_v2(account,now()+interval '1 hour')) then raise exception 'Invented historical or future snapshot';end if;
 update icash_research_private.owner_exports set completed_at=now();
 if (select last_completed_output_at from icash_reliability_private.account_work_receipts_v2(account,now())) is distinct from now() then raise exception 'Exact observation finalization boundary lost';end if;
 update icash_research_private.owner_exports set artifact_sha256=repeat('b',64);
 if (select last_completed_output_at from icash_reliability_private.account_work_receipts_v2(account,now())) is not null then raise exception 'Wrong canonical artifact accepted';end if;

 -- Public controls and funds retain their old precedence; funding/resume never
 -- populate completed output, even when their existing grace hides a finding.
 update public.icash_accounts set bot_paused=true;
 insert into public.icash_control_events(id,account_id,action,created_at) values(gen_random_uuid(),account,'pause',now());
 if exists(select 1 from icash_reliability_private.account_work_observations_v2()) then raise exception 'Customer Pause ignored';end if;
 delete from public.icash_control_events;update public.icash_accounts set bot_paused=false;
 update public.fixture_work_policy set member=false;
 if exists(select 1 from icash_reliability_private.account_work_observations_v2()) then raise exception 'Membership ignored';end if;
 update public.fixture_work_policy set member=true;
 update public.icash_discovery_configs set enabled=false;
 if (select reason from icash_reliability_private.account_work_observations_v2())<>'configuration_disabled' then raise exception 'Configuration precedence lost';end if;
 update public.icash_discovery_configs set enabled=true;
 insert into public.icash_control_events(id,account_id,action,created_at) values(gen_random_uuid(),account,'resume',now());
 if exists(select 1 from icash_reliability_private.account_work_observations_v2())
  or (select last_completed_output_at from icash_reliability_private.account_work_receipts_v2(account,now())) is not null then raise exception 'Resume became output';end if;
 delete from public.icash_control_events;
 evidence_before:=public.fixture_progress_evidence();
 perform * from icash_reliability_private.account_work_observations_v2();
 perform * from icash_reliability_private.account_work_receipts_v2(account,now());
 if evidence_before is distinct from public.fixture_progress_evidence() then raise exception 'Reader modified original evidence or money';end if;
 if source_definition<>pg_get_functiondef('public.icash_account_work_observations()'::regprocedure) then raise exception 'Public observer changed';end if;
end $test$;
rollback;
