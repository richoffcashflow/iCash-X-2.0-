-- The presenting owner explicitly requests each demonstration. A completed
-- earlier demo must not consume the next request's rolling-day introduction.
-- Ordinary seller spacing, hours, billing and provider admission stay intact.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create or replace function public.icash_owner_demo_call_current(p_account uuid,p_job uuid)
returns boolean language sql security definer set search_path='' as $$
 select exists(
  select 1 from public.icash_voice_jobs j
  join public.icash_accounts a on a.id=j.account_id
  join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id
  join public.icash_seller_intakes l on l.id=p.seller_intake_id and l.phone=p.phone
  join public.icash_optin_call_requests r on r.lead_id=l.id and r.request_id=l.request_id and r.phone=l.phone
  join public.icash_seller_matches m on m.lead_id=l.id and m.account_id=j.account_id and m.screening_id=p.screening_id
  join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id
  where j.id=p_job and j.account_id=p_account
   and p_account='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid
   and a.owner_user_id='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
   and p.phone='+12142185280' and p.contact_key=encode(sha256(convert_to(p.phone,'UTF8')),'hex')
   and not a.bot_paused and s.state='complete' and l.state='assigned' and l.ai_consented
   and l.contact_consent_scope='icash_x_demo' and l.attribution->>'demoAccountId'=p_account::text
   and r.source='demo_form' and r.account_id=p_account and r.requested_by=a.owner_user_id
   and r.request_version='icash-optin-call-now-2026-10-16.1' and r.request_reference=r.request_version
   and l.created_at<=r.requested_at and r.requested_at<=clock_timestamp()
   and r.expires_at=r.requested_at+interval '5 minutes' and r.expires_at>clock_timestamp()
   and p.party='seller' and p.revoked_at is null and p.permission_until>clock_timestamp()
   and j.state in ('ready','issued','dispatching')
   and j.operational_contact_id is null and j.callback_id is null and j.sms_source_message_id is null
   and j.cancellation_notice_id is null and j.meta_offer_lead_id is null
   and j.meta_retry_of is null and j.meta_followup_lead_id is null
   and j.provider_call_sid is null and j.conversation_id is null
   and not exists(select 1 from public.icash_text_suppressions where phone=p.phone)
   and not exists(select 1 from public.icash_contact_suppressions where contact_key=p.contact_key)
   -- Only the original initial job may use this receipt, including its final
   -- serialized dial claim. Never replay an attempted or unknown operation.
   and not exists(select 1 from public.icash_voice_jobs older
    where older.account_id=j.account_id and older.permission_id=j.permission_id and older.id<>j.id
     and (older.created_at,older.id)<(j.created_at,j.id))
   and not exists(select 1 from public.icash_call_recordings own
    where own.voice_job_id=j.id and (own.account_id is distinct from j.account_id
     or own.to_phone is distinct from p.phone or own.dial_claimed_at is not null
     or own.call_sid is not null or own.conversation_id is not null))
   and not exists(select 1 from public.icash_live_conversations c where c.operation_key='voice:'||j.id)
   -- A fresh request must follow completed earlier calls. Both unknown and
   -- known-but-unfinished calls remain blocked across properties/accounts.
   and not exists(select 1 from public.icash_call_recordings previous
    where previous.to_phone=p.phone and previous.voice_job_id is distinct from j.id
     and (previous.call_ended_at>r.requested_at or (previous.call_ended_at is null
      and not exists(select 1 from icash_recording_private.terminal_cost_receipts terminal
       where terminal.recording_id=previous.id and terminal.created_at<=r.requested_at
        and terminal.receipt->>'callSid'=previous.call_sid
        and terminal.receipt->>'providerAccountSid'=previous.provider_account_sid
        and terminal.receipt->>'toPhone'=previous.to_phone
        and terminal.receipt->>'status' in ('completed','failed','busy','no-answer','canceled')))))
   and not exists(select 1 from public.icash_customer_phone_calls manual
    where manual.recipient_phone=p.phone
     and (manual.ended_at is null or manual.ended_at>r.requested_at))
   and public.icash_seller_voice_permission_current(j.account_id,p.id)
 );
$$;
revoke all on function public.icash_owner_demo_call_current(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_owner_demo_call_current(uuid,uuid) to service_role;

do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_seller_phone_call_current(uuid,uuid)'::regprocedure);
 needle:=' if unknown_attempt then return false;end if;';
 replacement:=needle||$guard$
 -- Owner self-demonstrations require their own fresh form receipt even when
 -- the rolling-day window clears. Expired requests cannot dial tomorrow.
 if p_account='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid and p.phone='+12142185280'
  and exists(select 1 from public.icash_contact_permissions cp
   join public.icash_seller_intakes l on l.id=cp.seller_intake_id
   where cp.id=j.permission_id and cp.account_id=p_account and l.contact_consent_scope='icash_x_demo') then
  return public.icash_owner_demo_call_current(p_account,p_job);
 end if;$guard$;
 if position(replacement in definition)>0 then null;
 elsif (length(definition)-length(replace(definition,needle,'')))/length(needle)=1 then
  execute replace(definition,needle,replacement);
 else raise exception 'Owner demo spacing prerequisite changed';end if;
end $patch$;
commit;
