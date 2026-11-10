-- A call-requested private owner demo must not be pinned to an SMS-only lease.
-- Narrow only first allocation; established threads and call receipts still win.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure);
 if strpos(d,'owner_demo_call_capable_v1')>0 then return;end if;
 needle:='has_thread boolean:=false;';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Owner demo selector declaration changed';end if;
 d:=replace(d,needle,needle||' require_voice boolean:=p_voice;');
 needle:=' select s.phone into chosen from public.icash_text_senders s';
 replacement:=$replacement$ -- owner_demo_call_capable_v1: retain the original call-now receipt as intent.
 -- Its expiry still controls final dial admission; this selector never renews it.
 if not p_voice and chosen is null
  and p_account='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid
  and public.icash_outreach_voice_current(p_account)
  and exists(
   select 1 from public.icash_accounts a
   join public.icash_seller_intakes l on l.assigned_account=a.id and l.screening_id=p_screening
   join public.icash_seller_matches m on m.lead_id=l.id and m.account_id=a.id and m.screening_id=l.screening_id
   join public.icash_optin_call_requests r on r.lead_id=l.id and r.request_id=l.request_id and r.phone=l.phone
   where a.id=p_account and a.owner_user_id='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
    and l.phone=p_recipient and l.state='assigned' and l.ai_consented
    and l.contact_consent_scope='icash_x_demo' and l.attribution->>'demoAccountId'=a.id::text
    and r.source='demo_form' and r.account_id=a.id and r.requested_by=a.owner_user_id
    and r.request_version='icash-optin-call-now-2026-10-16.1' and r.request_reference=r.request_version
  ) then require_voice:=true;end if;
 select s.phone into chosen from public.icash_text_senders s$replacement$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Owner demo selector allocation changed';end if;
 d:=replace(d,needle,replacement);
 needle:='or (not p_voice and n.phone in (';
 replacement:='or (not require_voice and n.phone in (';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Owner demo selector voice eligibility changed';end if;
 execute replace(d,needle,replacement);
end $patch$;
commit;
