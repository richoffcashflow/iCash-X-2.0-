CREATE OR REPLACE FUNCTION public.icash_claim_title_update(p_account uuid, p_task uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_title_tasks;j public.icash_title_requests;d public.icash_deal_files;c public.icash_title_contacts;prop text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into t from public.icash_title_tasks where id=p_task and account_id=p_account for update;
 if not found or t.kind<>'document_update' or t.state<>'scheduled' or t.email_state<>'issued' or t.payload is distinct from p_payload then return null;end if;
 if not exists(select 1 from public.icash_title_followup_settings where id=1 and enabled) then return null;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;if not found then return null;end if;
 select * into j from public.icash_title_requests where id=t.request_id and account_id=p_account and deal_id=t.deal_id for share;
 if not found or j.state<>'sent' then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account for share;
 if not found or d.stage not in ('under_contract','buyer_selected','title_open','closing') or not public.icash_title_contact_matches(p_account,d.id,j.recipient) then return null;end if;
 select * into c from public.icash_title_contacts where account_id=p_account and deal_id=d.id and email=j.recipient and enabled and verified_until>now() for share;
 if not found then return null;end if;
 if not exists(select 1 from public.icash_signing_envelopes where id=j.purchase_envelope_id and account_id=p_account and deal_id=d.id and kind='purchase' and state='completed' and not test_mode)
 or not public.icash_signing_action_allowed(p_account,j.purchase_envelope_id) then return null;end if;
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=d.screening_id and account_id=p_account;
 if prop is null or exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=prop and manual) then return null;end if;
 if t.payload->>'type'='assignment' then
  if (select count(*) from public.icash_signing_envelopes where account_id=p_account and deal_id=d.id and kind='assignment' and state='completed' and not test_mode)<>1
  or not exists(select 1 from public.icash_signing_envelopes where id=(t.payload->>'envelopeId')::uuid and account_id=p_account and deal_id=d.id and kind='assignment' and state='completed' and not test_mode)
  or not public.icash_signing_action_allowed(p_account,(t.payload->>'envelopeId')::uuid) then return null;end if;
 elsif t.payload->>'type'='payout' then
  if not exists(select 1 from public.icash_closing_setup where account_id=p_account and deal_id=d.id and payout-'detailsSharedWithTitle'=t.payload->'payout') then return null;end if;
 else return null;end if;
 if not exists(select 1 from public.icash_operation_rates where id=c.rate_id and operation='title_email' and enabled and expires_at>now()) then return null;end if;
 perform public.icash_reserve_operation(p_account,'title-followup:'||t.id,c.rate_id,c.verified_until);
 if not public.icash_claim_operation('title-followup:'||t.id) then raise exception 'Update operation already claimed';end if;
 update public.icash_title_tasks set email_state='dispatching',updated_at=now() where id=t.id;
 return jsonb_build_object('requestId',j.id,'recipient',j.recipient,'address',j.property_address);
end $function$;

CREATE OR REPLACE FUNCTION public.icash_record_title_reply(p_email uuid, p_kind text, p_reference uuid, p_sender text, p_subject text, p_text text, p_authenticated boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a uuid;d uuid;r uuid;q uuid;expected text;verified boolean:=false;
begin
 if p_kind='T' then
 select account_id,deal_id,id,recipient into a,d,r,expected from public.icash_title_requests where id=p_reference and state in ('dispatching','sent','needs_review');
 elsif p_kind='Q' then
 select j.account_id,j.id,c.public_email into a,q,expected from public.icash_title_qualification_jobs j join public.icash_title_directory c on c.id=j.company_id where j.id=p_reference and j.state in ('dispatching','sent','needs_review');
 end if;
 verified:=coalesce(p_authenticated and lower(expected)=lower(p_sender),false);
 -- Unverified mail is quarantined to operations, never exposed across tenants.
 if not verified then a:=null;d:=null;r:=null;q:=null;end if;
 insert into public.icash_title_replies(provider_email_id,account_id,deal_id,request_id,qualification_id,sender,subject,body_text,sender_verified)
 values(p_email,a,d,r,q,left(p_sender,320),left(p_subject,500),left(p_text,20000),verified) on conflict(provider_email_id) do nothing;
 -- Email text alone never approves a partner or changes a deal's financial or closing status.
end $function$;

CREATE OR REPLACE FUNCTION public.icash_signing_action_allowed(p_account uuid, p_envelope uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.icash_signing_envelopes e join public.icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id
  where e.id=p_envelope and e.account_id=p_account and e.state not in ('cancellation_pending','cancelled') and d.stage not in ('cancellation_pending','cancelled','closed')
  and not exists(select 1 from public.icash_agreement_cancellations c where c.deal_id=d.id and c.late_activity));
$function$;

CREATE OR REPLACE FUNCTION public.icash_title_contact_matches(p_account uuid, p_deal uuid, p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.icash_deal_files d where d.id=p_deal and d.account_id=p_account
  and (lower(nullif(btrim(d.terms->>'titleEmail'),''))=lower(p_email)
   or (nullif(btrim(d.terms->>'titleEmail'),'') is null and exists(
    select 1 from public.icash_title_contacts c where c.account_id=p_account and c.deal_id=p_deal
     and lower(c.email)=lower(p_email) and c.enabled and c.verified_until>now()
     and c.evidence_ref like 'owner-closing-verification:%'))));
$function$;
