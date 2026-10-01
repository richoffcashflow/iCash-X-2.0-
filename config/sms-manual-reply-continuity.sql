begin;
-- Apply after manual-handoff-replies.sql, sms-inbound-campaign.sql and sms-contact-intake.sql.
-- Mirror the existing permitted human-reply exception at the outer campaign claim.
do $patch$
declare def text;needle text;
begin
 if to_regprocedure('public.icash_manual_handoff_reply(uuid,uuid)') is null then raise exception 'Manual handoff reply policy required';end if;
 def:=pg_get_functiondef('public.icash_claim_text(uuid,uuid,text)'::regprocedure);
 needle:=$n$ if exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=s.snapshot->>'propertyId' and manual) then return null;end if;$n$;
 if (length(def)-length(replace(def,needle,'')))/length(needle)<>1 then raise exception 'Campaign manual-control boundary changed';end if;
 execute replace(def,needle,$n$
 if exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=s.snapshot->>'propertyId' and manual)
 and not (
  public.icash_manual_handoff_reply(p_account,t.id)
  and not exists(select 1 from public.icash_text_ai_jobs where outgoing_id=p_message and account_id=p_account)
  and not exists(select 1 from public.icash_seller_opener_assignments where message_id=p_message and account_id=p_account)
  and not exists(select 1 from public.icash_sms_inbound_invitations where message_id=p_message and account_id=p_account)
 ) then return null;end if;$n$);
end $patch$;
commit;
