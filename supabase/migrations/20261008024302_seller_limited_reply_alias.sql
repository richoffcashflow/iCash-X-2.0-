begin;
set local lock_timeout='2s';
do $patch$
declare definition text;needle text:=$old$exists(select 1 from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id where t.id=p_thread and t.account_id=p_account and public.icash_seller_limited_contact(p_account,d.screening_id))$old$;replacement text:=$new$exists(select 1 from public.icash_text_threads candidate_thread join public.icash_deal_files candidate_deal on candidate_deal.id=candidate_thread.deal_id and candidate_deal.account_id=candidate_thread.account_id where candidate_thread.id=p_thread and candidate_thread.account_id=p_account and public.icash_seller_limited_contact(p_account,candidate_deal.screening_id))$new$;
begin
 definition:=pg_get_functiondef('public.icash_prepare_sms_inbound_reply(uuid,uuid,uuid)'::regprocedure);
 if position(needle in definition)>0 then execute replace(definition,needle,replacement);
 elsif position(replacement in definition)=0 then raise exception 'Limited seller reply prerequisite changed';end if;
end $patch$;
commit;
