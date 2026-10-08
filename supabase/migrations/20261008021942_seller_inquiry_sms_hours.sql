begin;
set local lock_timeout='2s';
-- This window applies only to a seller's own consented form inquiry or their
-- recent property-bound incoming text. Cold outreach retains contact hours.
create function public.icash_seller_sms_inquiry_window(p_account uuid,p_thread uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_text_threads t
 join public.icash_seller_intakes l on l.id=t.seller_intake_id and l.phone=t.recipient and l.ai_consented and l.state='assigned'
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id and d.stage not in ('closed','cancelled')
 join public.icash_seller_matches match on match.lead_id=l.id and match.account_id=t.account_id and match.screening_id=d.screening_id
 where t.id=p_thread and t.account_id=p_account and t.party='seller' and t.retired_at is null
 and not t.paused and not t.manual_only and t.ai_mode='auto'
 and public.icash_seller_contact_evidence(p_account,d.screening_id,l.id,t.recipient) is not null
 and (l.created_at between now()-interval '24 hours' and now()
  or exists(select 1 from public.icash_text_messages m join public.icash_sms_routes r on r.sender=t.sender and r.recipient=t.recipient and r.account_id=t.account_id
    where m.thread_id=t.id and m.account_id=p_account and m.direction='incoming' and m.state='received'
    and m.created_at between now()-interval '15 minutes' and now() and m.route_revision=r.revision and not r.needs_review)));
$$;
revoke all on function public.icash_seller_sms_inquiry_window(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_sms_inquiry_window(uuid,uuid) to service_role;
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_seller_sms_permission_current(uuid,uuid,boolean)'::regprocedure);
 needle:='return not p_check_hour or (h>=9 and h<20);';
 if position(needle in definition)=0 then raise exception 'Seller SMS hours prerequisite changed';end if;
 execute replace(definition,needle,'return not p_check_hour or (h>=9 and h<20) or public.icash_seller_sms_inquiry_window(p_account,t.id);');
 definition:=pg_get_functiondef('public.icash_claim_text_before_ai(uuid,uuid,text)'::regprocedure);
 needle:='if h<9 or h>=20 then return null;end if;';
 if position(needle in definition)=0 then raise exception 'SMS dispatch hours prerequisite changed';end if;
 execute replace(definition,needle,'if (h<9 or h>=20) and not public.icash_seller_sms_inquiry_window(p_account,t.id) then return null;end if;');
end $patch$;
commit;
