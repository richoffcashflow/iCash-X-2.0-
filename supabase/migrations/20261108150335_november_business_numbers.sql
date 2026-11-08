-- Register the four owner-selected leases without activating unverified traffic.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.icash_business_voice_numbers drop constraint icash_business_voice_numbers_phone_check;
alter table public.icash_business_voice_numbers add constraint icash_business_voice_numbers_phone_check
 check(phone in ('+14244377030','+17208134296','+14154208230','+16195364770',
 '+16462959838','+18623812530','+17866727869','+16462494809'));
insert into public.icash_text_senders(phone,enabled) values
 ('+16462959838',false),('+18623812530',false),('+17866727869',false),('+16462494809',false)
on conflict(phone) do nothing;

-- Preserve the current functions and their metadata, ACLs, source evidence and
-- conversation ownership. Refuse an unexpected predecessor atomically.
do $boundaries$
declare patch record;definition text;needle text:=$old$'+16195364770')$old$;
 replacement text:=$new$'+16195364770','+16462959838','+18623812530','+17866727869','+16462494809')$new$;
begin
 for patch in select * from (values
  ('public.icash_business_conversation_sender(uuid,uuid,text,boolean)',2),
  ('icash_recording_private.bind_business_caller_id()',1),
  ('public.icash_save_business_voice_number(text,text,boolean,boolean,text)',1),
  ('icash_callback_private.call_candidates(text,text)',1),
  ('icash_callback_private.thread_candidates(text,text)',1),
  ('public.icash_owner_callback_context(uuid,text,text)',1)
 ) as changes(signature,expected)
 loop
  definition:=pg_get_functiondef(patch.signature::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>patch.expected then
   raise exception 'November number boundary changed: %',patch.signature;end if;
  execute replace(definition,needle,replacement);
 end loop;
end $boundaries$;

-- A freshly checked lease with active AI reception can text and receive calls
-- while Twilio verifies its outgoing caller ID. Only the four new leases get
-- this SMS/incoming distinction. Outgoing AI/manual calls still require all
-- original caller-ID/account/forwarding checks at selection and final dispatch.
do $channels$
declare patch record;definition text;
begin
 for patch in select * from (values
  ('public.icash_business_conversation_sender(uuid,uuid,text,boolean)',
   'and n.outbound_enabled and n.forwarding_ready and n.caller_id_sid is not null',
   $new$and n.forwarding_ready and ((n.outbound_enabled and n.caller_id_sid is not null)
    or (not p_voice and n.phone in ('+16462959838','+18623812530','+17866727869','+16462494809')))$new$),
  ('icash_callback_private.thread_candidates(text,text)',
   'n.outbound_enabled and n.forwarding_ready',
   $new$n.forwarding_ready and (n.outbound_enabled or n.phone in ('+16462959838','+18623812530','+17866727869','+16462494809'))$new$),
  ('icash_callback_private.call_candidates(text,text)',
   'n.outbound_enabled and n.forwarding_ready and n.caller_id_sid is not null',
   $new$n.forwarding_ready and ((n.outbound_enabled and n.caller_id_sid is not null)
    or n.phone in ('+16462959838','+18623812530','+17866727869','+16462494809'))$new$)
 ) as changes(signature,needle,replacement)
 loop
  definition:=pg_get_functiondef(patch.signature::regprocedure);
  if (length(definition)-length(replace(definition,patch.needle,'')))/length(patch.needle)<>1 then
   raise exception 'November channel boundary changed: %',patch.signature;end if;
  execute replace(definition,patch.needle,patch.replacement);
 end loop;
end $channels$;
commit;
