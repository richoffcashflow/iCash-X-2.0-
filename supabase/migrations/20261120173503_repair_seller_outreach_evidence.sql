-- Only evidence-bound owner, contact and delivery paths change.
create function icash_reliability_private.verified_empty_owner_export(op public.icash_operation_spend)
returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(
  select 1 from icash_research_private.owner_batch_items i
  join icash_research_private.owner_batches b on b.id=i.batch_id and b.account_id=op.account_id
  join icash_research_private.owner_exports e on e.id=b.id
  join icash_research_private.owner_export_capacity_reviews r on r.id=e.capacity_review_id and r.export_id=e.id
  join icash_research_private.requests q on q.id=b.id and q.account_id=b.account_id
  where op.state='dispatched' and i.operation_key=op.operation_key and op.operation_key='owners:'||b.account_id||':'||i.screening_id
   and b.state='claimed' and b.results is null and b.paid_receipt=e.receipt->'raw'
   and e.terminal_at is null and e.completed_at is null and e.csv is null and e.artifact_sha256 is null
   and r.state='verified' and r.auto_policy='empty-idle-v1' and r.receipt_hash=md5(e.receipt::text)
   and e.receipt->'httpStatus'='400'::jsonb and e.receipt#>>'{raw,error,code}'='no_records_matched'
   and e.receipt#>>'{raw,error,request_id}' ~ '^req_[a-zA-Z0-9_-]+$'
   and case when pg_input_is_valid(e.receipt->>'rawText','jsonb') then (e.receipt->>'rawText')::jsonb=e.receipt->'raw' else false end
   and q.kind='owner_lookup' and q.operation_key='owner-batch:'||b.id and q.admitted
   and q.finished_at between q.created_at and now() and q.result->>'outcome'='http_error'
   and q.result->'httpStatus'='400'::jsonb and not q.result?'creditsUsed')
$fn$;
revoke all on function icash_reliability_private.verified_empty_owner_export(public.icash_operation_spend) from public,anon,authenticated;
grant execute on function icash_reliability_private.verified_empty_owner_export(public.icash_operation_spend) to service_role;

do $patch$
declare src text:=pg_get_functiondef('public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
begin
 if md5(src)<>'7193a49bccb17694139ebcf11bcc19de' then raise exception 'Unexpected predecessor of public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)';end if;
 src:=replace(src,$old$p_request->'fields'='["person_full_name","has_active_phone_number","phone_1_usage_2_months_id","phone_1_usage_12_months_id","phone_2_usage_2_months_id","phone_2_usage_12_months_id","phone_3_usage_2_months_id","phone_3_usage_12_months_id"]'::jsonb then$old$,$new$p_request->'fields' in ('["person_full_name","has_active_phone_number","phone_1_usage_2_months_id","phone_1_usage_12_months_id","phone_2_usage_2_months_id","phone_2_usage_12_months_id","phone_3_usage_2_months_id","phone_3_usage_12_months_id"]'::jsonb,'["person_full_name","has_active_phone_number","phones","phone_1_usage_2_months_id","phone_1_usage_12_months_id","phone_2_usage_2_months_id","phone_2_usage_12_months_id","phone_3_usage_2_months_id","phone_3_usage_12_months_id"]'::jsonb) then$new$);
 execute src;
end $patch$;

do $patch$
declare src text:=pg_get_functiondef('icash_research_private.credit_export_source(uuid,text)'::regprocedure);
begin
 if md5(src)<>'366cdaed7922a1ddd1fa6719c442f8fe' then raise exception 'Unexpected predecessor of icash_research_private.credit_export_source(uuid,text)';end if;
 src:=replace(src,$old$'fields','["person_full_name","has_active_phone_number","phone_1_usage_2_months_id","phone_1_usage_12_months_id","phone_2_usage_2_months_id","phone_2_usage_12_months_id","phone_3_usage_2_months_id","phone_3_usage_12_months_id"]'::jsonb,$old$,$new$'fields',case when e.request->'fields'='["person_full_name","has_active_phone_number","phones","phone_1_usage_2_months_id","phone_1_usage_12_months_id","phone_2_usage_2_months_id","phone_2_usage_12_months_id","phone_3_usage_2_months_id","phone_3_usage_12_months_id"]'::jsonb then e.request->'fields' else '["person_full_name","has_active_phone_number","phone_1_usage_2_months_id","phone_1_usage_12_months_id","phone_2_usage_2_months_id","phone_2_usage_12_months_id","phone_3_usage_2_months_id","phone_3_usage_12_months_id"]'::jsonb end,$new$);
 execute src;
end $patch$;

do $patch$
declare src text:=pg_get_functiondef('public.icash_call_has_seller_response(jsonb)'::regprocedure);
begin
 if md5(src)<>'a94feae59a7abaf53791d9c47fc02ddf' then raise exception 'Unexpected predecessor of public.icash_call_has_seller_response(jsonb)';end if;
 src:=replace(src,$old$press any key to continue$old$,$new$^\s*[. ]*been set up yet[.! ]+goodbye[.! ]*$|^\s*try your call again later[.! ]+goodbye[.! ]*$|^\s*you can modify it by pressing pound[.! ]*$|^\s*i am a virtual assistant that helps people with their calls when they[''’]re busy[.! ]+they wanted me to check the reason for the call before connecting you to them[.! ]*$|press any key to continue$new$);
 execute src;
end $patch$;

do $patch$
declare src text:=pg_get_functiondef('icash_reliability_private.pending_planning_cents(public.icash_operation_spend)'::regprocedure);
begin
 if md5(src)<>'89d0bedf4ef52b9e8a90131b9ce1a680' then raise exception 'Unexpected predecessor of icash_reliability_private.pending_planning_cents(public.icash_operation_spend)';end if;
 src:=replace(src,$old$  else p_operation.charge_cap_cents end;$old$,$new$  when p_operation.state='dispatched' and p_operation.operation_key like 'owners:%'
   and icash_reliability_private.verified_empty_owner_export(p_operation) then 0
  else p_operation.charge_cap_cents end;$new$);
 execute src;
end $patch$;

do $patch$
declare src text:=pg_get_functiondef('public.icash_queue_voice_jobs()'::regprocedure);
begin
 if md5(src)<>'fe7f1e81af08f50ec212793aa3919a67' then raise exception 'Unexpected predecessor of public.icash_queue_voice_jobs()';end if;
 src:=replace(src,$old$if exists(select 1 from public.icash_voice_jobs where state='ready' and due_at<=now())$old$,$new$if exists(select 1 from public.icash_voice_jobs v join public.icash_voice_contact_targets target
  on target.id=coalesce(v.permission_id,v.operational_contact_id) and target.account_id=v.account_id
  where v.state='ready' and v.due_at<=now() and target.revoked_at is null and target.permission_until>now())$new$);
 src:=replace(src,$old$ perform public.icash_queue_unanswered_seller_calls();$old$,$new$ with expired as materialized (
  select v.id from public.icash_voice_jobs v join public.icash_operational_contacts op on op.id=v.operational_contact_id and op.account_id=v.account_id
  where v.state='ready' and v.due_at<=now() and v.permission_id is null and op.channel='voice' and op.revoked_at is null and op.eligibility_until<=now()
   and v.operation_key is null and v.provider_call_sid is null and v.conversation_id is null and v.outcome is null
   and v.callback_id is null and v.sms_source_message_id is null and v.sms_context is null and v.seller_followup_of is null
   and v.cancellation_notice_id is null and v.meta_offer_lead_id is null and v.meta_retry_of is null and v.meta_followup_lead_id is null
   and not exists(select 1 from public.icash_automation_tickets a where a.voice_job_id=v.id)
   and not exists(select 1 from public.icash_call_recordings r where r.voice_job_id=v.id)
   and not exists(select 1 from public.icash_operation_spend o where o.operation_key='voice:'||v.id)
  order by v.due_at,v.id limit 50 for update of v skip locked)
 update public.icash_voice_jobs v set state='held',outcome='contact_checks_expired_before_dispatch',updated_at=now() from expired where expired.id=v.id;
 perform public.icash_queue_unanswered_seller_calls();$new$);
 src:=replace(src,$old$ where prior.callback_id is null$old$,$new$ where prior.callback_id is null and not (prior.state='held' and prior.outcome is not distinct from 'contact_checks_expired_before_dispatch' and prior.operational_contact_id is not null and prior.operation_key is null and prior.provider_call_sid is null and prior.conversation_id is null)$new$);
 src:=replace(src,$old$ and j.callback_id is null)$old$,$new$ and j.callback_id is null and not (j.state='held' and j.outcome is not distinct from 'contact_checks_expired_before_dispatch' and j.operational_contact_id is not null and j.operation_key is null and j.provider_call_sid is null and j.conversation_id is null))$new$);
 execute src;
end $patch$;

do $patch$
declare src text:=pg_get_functiondef('public.icash_claim_text_delivery_rechecks()'::regprocedure);
begin
 if md5(src)<>'6af7b3cff3417dc8f29faf9465d8dd56' then raise exception 'Unexpected predecessor of public.icash_claim_text_delivery_rechecks()';end if;
 src:=replace(src,$old$   and s.message_id is null
  order by m.created_at$old$,$new$   and s.message_id is null
   -- Alternate first-read windows. Retry eligibility and the three-read ceiling stay intact.
   and m.created_at>=case when extract(minute from now())::int%2=0 then now()-interval '24 hours' else '-infinity'::timestamptz end
  order by m.created_at$new$);
 execute src;
end $patch$;

create function icash_reliability_private.carrier_block_notice(p_account uuid,p_thread uuid,p_message uuid)
returns boolean language sql stable set search_path='' as $fn$
 select exists(select 1 from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  where m.id=p_message and t.id=p_thread and t.account_id=p_account and t.party='seller' and t.recipient ~ '^\+1[0-9]{10}$'
   and m.direction='incoming' and m.state='received' and m.event_id is not null
   and m.body='Free Msg: Receiver '||substring(t.recipient from 2)||' unable to receive message - Message Blocking is active')
$fn$;
revoke all on function icash_reliability_private.carrier_block_notice(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function icash_reliability_private.carrier_block_notice(uuid,uuid,uuid) to service_role;
create function icash_reliability_private.stop_carrier_ai_job() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if new.state in ('pending','issued','analyzing','drafted','needs_review','queued','handoff')
  and icash_reliability_private.carrier_block_notice(new.account_id,new.thread_id,new.message_id) then new.state:='superseded';end if;
 return new;
end $fn$;
revoke all on function icash_reliability_private.stop_carrier_ai_job() from public,anon,authenticated;
create trigger icash_stop_carrier_ai_job before insert or update of state on public.icash_text_ai_jobs for each row execute function icash_reliability_private.stop_carrier_ai_job();
with carrier_jobs as materialized (
 select j.id,j.account_id,j.thread_id,j.outgoing_id from public.icash_seller_reply_progress p
 join public.icash_text_ai_jobs j on j.message_id=p.message_id and j.account_id=p.account_id and j.thread_id=p.thread_id
 where p.state='stopped' and p.reason='carrier_response' and j.state in ('pending','needs_review','queued')
  and icash_reliability_private.carrier_block_notice(j.account_id,j.thread_id,j.message_id) for update of j
), cancelled as (
 update public.icash_text_messages m set state='cancelled',updated_at=now() from carrier_jobs j
 where m.id=j.outgoing_id and m.thread_id=j.thread_id and m.account_id=j.account_id and m.direction='outgoing'
  and m.state='ready' and m.provider_id is null and not exists(select 1 from public.icash_operation_spend o where o.operation_key='text:'||m.id)
 returning m.id)
update public.icash_text_ai_jobs j set state='superseded',updated_at=now() from carrier_jobs c
where j.id=c.id and (c.outgoing_id is null or c.outgoing_id in (select id from cancelled));
