begin;
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_prepare_sms_inbound_reply(uuid,uuid,uuid)'::regprocedure);
 needle:=$old$'Would you be interested in selling your property for all cash? Reply STOP to opt out.','$old$;
 if position(needle in definition)=0 then raise exception 'Interest reply prerequisite changed';end if;
 execute replace(definition,needle,$new$case when t.seller_intake_id is not null then 'Would you consider a cash offer?' else 'Would you be interested in selling your property for all cash? Reply STOP to opt out.' end,'$new$);
 definition:=pg_get_functiondef('public.icash_claim_text(uuid,uuid,text)'::regprocedure);
 needle:=$old$and body='Would you be interested in selling your property for all cash? Reply STOP to opt out.'$old$;
 if position(needle in definition)=0 then raise exception 'Interest claim prerequisite changed';end if;
 execute replace(definition,needle,$new$and (body='Would you be interested in selling your property for all cash? Reply STOP to opt out.' or (body='Would you consider a cash offer?' and exists(select 1 from public.icash_text_threads permitted where permitted.id=opening.thread_id and permitted.account_id=p_account and permitted.seller_intake_id is not null)))$new$);
end $patch$;
commit;
