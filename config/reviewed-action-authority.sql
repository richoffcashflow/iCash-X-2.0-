begin;
-- STAGED ONLY. Apply after live-dispatch.sql, buyer-voice.sql and fulfillment-completion.sql.
-- Deliberately contains no operators, legal approvals, DNC sources or permission seeds.
-- All calls use the verified server session identity. Never expose service-role credentials.
create table public.icash_trusted_operators (
 user_id uuid primary key references auth.users(id),scopes text[] not null default '{}' check(scopes <@ array['support','authority_review']::text[]),provisioned_by text not null check(length(provisioned_by)>=12),
 provisioned_at timestamptz not null default now(),expires_at timestamptz not null,revoked_at timestamptz
);
create table public.icash_authority_market_reviews (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 screening_id uuid not null references public.icash_screening_jobs(id),state_code text not null check(state_code ~ '^[A-Z]{2}$'),
 kind text not null check(kind in ('contact_permission','offer_ceiling','marketing_release')),
 channel text not null check(channel in ('voice','offer','buyer_marketing')),
 source_reference text not null check(length(source_reference)>=12),reviewed_by text not null check(length(reviewed_by)>=3),
 reviewed_at timestamptz not null,expires_at timestamptz not null,revoked_at timestamptz,
 check(expires_at>reviewed_at)
);
create table public.icash_dnc_verification_sources (
 id uuid primary key default gen_random_uuid(),name text not null,source_reference text not null check(length(source_reference)>=12),
 enabled boolean not null default false,expires_at timestamptz not null
);
create table public.icash_dnc_verification_receipts (
 id uuid primary key default gen_random_uuid(),source_id uuid not null references public.icash_dnc_verification_sources(id),
 phone text not null check(phone ~ '^\+1[2-9][0-9]{9}$'),contact_key text not null,
 provider_reference text not null check(length(provider_reference)>=12),receipt_hash text not null check(receipt_hash ~ '^[a-f0-9]{64}$'),
 checked_at timestamptz not null,expires_at timestamptz not null,clear boolean not null,revoked_at timestamptz,
 check(contact_key=encode(sha256(convert_to(phone,'UTF8')),'hex')),check(expires_at>checked_at),
 unique(source_id,provider_reference)
);
create table public.icash_authority_review_requests (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 submitted_by uuid not null references auth.users(id),screening_id uuid not null references public.icash_screening_jobs(id),
 kind text not null check(kind in ('contact_permission','offer_ceiling','marketing_release')),
 idempotency_key uuid not null,payload jsonb not null check(octet_length(payload::text)<=12000),payload_hash text not null,
 state text not null default 'submitted' check(state in ('submitted','needs_information','approved','declined','revoked')),
 expires_at timestamptz not null,created_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id),reviewed_at timestamptz,decision_note text,verification jsonb,
 unique(account_id,idempotency_key)
);
create index icash_authority_reviews_account on public.icash_authority_review_requests(account_id,created_at desc,id desc);
create index icash_authority_reviews_property on public.icash_authority_review_requests(account_id,screening_id,created_at desc);
create table public.icash_authority_review_audit (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.icash_authority_review_requests(id),
 actor_user_id uuid references auth.users(id),event text not null,note text not null,evidence jsonb not null default '{}',created_at timestamptz not null default now()
);
create index icash_authority_review_audit_request on public.icash_authority_review_audit(request_id,created_at);
alter table public.icash_contact_permissions add column review_request_id uuid references public.icash_authority_review_requests(id);
alter table public.icash_offer_authorities add column review_request_id uuid references public.icash_authority_review_requests(id);
alter table public.icash_disposition_authorities add column review_request_id uuid references public.icash_authority_review_requests(id),add column terms_hash text,add column signed_document_hash text,add column marketing_scope text;

alter table public.icash_trusted_operators enable row level security;
alter table public.icash_authority_market_reviews enable row level security;
alter table public.icash_dnc_verification_sources enable row level security;
alter table public.icash_dnc_verification_receipts enable row level security;
alter table public.icash_authority_review_requests enable row level security;
alter table public.icash_authority_review_audit enable row level security;
revoke all on public.icash_trusted_operators,public.icash_authority_market_reviews,public.icash_dnc_verification_sources,public.icash_dnc_verification_receipts,public.icash_authority_review_requests,public.icash_authority_review_audit from public,anon,authenticated,service_role;
-- Evidence and membership provisioning is a separate, explicitly authorized operation.
grant select on public.icash_trusted_operators,public.icash_authority_market_reviews,public.icash_dnc_verification_sources,public.icash_dnc_verification_receipts to service_role;
grant select,insert,update on public.icash_authority_review_requests to service_role;
grant select,insert on public.icash_authority_review_audit to service_role;

create function public.icash_authority_immutable_request() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if row(new.id,new.account_id,new.submitted_by,new.screening_id,new.kind,new.idempotency_key,new.payload,new.payload_hash,new.created_at)
 is distinct from row(old.id,old.account_id,old.submitted_by,old.screening_id,old.kind,old.idempotency_key,old.payload,old.payload_hash,old.created_at)
 then raise exception 'Review submission is immutable';end if;return new;
end $$;
create trigger icash_authority_request_immutable before update on public.icash_authority_review_requests for each row execute function public.icash_authority_immutable_request();
create function public.icash_authority_no_mutation() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Append-only evidence';end $$;
create trigger icash_authority_audit_immutable before update or delete on public.icash_authority_review_audit for each row execute function public.icash_authority_no_mutation();
create function public.icash_authority_text(p jsonb,k text,n integer default 12) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p->k)='string' and length(trim(p->>k)) between n and 1000,false)
$$;
create function public.icash_submit_authority_review(p_account uuid,p_user uuid,p_key uuid,p_payload jsonb) returns public.icash_authority_review_requests
language plpgsql security invoker set search_path='' as $$
declare r public.icash_authority_review_requests;s public.icash_screening_jobs;h text;k text;observed timestamptz;expiry timestamptz;
begin
 if p_user is null or p_key is null or not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account ownership required';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>12000 then raise exception 'Invalid review';end if;
 h:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 -- Serialize identical keys before validation: lost-response retries preserve the original receipt.
 perform pg_advisory_xact_lock(hashtextextended(p_account::text||p_key::text,481));
 select * into r from public.icash_authority_review_requests where account_id=p_account and idempotency_key=p_key;
 if found then if r.payload_hash<>h then raise exception 'Idempotency payload conflict';end if;return r;end if;
 select * into s from public.icash_screening_jobs where id=(p_payload->>'screeningId')::uuid and account_id=p_account and state='complete';
 if not found then raise exception 'Owned completed property required';end if;
 k:=p_payload->>'kind';
 if k is null or k not in ('contact_permission','offer_ceiling','marketing_release') or not public.icash_authority_text(p_payload,'purpose') or not public.icash_authority_text(p_payload,'sourceName',3) or not public.icash_authority_text(p_payload,'evidenceReference') or coalesce(p_payload->>'stateCode','') !~ '^[A-Z]{2}$' then raise exception 'Dated source and scope required';end if;
 observed:=(p_payload->>'evidenceObservedAt')::timestamptz;expiry:=(p_payload->>'expiresAt')::timestamptz;
 if observed is null or observed>now() or observed<now()-interval '365 days' or expiry is null or expiry<=now() or expiry>now()+interval '90 days' then raise exception 'Current evidence and bounded expiry required';end if;
 if k='contact_permission' then
  if p_payload->>'channel' is distinct from 'voice' or coalesce(p_payload->>'party','') not in ('seller','buyer') or coalesce(p_payload->>'phone','') !~ '^\+1[2-9][0-9]{9}$'
   or not exists(select 1 from pg_timezone_names where name=p_payload->>'timezone')
   or coalesce((p_payload->>'localStartHour')::integer,0) not between 9 and 19 or coalesce((p_payload->>'localEndHour')::integer,0) not between 10 and 20 or (p_payload->>'localStartHour')::integer>=(p_payload->>'localEndHour')::integer then raise exception 'Voice scope and valid contact window required';end if;
  if (p_payload->>'party'='buyer' and not exists(select 1 from public.icash_buyer_profiles where id=(p_payload->>'buyerId')::uuid and account_id=p_account)) or (p_payload->>'party'='seller' and p_payload->>'buyerId' is not null) then raise exception 'Buyer scope mismatch';end if;
 elsif k='offer_ceiling' then
  if p_payload->>'channel' is distinct from 'offer' or jsonb_typeof(p_payload->'maxCents') is distinct from 'number' or (p_payload->>'maxCents')::numeric<>trunc((p_payload->>'maxCents')::numeric) or (p_payload->>'maxCents')::numeric not between 1 and 100000000000 then raise exception 'Exact bounded offer required';end if;
 else
  if p_payload->>'channel' is distinct from 'buyer_marketing' or p_payload->>'marketingScope' is distinct from 'assignment_interest' or not exists(select 1 from public.icash_deal_files where id=(p_payload->>'dealId')::uuid and account_id=p_account and screening_id=s.id) then raise exception 'Owned deal and marketing scope required';end if;
  if coalesce(p_payload->>'termsHash','') !~ '^[a-f0-9]{64}$' or coalesce(p_payload->>'propertyType','') not in ('house','land') or not public.icash_authority_text(p_payload,'market',2) or jsonb_typeof(p_payload->'maxCents') is distinct from 'number' or (p_payload->>'maxCents')::numeric<>trunc((p_payload->>'maxCents')::numeric) or (p_payload->>'maxCents')::numeric not between 1 and 100000000000 or jsonb_typeof(p_payload->'repairsCents') is distinct from 'number' or (p_payload->>'repairsCents')::numeric<>trunc((p_payload->>'repairsCents')::numeric) or (p_payload->>'repairsCents')::numeric not between 0 and 100000000000 then raise exception 'Exact marketing terms required';end if;
 end if;
 insert into public.icash_authority_review_requests(account_id,submitted_by,screening_id,kind,idempotency_key,payload,payload_hash,expires_at)
 values(p_account,p_user,s.id,k,p_key,p_payload,h,expiry) returning * into r;
 insert into public.icash_authority_review_audit(request_id,actor_user_id,event,note,evidence) values(r.id,p_user,'submitted','Evidence submitted; no authority granted',jsonb_build_object('payloadHash',h));
 return r;
end $$;

create function public.icash_revoke_authority_review(p_request uuid,p_actor uuid,p_note text) returns void
language plpgsql security invoker set search_path='' as $$
declare r public.icash_authority_review_requests;
begin
 select * into strict r from public.icash_authority_review_requests where id=p_request for update;
 if r.state='revoked' then return;end if;
 update public.icash_contact_permissions set revoked_at=coalesce(revoked_at,now()) where review_request_id=r.id;
 update public.icash_offer_authorities set expires_at=least(expires_at,now()) where review_request_id=r.id;
 update public.icash_disposition_authorities set expires_at=least(expires_at,now()) where review_request_id=r.id;
 update public.icash_authority_review_requests set state='revoked',decision_note=p_note,reviewed_at=now() where id=r.id;
 insert into public.icash_authority_review_audit(request_id,actor_user_id,event,note) values(r.id,p_actor,'revoked',p_note);
end $$;

create function public.icash_decide_authority_review(p_reviewer uuid,p_request uuid,p_decision text,p_note text,p_verification jsonb default '{}') returns public.icash_authority_review_requests
language plpgsql security invoker set search_path='' as $$
declare r public.icash_authority_review_requests;s public.icash_screening_jobs;p jsonb;v jsonb:=p_verification;m public.icash_authority_market_reviews;
 dnc public.icash_dnc_verification_receipts;src public.icash_dnc_verification_sources;d public.icash_deal_files;e public.icash_signing_envelopes;
 expiry timestamptz;checked timestamptz;contact text;old_review uuid;amount bigint;sig jsonb;expected jsonb;n integer;
begin
 if p_reviewer is null or not exists(select 1 from public.icash_trusted_operators where user_id=p_reviewer and scopes @> array['authority_review']::text[] and revoked_at is null and expires_at>now()) then raise exception 'Trusted operator required';end if;
 if p_note is null or length(trim(p_note)) not between 12 and 1000 or p_decision is null or p_decision not in ('approved','needs_information','declined','revoked') then raise exception 'Explicit decision and reason required';end if;
 select * into strict r from public.icash_authority_review_requests where id=p_request for update;
 if r.state=p_decision then return r;end if;
 if p_decision='revoked' then perform public.icash_revoke_authority_review(r.id,p_reviewer,p_note);select * into r from public.icash_authority_review_requests where id=r.id;return r;end if;
 if r.state not in ('submitted','needs_information') then raise exception 'Review already decided; submit a new version';end if;
 if p_decision<>'approved' then
  update public.icash_authority_review_requests set state=p_decision,decision_note=p_note,reviewed_by=p_reviewer,reviewed_at=now() where id=r.id returning * into r;
  insert into public.icash_authority_review_audit(request_id,actor_user_id,event,note) values(r.id,p_reviewer,p_decision,p_note);return r;
 end if;
 p:=r.payload;
 -- Account/property locking also serializes competing approvals of the same subject.
 perform pg_advisory_xact_lock(hashtextextended(r.account_id::text||r.screening_id::text,482));
 select * into strict s from public.icash_screening_jobs where id=r.screening_id and account_id=r.account_id and state='complete' for share;
 if not exists(select 1 from public.icash_accounts where id=r.account_id and owner_user_id=r.submitted_by) then raise exception 'Owner changed; new review required';end if;
 if jsonb_typeof(v) is distinct from 'object' or not public.icash_authority_text(v,'reviewReference') then raise exception 'Reviewed evidence required';end if;
 checked:=(v->>'reviewedAt')::timestamptz;expiry:=least(r.expires_at,(v->>'validUntil')::timestamptz);
 if checked is null or checked>now() or checked<now()-interval '24 hours' or v->>'validUntil' is null or expiry<=now() then raise exception 'Current review required';end if;
 select * into m from public.icash_authority_market_reviews where id=(v->>'marketReviewId')::uuid and account_id=r.account_id and screening_id=r.screening_id and state_code=p->>'stateCode' and kind=r.kind and channel=p->>'channel' and revoked_at is null and reviewed_at<=now() and expires_at>now() for share;
 if not found then raise exception 'Legal market and channel verification required';end if;
 expiry:=least(expiry,m.expires_at);
 if r.kind='contact_permission' then
  contact:=encode(sha256(convert_to(p->>'phone','UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(contact,17));
  if exists(select 1 from public.icash_contact_suppressions where contact_key=contact) or exists(select 1 from public.icash_text_suppressions where phone=p->>'phone') then raise exception 'Contact suppressed; permission cannot override opt-out';end if;
  if not public.icash_authority_text(v,'consentReference') or v->>'consentObservedAt' is null or (v->>'consentObservedAt')::timestamptz>now() or (v->>'consentObservedAt')::timestamptz<now()-interval '365 days' then raise exception 'Verified voice consent source required';end if;
  select * into dnc from public.icash_dnc_verification_receipts where id=(v->>'dncReceiptId')::uuid and phone=p->>'phone' and contact_key=contact and clear and revoked_at is null and checked_at between now()-interval '30 days' and now() and expires_at>now() for share;
  if not found then raise exception 'External DNC verification required';end if;
  select * into src from public.icash_dnc_verification_sources where id=dnc.source_id and enabled and expires_at>now() for share;
  if not found then raise exception 'External DNC source unavailable';end if;
  expiry:=least(expiry,dnc.expires_at,dnc.checked_at+interval '30 days',src.expires_at);
  if exists(select 1 from public.icash_contact_permissions where account_id=r.account_id and screening_id=r.screening_id and party=p->>'party' and contact_key=contact and revoked_at is not null) then raise exception 'Revoked contact needs separate opt-out resolution';end if;
  select review_request_id into old_review from public.icash_contact_permissions where account_id=r.account_id and screening_id=r.screening_id and party=p->>'party' and contact_key=contact;
  -- Do not clear a historical revocation. Replaced active evidence expires atomically.
  if old_review is not null then perform public.icash_revoke_authority_review(old_review,p_reviewer,'Superseded by a new explicit review');end if;
  insert into public.icash_contact_permissions(account_id,screening_id,party,phone,contact_key,timezone,local_start_hour,local_end_hour,permission_evidence,permission_until,dnc_checked_at,dnc_clear,buyer_id,review_request_id)
  values(r.account_id,r.screening_id,p->>'party',p->>'phone',contact,p->>'timezone',(p->>'localStartHour')::integer,(p->>'localEndHour')::integer,v->>'consentReference',expiry,dnc.checked_at,true,(p->>'buyerId')::uuid,r.id)
  on conflict(account_id,screening_id,party,contact_key) do update set timezone=excluded.timezone,local_start_hour=excluded.local_start_hour,local_end_hour=excluded.local_end_hour,permission_evidence=excluded.permission_evidence,permission_until=excluded.permission_until,dnc_checked_at=excluded.dnc_checked_at,dnc_clear=true,review_request_id=excluded.review_request_id,revoked_at=null,buyer_id=excluded.buyer_id;
 elsif r.kind='offer_ceiling' then
  amount:=(p->>'maxCents')::bigint;
  if not public.icash_authority_text(v,'underwritingReference') or jsonb_typeof(v->'underwritingMaxCents') is distinct from 'number' or (v->>'underwritingMaxCents')::numeric<>trunc((v->>'underwritingMaxCents')::numeric) or (v->>'underwritingMaxCents')::numeric not between amount and 100000000000 or coalesce(s.result->>'preliminarySellerCeilingCents','0')::numeric<amount or s.result->'financialCheck'->>'status' is distinct from 'eligible' or (s.snapshot->>'fetchedAt')::timestamptz is null or (s.snapshot->>'fetchedAt')::timestamptz not between now()-interval '24 hours' and now() then raise exception 'Reviewed underwriting and fresh bounded offer required';end if;
  select review_request_id into old_review from public.icash_offer_authorities where account_id=r.account_id and screening_id=r.screening_id;
  if old_review is not null then perform public.icash_revoke_authority_review(old_review,p_reviewer,'Superseded by a new explicit review');end if;
  insert into public.icash_offer_authorities(account_id,screening_id,max_offer_cents,reviewed_evidence,expires_at,review_request_id) values(r.account_id,r.screening_id,amount,v->>'underwritingReference',expiry,r.id)
  on conflict(account_id,screening_id) do update set max_offer_cents=excluded.max_offer_cents,reviewed_evidence=excluded.reviewed_evidence,expires_at=excluded.expires_at,review_request_id=excluded.review_request_id;
 else
  select * into d from public.icash_deal_files where id=(p->>'dealId')::uuid and account_id=r.account_id and screening_id=r.screening_id and stage in ('under_contract','buyer_selected') and seller_signed_at is not null for share;
  if not found then raise exception 'Executed active purchase required';end if;
  select * into e from public.icash_signing_envelopes where id=(p->>'purchaseEnvelopeId')::uuid and account_id=r.account_id and deal_id=d.id and kind='purchase' and state='completed' and not test_mode
   -- Assignment-only fields are deliberately editable after purchase execution.
   -- Bind every purchase term to the unchanged signed snapshot, while validating
   -- the current fee/asking price below. The original envelope/hash stays intact.
   and terms-array['assignee','assignmentFeeCents','assignmentDepositCents','payoutMethod','payoutHandle']
       =d.terms-array['assignee','assignmentFeeCents','assignmentDepositCents','payoutMethod','payoutHandle']
   and terms_hash=p->>'termsHash' for share;
  if not found or e.provider_id is null or e.terms->>'state' is distinct from p->>'stateCode' then raise exception 'Current actual purchase and terms hash required';end if;
  if coalesce(v->>'signedDocumentHash','') !~ '^[a-f0-9]{64}$' or v->>'signedDocumentCheckedAt' is null or (v->>'signedDocumentCheckedAt')::timestamptz not between now()-interval '5 minutes' and now() or not public.icash_authority_text(v,'marketingRightsReference') then raise exception 'Provider verified signed PDF and marketing rights required';end if;
  if e.provider_evidence->>'id' is distinct from e.provider_id::text or e.provider_evidence->>'test_mode' is distinct from 'false' or lower(e.provider_evidence->>'status') is distinct from 'completed' or e.provider_evidence->>'apply_signing_order' is distinct from 'true' or e.provider_evidence->'metadata'->>'icash_envelope' is distinct from e.id::text or e.provider_evidence->'metadata'->>'terms_hash' is distinct from e.terms_hash or jsonb_typeof(e.recipients) is distinct from 'array' or jsonb_array_length(e.recipients)<2 or jsonb_typeof(e.provider_evidence->'recipients') is distinct from 'array' or jsonb_array_length(e.provider_evidence->'recipients')<>jsonb_array_length(e.recipients) then raise exception 'Verified real signatures required';end if;
  n:=0;for expected in select value from jsonb_array_elements(e.recipients) loop
   select value into sig from jsonb_array_elements(e.provider_evidence->'recipients') where value->>'id'=expected->>'id';n:=n+1;
   if sig is null or lower(sig->>'email') is distinct from lower(expected->>'email') or lower(sig->>'status') is distinct from 'signed' or sig->>'signing_order' is distinct from n::text then raise exception 'All required signatures in order required';end if;
  end loop;
  amount:=(p->>'maxCents')::bigint;
  if d.terms->>'priceCents' is null or d.terms->>'assignmentFeeCents' is null or amount<>(d.terms->>'priceCents')::bigint+(d.terms->>'assignmentFeeCents')::bigint then raise exception 'Exact asking price and assignment fee required';end if;
  select review_request_id into old_review from public.icash_disposition_authorities where deal_id=d.id;
  if old_review is not null then perform public.icash_revoke_authority_review(old_review,p_reviewer,'Superseded by a new explicit review');end if;
  insert into public.icash_disposition_authorities(deal_id,account_id,purchase_envelope_id,market,property_type,asking_price_cents,repairs_cents,marketing_evidence,expires_at,review_request_id,terms_hash,signed_document_hash,marketing_scope)
  values(d.id,r.account_id,e.id,p->>'market',p->>'propertyType',amount,(p->>'repairsCents')::bigint,v->>'marketingRightsReference',expiry,r.id,e.terms_hash,v->>'signedDocumentHash','assignment_interest')
  on conflict(deal_id) do update set purchase_envelope_id=excluded.purchase_envelope_id,market=excluded.market,property_type=excluded.property_type,asking_price_cents=excluded.asking_price_cents,repairs_cents=excluded.repairs_cents,marketing_evidence=excluded.marketing_evidence,expires_at=excluded.expires_at,review_request_id=excluded.review_request_id,terms_hash=excluded.terms_hash,signed_document_hash=excluded.signed_document_hash,marketing_scope=excluded.marketing_scope;
 end if;
 update public.icash_authority_review_requests set state='approved',reviewed_by=p_reviewer,reviewed_at=now(),decision_note=p_note,verification=v,expires_at=expiry where id=r.id returning * into r;
 insert into public.icash_authority_review_audit(request_id,actor_user_id,event,note,evidence) values(r.id,p_reviewer,'approved',p_note,v);
 return r;
end $$;

-- Revoke on evidence withdrawal or signed-contract changes. No automatic new grant.
create function public.icash_invalidate_reviewed_authorities() returns trigger language plpgsql security invoker set search_path='' as $$
declare r record;
begin
 for r in select q.id from public.icash_authority_review_requests q where q.state='approved' and (
  (tg_table_name='icash_authority_market_reviews' and q.verification->>'marketReviewId'=old.id::text)
  or (tg_table_name='icash_dnc_verification_receipts' and q.verification->>'dncReceiptId'=old.id::text)
  or (tg_table_name='icash_dnc_verification_sources' and exists(select 1 from public.icash_dnc_verification_receipts x where x.source_id=old.id and x.id::text=q.verification->>'dncReceiptId'))
  or (tg_table_name='icash_signing_envelopes' and q.payload->>'purchaseEnvelopeId'=old.id::text)
  or (tg_table_name='icash_deal_files' and q.payload->>'dealId'=old.id::text)
 ) loop perform public.icash_revoke_authority_review(r.id,null,'Supporting evidence changed; a new review is required');end loop;
 return new;
end $$;
create trigger icash_market_review_changed after update on public.icash_authority_market_reviews for each row when (old.* is distinct from new.*) execute function public.icash_invalidate_reviewed_authorities();
create trigger icash_dnc_receipt_changed after update on public.icash_dnc_verification_receipts for each row when (old.* is distinct from new.*) execute function public.icash_invalidate_reviewed_authorities();
create trigger icash_market_review_deleted after delete on public.icash_authority_market_reviews for each row execute function public.icash_invalidate_reviewed_authorities();
create trigger icash_dnc_receipt_deleted after delete on public.icash_dnc_verification_receipts for each row execute function public.icash_invalidate_reviewed_authorities();
create trigger icash_dnc_source_changed after update on public.icash_dnc_verification_sources for each row when (old.* is distinct from new.*) execute function public.icash_invalidate_reviewed_authorities();
create trigger icash_marketing_contract_changed after update of terms,terms_hash,state,test_mode,provider_evidence,provider_id on public.icash_signing_envelopes for each row when (old.* is distinct from new.*) execute function public.icash_invalidate_reviewed_authorities();
create trigger icash_marketing_terms_changed after update of terms,stage,seller_signed_at on public.icash_deal_files for each row when (old.terms is distinct from new.terms or new.stage not in ('under_contract','buyer_selected','title_open','closing') or new.seller_signed_at is null) execute function public.icash_invalidate_reviewed_authorities();

create function public.icash_withdraw_authority_review(p_account uuid,p_user uuid,p_request uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts a join public.icash_authority_review_requests r on r.account_id=a.id where a.id=p_account and a.owner_user_id=p_user and r.id=p_request) then raise exception 'Owned request required';end if;
 perform public.icash_revoke_authority_review(p_request,p_user,'Withdrawn by the account owner');
end $$;
revoke all on function public.icash_authority_immutable_request(),public.icash_authority_no_mutation(),public.icash_authority_text(jsonb,text,integer),public.icash_submit_authority_review(uuid,uuid,uuid,jsonb),public.icash_revoke_authority_review(uuid,uuid,text),public.icash_decide_authority_review(uuid,uuid,text,text,jsonb),public.icash_invalidate_reviewed_authorities(),public.icash_withdraw_authority_review(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_authority_text(jsonb,text,integer),public.icash_submit_authority_review(uuid,uuid,uuid,jsonb),public.icash_revoke_authority_review(uuid,uuid,text),public.icash_decide_authority_review(uuid,uuid,text,text,jsonb),public.icash_invalidate_reviewed_authorities(),public.icash_withdraw_authority_review(uuid,uuid,uuid) to service_role;

-- Bind the spoken offer to the still-current authority inside the final dispatch
-- claim. A withdrawal before this transaction completes prevents the call.
create function public.icash_claim_reviewed_voice_job(p_job uuid,p_offer_snapshot jsonb default null,p_buyer_snapshot jsonb default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare j public.icash_voice_jobs;p public.icash_contact_permissions;a public.icash_offer_authorities;
begin
 select * into j from public.icash_voice_jobs where id=p_job;
 select * into p from public.icash_contact_permissions where id=j.permission_id and account_id=j.account_id;
 if p.party='buyer' then
  -- Lock the release backing the context; its replacement/revocation waits for this claim.
  perform 1 from public.icash_disposition_authorities where account_id=j.account_id and deal_id=(p_buyer_snapshot->>'dealId')::uuid for share;
  if not found or p_buyer_snapshot is null or public.icash_buyer_voice_context(p.id) is distinct from p_buyer_snapshot then return false;end if;
 end if;
 if p_offer_snapshot is not null then
  select * into j from public.icash_voice_jobs where id=p_job;
  select * into p from public.icash_contact_permissions where id=j.permission_id and account_id=j.account_id;
  select * into a from public.icash_offer_authorities where account_id=j.account_id and screening_id=p.screening_id for share;
  if not found or a.expires_at<=now() or jsonb_typeof(p_offer_snapshot) is distinct from 'object'
   or a.max_offer_cents is distinct from (p_offer_snapshot->>'max_offer_cents')::bigint
   or a.expires_at is distinct from (p_offer_snapshot->>'expires_at')::timestamptz
   or a.review_request_id is distinct from (p_offer_snapshot->>'review_request_id')::uuid then return false;end if;
 end if;
 return public.icash_claim_voice_job(p_job);
end $$;
revoke all on function public.icash_claim_reviewed_voice_job(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.icash_claim_reviewed_voice_job(uuid,jsonb,jsonb) to service_role;
commit;
