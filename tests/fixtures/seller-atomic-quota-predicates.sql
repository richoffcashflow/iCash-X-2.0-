-- Exact relevant predicate source, verified read-only 2026-11-05 13:12 UTC.
-- No customer rows, credentials or provider calls. These bodies are deliberately
-- complete rather than always-true eligibility delegates. Native fixture tables
-- contain only synthetic rows; unrelated product triggers are outside its scope.

-- pg_get_functiondef MD5: 013e42ff7e2f776e01da5d37c4f2cb12
CREATE OR REPLACE FUNCTION public.icash_address_state(p_address text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 with states as (select key code,value name from jsonb_each_text('{"AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California","CO":"Colorado","CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia","HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas","KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland","MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi","MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey","NM":"New Mexico","NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma","OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota","TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington","WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming","DC":"District of Columbia"}'::jsonb))
 select code from states where trim(p_address) ~* ('[ ,]('||code||'|'||name||')([ ,]+[0-9]{5}(-[0-9]{4})?)?([ ,]+(USA|US|United States))?$') limit 1
$function$;

-- pg_get_functiondef MD5: 554669115ef58cb0da536bda361dcdca
CREATE OR REPLACE FUNCTION public.icash_membership_work_allowed(p_account uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.icash_accounts a where a.id=p_account and (a.billing_model<>'membership_credits' or exists(select 1 from public.icash_memberships m where m.account_id=a.id and m.mode='live' and m.state='active' and m.paid_through>now())))
$function$;

-- pg_get_functiondef MD5: 12dd466cf973063c1125b3b1e982da9b
CREATE OR REPLACE FUNCTION public.icash_credit_acquisition_allowed(p_account uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id
 join public.icash_spend_activations sa on sa.account_id=a.id and sa.enabled
 where a.id=p_account and not a.bot_paused and w.balance_cents>w.reserved_cents
 and public.icash_membership_work_allowed(a.id)
 and not exists(select 1 from public.icash_billing_reviews where account_id=a.id and resolved_at is null)
 and (a.billing_model in ('prepaid','membership_credits') or (a.billing_model='daily' and exists(select 1 from public.icash_daily_plans p where p.account_id=a.id and p.state='active' and p.mode='live' and (p.consent_version like 'daily-2026-10-04.1%' or p.consent_version like 'daily-2026-10-10.1%')))))
$function$;

-- pg_get_functiondef MD5: f0076129270df8c217300298d2dc8876
CREATE OR REPLACE FUNCTION public.icash_research_state_allowed(p_state text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce(upper(trim(p_state))=any(string_to_array('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC',' ')),false)
 and not exists(select 1 from public.icash_research_state_exclusions where state_code=upper(trim(p_state)) and effective_from<=current_date)
$function$;

-- pg_get_functiondef MD5: 9b02e2dcd1c28759e4c311e66f73360a
CREATE OR REPLACE FUNCTION public.icash_dealmachine_provider_available()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce((select blocked_until is null or blocked_until<=now() from icash_research_private.quota_feedback where id=1),false);
$function$;

-- pg_get_functiondef MD5: 0dbdeba9af4739a7c83d0d26adb60451
CREATE OR REPLACE FUNCTION public.icash_outreach_sms_current(p_account uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(
  select 1 from public.icash_accounts a
  join public.icash_customer_identities i on i.account_id=a.id
  where a.id=p_account and nullif(trim(i.principal),'') is not null
  and not exists(select 1 from public.icash_outreach_campaigns c
   where c.account_id=a.id and not c.enabled)
 );
$function$;

-- pg_get_functiondef MD5: bcb816fee48ebdf72e24d477120f4dbe
CREATE OR REPLACE FUNCTION public.icash_outreach_voice_current(p_account uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select public.icash_outreach_sms_current(p_account)
  and not exists(select 1 from public.icash_outreach_campaigns c
   where c.account_id=p_account and c.mode='sms_inbound');
$function$;

-- pg_get_functiondef MD5: 63bb29d5424c18912883e33fe9c86468
CREATE OR REPLACE FUNCTION public.icash_seller_evidence_before_meta(p_account uuid, p_screening uuid, p_lead uuid, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare l public.icash_seller_intakes;principal text;tz text;expiry timestamptz;binding jsonb;
begin
 select * into l from public.icash_seller_intakes where id=p_lead for share;
 if not found or l.phone is distinct from p_phone or not l.ai_consented or l.state<>'assigned'
  or (
   (l.consent_version='homeoffer-seller-contact-2026-10-05.4' and l.contact_consent_scope='homeoffer_network_and_matched_buyers'
    and l.consent_text='I agree to marketing calls, texts and emails about my property from HomeOffer Network and its matched buyers, including automated texts and AI-generated voice calls. Consent is not a condition of buying or selling. Message/data rates may apply. Reply STOP to texts or unsubscribe from emails.')
   or (l.consent_version='icash-x-demo-contact-2026-10-10.1' and l.contact_consent_scope='icash_x_demo'
    and l.consent_text='I agree to calls and texts from iCash X about this property demo, including automated texts and AI-generated voice calls. I have permission to use this number. Consent is not a condition of purchase. Message/data rates may apply. Reply STOP to end texts.' and l.attribution->>'demoAccountId'=p_account::text)
  ) is not true
  or l.consent_version is null or l.consent_text is null or l.contact_consent_scope is null
  or l.created_at>now() or l.created_at<=now()-interval '30 days' or l.data_rights_until is null or l.data_rights_until<=now() then return null;end if;
 perform 1 from public.icash_seller_matches where lead_id=p_lead and account_id=p_account and screening_id=p_screening for share;
 if not found then return null;end if;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=p_account for share;
 if nullif(trim(principal),'') is null then return null;end if;
 tz:=l.attribution->>'contactTimezone';
 if l.attribution->>'contactTimezoneSource' not in ('seller_browser','owner_test_context') or l.attribution->>'contactTimezoneSource' is null
  or not exists(select 1 from public.icash_timezone_names where name=tz)
  or exists(select 1 from public.icash_text_suppressions where phone=p_phone)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex')) then return null;end if;
 expiry:=least(l.created_at+interval '30 days',l.data_rights_until);
 binding:=jsonb_build_object('lead',l.id,'account',p_account,'screening',p_screening,'phone',l.phone,'principal',principal,'consentVersion',l.consent_version,'consentText',l.consent_text,'scope',l.contact_consent_scope,'receivedAt',l.created_at,'timezone',tz,'timezoneSource',l.attribution->>'contactTimezoneSource');
 return jsonb_build_object('timezone',tz,'until',expiry,'evidence','seller-intake:'||l.id||':'||encode(sha256(convert_to(binding::text,'UTF8')),'hex'));
end $function$;

-- pg_get_functiondef MD5: c9dc1a749cd9bb14a3b1096f5ddbd67c
CREATE OR REPLACE FUNCTION public.icash_meta_contact_receipt_current(p_source uuid, p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare src public.icash_meta_lead_sources;raw jsonb;phone text;receipt jsonb;
begin
 select * into src from public.icash_meta_lead_sources where id=p_source and enabled and reviewed_until>now();
 if not found or jsonb_typeof(p_payload->'consentResponses') is distinct from 'array' then return false;end if;
 if src.contact_basis='checkbox' then
  return (select count(*) from jsonb_array_elements(p_payload->'consentResponses') e where e->>'checkbox_key'=src.consent_key)=1
   and exists(select 1 from jsonb_array_elements(p_payload->'consentResponses') e where e->>'checkbox_key'=src.consent_key and e->'is_checked'='true'::jsonb);
 end if;
 select payload into raw from public.icash_make_lead_inbox where meta_id=p_payload->>'metaId'
  and page_id=src.page_id and form_id=src.form_id and not is_test and state in ('pending','fetching','accepted');
 if not found or p_payload->>'pageId' is distinct from src.page_id or p_payload->>'formId' is distinct from src.form_id
 or p_payload->>'submittedAt' is distinct from raw->>'created_time' then return false;end if;
 if (select count(*) from jsonb_array_elements(raw->'field_data') f where f->>'name'='full_name')<>1
 or (select count(*) from jsonb_array_elements(raw->'field_data') f where f->>'name'='phone_number')<>1
 or not exists(select 1 from jsonb_array_elements(raw->'field_data') f where f->>'name'='full_name' and f->'values'=jsonb_build_array(p_payload->>'name')) then return false;end if;
 select regexp_replace(f->'values'->>0,'[[:space:]().-]','','g') into phone
 from jsonb_array_elements(raw->'field_data') f where f->>'name'='phone_number' and jsonb_array_length(f->'values')=1;
 phone:=case when phone ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' then '+1'||phone when phone ~ '^1[2-9][0-9]{2}[2-9][0-9]{6}$' then '+'||phone else phone end;
 if phone is null or phone is distinct from p_payload->>'phone' then return false;end if;
 receipt:=jsonb_build_array(jsonb_build_object('kind','form_submission','provider','meta','metaId',p_payload->>'metaId','pageId',src.page_id,'formId',src.form_id,'submittedAt',raw->>'created_time'));
 return p_payload->'consentResponses'=receipt;
end $function$;

-- pg_get_functiondef MD5: 431c083aa309143a6741b0a14823f42f
CREATE OR REPLACE FUNCTION public.icash_meta_direct_contact_evidence(p_account uuid, p_screening uuid, p_lead uuid, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare m public.icash_meta_leads;l public.icash_seller_intakes;principal text;binding jsonb;
begin
 select * into m from public.icash_meta_leads where lead_id=p_lead and account_id=p_account and screening_id=p_screening for share;
 if not found then return public.icash_seller_evidence_before_meta(p_account,p_screening,p_lead,p_phone);end if;
 select * into l from public.icash_seller_intakes where id=p_lead for share;
 if m.paused or m.declined_at is not null or l.phone is distinct from p_phone or l.assigned_account is distinct from p_account
  or l.screening_id is distinct from p_screening or not l.ai_consented or l.contact_consent_scope is distinct from 'meta_direct_principal'
  or l.consent_version is distinct from m.consent_version or l.consent_text is distinct from m.consent_text
  or not public.icash_meta_contact_receipt_current(m.source_id,jsonb_build_object('metaId',m.meta_id,'pageId',m.page_id,'formId',m.form_id,'submittedAt',m.consent_receipt->0->>'submittedAt','name',l.name,'phone',l.phone,'consentResponses',m.consent_receipt))
  or m.submitted_at>now() or m.submitted_at<=now()-interval '30 days' or m.contact_until<=now()
  or not exists(select 1 from public.icash_meta_lead_sources where id=m.source_id and enabled and reviewed_until>now() and account_id=m.account_id and page_id=m.page_id and form_id=m.form_id and consent_text=m.consent_text and consent_version=m.consent_version and timezone=m.timezone and icash_meta_lead_sources.principal=(select i.principal from public.icash_customer_identities i where i.account_id=p_account))
  or exists(select 1 from public.icash_text_suppressions where phone=p_phone)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex'))
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=p_screening and state<>'resolved') then return null;end if;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=p_account;
 if nullif(trim(principal),'') is null then return null;end if;
 binding:=jsonb_build_object('lead',l.id,'account',p_account,'screening',p_screening,'phone',p_phone,'principal',principal,'metaLeadId',m.meta_id,'formId',m.form_id,'consent',m.consent_receipt,'consentVersion',m.consent_version,'consentText',m.consent_text,'submittedAt',m.submitted_at,'timezone',m.timezone);
 return jsonb_build_object('timezone',m.timezone,'until',m.contact_until,'evidence','meta-intake:'||l.id||':'||encode(sha256(convert_to(binding::text,'UTF8')),'hex'));
end $function$;

-- pg_get_functiondef MD5: 41bbcbfc263c80555799afdb1d8ab8cc
CREATE OR REPLACE FUNCTION public.icash_meta_pool_receipt_current(p_lead uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.icash_meta_leads m join public.icash_seller_intakes l on l.id=m.lead_id
 join public.icash_meta_lead_sources src on src.id=m.source_id
 where m.lead_id=p_lead and src.routing_mode='network_pool' and src.account_id is null and src.principal='HomeOffer Network'
 and src.enabled and src.reviewed_until>now() and src.page_id=m.page_id and src.form_id=m.form_id
 and src.consent_text=m.consent_text and src.consent_version=m.consent_version and src.timezone=m.timezone
 and l.ai_consented and l.contact_consent_scope='homeoffer_network_and_matched_buyers'
 and l.consent_text=m.consent_text and l.consent_version=m.consent_version and l.sharing_text=src.sharing_text
 and l.state<>'duplicate' and not m.paused and m.declined_at is null and m.contact_until>now() and l.data_rights_until>now()
 and m.submitted_at<=now() and m.submitted_at>now()-interval '30 days'
 and public.icash_meta_contact_receipt_current(src.id,jsonb_build_object('metaId',m.meta_id,'pageId',m.page_id,'formId',m.form_id,'submittedAt',m.consent_receipt->0->>'submittedAt','name',l.name,'phone',l.phone,'consentResponses',m.consent_receipt))
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=l.phone)
 and not exists(select 1 from public.icash_contact_suppressions s where s.contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex')));
$function$;

-- pg_get_functiondef MD5: 1b5e169962f1bd02a80f8d080489783f
CREATE OR REPLACE FUNCTION public.icash_seller_contact_evidence(p_account uuid, p_screening uuid, p_lead uuid, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare m public.icash_meta_leads;l public.icash_seller_intakes;principal text;binding jsonb;
begin
 select ml.* into m from public.icash_meta_leads ml join public.icash_meta_lead_sources src on src.id=ml.source_id where ml.lead_id=p_lead and src.routing_mode='network_pool';
 if not found then return public.icash_meta_direct_contact_evidence(p_account,p_screening,p_lead,p_phone);end if;
 select * into l from public.icash_seller_intakes where id=p_lead;
 if l.phone is distinct from p_phone or not public.icash_meta_pool_receipt_current(p_lead)
 or ((m.account_id=p_account and m.screening_id=p_screening and l.assigned_account=p_account and l.screening_id=p_screening)
  or exists(select 1 from public.icash_seller_matches sm where sm.lead_id=p_lead and sm.account_id=p_account and sm.screening_id=p_screening)) is not true
 or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=p_screening and state<>'resolved') then return null;end if;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=p_account;
 if nullif(trim(principal),'') is null then return null;end if;
 binding:=jsonb_build_object('lead',l.id,'account',p_account,'screening',p_screening,'phone',p_phone,'principal',principal,'metaLeadId',m.meta_id,'formId',m.form_id,'consent',m.consent_receipt,'consentVersion',m.consent_version,'consentText',m.consent_text,'scope',l.contact_consent_scope,'sharing',l.sharing_text,'submittedAt',m.submitted_at,'timezone',m.timezone);
 return jsonb_build_object('timezone',m.timezone,'until',m.contact_until,'evidence','meta-network:'||l.id||':'||encode(sha256(convert_to(binding::text,'UTF8')),'hex'));
end $function$;

-- pg_get_functiondef MD5: d6899f40347c03db881042f6a16841d1
CREATE OR REPLACE FUNCTION public.icash_seller_research_refresh_targets(p_lead uuid DEFAULT NULL::uuid)
 RETURNS TABLE(lead_id uuid, screening_id uuid, account_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select l.id,s.id,a.id from public.icash_seller_responses r
 join public.icash_seller_matches m on m.lead_id=r.lead_id and m.account_id=r.account_id and m.screening_id=r.screening_id
 join public.icash_seller_intakes l on l.id=r.lead_id
 join public.icash_screening_jobs s on s.id=r.screening_id and s.account_id=r.account_id
 join public.icash_accounts a on a.id=r.account_id
 join public.icash_wallets w on w.account_id=a.id
 join public.icash_deal_files d on d.screening_id=s.id and d.account_id=a.id
 where (p_lead is null or l.id=p_lead) and l.state='assigned' and l.ai_consented
 and l.contact_consent_scope is distinct from 'icash_x_demo'
 and l.data_rights_until>now() and l.checked_at>=now()-interval '8 days'
 and r.state in ('pending','needs_setup','queued') and m.assigned_at between now()-interval '24 hours' and now()
 and s.state='complete' and s.result->'financialCheck'->>'status'='eligible'
 and s.snapshot->>'propertyId'=l.property->>'id' and s.snapshot->'sellerRequest'->>'id'=l.id::text
 and (s.snapshot->>'fetchedAt')::timestamptz between now()-interval '8 days' and now()-interval '24 hours'
 and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true'
 and not a.bot_paused and w.balance_cents>0 and public.icash_membership_work_allowed(a.id)
 and (public.icash_outreach_sms_current(a.id) or public.icash_outreach_voice_current(a.id))
 and public.icash_seller_contact_evidence(a.id,s.id,l.id,l.phone) is not null
 and public.icash_research_state_allowed(public.icash_address_state(l.address))
 and not exists(select 1 from public.icash_billing_reviews b where b.account_id=a.id and b.resolved_at is null)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=a.id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
 and not exists(select 1 from public.icash_handoffs h where h.account_id=a.id and h.screening_id=s.id and h.state<>'resolved')
 and not exists(select 1 from public.icash_text_suppressions x where x.phone=l.phone)
 and not exists(select 1 from public.icash_contact_suppressions x where x.contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex'))
 and not exists(select 1 from public.icash_signing_envelopes e where e.account_id=a.id and e.deal_id=d.id and not e.test_mode)
 and not exists(select 1 from public.icash_text_threads t where t.account_id=a.id and t.deal_id=d.id and t.party='seller' and t.recipient=l.phone
  and (t.retired_at is not null or t.manual_only or t.ai_mode<>'auto' or t.paused))
 and not exists(select 1 from public.icash_text_threads t join public.icash_text_messages msg on msg.thread_id=t.id and msg.account_id=t.account_id
  where t.account_id=a.id and t.deal_id=d.id and t.party='seller' and t.recipient=l.phone
  and (msg.direction='incoming' or msg.state<>'ready' or msg.provider_id is not null
   or exists(select 1 from public.icash_operation_spend o where o.operation_key='text:'||msg.id)))
 and not exists(select 1 from public.icash_voice_jobs v join public.icash_contact_permissions p on p.id=v.permission_id and p.account_id=v.account_id
  where p.account_id=a.id and p.screening_id=s.id and (v.callback_id is not null or v.state not in ('ready','held')
   or (v.state='held' and v.outcome is distinct from 'fresh_screening_required')
   or v.operation_key is not null or v.provider_call_sid is not null or v.conversation_id is not null
   or exists(select 1 from public.icash_operation_spend o where o.operation_key='voice:'||v.id)))
 and not exists(select 1 from public.icash_call_recordings cr where cr.account_id=a.id and cr.screening_id=s.id)
 and not exists(select 1 from public.icash_live_conversations cv where cv.account_id=a.id and cv.screening_id=s.id);
$function$;

do $verify$ begin
 if md5(pg_get_functiondef('public.icash_address_state(text)'::regprocedure))<>'013e42ff7e2f776e01da5d37c4f2cb12' then raise exception 'Fixture predicate changed: icash_address_state';end if;
 if md5(pg_get_functiondef('public.icash_membership_work_allowed(uuid)'::regprocedure))<>'554669115ef58cb0da536bda361dcdca' then raise exception 'Fixture predicate changed: icash_membership_work_allowed';end if;
 if md5(pg_get_functiondef('public.icash_credit_acquisition_allowed(uuid)'::regprocedure))<>'12dd466cf973063c1125b3b1e982da9b' then raise exception 'Fixture predicate changed: icash_credit_acquisition_allowed';end if;
 if md5(pg_get_functiondef('public.icash_research_state_allowed(text)'::regprocedure))<>'f0076129270df8c217300298d2dc8876' then raise exception 'Fixture predicate changed: icash_research_state_allowed';end if;
 if md5(pg_get_functiondef('public.icash_dealmachine_provider_available()'::regprocedure))<>'9b02e2dcd1c28759e4c311e66f73360a' then raise exception 'Fixture predicate changed: icash_dealmachine_provider_available';end if;
 if md5(pg_get_functiondef('public.icash_outreach_sms_current(uuid)'::regprocedure))<>'0dbdeba9af4739a7c83d0d26adb60451' then raise exception 'Fixture predicate changed: icash_outreach_sms_current';end if;
 if md5(pg_get_functiondef('public.icash_outreach_voice_current(uuid)'::regprocedure))<>'bcb816fee48ebdf72e24d477120f4dbe' then raise exception 'Fixture predicate changed: icash_outreach_voice_current';end if;
 if md5(pg_get_functiondef('public.icash_seller_evidence_before_meta(uuid,uuid,uuid,text)'::regprocedure))<>'63bb29d5424c18912883e33fe9c86468' then raise exception 'Fixture predicate changed: icash_seller_evidence_before_meta';end if;
 if md5(pg_get_functiondef('public.icash_meta_contact_receipt_current(uuid,jsonb)'::regprocedure))<>'c9dc1a749cd9bb14a3b1096f5ddbd67c' then raise exception 'Fixture predicate changed: icash_meta_contact_receipt_current';end if;
 if md5(pg_get_functiondef('public.icash_meta_direct_contact_evidence(uuid,uuid,uuid,text)'::regprocedure))<>'431c083aa309143a6741b0a14823f42f' then raise exception 'Fixture predicate changed: icash_meta_direct_contact_evidence';end if;
 if md5(pg_get_functiondef('public.icash_meta_pool_receipt_current(uuid)'::regprocedure))<>'41bbcbfc263c80555799afdb1d8ab8cc' then raise exception 'Fixture predicate changed: icash_meta_pool_receipt_current';end if;
 if md5(pg_get_functiondef('public.icash_seller_contact_evidence(uuid,uuid,uuid,text)'::regprocedure))<>'1b5e169962f1bd02a80f8d080489783f' then raise exception 'Fixture predicate changed: icash_seller_contact_evidence';end if;
 if md5(pg_get_functiondef('public.icash_seller_research_refresh_targets(uuid)'::regprocedure))<>'d6899f40347c03db881042f6a16841d1' then raise exception 'Fixture predicate changed: icash_seller_research_refresh_targets';end if;
end $verify$;
