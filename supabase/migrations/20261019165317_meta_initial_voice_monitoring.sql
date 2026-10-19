begin;
set local lock_timeout='5s';

-- Contact-only Meta leads have no complete screening/seller response yet.
-- Observe only their current original first call. Reuse the existing issue kind
-- so this database change does not require a coordinated application rollout.
-- This adds no queue, retry, provider dispatch, approval or billing mutation.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_undispatched_outreach_findings()'::regprocedure);
 needle:=$old$ union all
 select 'buyer_fulfillment',j.id,j.account_id,j.updated_at$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
  then raise exception 'Meta initial voice monitoring prerequisite changed';end if;
 execute replace(definition,needle,$new$ union all
 select 'seller_response',m.screening_id,m.account_id,j.created_at
 from public.icash_meta_leads m join running a on a.id=m.account_id
 join public.icash_seller_intakes l on l.id=m.lead_id
 join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id and s.state='awaiting_address'
 join public.icash_deal_files d on d.screening_id=m.screening_id and d.account_id=m.account_id and d.stage='draft'
 join public.icash_voice_jobs j on j.id=m.voice_job_id and j.account_id=m.account_id
 join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=m.account_id
  and p.screening_id=m.screening_id and p.seller_intake_id=m.lead_id and p.phone=l.phone
 join public.icash_meta_lead_sources src on src.id=m.source_id
 join public.icash_customer_identities i on i.account_id=m.account_id
 where j.created_at<now()-interval '5 minutes' and j.due_at<=now()
  and j.state in ('ready','issued','dispatching','dispatched','held')
  and j.callback_id is null and j.sms_source_message_id is null and j.cancellation_notice_id is null
  and j.operational_contact_id is null and j.meta_offer_lead_id is null
  and j.meta_retry_of is null and j.meta_followup_lead_id is null
  and not public.icash_voice_attempt_recorded(j.id)
  and not m.paused and not m.voice_paused and m.declined_at is null
  and m.response_at is null and m.address_confirmed_at is null
  and l.state='awaiting_address' and l.address is null and l.canonical_id is null
  and l.assigned_account=m.account_id and l.screening_id=m.screening_id and l.ai_consented
  and coalesce(d.terms->>'practice','false')<>'true' and coalesce(d.terms->>'testHold','false')<>'true'
  and public.icash_outreach_voice_current(m.account_id) and nullif(trim(i.principal),'') is not null
  and not public.icash_meta_is_test_contact(m.source_id,l.name)
  and not exists(select 1 from public.icash_property_controls pc where pc.account_id=m.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
  and not exists(select 1 from public.icash_handoffs h where h.account_id=m.account_id and h.screening_id=m.screening_id and h.state<>'resolved')
  and not exists(select 1 from public.icash_text_suppressions x where x.phone=l.phone)
  and not exists(select 1 from public.icash_contact_suppressions x where x.contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex'))
  and not exists(select 1 from public.icash_text_threads t where t.account_id=m.account_id and t.deal_id=d.id and t.party='seller' and t.recipient=l.phone and t.retired_at is null
   and (t.manual_only or t.ai_mode<>'auto' or (t.paused and not t.sms_intake_pending)))
  and not exists(select 1 from public.icash_text_threads t join public.icash_text_messages msg on msg.thread_id=t.id and msg.account_id=t.account_id
   where t.account_id=m.account_id and t.seller_intake_id=m.lead_id and msg.direction='incoming' and msg.state='received')
  -- Match seller_voice_permission_current without its SELECT FOR SHARE locks.
  -- The source receipt predicates below are STABLE, read-only validators.
  and p.party='seller' and p.revoked_at is null and p.permission_until>now()
  and not p.dnc_clear and p.dnc_checked_at is null and p.review_request_id is null and p.buyer_id is null
  and p.contact_key=encode(sha256(convert_to(p.phone,'UTF8')),'hex')
  and p.timezone=m.timezone and p.permission_until=m.contact_until and p.local_start_hour=9 and p.local_end_hour=20
  and src.enabled and src.reviewed_until>now() and src.page_id=m.page_id and src.form_id=m.form_id
  and src.consent_text=m.consent_text and src.consent_version=m.consent_version and src.timezone=m.timezone
  and l.consent_text=m.consent_text and l.consent_version=m.consent_version
  and m.submitted_at<=now() and m.submitted_at>now()-interval '30 days' and m.contact_until>now()
  and ((src.routing_mode='network_pool' and public.icash_meta_pool_receipt_current(m.lead_id))
   or (src.routing_mode='direct' and src.account_id=m.account_id and src.principal=i.principal
    and l.contact_consent_scope='meta_direct_principal'
    and public.icash_meta_contact_receipt_current(src.id,jsonb_build_object('metaId',m.meta_id,'pageId',m.page_id,'formId',m.form_id,
     'submittedAt',m.consent_receipt->0->>'submittedAt','name',l.name,'phone',l.phone,'consentResponses',m.consent_receipt))))
  and p.permission_evidence=(case src.routing_mode when 'network_pool' then 'meta-network:' else 'meta-intake:' end)||l.id||':'||
   encode(sha256(convert_to((jsonb_build_object('lead',l.id,'account',m.account_id,'screening',m.screening_id,'phone',l.phone,'principal',i.principal,
    'metaLeadId',m.meta_id,'formId',m.form_id,'consent',m.consent_receipt,'consentVersion',m.consent_version,'consentText',m.consent_text,
    'submittedAt',m.submitted_at,'timezone',m.timezone)
    ||case src.routing_mode when 'network_pool' then jsonb_build_object('scope',l.contact_consent_scope,'sharing',l.sharing_text) else '{}'::jsonb end)::text,'UTF8')),'hex')
 union all
 select 'buyer_fulfillment',j.id,j.account_id,j.updated_at$new$);
end $patch$;
-- CREATE OR REPLACE preserves the existing STABLE/INVOKER definition and ACLs.
commit;
