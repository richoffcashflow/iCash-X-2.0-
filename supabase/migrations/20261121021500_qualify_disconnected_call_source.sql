do $fix$
declare src text:=pg_get_functiondef('public.icash_unanswered_seller_call_current(uuid,uuid,uuid)'::regprocedure);
 old text:=$old$if exists(select 1 from public.icash_live_conversations c where c.account_id=p_account
  and c.operation_key='voice:'||p_original and c.party='seller' and c.state='complete'
  and public.icash_call_reported_disconnection(c.result)) then return false;end if;$old$;
 new text:=$new$if exists(select 1 from public.icash_live_conversations prior_call where prior_call.account_id=p_account
  and prior_call.operation_key='voice:'||p_original and prior_call.party='seller' and prior_call.state='complete'
  and public.icash_call_reported_disconnection(prior_call.result)) then return false;end if;$new$;
begin
 if strpos(src,new)>0 then return;end if;
 if strpos(src,old)=0 then raise exception 'Unexpected unanswered-call source';end if;
 execute replace(src,old,new);
end
$fix$;
