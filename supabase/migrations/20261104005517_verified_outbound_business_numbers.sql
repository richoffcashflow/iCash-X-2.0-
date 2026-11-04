-- Enable verified voice eligibility for the two new leases without enabling SMS.
-- No provider verification, outbound activation or historical identity is written.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Preserve the current shared identity/recipient checks in one implementation.
-- Existing three-argument calls remain SMS-only; only voice wrappers opt in.
do $selector$
declare definition text;needle text;
begin
 if to_regprocedure('public.icash_business_conversation_sender(uuid,uuid,text,boolean)') is not null then
  raise exception 'Voice-aware conversation selector already exists';end if;
 definition:=pg_get_functiondef('public.icash_business_conversation_sender(uuid,uuid,text)'::regprocedure);
 needle:='FUNCTION public.icash_business_conversation_sender(p_account uuid, p_screening uuid, p_recipient text)';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Conversation sender signature changed';end if;
 definition:=replace(definition,needle,'FUNCTION public.icash_business_conversation_sender(p_account uuid, p_screening uuid, p_recipient text, p_voice boolean)');
 needle:='where s.enabled and (chosen is null or s.phone=chosen)';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Conversation sender eligibility changed';end if;
 definition:=replace(definition,needle,$pool$where (s.enabled or (p_voice and s.phone in ('+14154208230','+16195364770'))) and (chosen is null or s.phone=chosen)$pool$);
 needle:=$old$('+14244377030','+17208134296')$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Conversation voice allowlist changed';end if;
 definition:=replace(definition,needle,$new$('+14244377030','+17208134296','+14154208230','+16195364770')$new$);
 execute definition;
end $selector$;
revoke all on function public.icash_business_conversation_sender(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.icash_business_conversation_sender(uuid,uuid,text,boolean) to service_role;

create or replace function public.icash_business_conversation_sender(p_account uuid,p_screening uuid,p_recipient text)
returns text language sql stable security invoker set search_path='' as $$
 select public.icash_business_conversation_sender(p_account,p_screening,p_recipient,false);
$$;

-- Exact replacements retain all current bodies, function metadata, permissions,
-- contact controls, final admission locks and immutable receipt boundaries.
do $boundaries$
declare patch record;definition text;
begin
 for patch in select * from (values
  ('public.icash_property_call_sender(uuid,uuid,text)',
   'public.icash_business_conversation_sender(p_account,p_screening,p_recipient)',
   'public.icash_business_conversation_sender(p_account,p_screening,p_recipient,true)'),
  ('public.icash_customer_call_sender(uuid,uuid,text)',
   'public.icash_business_conversation_sender(p_account,p_screening,p_recipient)',
   'public.icash_business_conversation_sender(p_account,p_screening,p_recipient,true)'),
  ('icash_recording_private.bind_business_caller_id()',
   $old$('+14244377030','+17208134296')$old$,
   $new$('+14244377030','+17208134296','+14154208230','+16195364770')$new$),
  ('public.icash_save_business_voice_number(text,text,boolean,boolean,text)',
   'values(p_phone,true)',
   $sms$values(p_phone,p_phone not in ('+14154208230','+16195364770'))$sms$),
  ('icash_callback_private.candidates(text,text)',
   $old$('+14243948384','+17208134296','+14244377030')$old$,
   $new$('+14243948384','+17208134296','+14244377030','+14154208230','+16195364770')$new$),
  ('public.icash_owner_callback_context(uuid,text,text)',
   $old$('+14243948384','+17208134296','+14244377030')$old$,
   $new$('+14243948384','+17208134296','+14244377030','+14154208230','+16195364770')$new$)
 ) as changes(signature,needle,replacement)
 loop
  definition:=pg_get_functiondef(patch.signature::regprocedure);
  if (length(definition)-length(replace(definition,patch.needle,'')))/length(patch.needle)<>1 then
   raise exception 'Business voice boundary changed: %',patch.signature;end if;
  execute replace(definition,patch.needle,patch.replacement);
 end loop;
end $boundaries$;
commit;
