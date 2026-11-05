-- Prospective, source-bound clarification for a seller who requests text or is
-- unable to talk before ownership is established. No historical reply replay.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $guard$
begin
 if md5(pg_get_functiondef('public.icash_seller_dialogue_context(uuid,uuid)'::regprocedure))
    <> 'c9b3e0104fe39129c02dc5d285bd3223' then
  raise exception 'Seller dialogue changed; review and rebase the clarification patch';
 end if;
end $guard$;

alter table public.icash_seller_progress_settings
 add column initial_reply_enabled_at timestamptz;

do $patch$
declare definition text;before_branch text;after_branch text;
begin
 definition:=pg_get_functiondef('public.icash_seller_dialogue_context(uuid,uuid)'::regprocedure);
 before_branch:=$old$ elsif owner_unknown and (b ~ '(how much|what.*offer|what.*pay)' or condition_answer=m.id) then$old$;
 after_branch:=$new$ elsif owner_unknown
   and b ~ '^(please |can you |could you )?text me( instead| please)?[.! ]*$|^(sorry[, ]+)?i (can''t|cannot|can not) talk( right now| now)?[.! ]*$'
   and exists(select 1 from public.icash_seller_progress_settings settings where settings.id=1
    and settings.initial_reply_enabled_at is not null
    and m.created_at>=settings.initial_reply_enabled_at
    and source_at>=extract(epoch from settings.initial_reply_enabled_at))
   and exists(select 1 from public.icash_sms_seller_openings opening
    join public.icash_text_messages question_message on question_message.id=opening.owner_question_id
     and question_message.account_id=p_account and question_message.thread_id=t.id
     and question_message.direction='outgoing' and question_message.state='delivered'
     and question_message.provider_id is not null
     and extract(epoch from question_message.created_at)<source_at
    where opening.account_id=p_account and opening.thread_id=t.id and opening.owner_reply_id is null
     and not exists(select 1 from public.icash_text_messages later
      where later.account_id=p_account and later.thread_id=t.id and later.direction='outgoing'
       and later.state in ('accepted','delivered','dispatching')
       and later.id<>question_message.id
       and later.created_at>question_message.created_at and extract(epoch from later.created_at)<source_at)) then
  action:='clarify_ownership';
  reply:=case when b ~ 'text me' then 'Text is fine. Are you the owner of the property we texted about?'
   else 'No problem. Reply here when you are free. Are you the owner of the property we texted about?' end;
 elsif owner_unknown and (b ~ '(how much|what.*offer|what.*pay)' or condition_answer=m.id) then$new$;
 if position(before_branch in definition)=0 or
    length(definition)-length(replace(definition,before_branch,''))<>length(before_branch) then
  raise exception 'Expected one ownership branch';
 end if;
 execute replace(definition,before_branch,after_branch);
end $patch$;

-- New source messages only. Clearing this timestamp disables the new branch;
-- existing final-send gates will also hold any not-yet-dispatched new reply.
update public.icash_seller_progress_settings set initial_reply_enabled_at=transaction_timestamp() where id=1;
commit;
