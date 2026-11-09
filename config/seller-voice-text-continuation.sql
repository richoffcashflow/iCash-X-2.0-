-- Continue a fresh text preference after this exact property's actual call.
-- This supplies conversation context only, never consent, ownership or price.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.icash_seller_progress_settings add column voice_text_enabled_at timestamptz;
create function public.icash_seller_voice_text_context(p_account uuid,p_message uuid)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;d public.icash_deal_files;r public.icash_call_recordings;source_at timestamptz;
begin
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and direction='incoming' and state='received';
 if not found or (m.event_id is null and m.provider_id is null) then return false;end if;
 source_at:=to_timestamp(public.icash_sms_reply_time(m.id)::double precision);
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account and party='seller' and not paused and not manual_only and ai_mode='auto' and retired_at is null;
 if not found then return false;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage='draft' and coalesce(terms->>'practice','false')<>'true';
 if not found then return false;end if;
 -- No ambiguous or later call may donate its property context to this reply.
 select * into r from public.icash_call_recordings
 where from_phone=t.sender and to_phone=t.recipient and dial_claimed_at<=source_at and dial_claimed_at>source_at-interval '2 hours' and call_sid is not null
 order by dial_claimed_at desc,id desc limit 1;
 if r.id is null or r.account_id is distinct from p_account or r.screening_id is distinct from d.screening_id or r.party<>'seller' or not public.icash_seller_recorded_call_finished(p_account,r.id)
  or exists(select 1 from public.icash_call_recordings other where other.from_phone=t.sender and other.to_phone=t.recipient
   and other.id<>r.id and other.dial_claimed_at=r.dial_claimed_at and other.call_sid is not null)
  or exists(select 1 from public.icash_text_messages sent where sent.account_id=p_account and sent.thread_id=t.id and sent.direction='outgoing'
   and not exists(select 1 from public.icash_text_ai_jobs j where j.account_id=p_account and j.thread_id=t.id and j.message_id=m.id and j.outgoing_id=sent.id and j.analysis->>'dialoguePolicy'='seller-dialogue-v1'))
  or exists(select 1 from public.icash_sms_seller_openings opening where opening.account_id=p_account and opening.thread_id=t.id)
  or not exists(select 1 from public.icash_sms_routes route where route.account_id=p_account and route.sender=t.sender and route.recipient=t.recipient and not route.needs_review and route.revision=m.route_revision) then return false;end if;
 return true;
end $$;
revoke all on function public.icash_seller_voice_text_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_voice_text_context(uuid,uuid) to service_role;
do $patch$
declare d text;old text;
begin
 d:=pg_get_functiondef('public.icash_seller_dialogue_context(uuid,uuid)'::regprocedure);
 old:=$old$ elsif owner_unknown
   and b ~ '^(please |can you |could you )?text me$old$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Initial reply context prerequisite changed';end if;
 execute replace(d,old,$new$ elsif b ~ '^(please |can you |could you )?text me( instead| please)?[.! ]*$'
   and exists(select 1 from public.icash_seller_progress_settings settings where settings.id=1
    and settings.voice_text_enabled_at is not null and m.created_at>=settings.voice_text_enabled_at
    and source_at>=extract(epoch from settings.voice_text_enabled_at))
   and public.icash_seller_voice_text_context(p_account,m.id) then
  owner_unknown:=true;action:='clarify_ownership';
  reply:='Text is fine. Are you the owner of the property we called about?';
 elsif owner_unknown
   and b ~ '^(please |can you |could you )?text me$new$);
end $patch$;
-- Prospective activation; never move this backwards or replay old negotiations.
update public.icash_seller_progress_settings set voice_text_enabled_at=transaction_timestamp() where id=1;
commit;
