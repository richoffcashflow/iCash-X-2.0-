-- Answer new, unambiguous identity questions after the exact completed call.
-- A greeting is neither ownership confirmation nor permission for another call.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.icash_seller_progress_settings add column post_call_identity_enabled_at timestamptz;

create function public.icash_seller_post_call_identity_reply(p_account uuid,p_message uuid)
returns text language plpgsql stable security invoker set search_path='' as $$
declare m public.icash_text_messages;b text;principal text;address text;reply text;spanish boolean;
begin
 select * into m from public.icash_text_messages where account_id=p_account and id=p_message and direction='incoming' and state='received';
 if not found or not exists(select 1 from public.icash_seller_progress_settings s where id=1
  and s.enabled and s.dialogue_enabled and s.post_call_identity_enabled_at is not null
  and m.created_at>=s.post_call_identity_enabled_at
  and public.icash_sms_reply_time(m.id)>=extract(epoch from s.post_call_identity_enabled_at)) then return null;end if;
 b:=lower(trim(regexp_replace(replace(m.body,'’',chr(39)),'[[:space:]]+',' ','g')));
 spanish:=b ~ '^(hola[,! ]+)?(d[ií]game|qui[eé]n es|qui[eé]n habla|qui[eé]n eres)[?! .]*$';
 if not spanish and b !~ '^(hi|hello|hey)([!, .]+| *:\) *)?(who is this|who are you|who''s this|who called)?[?! .]*$|^(who is this|who are you|who''s this|who called)[?! .]*$' then return null;end if;
 if not public.icash_seller_voice_text_context(p_account,p_message) then return null;end if;
 select trim(coalesce(nullif(trim(i.company_name),''),i.principal)),public.icash_conversation_street(d.terms->>'address')
 into principal,address from public.icash_text_threads t
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 join public.icash_customer_identities i on i.account_id=t.account_id
 where t.id=m.thread_id and t.account_id=p_account;
 if nullif(principal,'') is null or nullif(address,'') is null then return null;end if;
 reply:=case when spanish then 'Soy el asistente de IA de '||principal||'. Llamamos por '||address||'. Es usted el propietario?'
  else 'I''m the AI assistant for '||principal||' about '||address||'. Are you the owner?' end;
 -- Preserve literal identity and address. Unsupported/long copy stays in review.
 if length(reply)>160 or reply ~ '[^A-Za-z0-9 .,!?&#/''-]' then return null;end if;
 return reply;
end $$;
revoke all on function public.icash_seller_post_call_identity_reply(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_post_call_identity_reply(uuid,uuid) to service_role;

do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_seller_dialogue_context(uuid,uuid)'::regprocedure);
 needle:=$old$ elsif b ~ '^(please |can you |could you )?text me( instead| please)?[.! ]*$'$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Voice-to-text prerequisite changed';end if;
 execute replace(definition,needle,$new$ elsif public.icash_seller_post_call_identity_reply(p_account,m.id) is not null then
  owner_unknown:=true;action:='clarify_ownership';reply:=public.icash_seller_post_call_identity_reply(p_account,m.id);
$new$||needle);
end $patch$;
-- Activate prospectively only after exact-release verification. NULL fences
-- pending replies through the existing final dialogue revalidation as well.
commit;
