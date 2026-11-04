-- Disabled, individually reviewed revalidation from NEW existing evidence only.
-- This does not obtain, renew or rewrite a DNC receipt, purchase, consent or send.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create schema if not exists icash_seller_recovery_private;
revoke all on schema icash_seller_recovery_private from public,anon,authenticated;
grant usage on schema icash_seller_recovery_private to service_role;
create table icash_seller_recovery_private.contact_revalidation_policy(
 id integer primary key check(id=1),enabled boolean not null default false
);
insert into icash_seller_recovery_private.contact_revalidation_policy(id) values(1);
create table icash_seller_recovery_private.contact_revalidation_reviews(
 id uuid primary key default gen_random_uuid(),gap_id uuid not null references public.icash_seller_gaps(id),
 contact_id uuid not null references public.icash_operational_contacts(id),
 snapshot jsonb not null,snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 review_reference text not null check(length(trim(review_reference)) between 20 and 1000),
 created_at timestamptz not null,expires_at timestamptz not null,
 check(expires_at=created_at+interval '30 minutes')
);
create table icash_seller_recovery_private.contact_revalidations(
 review_id uuid primary key references icash_seller_recovery_private.contact_revalidation_reviews(id),
 gap_id uuid not null unique references public.icash_seller_gaps(id),
 before_evidence jsonb not null,after_thread jsonb not null,after_gap jsonb not null,applied_at timestamptz not null
);
alter table icash_seller_recovery_private.contact_revalidation_policy enable row level security;
alter table icash_seller_recovery_private.contact_revalidation_reviews enable row level security;
alter table icash_seller_recovery_private.contact_revalidations enable row level security;
revoke all on all tables in schema icash_seller_recovery_private from public,anon,authenticated,service_role;
grant select on all tables in schema icash_seller_recovery_private to service_role;
create trigger contact_revalidation_reviews_immutable before update or delete
 on icash_seller_recovery_private.contact_revalidation_reviews for each row execute function public.icash_authority_no_mutation();
create trigger contact_revalidations_immutable before update or delete
 on icash_seller_recovery_private.contact_revalidations for each row execute function public.icash_authority_no_mutation();

-- Read-only exact review material. A later changed control, receipt or source
-- invalidates the reviewed hash rather than silently updating the authorization.
create function public.icash_seller_contact_revalidation_snapshot(p_gap uuid,p_contact uuid) returns jsonb
language sql stable security invoker set search_path='' as $function$
 select jsonb_build_object('gap',to_jsonb(g),'thread',to_jsonb(t),'oldContact',to_jsonb(old),
  'newContact',to_jsonb(fresh),'oldReceipt',to_jsonb(old_receipt),'newReceipt',to_jsonb(fresh_receipt),
  'oldSource',to_jsonb(old_source),'newSource',to_jsonb(fresh_source))
 from public.icash_seller_gaps g
 join public.icash_text_threads t on t.id=g.thread_id and t.account_id=g.account_id and t.deal_id=g.deal_id
 join public.icash_operational_contacts old on old.id=t.operational_contact_id and old.account_id=t.account_id
 join public.icash_operational_contacts fresh on fresh.id=p_contact and fresh.account_id=t.account_id
 join public.icash_dnc_verification_receipts old_receipt on old_receipt.id=old.dnc_receipt_id
 join public.icash_dnc_verification_receipts fresh_receipt on fresh_receipt.id=fresh.dnc_receipt_id
 join public.icash_dnc_verification_sources old_source on old_source.id=old_receipt.source_id
 join public.icash_dnc_verification_sources fresh_source on fresh_source.id=fresh_receipt.source_id
 where g.id=p_gap
$function$;

-- Review never alters contact authority or the held follow-up. There is no
-- automatic review enrollment and no provider/evidence writer in this release.
create function public.icash_review_seller_contact_revalidation(p_gap uuid,p_contact uuid,p_expected_hash text,p_reference text) returns uuid
language plpgsql security definer set search_path='' as $function$
declare snapshot jsonb;review_id uuid;stamp timestamptz:=clock_timestamp();
begin
 if p_expected_hash is null or p_expected_hash !~ '^[a-f0-9]{64}$'
  or length(trim(coalesce(p_reference,''))) not between 20 and 1000 then return null;end if;
 snapshot:=public.icash_seller_contact_revalidation_snapshot(p_gap,p_contact);
 if snapshot is null or encode(sha256(convert_to(snapshot::text,'UTF8')),'hex')<>p_expected_hash
  or snapshot#>>'{gap,state}' is distinct from 'needs_review' or snapshot#>>'{gap,review_reason}' is distinct from 'contact_checks_expired'
  or snapshot#>>'{gap,reason}' is distinct from 'no_response' or snapshot#>>'{gap,stage}' is distinct from 'draft'
  or snapshot#>>'{gap,outgoing_id}' is not null
  or snapshot#>>'{oldContact,id}'=snapshot#>>'{newContact,id}'
  or exists(select 1 from icash_seller_recovery_private.contact_revalidations where gap_id=p_gap)
 then return null;end if;
 insert into icash_seller_recovery_private.contact_revalidation_reviews(gap_id,contact_id,snapshot,snapshot_hash,review_reference,created_at,expires_at)
 values(p_gap,p_contact,snapshot,p_expected_hash,trim(p_reference),stamp,stamp+interval '30 minutes') returning id into review_id;
 return review_id;
end $function$;

create function public.icash_apply_seller_contact_revalidation(p_review uuid) returns boolean
language plpgsql security definer set search_path='' as $function$
declare review icash_seller_recovery_private.contact_revalidation_reviews;
 g public.icash_seller_gaps;t public.icash_text_threads;old public.icash_operational_contacts;fresh public.icash_operational_contacts;
 old_receipt public.icash_dnc_verification_receipts;fresh_receipt public.icash_dnc_verification_receipts;
 snapshot jsonb;stamp timestamptz;until_at timestamptz;original_at timestamptz;
begin
 -- Match the ordinary scheduler's outer lock, then the admission/recipient locks.
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;if not found then return false;end if;
 perform 1 from icash_seller_recovery_private.contact_revalidation_policy where id=1 and enabled for share;if not found then return false;end if;
 select * into review from icash_seller_recovery_private.contact_revalidation_reviews where id=p_review for share;
 if not found or review.expires_at<=clock_timestamp()
  or exists(select 1 from icash_seller_recovery_private.contact_revalidations where review_id=p_review or gap_id=review.gap_id)
 then return false;end if;
 select th.* into t from public.icash_text_threads th join public.icash_seller_gaps gap on gap.thread_id=th.id where gap.id=review.gap_id;
 if not found then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 perform pg_advisory_xact_lock(hashtextextended(encode(sha256(convert_to(t.recipient,'UTF8')),'hex'),17));
 perform 1 from public.icash_accounts where id=t.account_id and not bot_paused for share;if not found then return false;end if;
 select * into t from public.icash_text_threads where id=t.id for update;
 perform 1 from public.icash_sms_routes where sender=t.sender and recipient=t.recipient
  and account_id=t.account_id and not needs_review for share;if not found then return false;end if;
 select * into g from public.icash_seller_gaps where id=review.gap_id for update;
 select * into old from public.icash_operational_contacts where id=t.operational_contact_id for share;
 select * into fresh from public.icash_operational_contacts where id=review.contact_id for share;
 select * into old_receipt from public.icash_dnc_verification_receipts where id=old.dnc_receipt_id for share;
 select * into fresh_receipt from public.icash_dnc_verification_receipts where id=fresh.dnc_receipt_id for share;
 perform 1 from public.icash_dnc_verification_sources where id in (old_receipt.source_id,fresh_receipt.source_id) order by id for share;
 snapshot:=public.icash_seller_contact_revalidation_snapshot(g.id,fresh.id);
 stamp:=clock_timestamp();
 if snapshot is null or snapshot is distinct from review.snapshot or review.expires_at<=stamp
  or g.state is distinct from 'needs_review' or g.review_reason is distinct from 'contact_checks_expired' or g.reason is distinct from 'no_response'
  or g.stage<>'draft' or g.outgoing_id is not null or g.expires_at<=stamp or g.due_at>stamp
  or t.account_id<>g.account_id or t.deal_id<>g.deal_id or t.party<>'seller'
  or t.paused or t.manual_only or t.ai_mode<>'auto' or t.retired_at is not null or t.seller_intake_id is not null
  or old.id=fresh.id or old.revoked_at is not null or fresh.revoked_at is not null
  or old_receipt.clear is distinct from true or old_receipt.revoked_at is not null
  or not exists(select 1 from public.icash_dnc_verification_sources where id=old_receipt.source_id and enabled)
  or row(old.account_id,old.screening_id,old.channel,old.phone,old.contact_key,old.owner_user_id,old.sending_principal,old.source_hash,old.timezone,old.timezone_basis,old.local_start_hour,old.local_end_hour)
   is distinct from row(fresh.account_id,fresh.screening_id,fresh.channel,fresh.phone,fresh.contact_key,fresh.owner_user_id,fresh.sending_principal,fresh.source_hash,fresh.timezone,fresh.timezone_basis,fresh.local_start_hour,fresh.local_end_hour)
  or fresh.channel<>'sms' or fresh.screening_id<>g.screening_id or fresh.phone<>t.recipient or fresh.timezone<>t.timezone
  or fresh.dnc_receipt_id=old.dnc_receipt_id or fresh_receipt.checked_at<=old_receipt.checked_at
  or fresh_receipt.checked_at>stamp or fresh_receipt.checked_at<=review.created_at-interval '24 hours'
  or fresh.eligibility_until<=stamp or fresh.eligibility_until<=old.eligibility_until
 then return false;end if;
 -- This repair is only the existing non-price reminder of a verified original
 -- outgoing text. Match final dispatch's seven-day non-price financial screen;
 -- do not invent a new valuation or buy one merely to renew a reminder.
 select m.created_at into original_at from public.icash_text_messages m
  where g.source='text' and m.id=g.source_id and m.account_id=g.account_id and m.thread_id=t.id
   and m.direction='outgoing' and m.state='delivered' and m.provider_id is not null and m.created_at<=stamp for share;
 if not found then return false;end if;
 perform 1 from public.icash_screening_jobs s where s.id=g.screening_id and s.account_id=g.account_id
  and s.state='complete' and s.result->'financialCheck'->>'status'='eligible'
  and s.completed_at<=stamp and s.completed_at>stamp-interval '7 days' for share;
 if not found then return false;end if;
 -- A new binding cannot incidentally revive another draft, AI job, prior
 -- recovery attempt or unknown send. History and financial holds stay intact.
 if exists(select 1 from public.icash_text_messages m where m.thread_id=t.id and m.direction='outgoing'
    and m.state in ('ready','dispatching','needs_review'))
  or exists(select 1 from public.icash_text_ai_jobs j where j.thread_id=t.id and j.state not in ('superseded','queued'))
  or exists(select 1 from public.icash_seller_gaps other where other.thread_id=t.id and other.id<>g.id and other.state in ('open','queued'))
  or exists(select 1 from public.icash_seller_recovery_attempts a where a.thread_id=t.id)
  or exists(select 1 from public.icash_property_controls pc join public.icash_screening_jobs s
    on s.account_id=pc.account_id and s.snapshot->>'propertyId'=pc.property_id
    where s.id=g.screening_id and s.account_id=g.account_id and pc.manual)
  or not exists(select 1 from public.icash_owner_contacts oc join public.icash_operation_spend spend
    on spend.operation_key=oc.operation_key and spend.account_id=oc.account_id and spend.state='settled'
    where oc.account_id=t.account_id and oc.screening_id=g.screening_id)
  or public.icash_seller_text_cadence_current(g.account_id,t.id,null,true) is distinct from true
  or public.icash_operational_contact_current(g.account_id,fresh.id,'sms',false) is distinct from true
 then return false;end if;
 select least(fresh.eligibility_until,r.expires_at) into until_at from public.icash_operation_rates r where r.id=t.sms_rate_id for share;
 if until_at is null or until_at<=clock_timestamp() or review.expires_at<=clock_timestamp() then return false;end if;
 -- Only these current-evidence fields change. Account/property/phone/sender,
 -- identity, source, consent, cadence, gap source/due/expiry and controls do not.
 -- A failed final check rolls back the entire small change and its audit.
 begin
  update public.icash_text_threads set operational_contact_id=fresh.id,eligibility_until=until_at,
   dnc_checked_at=fresh_receipt.checked_at,dnc_clear=fresh_receipt.clear where id=t.id;
  if public.icash_sms_thread_review_current(g.account_id,t.id,false) is distinct from true
   then raise exception 'Current SMS evidence did not validate' using errcode='P7501';end if;
  update public.icash_seller_gaps set state='open',review_reason=null,updated_at=clock_timestamp() where id=g.id;
  if public.icash_seller_recovery_current(g.id) is distinct from true
   then raise exception 'Current follow-up did not validate' using errcode='P7501';end if;
  if review.expires_at<=clock_timestamp() or g.expires_at<=clock_timestamp() or until_at<=clock_timestamp()
   then raise exception 'Reviewed revalidation window expired during final checks' using errcode='P7501';end if;
  insert into icash_seller_recovery_private.contact_revalidations(review_id,gap_id,before_evidence,after_thread,after_gap,applied_at)
  select review.id,g.id,snapshot,to_jsonb(th),to_jsonb(gap),clock_timestamp()
   from public.icash_text_threads th,public.icash_seller_gaps gap where th.id=t.id and gap.id=g.id;
 exception when sqlstate 'P7501' then return false;
 end;
 return true;
end $function$;

revoke all on function public.icash_seller_contact_revalidation_snapshot(uuid,uuid),
 public.icash_review_seller_contact_revalidation(uuid,uuid,text,text),public.icash_apply_seller_contact_revalidation(uuid)
 from public,anon,authenticated;
grant execute on function public.icash_seller_contact_revalidation_snapshot(uuid,uuid),
 public.icash_review_seller_contact_revalidation(uuid,uuid,text,text),public.icash_apply_seller_contact_revalidation(uuid) to service_role;
commit;
