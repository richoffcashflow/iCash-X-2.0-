-- Reuse existing capacity data only within one serialized queue-recovery batch.
-- Final dispatch/admission still calls the unchanged fresh-capacity functions.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;r record;old_text text;new_text text;
begin
 for r in select * from (values
  ('public.icash_recover_voice_configuration(text,text,text,text,timestamptz)','9c6b7db40c497cc477a61a518c4a2cea'),
  ('public.icash_voice_capacity_available(uuid,text,text,text,boolean)','ec76711357fe24dbcd75a351f68acc85'),
  ('public.icash_voice_queue_slot_open(uuid,uuid)','eae554cdd15240c5eb8e60cea2844f4f'),
  ('icash_recording_private.voice_capacity_snapshot()','2d9e037c510cc91c9b5757c0d7177bfb'),
  ('icash_recording_private.voice_capacity_from_snapshot(uuid,text,text,text,boolean,jsonb)','adf3fcc3a9cb0d204cea26d1a4fe130f'),
  ('icash_recording_private.voice_queue_slot_from_snapshot(uuid,uuid,jsonb)','417d8f30a03ac180c804edff5ab55581')
 ) expected(signature,definition_hash) loop
  if md5(pg_get_functiondef(r.signature::regprocedure))<>r.definition_hash then
   raise exception 'Voice recovery capacity prerequisite changed: %',r.signature;
  end if;
 end loop;
 d:=pg_get_functiondef('public.icash_recover_voice_configuration(text,text,text,text,timestamptz)'::regprocedure);
 for old_text,new_text in select * from (values
  ($old$declare j record;n integer:=0;checked timestamptz:=clock_timestamp();$old$,
   $new$declare j record;n integer:=0;checked timestamptz:=clock_timestamp();capacity_snapshot jsonb;$new$),
  ($old$ for j in$old$,
   $new$ capacity_snapshot:=icash_recording_private.voice_capacity_snapshot();
 for j in$new$),
  ($old$public.icash_voice_capacity_available(candidate.account_id,p_agent,'voice:'||candidate.id,candidate.contact_key,false)$old$,
   $new$icash_recording_private.voice_capacity_from_snapshot(candidate.account_id,p_agent,'voice:'||candidate.id,candidate.contact_key,false,capacity_snapshot)$new$),
  ($old$public.icash_voice_queue_slot_open(j.account_id,j.id)$old$,
   $new$icash_recording_private.voice_queue_slot_from_snapshot(j.account_id,j.id,capacity_snapshot)$new$)
 ) replacements(old_value,new_value) loop
  if (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 then
   raise exception 'Voice recovery capacity replacement is not unique';
  end if;
  d:=replace(d,old_text,new_text);
 end loop;
 execute d;
end $patch$;
commit;
