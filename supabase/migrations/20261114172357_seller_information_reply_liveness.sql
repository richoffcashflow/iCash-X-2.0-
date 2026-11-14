-- A current seller question may receive deterministic nonfinancial dialogue
-- while fresh underwriting is still required for a monetary offer/contract.
-- The migration runner owns the transaction. No stored reply is replayed.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preconditions$
begin
 if md5(pg_get_functiondef('public.icash_seller_dialogue_reply(uuid,uuid)'::regprocedure))<>'6c52f4e955677b63a4d8dd6c3ae46672'
 or md5(pg_get_functiondef('public.icash_claim_text_before_owner_question(uuid,uuid,text)'::regprocedure))<>'5a014c81614b051fbac441e019240a08'
 then raise exception 'Seller information reply predecessor changed';end if;
end $preconditions$;

create function public.icash_seller_information_action(p_action text) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(p_action in ('explain_price','explain_process','explain_fees','clarify_question','continue_details','clarify_ownership','cash_identity_v6'),false)
$$;
revoke all on function public.icash_seller_information_action(text) from public,anon,authenticated;
grant execute on function public.icash_seller_information_action(text) to service_role;

do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_seller_dialogue_reply(uuid,uuid)'::regprocedure);
 needle:='completed_at between now()-interval ''24 hours'' and now()';
 replacement:='completed_at<=now() and (completed_at>=now()-interval ''24 hours'' or public.icash_seller_information_action(j.analysis->>''dialogueAction''))';
 if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Dialogue screening guard changed';end if;
 execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.icash_claim_text_before_owner_question(uuid,uuid,text)'::regprocedure);
 needle:='and not public.icash_seller_recovery_nonprice_current(p_account,p_message)';
 replacement:=needle||$replacement$ and not (exists(select 1 from public.icash_text_ai_jobs j
  where j.account_id=p_account and j.thread_id=t.id and j.outgoing_id=m.id and j.state='queued'
   and j.analysis->>'dialoguePolicy'='seller-dialogue-v1' and public.icash_seller_information_action(j.analysis->>'dialogueAction'))
  and public.icash_seller_conversation_message_current(p_account,p_message))$replacement$;
 if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Final seller screening guard changed';end if;
 execute replace(definition,needle,replacement);
end $patch$;
