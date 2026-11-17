-- Preserve existing unanswered followups after a prospective carrier machine cutoff.
-- No backfill, enrollment, cadence or activation changes. Apply after carrier AMD costs.
-- The migration runner owns the transaction and schema ledger.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $carrier_followup_guard$
declare item record; target regprocedure;
begin
 for item in select * from (values
  ('icash_recording_private.audit()','ffa907f5b222bcddd1b2444eef073baf',true,false),
  ('icash_recording_private.audit_immutable()','efe2ad490658253db147212a2ccc66cd',false,false),
  ('public.icash_settle_unstarted_recorded_call(uuid,uuid,text,jsonb,jsonb,text)','ddd8f5de8e8b201a7b1617cae85970db',true,true),
  ('public.icash_unanswered_seller_call_current(uuid,uuid,uuid)','a4845529c2d3393c67c7da5d509ba56a',true,true),
  ('icash_seller_recovery_private.settled_unanswered_call(uuid,uuid,uuid)','ee6e80f53700bed9fb2133e749238ac8',false,false),
  ('icash_seller_recovery_private.meta_third_call_current(uuid,uuid)','613e9abcf9796dba14a0658d9e23179d',true,true)
 ) p(signature,source_hash,definer,service_access) loop
  target:=to_regprocedure(item.signature);
  if target is null or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target
   and md5(pg_get_functiondef(p.oid))=item.source_hash and p.prosecdef=item.definer and p.provolatile='v' and p.proparallel='u'
   and l.lanname='plpgsql' and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=""']
   and p.proacl::text=case when item.service_access then '{postgres=X/postgres,service_role=X/postgres}' else '{postgres=X/postgres}' end)
  then raise exception 'Carrier followup source or access contract changed: %',item.signature;end if;
 end loop;
 if to_regprocedure('icash_recording_private.carrier_machine_followup(uuid,uuid)') is not null then raise exception 'Carrier machine evidence helper already exists';end if;
 for item in select * from (values
  ('icash_recording_private.events',array['id:bigint:true:a','recording_id:uuid:true:','account_id:uuid:true:','operation_key:text:true:','row_version:bigint:true:','action:text:true:','old_state:text:false:','new_state:text:true:','occurred_at:timestamp with time zone:true:']),
  ('icash_recording_private.terminal_cost_receipts',array['recording_id:uuid:true:','receipt:jsonb:true:','components:jsonb:true:','evidence_ref:text:true:','charged_cents:bigint:true:','created_at:timestamp with time zone:true:'])
 ) t(name,columns) loop
  if not exists(select 1 from pg_class c where c.oid=to_regclass(item.name) and c.relkind='r' and c.relrowsecurity and not c.relforcerowsecurity
   and pg_get_userbyid(c.relowner)='postgres' and c.relacl is not null
   and not exists(select 1 from aclexplode(c.relacl) a where a.grantee<>c.relowner)
   and (select array_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||a.attidentity::text order by a.attnum)
    from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)=item.columns)
  then raise exception 'Carrier followup private table contract changed: %',item.name;end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.icash_call_recordings'::regclass and tgname='icash_recording_audit'
   and tgfoid='icash_recording_private.audit()'::regprocedure and tgtype=21 and tgenabled='O' and tgqual is null)
  or not exists(select 1 from pg_trigger where tgrelid='icash_recording_private.events'::regclass and tgname='icash_recording_audit_immutable'
   and tgfoid='icash_recording_private.audit_immutable()'::regprocedure and tgtype=27 and tgenabled='O' and tgqual is null)
  or not exists(select 1 from pg_trigger where tgrelid='icash_recording_private.events'::regclass and tgname='icash_recording_audit_no_truncate'
   and tgfoid='icash_recording_private.audit_immutable()'::regprocedure and tgtype=34 and tgenabled='O' and tgqual is null)
  or not exists(select 1 from pg_trigger where tgrelid='icash_recording_private.terminal_cost_receipts'::regclass and tgname='icash_recording_costs_immutable'
   and tgfoid='icash_recording_private.audit_immutable()'::regprocedure and tgtype=27 and tgenabled='O' and tgqual is null)
  or not exists(select 1 from pg_trigger where tgrelid='icash_recording_private.terminal_cost_receipts'::regclass and tgname='icash_recording_costs_no_truncate'
   and tgfoid='icash_recording_private.audit_immutable()'::regprocedure and tgtype=34 and tgenabled='O' and tgqual is null)
 then raise exception 'Carrier followup append-only audit contract changed';end if;
end $carrier_followup_guard$;

-- The existing append-only audit preserves the authenticated transition's reason
-- even if price-pending reconciliation later replaces recordings.last_error.
-- Existing rows remain NULL and cannot become machine evidence retroactively.
alter table icash_recording_private.events add column failure_reason text;

create function icash_recording_private.carrier_machine_followup(p_account uuid,p_recording uuid)
returns boolean language sql volatile set search_path='' as $$
 select exists(select 1 from public.icash_call_recordings r
  join public.icash_operation_spend o on o.operation_key=r.operation_key and o.account_id=r.account_id and o.state='settled'
  join icash_recording_private.terminal_cost_receipts t on t.recording_id=r.id
  where r.id=p_recording and r.account_id=p_account and r.party='seller' and r.state='failed'
   and r.entry_policy='direct_recorded_v1' and r.call_context->'answerPolicy'='"carrier_amd_enable_v1"'::jsonb
   and r.call_sid is not null and r.dial_claimed_at is not null and r.dial_claimed_at<=clock_timestamp()
   and r.consent_at is null and r.recording_authorized_at is null and r.start_claimed_at is null
   and r.provider_started_at is null and r.recording_sid is null and r.conversation_id is null
   and not exists(select 1 from public.icash_live_conversations c where c.operation_key=r.operation_key)
   and not exists(select 1 from public.icash_voice_jobs j where j.id=r.voice_job_id and j.conversation_id is not null)
   and exists(select 1 from icash_recording_private.events e where e.recording_id=r.id and e.account_id=r.account_id
    and e.operation_key=r.operation_key and e.row_version<=r.row_version
    and e.action='fail' and e.old_state='consent_pending' and e.new_state='failed' and e.failure_reason='carrier_machine_detected'
    and e.occurred_at between r.dial_claimed_at and clock_timestamp())
   and t.receipt->>'status'='completed' and t.receipt->>'currency'='USD' and t.receipt->'speechGatherUsed'='false'::jsonb
   and row(t.receipt->>'providerAccountSid',t.receipt->>'callSid',t.receipt->>'fromPhone',t.receipt->>'toPhone')
    is not distinct from row(r.provider_account_sid,r.call_sid,r.from_phone,r.to_phone)
   and t.components->'twilio'->>'basis'='verified' and t.components->'twilio'->'amountMicros'=t.receipt->'priceMicros'
   and t.components->'other'->>'basis'='estimated' and t.components->'other'->'amountMicros'='7500'::jsonb
   and t.components->'other'->'subitems'='{"speechGatherMicros":0,"recordingMicros":0,"storageMicros":0,"answerDetectionMicros":7500}'::jsonb
   and t.components->'elevenlabs'->>'basis'='not_applicable' and t.components->'elevenlabs'->'amountMicros'='0'::jsonb
   and t.components->'llm'->>'basis'='not_applicable' and t.components->'llm'->'amountMicros'='0'::jsonb);
$$;
revoke all on function icash_recording_private.carrier_machine_followup(uuid,uuid) from public,anon,authenticated,service_role;

do $carrier_followup_patch$
declare target regprocedure; d text; old text; replacement text; item record;
begin
 target:='icash_recording_private.audit()'::regprocedure;d:=pg_get_functiondef(target);
 old:=$old$old_state,new_state)
 values(new.id,new.account_id,new.operation_key,new.row_version,new.last_action,case when tg_op='UPDATE' then old.state end,new.state);$old$;
 replacement:=$new$old_state,new_state,failure_reason)
 values(new.id,new.account_id,new.operation_key,new.row_version,new.last_action,case when tg_op='UPDATE' then old.state end,new.state,
  case when tg_op='UPDATE' then case when old.state='consent_pending' and new.state='failed' and new.last_action='fail'
   and new.entry_policy='direct_recorded_v1' and new.call_context->'answerPolicy'='"carrier_amd_enable_v1"'::jsonb
   and new.call_sid is not null and new.dial_claimed_at is not null
   and new.consent_at is null and new.recording_authorized_at is null and new.start_claimed_at is null
   and new.recording_sid is null and new.conversation_id is null
   and new.last_error in ('carrier_machine_detected','carrier_fax_detected','carrier_answer_unconfirmed')
  then new.last_error end end);$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Carrier followup audit clause changed';end if;
 execute replace(d,old,replacement);

 target:='public.icash_settle_unstarted_recorded_call(uuid,uuid,text,jsonb,jsonb,text)'::regprocedure;d:=pg_get_functiondef(target);
 old:=$old$update public.icash_voice_jobs set state='held',outcome='ended_before_recording',updated_at=icash_recording_private.clock_now()$old$;
 replacement:=$new$update public.icash_voice_jobs set state=case when icash_recording_private.carrier_machine_followup(r.account_id,r.id) then 'dispatched' else 'held' end,
  outcome=case when icash_recording_private.carrier_machine_followup(r.account_id,r.id) then 'carrier_machine_detected' else 'ended_before_recording' end,
  updated_at=icash_recording_private.clock_now()$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Carrier followup settlement clause changed';end if;
 execute replace(d,old,replacement);

 for item in select * from (values
  ('public.icash_unanswered_seller_call_current(uuid,uuid,uuid)','r.to_phone)) then return false;end if;','r.to_phone)) and not icash_recording_private.carrier_machine_followup(p_account,r.id) then return false;end if;'),
  ('icash_seller_recovery_private.settled_unanswered_call(uuid,uuid,uuid)','r.to_phone));','r.to_phone)) or icash_recording_private.carrier_machine_followup(p_account,r.id);'),
  ('icash_seller_recovery_private.meta_third_call_current(uuid,uuid)','r.to_phone)) then return false;end if;','r.to_phone)) and not icash_recording_private.carrier_machine_followup(m.account_id,r.id) then return false;end if;')
 ) p(signature,needle,replacement) loop
  target:=item.signature::regprocedure;d:=pg_get_functiondef(target);
  if (length(d)-length(replace(d,item.needle,'')))<>length(item.needle) then raise exception 'Carrier followup terminal clause changed: %',item.signature;end if;
  execute replace(d,item.needle,item.replacement);
 end loop;
 for item in select * from (values
  ('icash_recording_private.audit()','458c59a6c178a05a7f13aa423f6dd8d1',true,false),
  ('public.icash_settle_unstarted_recorded_call(uuid,uuid,text,jsonb,jsonb,text)','8e404e310ed1acfdc6bcd66ba8081506',true,true),
  ('public.icash_unanswered_seller_call_current(uuid,uuid,uuid)','61ec5e2634746d4c18e2045ec5d0004c',true,true),
  ('icash_seller_recovery_private.settled_unanswered_call(uuid,uuid,uuid)','d7236ebb5c5d07ad35db5198b132f481',false,false),
  ('icash_seller_recovery_private.meta_third_call_current(uuid,uuid)','022147f7097b951aab9a63fc0f891521',true,true)
 ) p(signature,result_hash,definer,service_access) loop
  target:=item.signature::regprocedure;
  if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target
   and md5(pg_get_functiondef(p.oid))=item.result_hash and p.prosecdef=item.definer and p.provolatile='v' and p.proparallel='u'
   and l.lanname='plpgsql' and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=""']
   and p.proacl::text=case when item.service_access then '{postgres=X/postgres,service_role=X/postgres}' else '{postgres=X/postgres}' end)
  then raise exception 'Carrier followup result or access contract changed: %',item.signature;end if;
 end loop;
 if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
  where p.oid='icash_recording_private.carrier_machine_followup(uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='a99c57ec375b8f101ae27128d8dba2d7' and not p.prosecdef and p.provolatile='v' and p.proparallel='u'
   and l.lanname='sql' and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=""'] and p.proacl::text='{postgres=X/postgres}')
 then raise exception 'Carrier machine evidence helper contract changed';end if;
end $carrier_followup_patch$;
