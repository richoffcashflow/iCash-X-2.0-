-- Reuse one call-hold snapshot during selection; final admission always rereads.
-- Skip known non-resumable budget tickets before the bounded recovery batch.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);

do $check$
declare item record;
begin
 for item in select * from (values
  ('icash_voice_contact_holds()','c02f30febf4d8615de5280a3256dc6fc'),
  ('icash_voice_capacity_available(uuid,text,text,text,boolean)','1cb711da59b313ea748dec4b6c349283'),
  ('icash_active_voice_slots()','1ab6268023eaba1138a09be673d13a86'),
  ('icash_resume_prospecting_ticket()','111ec5322cc6bac7b8f48b70740727ab'),
  ('icash_issue_ready_voice_ticket()','848bba0d7bb21485dbc648bbad6e6f38')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(('public.'||item.signature)::regprocedure))<>item.checksum then
   raise exception 'Scheduler reliability prerequisite changed: %',item.signature;
  end if;
 end loop;
end $check$;

-- Preserve the exact quarantine/late-receipt rules from the existing slot
-- function. Materialize original contact holds once for both projections.
do $snapshot$
declare d text;body text;
begin
 d:=pg_get_functiondef('public.icash_active_voice_slots()'::regprocedure);
 body:=split_part(split_part(d,'AS $function$',2),'$function$',1);
 body:=regexp_replace(body,';\s*$','');
 body:=replace(body,'public.icash_voice_contact_holds()','holds');
 execute $head$create function icash_recording_private.voice_capacity_snapshot() returns jsonb
 language sql stable security definer set search_path='' as $body$
 with holds as materialized (select * from public.icash_voice_contact_holds()),
 slots as materialized ($head$||body||$tail$)
 select jsonb_build_object('holds',coalesce((select jsonb_agg(to_jsonb(h)) from holds h),'[]'::jsonb),
  'slots',coalesce((select jsonb_agg(to_jsonb(s)) from slots s),'[]'::jsonb));
 $body$;$tail$;
end $snapshot$;

do $capacity$
declare d text;original text;signature text;slot_definition text;
 rows text:='(operation_key text,account_id uuid,agent_id text,contact_key text)';
begin
 original:=pg_get_functiondef('public.icash_voice_capacity_available(uuid,text,text,text,boolean)'::regprocedure);
 signature:='public.icash_voice_capacity_available(p_account uuid, p_agent text, p_operation text, p_contact text, p_incoming boolean DEFAULT false)';
 if position(signature in original)=0 then raise exception 'Capacity signature changed';end if;
 d:=replace(original,signature,'icash_recording_private.voice_capacity_from_snapshot(p_account uuid, p_agent text, p_operation text, p_contact text, p_incoming boolean, p_snapshot jsonb)');
 d:=replace(d,'public.icash_active_voice_slots()', 'jsonb_to_recordset(p_snapshot->''slots'') as snapshot_slot'||rows);
 d:=replace(d,'public.icash_voice_contact_holds() s','jsonb_to_recordset(p_snapshot->''holds'') as s'||rows);
 d:=replace(d,'public.icash_voice_contact_holds() held','jsonb_to_recordset(p_snapshot->''holds'') as held'||rows);
 if position('public.icash_voice_contact_holds()' in d)>0 or position('public.icash_active_voice_slots()' in d)>0 then
  raise exception 'Unconverted capacity scan';
 end if;
 execute d;
 -- Existing public callers still use current database evidence, never a
 -- client-supplied snapshot. This also reduces final admission to one scan.
 execute split_part(original,'AS $function$',1)||$wrapper$AS $function$
 begin
  if p_incoming is not true and exists(select 1 from public.icash_voice_capacity_policy where id=1 and credit_state='exhausted') then return false;end if;
  return icash_recording_private.voice_capacity_from_snapshot(p_account,p_agent,p_operation,p_contact,p_incoming,
   icash_recording_private.voice_capacity_snapshot());
 end $function$;$wrapper$;

 slot_definition:=pg_get_functiondef('public.icash_voice_queue_slot_open(uuid,uuid)'::regprocedure);
 d:=replace(slot_definition,'public.icash_voice_queue_slot_open(p_account uuid, p_job uuid)',
  'icash_recording_private.voice_queue_slot_from_snapshot(p_account uuid, p_job uuid, p_snapshot jsonb)');
 d:=replace(d,'public.icash_voice_capacity_available(j.account_id,(select agent_id from public.icash_voice_configs where account_id=j.account_id),''voice:''||j.id,target.contact_key,false)',
  'icash_recording_private.voice_capacity_from_snapshot(j.account_id,(select agent_id from public.icash_voice_configs where account_id=j.account_id),''voice:''||j.id,target.contact_key,false,p_snapshot)');
 if position('public.icash_voice_capacity_available(' in d)>0 or d=slot_definition then raise exception 'Queue capacity boundary changed';end if;
 execute d;

 d:=pg_get_functiondef('public.icash_issue_ready_voice_ticket()'::regprocedure);
 d:=replace(d,'last_voice timestamptz;','last_voice timestamptz;capacity_snapshot jsonb;');
 d:=replace(d,'and public.icash_outgoing_voice_capacity_open() then',
  'and public.icash_outgoing_voice_capacity_open() then'||E'\n capacity_snapshot:=icash_recording_private.voice_capacity_snapshot();');
 d:=replace(d,'public.icash_voice_queue_slot_open(candidate.account_id,candidate.id)',
  'icash_recording_private.voice_queue_slot_from_snapshot(candidate.account_id,candidate.id,capacity_snapshot)');
 if position('capacity_snapshot:=' in d)=0 or position('public.icash_voice_queue_slot_open(' in d)>0 then
  raise exception 'Voice selection capacity boundary changed';
 end if;
 execute d;
end $capacity$;

-- Only the service backend may read the snapshot or use selection helpers.
-- No new table permissions, public API input or final dispatch authority.
revoke all on function icash_recording_private.voice_capacity_snapshot(),
 icash_recording_private.voice_capacity_from_snapshot(uuid,text,text,text,boolean,jsonb),
 icash_recording_private.voice_queue_slot_from_snapshot(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function icash_recording_private.voice_capacity_snapshot(),
 icash_recording_private.voice_capacity_from_snapshot(uuid,text,text,text,boolean,jsonb),
 icash_recording_private.voice_queue_slot_from_snapshot(uuid,uuid,jsonb) to service_role;

create index icash_budget_resume_candidates on public.icash_automation_tickets(account_id,created_at,id)
 where state='held' and outcome='prospecting_budget_held';

do $resume$
declare d text;needle text:='  order by x.created_at limit 20 for update of x skip locked loop';
begin
 d:=pg_get_functiondef('public.icash_resume_prospecting_ticket()'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Budget recovery batch changed';end if;
 -- Mirror the existing receipt-free checks before LIMIT. Their locked checks
 -- below remain authoritative if state changes during selection.
 d:=replace(d,needle,$eligible$
  and (x.kind='discovery' or (
   x.kind in ('contacts','voice_dispatch','seller_opener','seller_recovery')
   and (x.kind<>'contacts' or x.screening_id is not null)
   and not exists(select 1 from public.icash_automation_tickets active
    where active.id<>x.id and active.account_id=x.account_id
     and ((active.state='issued' and active.expires_at>now())
      or (active.state='consumed' and active.created_at>now()-interval '5 minutes')))
   and (x.kind<>'voice_dispatch' or exists(select 1 from public.icash_voice_jobs v
    where v.id=x.voice_job_id and v.account_id=x.account_id and v.state='held' and v.outcome='prospecting_budget_held'
     and v.operation_key is null and v.conversation_id is null and v.provider_call_sid is null))
   and (x.kind not in ('seller_opener','seller_recovery') or exists(select 1 from public.icash_text_messages m
    where m.id=x.opener_message_id and m.account_id=x.account_id and m.state='ready' and m.provider_id is null and m.last_delivery_at is null))
   and not exists(select 1 from public.icash_operation_spend spent where spent.operation_key=case
    when x.kind='contacts' then 'owners:'||x.account_id||':'||x.screening_id
    when x.kind='voice_dispatch' then 'voice:'||x.voice_job_id else 'text:'||x.opener_message_id end)
   and not exists(select 1 from public.icash_live_conversations live where live.operation_key=case
    when x.kind='contacts' then 'owners:'||x.account_id||':'||x.screening_id
    when x.kind='voice_dispatch' then 'voice:'||x.voice_job_id else 'text:'||x.opener_message_id end)
  ))
$eligible$||needle);
 execute d;
end $resume$;
commit;
