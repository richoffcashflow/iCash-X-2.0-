-- Exact read-only production predecessor capture, 2026-11-16 23:54:12Z. No customer data.

CREATE OR REPLACE FUNCTION public.icash_claim_title_request_before_snapshot(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_title_requests;d public.icash_deal_files;prop text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_title_requests where id=p_id for update;
 if not found or j.state<>'ready' or j.verified_until<=now() then return false;end if;
 perform 1 from public.icash_accounts where id=j.account_id and not bot_paused for update;if not found then return false;end if;
 select * into d from public.icash_deal_files where id=j.deal_id and account_id=j.account_id for share;
 if d.stage not in ('under_contract','buyer_selected','title_open','closing') or not public.icash_title_contact_matches(j.account_id,j.deal_id,j.recipient) then return false;end if;
 if not exists(select 1 from public.icash_title_contacts where deal_id=d.id and account_id=j.account_id and email=j.recipient and rate_id=j.rate_id and enabled and verified_until>now()) then return false;end if;
 if not exists(select 1 from public.icash_signing_envelopes where id=j.purchase_envelope_id and account_id=j.account_id and deal_id=j.deal_id and state='completed' and not test_mode) then return false;end if;
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=d.screening_id and account_id=j.account_id;
 if prop is null or exists(select 1 from public.icash_property_controls where account_id=j.account_id and property_id=prop and manual) then return false;end if;
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id where o.operation_key='title:'||j.id and o.account_id=j.account_id and o.rate_id=j.rate_id and r.operation='title_email') then return false;end if;
 if not public.icash_claim_operation('title:'||j.id) then return false;end if;
 update public.icash_title_requests set state='dispatching',updated_at=now() where id=j.id;
 return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_claim_title_request_snapshot(p_id uuid, p_expected jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_title_requests;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_title_requests where id=p_id for update;
 if not found or j.state<>'ready' or j.provider_id is not null or jsonb_typeof(p_expected) is distinct from 'object'
  or j.account_id::text is distinct from p_expected->>'accountId'
  or j.deal_id::text is distinct from p_expected->>'dealId'
  or j.purchase_envelope_id::text is distinct from p_expected->>'purchaseEnvelopeId'
  or j.recipient is distinct from p_expected->>'recipient'
  or j.property_address is distinct from p_expected->>'propertyAddress'
  or j.rate_id::text is distinct from p_expected->>'rateId'
  or j.verified_until is distinct from (p_expected->>'verifiedUntil')::timestamptz then return false;end if;
 -- Reservation and the snapshot comparison are atomic: a stale worker must not
 -- leave an old rate/permission reservation behind after the draft was corrected.
 perform public.icash_reserve_operation(j.account_id,'title:'||j.id,j.rate_id,j.verified_until);
 return public.icash_claim_title_request_before_snapshot(j.id);
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_save_closing_setup_before_profile(p_account uuid, p_actor uuid, p_deal uuid, p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d public.icash_deal_files;s public.icash_closing_setup;rate uuid;mail text;prop text;label text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor for update;
 if not found then raise exception 'Owner required';end if;
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if not found or d.stage not in ('under_contract','buyer_selected','title_open','closing','closed') or not exists(
  select 1 from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='purchase' and state='completed' and not test_mode
 ) then raise exception 'Signed live purchase required';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>4096 then raise exception 'Invalid details';end if;
 insert into public.icash_closing_setup(account_id,deal_id,screening_id) values(p_account,p_deal,d.screening_id) on conflict(deal_id) do nothing;
 select * into strict s from public.icash_closing_setup where deal_id=p_deal and account_id=p_account for update;
 if p_action='payout' then
  if exists(select 1 from public.icash_closing_updates where account_id=p_account and deal_id=p_deal and kind='funds_disbursed') then raise exception 'Payment already reported; contact closer';end if;
  if p_data-array['payeeName','payeeType','method','mailingAddress','detailsSharedWithTitle']<>'{}'::jsonb
   or not (p_data ?& array['payeeName','payeeType','method','mailingAddress','detailsSharedWithTitle'])
   or jsonb_typeof(p_data->'payeeName')<>'string' or length(btrim(p_data->>'payeeName')) not between 2 and 200
   or p_data->>'payeeName' ~ E'[\r\n]' or p_data->>'payeeType' not in ('individual','company')
   or p_data->>'method' not in ('check_pickup','check_mail','wire')
   or jsonb_typeof(p_data->'mailingAddress')<>'string' or length(p_data->>'mailingAddress')>500
   or jsonb_typeof(p_data->'detailsSharedWithTitle')<>'boolean'
   or (p_data->>'method'='check_mail' and length(btrim(p_data->>'mailingAddress'))<10)
   or (p_data->>'method'<>'check_mail' and p_data->>'mailingAddress'<>'')
   or concat_ws(' ',p_data->>'payeeName',p_data->>'mailingAddress') ~* '(\m(routing|account|ssn|social security|tax id)\s*(number|#|:)|\m[0-9]{9,}\M)'
  then raise exception 'Payee and delivery preference only; no banking or tax details';end if;
  update public.icash_closing_setup set payout=p_data,updated_at=now() where id=s.id;
 elsif p_action='title_preference' then
  if p_data-array['company','closer','email','phone']<>'{}'::jsonb or not(p_data ?& array['company','closer','email','phone'])
   or jsonb_typeof(p_data->'company')<>'string' or length(btrim(p_data->>'company')) not between 2 and 200
   or jsonb_typeof(p_data->'closer')<>'string' or length(p_data->>'closer')>200
   or jsonb_typeof(p_data->'email')<>'string' or length(p_data->>'email')>254
   or (p_data->>'email'<>'' and p_data->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
   or jsonb_typeof(p_data->'phone')<>'string' or (p_data->>'phone'<>'' and p_data->>'phone' !~ '^\+[1-9][0-9]{7,14}$')
   or concat_ws('',p_data->>'company',p_data->>'closer') ~ E'[\r\n]'
  then raise exception 'Invalid title preference';end if;
  if p_data is distinct from s.title_proposal then
   if exists(select 1 from public.icash_title_requests j where j.account_id=p_account and j.deal_id=p_deal
    and (j.state<>'ready' or j.provider_id is not null or exists(select 1 from public.icash_operation_spend o where o.operation_key='title:'||j.id)))
   then raise exception 'Title delivery has been reserved or attempted. Request human review before changing the closer.';end if;
   update public.icash_title_contacts set enabled=false where account_id=p_account and deal_id=p_deal;
   update public.icash_closing_setup set title_proposal=p_data,payout=case when payout is null then null else payout||jsonb_build_object('detailsSharedWithTitle',false) end,state='needs_review',updated_at=now() where id=s.id;
  end if;
 elsif p_action='confirm_title' then
  if p_data-array['revision','independentContact','assignmentsAndCoverage','agreedByParties']<>'{}'::jsonb
   or p_data->'independentContact' is distinct from 'true'::jsonb or p_data->'assignmentsAndCoverage' is distinct from 'true'::jsonb
   or p_data->'agreedByParties' is distinct from 'true'::jsonb or (p_data->>'revision')::timestamptz is distinct from s.updated_at
   or s.title_proposal is null or length(s.title_proposal->>'closer')<2 or length(s.title_proposal->>'phone')<9
   or coalesce(s.title_proposal->>'email','')='' or d.stage='closed'
  then raise exception 'Complete contact details and current verification required';end if;
  mail:=lower(s.title_proposal->>'email');
  if nullif(btrim(d.terms->>'titleEmail'),'') is not null and lower(d.terms->>'titleEmail')<>mail then raise exception 'Changing the agreed closer needs human review';end if;
  if exists(select 1 from public.icash_title_requests j where j.deal_id=p_deal and j.account_id=p_account
    and ((lower(j.recipient)<>mail and (j.state<>'ready' or j.provider_id is not null))
     or (j.state='ready' and exists(select 1 from public.icash_operation_spend o where o.operation_key='title:'||j.id))))
   then raise exception 'Title delivery has been reserved or attempted. Request human review before changing the closer.';end if;
  select id into rate from public.icash_operation_rates where operation='title_email' and enabled and expires_at>now() order by verified_at desc limit 1;
  if rate is null then raise exception 'Current title delivery rate required';end if;
  insert into public.icash_title_contacts(deal_id,account_id,email,verified_until,evidence_ref,rate_id,enabled)
  values(p_deal,p_account,mail,now()+interval '30 days','owner-closing-verification:'||p_actor||':'||(s.title_proposal->>'phone'),rate,true)
  on conflict(deal_id) do update set email=excluded.email,verified_until=excluded.verified_until,evidence_ref=excluded.evidence_ref,rate_id=excluded.rate_id,enabled=true
  where icash_title_contacts.account_id=p_account;
  if exists(select 1 from public.icash_title_requests j where j.account_id=p_account and j.deal_id=p_deal and j.state='ready' and j.provider_id is null
   and not exists(select 1 from public.icash_operation_spend o where o.operation_key='title:'||j.id)) then
   perform public.icash_prepare_title_request(p_account,p_deal);
  end if;
  update public.icash_closing_setup set updated_at=now() where id=s.id;
 elsif p_action='takeover' then
  if p_data-array['reason']<>'{}'::jsonb or coalesce(p_data->>'reason','') not in ('human_requested','title_declined','payment_change','title_issue') then raise exception 'Choose a review reason';end if;
  perform public.icash_set_work_control(p_actor,p_account,'takeover',d.screening_id);
  update public.icash_closing_setup set state='acknowledged',review_reason=p_data->>'reason',updated_at=now() where id=s.id;
 else raise exception 'Unknown closing action';end if;
 -- Prepared preferences are not acceptance, funding or completed closing.
 update public.icash_closing_setup x set state=case when x.payout->'detailsSharedWithTitle'='true'::jsonb
  and exists(select 1 from public.icash_title_contacts c where c.account_id=p_account and c.deal_id=p_deal and c.enabled and c.verified_until>now() and public.icash_title_contact_matches(p_account,p_deal,c.email))
  then 'ready' else 'needs_review' end where x.id=s.id and x.review_reason='setup';
 select * into s from public.icash_closing_setup where id=s.id;
 return jsonb_build_object('state',s.state,'action',p_action,'sent',false);
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_signing_action_allowed(p_account uuid, p_envelope uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.icash_signing_envelopes e join public.icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id
  where e.id=p_envelope and e.account_id=p_account and e.state not in ('cancellation_pending','cancelled') and d.stage not in ('cancellation_pending','cancelled','closed')
  and not exists(select 1 from public.icash_agreement_cancellations c where c.deal_id=d.id and c.late_activity));
$function$
;
