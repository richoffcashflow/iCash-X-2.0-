-- Prospective carrier AMD: immutable per-call transport policy and complete costs.
-- Legacy calls, rates, approvals and receipts are unchanged. No calls are created.
-- The migration runner owns the transaction and schema ledger.
do $carrier_amd$
declare target regprocedure; d text; old text; replacement text; item record;
begin
 for item in select * from (values
  ('public.icash_create_direct_recorded_call(uuid,text,text,text,text,text,text,jsonb,jsonb)','ee07e65431bcbec2a0cdae076d17f618',true),
  ('public.icash_settle_unstarted_recorded_call(uuid,uuid,text,jsonb,jsonb,text)','d22a47776b891f4a975c9caeef6b8a23',true),
  ('public.icash_settle_voice_usage(text,jsonb,text)','fdf54d78d80999dfdddb61ef7edae36d',false)
 ) p(signature,source_hash,definer) loop
  target:=to_regprocedure(item.signature);
  if target is null or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target
   and md5(pg_get_functiondef(p.oid))=item.source_hash and p.prosecdef=item.definer and p.provolatile='v' and p.proparallel='u'
   and l.lanname='plpgsql' and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=""']
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}') then raise exception 'Carrier AMD source or access contract changed: %',item.signature;end if;
 end loop;

 target:='public.icash_create_direct_recorded_call(uuid,text,text,text,text,text,text,jsonb,jsonb)'::regprocedure;
 d:=pg_get_functiondef(target);
 old:=$old$icash_recording_private.keys(p_context->'callContext',array['principal','assistantName','firstMessage','prompt','strategyKey'],array['voiceId'])$old$;
 replacement:=$new$icash_recording_private.keys(p_context->'callContext',array['principal','assistantName','firstMessage','prompt','strategyKey'],array['voiceId','answerPolicy'])
   or (p_context->'callContext' ? 'answerPolicy' and p_context->'callContext'->'answerPolicy' is distinct from '"carrier_amd_enable_v1"'::jsonb)$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Carrier AMD context clause changed';end if;
 d:=replace(d,old,replacement);
 old:=$old$and p.party='seller'$old$;
 replacement:=$new$and p.party='seller'
  -- Existing immutable 51,000-micro other allowance covers at most 31,000
  -- recording/storage plus 7,500 AMD; direct calls use no speech Gather.
  and (not coalesce(p_context->'callContext' ? 'answerPolicy',false) or
   (jsonb_typeof(rate.costs_micros->'other')='number' and (rate.costs_micros->>'other')::numeric>=38500))$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Carrier AMD admission clause changed';end if;
 execute replace(d,old,replacement);

 target:='public.icash_settle_unstarted_recorded_call(uuid,uuid,text,jsonb,jsonb,text)'::regprocedure;
 d:=pg_get_functiondef(target);
 d:=replace(d,'charge bigint;gather bigint;basis text', 'charge bigint;gather bigint;answer_detection bigint:=0;answer_policy boolean:=false;basis text');
 old:=$old$gather:=case when (p_receipt->>'speechGatherUsed')::boolean then 20000 else 0 end;$old$;
 replacement:=$new$gather:=case when (p_receipt->>'speechGatherUsed')::boolean then 20000 else 0 end;
 answer_policy:=coalesce(r.call_context ? 'answerPolicy',false);
 if answer_policy then
  if r.entry_policy is distinct from 'direct_recorded_v1' or r.call_context->'answerPolicy' is distinct from '"carrier_amd_enable_v1"'::jsonb then raise exception 'Carrier AMD immutable policy required';end if;
  answer_detection:=case when p_receipt->>'status'='completed' then 7500 else 0 end;
 end if;$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Carrier AMD gate calculation changed';end if;
 d:=replace(d,old,replacement);
 d:=replace(d,$old$(p_components->'other'->>'amountMicros')::numeric<>gather$old$, $new$(p_components->'other'->>'amountMicros')::numeric<>gather+answer_detection$new$);
 d:=replace(d,$old$jsonb_build_object('speechGatherMicros',gather,'recordingMicros',0,'storageMicros',0)$old$,$new$(jsonb_build_object('speechGatherMicros',gather,'recordingMicros',0,'storageMicros',0)||case when answer_policy then jsonb_build_object('answerDetectionMicros',answer_detection) else '{}'::jsonb end)$new$);
 d:=replace(d,$old$(gather>0 and p_components->'other'->>'basis'$old$, $new$(gather+answer_detection>0 and p_components->'other'->>'basis'$new$);
 execute d;

 target:='public.icash_settle_voice_usage(text,jsonb,text)'::regprocedure;
 d:=pg_get_functiondef(target);
 d:=replace(d,'receipt numeric;duration numeric;', 'receipt numeric;duration numeric;audio public.icash_call_recordings;audio_minutes bigint;audio_recording bigint;audio_storage bigint;');
 old:=$old$-- Bind the inclusive ElevenLabs receipt to THIS operation and conversation.$old$;
 replacement:=$new$-- A rolling old collector cannot settle a new AMD call without its fee.
 select * into audio from public.icash_call_recordings where operation_key=o.operation_key and account_id=o.account_id;
 if found and coalesce(audio.call_context ? 'answerPolicy',false) then
  if audio.entry_policy is distinct from 'direct_recorded_v1' or audio.call_context->'answerPolicy' is distinct from '"carrier_amd_enable_v1"'::jsonb
   or audio.conversation_id is distinct from c.conversation_id or audio.rate_id is distinct from o.rate_id
   or audio.state not in ('available','expired','deletion_pending','deleted') or audio.recording_sid is null or audio.call_sid is null
   or audio.start_claimed_at is null or coalesce(audio.consent_at,audio.recording_authorized_at) is null
   or audio.provider_started_at is null or audio.ended_at is null or audio.ended_at<audio.provider_started_at
   or audio.duration_seconds is null or audio.duration_seconds not between 0 and 600 then return false;end if;
  audio_minutes:=ceil(audio.duration_seconds::numeric/60);
  audio_recording:=coalesce(audio.provider_recording_price_micros,audio_minutes*2500);
  audio_storage:=ceil(audio_minutes*500*30::numeric/28);
  if p_components->'other'->>'basis' is distinct from 'estimated'
   or p_components->'other'->'amountMicros' is distinct from to_jsonb(audio_recording+audio_storage+7500)
   or p_components->'other'->'subitems' is distinct from jsonb_build_object('recordingMicros',audio_recording,'storageMicros',audio_storage,'speechGatherMicros',0,'answerDetectionMicros',7500)
   then raise exception 'Complete carrier AMD recording costs required';end if;
 end if;
 -- Bind the inclusive ElevenLabs receipt to THIS operation and conversation.$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Carrier AMD voice calculation changed';end if;
 execute replace(d,old,replacement);
 for item in select * from (values
  ('public.icash_create_direct_recorded_call(uuid,text,text,text,text,text,text,jsonb,jsonb)','1832ddd79e5c74a1abcf1e0895be324e',true),
  ('public.icash_settle_unstarted_recorded_call(uuid,uuid,text,jsonb,jsonb,text)','ddd8f5de8e8b201a7b1617cae85970db',true),
  ('public.icash_settle_voice_usage(text,jsonb,text)','c8abc446d71bdd367c27cbc29e88f839',false)
 ) p(signature,result_hash,definer) loop
  target:=to_regprocedure(item.signature);
  if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target
   and md5(pg_get_functiondef(p.oid))=item.result_hash and p.prosecdef=item.definer and p.provolatile='v' and p.proparallel='u'
   and l.lanname='plpgsql' and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=""']
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}') then raise exception 'Carrier AMD result or access contract changed: %',item.signature;end if;
 end loop;
end $carrier_amd$;
