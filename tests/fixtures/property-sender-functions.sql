-- Production function definitions before sender-pool support, used only by isolated tests.
CREATE OR REPLACE FUNCTION public.icash_prepare_seller_contacts(p_account uuid, p_lead uuid, p_screening uuid, p_deal uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare l public.icash_seller_intakes;e jsonb;r public.icash_operation_rates;chosen_sender text;price bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
 if not found then return;end if;
 perform 1 from public.icash_deal_files where id=p_deal and account_id=p_account and screening_id=p_screening and stage='draft' and coalesce(terms->>'practice','false')<>'true' for share;
 if not found then return;end if;
 select * into l from public.icash_seller_intakes where id=p_lead;
 e:=public.icash_seller_contact_evidence(p_account,p_screening,p_lead,l.phone);
 if e is null then return;end if;
 if exists(select 1 from public.icash_property_controls pc join public.icash_screening_jobs s on s.account_id=pc.account_id and s.snapshot->>'propertyId'=pc.property_id where s.id=p_screening and s.account_id=p_account and pc.manual)
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=p_screening and state<>'resolved') then return;end if;
 if public.icash_outreach_voice_current(p_account) then
  insert into public.icash_contact_permissions(account_id,screening_id,party,phone,contact_key,timezone,local_start_hour,local_end_hour,permission_evidence,permission_until,dnc_checked_at,dnc_clear,seller_intake_id)
  values(p_account,p_screening,'seller',l.phone,encode(sha256(convert_to(l.phone,'UTF8')),'hex'),e->>'timezone',9,20,e->>'evidence',(e->>'until')::timestamptz,null,false,l.id)
  on conflict(account_id,screening_id,party,contact_key) do nothing;
 end if;
 if not public.icash_outreach_sms_current(p_account) then return;end if;
 -- Ambiguous sender configuration must not silently select a different business number.
 if (select count(*) from public.icash_text_senders where enabled)<>1 then return;end if;
 select phone into chosen_sender from public.icash_text_senders where enabled for share;
 select * into r from public.icash_operation_rates where operation='sms_send' and public.icash_sms_intake_rate_current(id) order by verified_at desc,charge_cents,id limit 1 for share;
 if not found then return;end if;
 select customer_micros into price from public.icash_communication_prices where operation='sms_segment' for share;
 perform public.icash_retire_expired_practice_threads(p_account,chosen_sender,l.phone);
 insert into public.icash_text_threads(account_id,deal_id,sender,recipient,permission_until,permission_evidence,timezone,dnc_checked_at,dnc_clear,sms_rate_id,paused,ai_mode,party,seller_intake_id,seller_sms_rate_hash,seller_sms_price_micros)
 values(p_account,p_deal,chosen_sender,l.phone,(e->>'until')::timestamptz,e->>'evidence',e->>'timezone',null,false,r.id,false,'auto','seller',l.id,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),price)
 on conflict(account_id,deal_id,sender,recipient) where retired_at is null do nothing;
 -- Never reassign, unpause, renew or overwrite an existing contact on a retry.
end $function$


;
CREATE OR REPLACE FUNCTION public.icash_prepare_manual_text(p_actor uuid, p_account uuid, p_screening uuid, p_phone text, p_terms jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d public.icash_deal_files;t public.icash_text_threads;sender_phone text;rate uuid;reason text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor for update;
 if not found then raise exception 'Account owner required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_phone,74));
 if not exists(select 1 from public.icash_manual_contacts(p_account,p_screening) where phone=p_phone and not blocked and phone_type<>'landline') then return jsonb_build_object('error','This number is unavailable for texting.');end if;
 select * into d from public.icash_deal_files where account_id=p_account and screening_id=p_screening;
 if d.id is null then
  insert into public.icash_deal_files(account_id,screening_id,terms) values(p_account,p_screening,p_terms) on conflict(account_id,screening_id) do nothing;
  select * into d from public.icash_deal_files where account_id=p_account and screening_id=p_screening;
 end if;
 select * into t from public.icash_text_threads where retired_at is null and account_id=p_account and deal_id=d.id and recipient=p_phone order by id limit 1;
 if t.id is not null then return jsonb_build_object('dealId',d.id,'threadId',t.id);end if;
 -- Existing conversations retain their sender. New conversations use one configured business sender.
 select phone into sender_phone from public.icash_text_senders where enabled order by phone limit 1;
 if sender_phone is null then return jsonb_build_object('error','Business texting number is not configured.');end if;
 perform public.icash_retire_expired_practice_threads(p_account,sender_phone,p_phone);
 if exists(select 1 from public.icash_text_threads where retired_at is null and sender=sender_phone and recipient=p_phone) then return jsonb_build_object('error','This number already has a conversation on another property. Open that conversation.');end if;
 select id into rate from public.icash_operation_rates where operation='sms_send' and enabled and expires_at>now() order by verified_at desc,id limit 1;
 insert into public.icash_text_threads(account_id,deal_id,sender,recipient,sms_rate_id,paused,ai_mode,manual_only) values(p_account,d.id,sender_phone,p_phone,rate,true,'off',true) returning * into t;
 return jsonb_build_object('dealId',d.id,'threadId',t.id);
end $function$


;
CREATE OR REPLACE FUNCTION public.icash_project_operational_sms_contacts(p_account uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_operational_contacts;r public.icash_operation_rates;v_sender text;deal uuid;price bigint;checked timestamptz;inserted integer;total integer:=0;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then return 0;end if;
 perform public.icash_prepare_operational_contacts(p_account);
 -- Ambiguous sender configuration is a setup problem, never a reason to guess.
 if (select count(*) from public.icash_text_senders where enabled)<>1 then return 0;end if;
 select phone into v_sender from public.icash_text_senders where enabled for share;
 select * into r from public.icash_operation_rates where operation='sms_send' and public.icash_sms_intake_rate_current(id)
  order by verified_at desc,id limit 1 for share;
 if not found then return 0;end if;
 select customer_micros into price from public.icash_communication_prices where operation='sms_segment' for share;
 if not found then return 0;end if;
 for c in select oc.* from public.icash_operational_contacts oc
  join public.icash_accounts a on a.id=oc.account_id and not a.bot_paused
  where oc.channel='sms' and (p_account is null or oc.account_id=p_account) and oc.revoked_at is null and oc.eligibility_until>now()
   and (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=oc.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
    or public.icash_operational_contact_current(oc.account_id,oc.id,'sms',false))
   and not exists(select 1 from public.icash_text_threads th where th.retired_at is null and th.sender=v_sender and th.recipient=oc.phone)
  order by oc.account_id,oc.phone,oc.id limit 100
 loop
  perform pg_advisory_xact_lock(hashtextextended(c.phone,74));
  perform 1 from public.icash_accounts where id=c.account_id and not bot_paused for update;
  if not found then continue;end if;
  perform 1 from public.icash_outreach_campaigns where account_id=c.account_id for share;
  if not public.icash_outreach_sms_current(c.account_id)
   or not public.icash_operational_contact_current(c.account_id,c.id,'sms',false) then continue;end if;
  -- A source with two live property bindings must be resolved rather than picked.
  if (select count(*) from public.icash_deal_files d where d.account_id=c.account_id and d.screening_id=c.screening_id
   and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true')<>1 then continue;end if;
  select d.id into deal from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
   where d.account_id=c.account_id and d.screening_id=c.screening_id and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true'
    and s.state='complete' and s.result->'financialCheck'->>'status'='eligible' and s.completed_at between now()-interval '24 hours' and now()
    and not exists(select 1 from public.icash_property_controls pc where pc.account_id=c.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
   for share of d,s;
  if not found then continue;end if;
  checked:=clock_timestamp();
  if least(c.eligibility_until,r.expires_at)<=checked or r.verified_at>checked then continue;end if;
  insert into public.icash_text_threads(account_id,deal_id,sender,recipient,timezone,dnc_checked_at,dnc_clear,sms_rate_id,
   paused,party,ai_mode,sms_intake_pending,operational_contact_id,eligibility_until,operational_sms_sender,operational_sms_rate_hash,operational_sms_price_micros)
  select c.account_id,deal,v_sender,c.phone,c.timezone,dr.checked_at,dr.clear,r.id,false,'seller','auto',false,c.id,
   least(c.eligibility_until,r.expires_at),v_sender,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),price
  from public.icash_dnc_verification_receipts dr where dr.id=c.dnc_receipt_id and dr.phone=c.phone
  on conflict(account_id,deal_id,sender,recipient) where retired_at is null do nothing;
  get diagnostics inserted=row_count;total:=total+inserted;
 end loop;
 return total;
end $function$


;
CREATE OR REPLACE FUNCTION public.icash_decide_authority_review(p_reviewer uuid, p_request uuid, p_decision text, p_note text, p_verification jsonb DEFAULT '{}'::jsonb)
 RETURNS icash_authority_review_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.icash_authority_review_requests;s public.icash_screening_jobs;p jsonb;v jsonb:=p_verification;m public.icash_authority_market_reviews;
 dnc public.icash_dnc_verification_receipts;src public.icash_dnc_verification_sources;d public.icash_deal_files;e public.icash_signing_envelopes;
 expiry timestamptz;checked timestamptz;contact text;old_review uuid;amount bigint;sig jsonb;expected jsonb;n integer; sms_thread public.icash_text_threads;sms_rate public.icash_operation_rates;sms_price bigint;
begin
 if p_reviewer is null or not exists(select 1 from public.icash_trusted_operators where user_id=p_reviewer and scopes @> array['authority_review']::text[] and revoked_at is null and expires_at>now()) then raise exception 'Trusted operator required';end if;
 if p_note is null or length(trim(p_note)) not between 12 and 1000 or p_decision is null or p_decision not in ('approved','needs_information','declined','revoked') then raise exception 'Explicit decision and reason required';end if;

 select * into strict r from public.icash_authority_review_requests where id=p_request;
 if r.payload->>'channel'='sms' then
  perform 1 from public.icash_operating_budget where id=1 for update;
  perform pg_advisory_xact_lock(hashtextextended(r.payload->>'phone',74));
  perform 1 from public.icash_accounts where id=r.account_id for update;
 end if;
 select * into strict r from public.icash_authority_review_requests where id=p_request for update;
 if r.state=p_decision then
  if r.payload->>'channel'='sms' and (r.decision_note is distinct from p_note or (p_decision='approved' and r.verification-array['smsRateId','smsRateHash','smsPriceMicros'] is distinct from v)) then raise exception 'Conflicting SMS review retry';end if;
  return r;end if;
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
  select * into dnc from public.icash_dnc_verification_receipts where evidence_kind='legacy_record' and id=(v->>'dncReceiptId')::uuid and phone=p->>'phone' and contact_key=contact and clear and revoked_at is null and checked_at between now()-interval '30 days' and now() and expires_at>now() for share;
  if not found then raise exception 'External DNC verification required';end if;
  select * into src from public.icash_dnc_verification_sources where id=dnc.source_id and enabled and expires_at>now() for share;
  if not found then raise exception 'External DNC source unavailable';end if;
  expiry:=least(expiry,dnc.expires_at,dnc.checked_at+interval '30 days',src.expires_at);

  if p->>'channel'='sms' then
   if v->'smsConsentConfirmed' is distinct from 'true'::jsonb or not public.icash_authority_text(v,'smsPriorContactReference') or v->>'smsConsentBusiness' is distinct from p->>'sendingPrincipal'
    or not exists(select 1 from public.icash_customer_identities where account_id=r.account_id and principal=p->>'sendingPrincipal') then raise exception 'Actual sending-business SMS consent and prior-contact evidence required';end if;
   select * into d from public.icash_deal_files where id=(p->>'dealId')::uuid and account_id=r.account_id and screening_id=r.screening_id and terms->>'state'=p->>'stateCode' and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true' for share;
   if not found then raise exception 'Owned real SMS property binding changed';end if;
   perform 1 from public.icash_text_senders where phone=v->>'smsSender' and enabled for share;if not found then raise exception 'Configured SMS sender required';end if;
   select * into sms_rate from public.icash_operation_rates where operation='sms_send' and public.icash_sms_intake_rate_current(id) order by verified_at desc,id limit 1 for share;
   if not found then raise exception 'Current fully priced SMS rate required';end if;
   select customer_micros into sms_price from public.icash_communication_prices where operation='sms_segment' for share;
   expiry:=least(expiry,sms_rate.expires_at);
   select * into sms_thread from public.icash_text_threads where retired_at is null and account_id=r.account_id and deal_id=d.id and sender=v->>'smsSender' and recipient=p->>'phone' for update;
   if found and (sms_thread.account_id<>r.account_id or sms_thread.deal_id<>d.id or sms_thread.party is distinct from p->>'party' or sms_thread.sms_review_request_id is null) then raise exception 'SMS recipient binding conflict';end if;
   if sms_thread.sms_review_request_id is not null then perform public.icash_revoke_authority_review(sms_thread.sms_review_request_id,p_reviewer,'Superseded by a new explicit SMS review');end if;
   v:=v||jsonb_build_object('smsRateId',sms_rate.id,'smsRateHash',encode(sha256(convert_to(to_jsonb(sms_rate)::text,'UTF8')),'hex'),'smsPriceMicros',sms_price);
   insert into public.icash_text_threads(account_id,deal_id,sender,recipient,permission_until,permission_evidence,timezone,dnc_checked_at,dnc_clear,sms_rate_id,paused,party,ai_mode,sms_review_request_id,sms_intake_pending)
   values(r.account_id,d.id,v->>'smsSender',p->>'phone',expiry,v->>'consentReference',p->>'timezone',dnc.checked_at,true,sms_rate.id,true,p->>'party','auto',r.id,true)
   on conflict(account_id,deal_id,sender,recipient) where retired_at is null do update set permission_until=excluded.permission_until,permission_evidence=excluded.permission_evidence,timezone=excluded.timezone,dnc_checked_at=excluded.dnc_checked_at,dnc_clear=true,sms_rate_id=excluded.sms_rate_id,paused=true,sms_review_request_id=excluded.sms_review_request_id,sms_intake_pending=true;
  else
  if exists(select 1 from public.icash_contact_permissions where account_id=r.account_id and screening_id=r.screening_id and party=p->>'party' and contact_key=contact and revoked_at is not null) then raise exception 'Revoked contact needs separate opt-out resolution';end if;
  select review_request_id into old_review from public.icash_contact_permissions where account_id=r.account_id and screening_id=r.screening_id and party=p->>'party' and contact_key=contact;
  -- Do not clear a historical revocation. Replaced active evidence expires atomically.
  if old_review is not null then perform public.icash_revoke_authority_review(old_review,p_reviewer,'Superseded by a new explicit review');end if;
  insert into public.icash_contact_permissions(account_id,screening_id,party,phone,contact_key,timezone,local_start_hour,local_end_hour,permission_evidence,permission_until,dnc_checked_at,dnc_clear,buyer_id,review_request_id)
  values(r.account_id,r.screening_id,p->>'party',p->>'phone',contact,p->>'timezone',(p->>'localStartHour')::integer,(p->>'localEndHour')::integer,v->>'consentReference',expiry,dnc.checked_at,true,(p->>'buyerId')::uuid,r.id)
  on conflict(account_id,screening_id,party,contact_key) do update set timezone=excluded.timezone,local_start_hour=excluded.local_start_hour,local_end_hour=excluded.local_end_hour,permission_evidence=excluded.permission_evidence,permission_until=excluded.permission_until,dnc_checked_at=excluded.dnc_checked_at,dnc_clear=true,review_request_id=excluded.review_request_id,revoked_at=null,buyer_id=excluded.buyer_id;
 end if;
 elsif r.kind='offer_ceiling' then
  amount:=(p->>'maxCents')::bigint;
  if not public.icash_authority_text(v,'underwritingReference') or jsonb_typeof(v->'underwritingMaxCents') is distinct from 'number' or (v->>'underwritingMaxCents')::numeric<>trunc((v->>'underwritingMaxCents')::numeric) or (v->>'underwritingMaxCents')::numeric not between amount and 100000000000 or coalesce(s.result->>'preliminarySellerCeilingCents','0')::numeric<amount or s.result->'financialCheck'->>'status' is distinct from 'eligible' or (s.snapshot->>'fetchedAt')::timestamptz is null or (s.snapshot->>'fetchedAt')::timestamptz not between now()-interval '24 hours' and now() then raise exception 'Reviewed underwriting and fresh bounded offer required';end if;
  select review_request_id into old_review from public.icash_offer_authorities where account_id=r.account_id and screening_id=r.screening_id;
  if old_review is not null then perform public.icash_revoke_authority_review(old_review,p_reviewer,'Superseded by a new explicit review');end if;
  insert into public.icash_offer_authorities(account_id,screening_id,max_offer_cents,reviewed_evidence,expires_at,review_request_id) values(r.account_id,r.screening_id,amount,v->>'underwritingReference',expiry,r.id)
  on conflict(account_id,screening_id) do update set max_offer_cents=excluded.max_offer_cents,reviewed_evidence=excluded.reviewed_evidence,expires_at=excluded.expires_at,review_request_id=excluded.review_request_id;
 else
  select * into d from public.icash_deal_files where id=(p->>'dealId')::uuid and account_id=r.account_id and screening_id=r.screening_id and stage in ('under_contract','buyer_selected','title_open','closing') and seller_signed_at is not null for share;
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
end $function$

;
