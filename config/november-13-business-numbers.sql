-- Owner-supplied November 13 leases. Activation requires fresh provider checks.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $numbers$
declare patch record;definition text;constraint_definition text;
 needle text:=$old$'+14357242174')$old$;
 replacement text:=$new$'+14357242174','+17262035755','+17262060050')$new$;
begin
 for patch in select * from (values
  ('public.icash_business_conversation_sender(uuid,uuid,text,boolean)',3),
  ('icash_recording_private.bind_business_caller_id()',1),
  ('public.icash_save_business_voice_number(text,text,boolean,boolean,text)',1),
  ('icash_callback_private.call_candidates(text,text)',2),
  ('icash_callback_private.thread_candidates(text,text)',2),
  ('public.icash_owner_callback_context(uuid,text,text)',1)
 ) as changes(signature,expected)
 loop
  definition:=pg_get_functiondef(patch.signature::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>patch.expected then
   raise exception 'November 13 number boundary changed: %',patch.signature;end if;
  execute replace(definition,needle,replacement);
 end loop;
 select pg_get_constraintdef(oid) into constraint_definition from pg_constraint
  where conrelid='public.icash_business_voice_numbers'::regclass
  and conname='icash_business_voice_numbers_phone_check';
 if constraint_definition is distinct from
  $check$CHECK ((phone = ANY (ARRAY['+14244377030'::text, '+17208134296'::text, '+14154208230'::text, '+16195364770'::text, '+16462959838'::text, '+18623812530'::text, '+17866727869'::text, '+16462494809'::text, '+15056019451'::text, '+15055072937'::text, '+15127791343'::text, '+16027722055'::text, '+14357242174'::text])))$check$
 then raise exception 'November 13 number registry boundary changed';end if;
 alter table public.icash_business_voice_numbers drop constraint icash_business_voice_numbers_phone_check;
 execute 'alter table public.icash_business_voice_numbers add constraint icash_business_voice_numbers_phone_check '||
  replace(constraint_definition,$old$'+14357242174'::text$old$,
   $new$'+14357242174'::text, '+17262035755'::text, '+17262060050'::text$new$);
end $numbers$;

insert into public.icash_text_senders(phone,enabled) values
 ('+17262035755',false),('+17262060050',false)
on conflict(phone) do nothing;
commit;
