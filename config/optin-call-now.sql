begin;
set local lock_timeout='3s';
-- A fresh call-now request is separate from, and never rewrites, saved consent.
-- It changes only the initial inbound response's time window. All contact,
-- paid-access, wallet, Run/Pause, provider and one-call admission checks remain.
create table if not exists public.icash_optin_call_requests (
 lead_id uuid primary key references public.icash_seller_intakes(id),
 request_id uuid not null, phone text not null,
 account_id uuid references public.icash_accounts(id),requested_by uuid,
 source text not null check(source in ('seller_form','demo_form','support_request')),
 request_version text not null check(request_version='icash-optin-call-now-2026-10-16.1'),
 request_text text not null check(request_text='Call me now about this property, including outside normal calling hours.'),
 request_reference text not null check(length(request_reference) between 10 and 500),
 requested_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '5 minutes',
 check(expires_at=requested_at+interval '5 minutes'),
 check((source='seller_form' and account_id is null and requested_by is null)
   or (source in ('demo_form','support_request') and account_id is not null and requested_by is not null))
);
alter table public.icash_optin_call_requests enable row level security;
revoke all on public.icash_optin_call_requests from public,anon,authenticated;
grant select,insert on public.icash_optin_call_requests to service_role;

create or replace function public.icash_requested_optin_call_current(p_account uuid,p_job uuid)
returns boolean language sql security invoker set search_path='' as $$
 select exists(
  select 1 from public.icash_voice_jobs j
  join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id
  join public.icash_seller_intakes l on l.id=p.seller_intake_id and l.phone=p.phone
  join public.icash_optin_call_requests r on r.lead_id=l.id and r.request_id=l.request_id and r.phone=l.phone
  join public.icash_seller_matches m on m.lead_id=l.id and m.account_id=p.account_id and m.screening_id=p.screening_id
  join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id and s.state='complete'
  where j.id=p_job and j.account_id=p_account and j.state in ('ready','issued')
  and j.operational_contact_id is null and j.callback_id is null and j.sms_source_message_id is null and j.cancellation_notice_id is null
  and j.provider_call_sid is null and j.conversation_id is null and p.party='seller'
  and l.state='assigned' and l.ai_consented and l.created_at<=r.requested_at
  and r.requested_at<=now() and r.expires_at>now()
  and ((r.source='seller_form' and r.account_id is null and r.requested_by is null
    and l.contact_consent_scope='homeoffer_network_and_matched_buyers')
   or (r.source in ('demo_form','support_request') and r.account_id=p_account
    and l.contact_consent_scope='icash_x_demo' and l.attribution->>'demoAccountId'=p_account::text
    and exists(select 1 from public.icash_accounts a where a.id=p_account and a.owner_user_id=r.requested_by)))
  -- Only the original initial-response job, never an SMS callback or later retry.
  and not exists(select 1 from public.icash_voice_jobs older
    where older.account_id=j.account_id and older.permission_id=j.permission_id and older.id<>j.id
    and older.callback_id is null and older.sms_source_message_id is null and older.cancellation_notice_id is null
    and (older.created_at,older.id)<(j.created_at,j.id))
  and public.icash_seller_voice_permission_current(j.account_id,p.id)
 );
$$;

create or replace function public.icash_request_optin_call_now(p_lead uuid,p_request uuid,p_source text,p_reference text,p_actor uuid default null,p_account uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l public.icash_seller_intakes;r public.icash_optin_call_requests;job uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into l from public.icash_seller_intakes where id=p_lead for share;
 if not found or l.request_id is distinct from p_request or not l.ai_consented
  or l.state not in ('received','checking','qualified','assigned')
  or l.created_at>now() or l.created_at<now()-interval '24 hours'
  or p_source is null or p_source not in ('seller_form','demo_form','support_request')
  or p_reference is null or length(p_reference) not between 10 and 500 then raise exception 'Current opt-in call request required';end if;
 if p_source in ('seller_form','demo_form') and p_reference<>'icash-optin-call-now-2026-10-16.1' then raise exception 'Current call-now statement required';end if;
 if p_source='seller_form' then
  if l.contact_consent_scope is distinct from 'homeoffer_network_and_matched_buyers' or p_actor is not null or p_account is not null then raise exception 'Seller request binding required';end if;
 else
  perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor for share;
  if not found or l.contact_consent_scope is distinct from 'icash_x_demo' or l.attribution->>'demoAccountId' is distinct from p_account::text then raise exception 'Presenting account required';end if;
 end if;
 if exists(select 1 from public.icash_text_suppressions where phone=l.phone)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex')) then raise exception 'Contact opted out';end if;
 if l.state='assigned' and not exists(select 1 from public.icash_seller_matches m
   join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id and s.state='complete'
   where m.lead_id=l.id and (p_account is null or m.account_id=p_account)) then raise exception 'Active property required';end if;
 insert into public.icash_optin_call_requests(lead_id,request_id,phone,account_id,requested_by,source,request_version,request_text,request_reference)
 values(l.id,l.request_id,l.phone,p_account,p_actor,p_source,'icash-optin-call-now-2026-10-16.1',
  'Call me now about this property, including outside normal calling hours.',p_reference)
 on conflict(lead_id) do nothing;
 select * into r from public.icash_optin_call_requests where lead_id=l.id;
 if row(r.request_id,r.phone,r.account_id,r.requested_by,r.source,r.request_reference)
  is distinct from row(p_request,l.phone,p_account,p_actor,p_source,p_reference) then raise exception 'Call request retry mismatch';end if;
 -- Wake only an initial job waiting for hours, never a started/unknown/held call.
 update public.icash_voice_jobs j set due_at=now(),outcome=null,updated_at=now()
 where j.state='ready' and j.outcome='Waiting for calling hours'
 and exists(select 1 from public.icash_contact_permissions p where p.id=j.permission_id and p.account_id=j.account_id and p.seller_intake_id=l.id)
 and public.icash_requested_optin_call_current(j.account_id,j.id);
 update public.icash_seller_responses set next_attempt_at=now(),updated_at=now()
 where lead_id=l.id and (p_account is null or account_id=p_account) and state in ('pending','needs_setup','queued') and r.expires_at>now();
 select j.id into job from public.icash_voice_jobs j join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id
 where p.seller_intake_id=l.id and (p_account is null or j.account_id=p_account)
 and public.icash_requested_optin_call_current(j.account_id,j.id) order by j.created_at,j.id limit 1;
 return jsonb_build_object('requested',r.expires_at>now(),'leadId',l.id,'jobId',job,'requestedAt',r.requested_at,'expiresAt',r.expires_at);
end $$;
revoke all on function public.icash_requested_optin_call_current(uuid,uuid),public.icash_request_optin_call_now(uuid,uuid,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_requested_optin_call_current(uuid,uuid),public.icash_request_optin_call_now(uuid,uuid,text,text,uuid,uuid) to service_role;

do $$declare definition text;needle text;replacement text;begin
 definition:=pg_get_functiondef('public.icash_claim_voice_job(uuid)'::regprocedure);
 needle:='and not public.icash_requested_seller_call_current(j.account_id,j.id) then return false;end if;';
 replacement:='and not public.icash_requested_seller_call_current(j.account_id,j.id) and not public.icash_requested_optin_call_current(j.account_id,j.id) then return false;end if;';
 if position(replacement in definition)>0 then null;
 elsif position(needle in definition)>0 then execute replace(definition,needle,replacement);
 else raise exception 'Voice contact window prerequisite changed';end if;
end $$;
commit;
