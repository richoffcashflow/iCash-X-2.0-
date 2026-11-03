-- One fresh owner self-demonstration may use one request of verified provider
-- headroom after the ordinary 9,800-request rolling allowance is exhausted.
-- Install disabled; never change existing limits, windows, counters or receipts.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table icash_research_private.owner_demo_request_policy(
 id integer primary key check(id=1),enabled boolean not null default false
);
insert into icash_research_private.owner_demo_request_policy(id) values(1);
create table icash_research_private.owner_demo_request_admissions(
 lead_id uuid primary key references public.icash_seller_intakes(id),
 request_id uuid not null unique,quota_request_id uuid not null unique,
 day_start timestamptz not null unique,account_id uuid not null references public.icash_accounts(id),
 phone text not null,requested_at timestamptz not null,expires_at timestamptz not null,
 admitted_at timestamptz not null,lookup_token uuid not null,
 provider_request_id uuid not null,provider_result jsonb not null,source jsonb not null,
 check(expires_at=requested_at+interval '5 minutes'),
 check(admitted_at>=requested_at and admitted_at<expires_at)
);
-- The shared request ledger is pruned. Retain this independent immutable proof
-- without a pruning FK; an unknown or expired attempt never restores allowance.
alter table icash_research_private.owner_demo_request_policy enable row level security;
alter table icash_research_private.owner_demo_request_admissions enable row level security;
revoke all on icash_research_private.owner_demo_request_policy,icash_research_private.owner_demo_request_admissions
 from public,anon,authenticated,service_role;
create function icash_research_private.keep_owner_demo_request_admission() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'Owner demo request admission is immutable';end$$;
create trigger owner_demo_request_admission_immutable before update or delete
 on icash_research_private.owner_demo_request_admissions for each row
 execute function icash_research_private.keep_owner_demo_request_admission();
revoke all on function icash_research_private.keep_owner_demo_request_admission() from public,anon,authenticated,service_role;

create function public.icash_claim_owner_demo_lookup(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 owner_account constant uuid:='48dfb798-8c1a-404f-88c0-c396cc067062';
 owner_user constant uuid:='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
 owner_phone constant text:='+12142185280';
 a public.icash_accounts;w public.icash_wallets;l public.icash_seller_intakes;
 r public.icash_optin_call_requests;b public.icash_dealmachine_request_budget;
 f icash_research_private.quota_feedback;q icash_research_private.requests;
 stamp timestamptz;claim jsonb;quota_id uuid:=gen_random_uuid();source jsonb;
begin
 if p_id is null then return null;end if;
 -- Keep paid-operation lock order. No account or seller lock is acquired after
 -- the quota row; ordinary limiter callers can finish without a reverse wait.
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return null;end if;
 perform 1 from icash_research_private.owner_demo_request_policy where id=1 and enabled for share;
 if not found then return null;end if;
 perform 1 from public.icash_seller_controls where id=1 and enabled for update;
 if not found then return null;end if;
 select * into a from public.icash_accounts where id=owner_account and owner_user_id=owner_user for update;
 if not found then return null;end if;
 select * into w from public.icash_wallets where account_id=a.id for update;
 if not found then return null;end if;
 select * into l from public.icash_seller_intakes where id=p_id for update;
 if not found then return null;end if;
 select * into r from public.icash_optin_call_requests where lead_id=l.id for share;
 if not found then return null;end if;
 select * into b from public.icash_dealmachine_request_budget where id=1 for update;
 if not found then return null;end if;
 select * into f from icash_research_private.quota_feedback where id=1 for share;
 if not found then return null;end if;
 stamp:=clock_timestamp();
 if a.bot_paused is distinct from false or a.workspace_ack_version is null or w.balance_cents<=w.reserved_cents
  or public.icash_membership_work_allowed(a.id) is distinct from true or public.icash_credit_acquisition_allowed(a.id) is distinct from true
  or exists(select 1 from public.icash_billing_reviews where account_id=a.id and resolved_at is null)
  or exists(select 1 from public.icash_support_cancel_requests c where c.account_id=a.id and c.confirmed_at is not null
   and c.confirmed_at>coalesce((select e.created_at from public.icash_control_events e
    where e.account_id=a.id and e.property_id is null order by e.created_at desc,e.id desc limit 1),'-infinity'::timestamptz)) then return null;end if;
 if l.state is distinct from 'received' or l.canonical_id is not null or l.ai_consented is distinct from true
  or l.phone is distinct from owner_phone or l.contact_consent_scope is distinct from 'icash_x_demo'
  or l.attribution->>'demoAccountId' is distinct from owner_account::text
  or l.attribution->>'source' is distinct from 'icash_x_demo'
  or l.consent_version is distinct from 'icash-x-demo-contact-2026-10-10.1'
  or l.consent_text is distinct from 'I agree to calls and texts from iCash X about this property demo, including automated texts and AI-generated voice calls. I have permission to use this number. Consent is not a condition of purchase. Message/data rates may apply. Reply STOP to end texts.'
  or l.claim_token is not null or l.claimed_at is not null or l.checked_at is not null
  or l.lookup_costs is not null or l.lookup_cap_micros is not null or l.lookup_cost_basis is not null
  or l.property is not null or l.result is not null or l.operation_key is not null
  or l.assigned_account is not null or l.screening_id is not null or l.assigned_at is not null
  or exists(select 1 from public.icash_seller_matches where lead_id=l.id)
  or exists(select 1 from public.icash_operation_spend where operation_key='seller-lead:'||l.id||':'||owner_account)
  or exists(select 1 from icash_research_private.owner_demo_request_admissions where lead_id=l.id or request_id=l.request_id)
  or not public.icash_research_state_allowed(public.icash_address_state(l.address)) then return null;end if;
 if r.request_id is distinct from l.request_id or r.phone is distinct from l.phone
  or r.account_id is distinct from owner_account or r.requested_by is distinct from owner_user
  or r.source is distinct from 'demo_form'
  or r.request_version is distinct from 'icash-optin-call-now-2026-10-16.1'
  or r.request_reference is distinct from r.request_version
  or r.request_text is distinct from 'Call me now about this property, including outside normal calling hours.'
  or l.created_at is null or r.requested_at is null or r.expires_at is null
  or l.created_at>r.requested_at or r.requested_at>stamp
  or r.expires_at is distinct from r.requested_at+interval '5 minutes' or r.expires_at<=stamp
  or exists(select 1 from public.icash_text_suppressions where phone=l.phone)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex')) then return null;end if;
 -- Only daily exhaustion qualifies. New-user reserve refusal, minute exhaustion,
 -- stale/future windows, configuration drift and provider cooldown do not.
 if b.day_limit is distinct from 9800 or b.day_used is distinct from 9800
  or b.minute_limit is distinct from 60 or b.day_start is null
  or b.day_start<=stamp-interval '24 hours' or b.day_start>stamp
  or b.minute_start is null or b.minute_start>stamp or b.minute_used is null or b.minute_used<0
  or (b.minute_start>stamp-interval '1 minute' and b.minute_used>=b.minute_limit)
  or exists(select 1 from icash_research_private.owner_demo_request_admissions where day_start=b.day_start)
  or public.icash_dealmachine_provider_available() is distinct from true
  or (f.blocked_until is not null and f.blocked_until>stamp) then return null;end if;
 -- Bind the entitlement to the original successful admitted request, rather
 -- than trusting a free-standing limit number or replacing a provider hold.
 select * into q from icash_research_private.requests where id=f.request_id;
 if q.id is null or q.admitted is distinct from true or q.finished_at is null
  or q.created_at<b.day_start or q.created_at>stamp or q.finished_at<q.created_at or q.finished_at>stamp
  or f.request_started_at is distinct from q.created_at or f.observed_at is null or f.observed_at<q.finished_at or f.observed_at>stamp
  or q.result is distinct from f.headers or q.result->>'outcome' is distinct from 'response'
  or q.result->>'httpStatus' is distinct from '200' or q.result->>'dayLimit' is distinct from '10000'
  or q.result->>'minuteLimit' is distinct from '70'
  or (case when coalesce(q.result->>'dayRemaining','') ~ '^[0-9]{1,5}$'
   then (q.result->>'dayRemaining')::integer between 1 and 10000 else false end) is distinct from true then return null;end if;
 source:=jsonb_build_object('leadId',l.id,'requestId',l.request_id,'accountId',a.id,'ownerUserId',a.owner_user_id,
  'phone',l.phone,'address',l.address,'consentVersion',l.consent_version,'consentText',l.consent_text,
  'callRequest',to_jsonb(r),'budgetBefore',to_jsonb(b));
 -- A failed ordinary claim must roll back its own reservations and any stale
 -- lookup bookkeeping along with this exceptional admission.
 begin
  claim:=public.icash_claim_seller_lookup_for(l.id);
  if claim is null or claim->>'id' is distinct from l.id::text or claim->>'address' is distinct from l.address
   or coalesce(claim->>'token','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise sqlstate 'P8001' using message='Owner demo lookup not claimed';
  end if;
  stamp:=clock_timestamp();
  if r.expires_at<=stamp or b.day_start<=stamp-interval '24 hours'
   or not exists(select 1 from public.icash_seller_intakes actual where actual.id=l.id and actual.state='checking'
    and actual.request_id=l.request_id and actual.phone=l.phone and actual.address=l.address
    and actual.claim_token=(claim->>'token')::uuid and actual.claimed_at<=stamp
    and actual.lookup_cap_micros>0 and actual.lookup_costs is not null and actual.data_rights_until>stamp) then
   raise sqlstate 'P8001' using message='Owner demo lookup expired or changed';
  end if;
  if b.minute_start<=stamp-interval '1 minute' then b.minute_start:=stamp;b.minute_used:=0;end if;
  insert into icash_research_private.owner_demo_request_admissions(lead_id,request_id,quota_request_id,day_start,
   account_id,phone,requested_at,expires_at,admitted_at,lookup_token,provider_request_id,provider_result,source)
  values(l.id,l.request_id,quota_id,b.day_start,a.id,l.phone,r.requested_at,r.expires_at,stamp,
   (claim->>'token')::uuid,q.id,q.result,source);
  insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at)
  values(quota_id,'property_lookup',a.id,'owner-demo-lookup:'||l.id,true,stamp);
  update public.icash_dealmachine_request_budget set day_used=b.day_used+1,
   minute_start=b.minute_start,minute_used=b.minute_used+1 where id=1;
  return claim||jsonb_build_object('quotaRequestId',quota_id,'noAddressFallback',true,'demoExpiresAt',r.expires_at);
 exception when sqlstate 'P8001' then return null;
 end;
end $$;
revoke all on function public.icash_claim_owner_demo_lookup(uuid) from public,anon,authenticated;
grant execute on function public.icash_claim_owner_demo_lookup(uuid) to service_role;
commit;
