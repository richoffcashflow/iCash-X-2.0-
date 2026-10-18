begin;
set local lock_timeout='3s';
-- Contact-only records have no invented property, valuation, DNC result, or
-- owner identity. A reviewed Meta form is bound to its actual buying principal.
create table public.icash_meta_lead_sources(
 id uuid primary key default gen_random_uuid(),page_id text not null check(page_id ~ '^[0-9]{5,40}$'),
 form_id text not null unique check(form_id ~ '^[0-9]{5,40}$'),account_id uuid not null references public.icash_accounts(id),
 slug text not null unique check(slug ~ '^[a-z0-9_-]{3,80}$'),enabled boolean not null default false,
 principal text not null check(length(principal) between 1 and 200),
 consent_key text not null,call_now_key text,call_now_text text,consent_text text not null check(length(consent_text) between 40 and 2000),
 consent_version text not null,timezone text not null references public.icash_timezone_names(name),
 review_ref text not null check(length(review_ref) between 20 and 1000),reviewed_until timestamptz not null,
 created_at timestamptz not null default now(),check(call_now_key is null or call_now_text='Call me now about this property, including outside normal calling hours.')
);
alter table public.icash_seller_intakes alter column address drop not null;
alter table public.icash_seller_intakes drop constraint icash_seller_intakes_state_check;
alter table public.icash_seller_intakes add constraint icash_seller_intakes_state_check check(state in ('awaiting_address','received','duplicate','checking','review','unmatched','numbers_review','market_review','qualified','assigned'));
alter table public.icash_seller_intakes add constraint icash_seller_address_required check(address is not null or state in ('awaiting_address','duplicate','review'));
alter table public.icash_seller_intakes drop constraint icash_seller_intakes_contact_consent_scope_check;
alter table public.icash_seller_intakes add constraint icash_seller_intakes_contact_consent_scope_check check(contact_consent_scope is null or contact_consent_scope in ('homeoffer_network_and_matched_buyers','icash_x_demo','meta_direct_principal'));
alter table public.icash_screening_jobs drop constraint icash_screening_jobs_state_check;
alter table public.icash_screening_jobs add constraint icash_screening_jobs_state_check check(state in ('awaiting_address','queued','running','complete','failed','archived'));
create table public.icash_meta_leads(
 lead_id uuid primary key references public.icash_seller_intakes(id),source_id uuid not null references public.icash_meta_lead_sources(id),
 account_id uuid not null references public.icash_accounts(id),screening_id uuid not null unique references public.icash_screening_jobs(id),
 meta_id text not null unique check(meta_id ~ '^[0-9]{5,40}$'),submitted_at timestamptz not null,
 page_id text not null,form_id text not null,ad_id text,adset_id text,campaign_id text,
 consent_receipt jsonb not null,consent_text text not null,consent_version text not null,timezone text not null,
 call_now boolean not null default false,contact_until timestamptz not null,link_hash text not null unique check(link_hash ~ '^[a-f0-9]{64}$'),link_expires_at timestamptz not null,
 first_outreach_at timestamptz,response_at timestamptz,response_channel text,address_confirmed_at timestamptz,address_channel text,
 voice_paused boolean not null default false,offer_ready_at timestamptz,declined_at timestamptz,paused boolean not null default false,
 next_attempt_at timestamptz not null default now(),voice_job_id uuid references public.icash_voice_jobs(id),
 created_at timestamptz not null default now(),check(response_channel is null or response_channel in ('sms','call','form')),
 check(address_channel is null or address_channel in ('sms','call','form'))
);
create index icash_meta_leads_account_pending on public.icash_meta_leads(account_id,created_at desc) where offer_ready_at is null;
create index icash_meta_leads_work on public.icash_meta_leads(next_attempt_at) where not paused;
create table public.icash_meta_lead_receipts(
 meta_id text primary key,lead_id uuid not null references public.icash_meta_leads(lead_id),source_id uuid not null references public.icash_meta_lead_sources(id),
 ad_id text,campaign_id text,submitted_at timestamptz not null,received_at timestamptz not null default now()
);
create table public.icash_meta_lead_messages(
 message_id uuid primary key references public.icash_text_messages(id),lead_id uuid not null references public.icash_meta_leads(lead_id),
 purpose text not null check(purpose in ('initial','address_link','reply','offer_ready')),evidence_key text not null,
 unique(lead_id,purpose,evidence_key)
);
alter table public.icash_meta_lead_sources enable row level security;
alter table public.icash_meta_leads enable row level security;
alter table public.icash_meta_lead_receipts enable row level security;
alter table public.icash_meta_lead_messages enable row level security;
revoke all on public.icash_meta_lead_sources,public.icash_meta_leads,public.icash_meta_lead_receipts,public.icash_meta_lead_messages from public,anon,authenticated;
grant all on public.icash_meta_lead_sources,public.icash_meta_leads,public.icash_meta_lead_receipts,public.icash_meta_lead_messages to service_role;

create function public.icash_meta_accept_lead(p_source uuid,p_payload jsonb,p_link_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare src public.icash_meta_lead_sources;l public.icash_seller_intakes;m public.icash_meta_leads;
 lead uuid:=gen_random_uuid();screen uuid;submitted timestamptz;principal text;lead_phone text;meta text;
begin
 select * into src from public.icash_meta_lead_sources where id=p_source and enabled and reviewed_until>now() for share;
 if not found then raise exception 'Reviewed Meta form required';end if;
 meta:=p_payload->>'metaId';lead_phone:=p_payload->>'phone';submitted:=(p_payload->>'submittedAt')::timestamptz;
 if meta !~ '^[0-9]{5,40}$' or lead_phone !~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$' or submitted>now()+interval '1 minute' or submitted<now()-interval '30 days'
  or p_payload->>'pageId' is distinct from src.page_id or p_payload->>'formId' is distinct from src.form_id
  or p_link_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_payload->'consentResponses') is distinct from 'array'
  or not exists(select 1 from jsonb_array_elements(p_payload->'consentResponses') e where e->>'checkbox_key'=src.consent_key and e->'is_checked'='true'::jsonb)
  then raise exception 'Verified Meta receipt required';end if;
 perform pg_advisory_xact_lock(hashtextextended('meta-lead:'||lead_phone,0));
 select ml.* into m from public.icash_meta_lead_receipts receipt join public.icash_meta_leads ml on ml.lead_id=receipt.lead_id where receipt.meta_id=meta;
 if found then return jsonb_build_object('leadId',m.lead_id,'accountId',m.account_id,'duplicate',true);end if;
 -- Repeated opt-ins keep one conversation and the original attribution. The
 -- duplicate receipt remains auditable, but never refreshes consent or timing.
 select ml.* into m from public.icash_meta_leads ml join public.icash_seller_intakes i on i.id=ml.lead_id
 where ml.account_id=src.account_id and i.phone=lead_phone and ml.submitted_at>now()-interval '30 days'
 order by ml.created_at desc limit 1;
 if found then
  insert into public.icash_meta_lead_receipts(meta_id,lead_id,source_id,ad_id,campaign_id,submitted_at) values(meta,m.lead_id,src.id,p_payload->>'adId',p_payload->>'campaignId',submitted);
  return jsonb_build_object('leadId',m.lead_id,'accountId',m.account_id,'duplicate',true);
 end if;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=src.account_id;
 if nullif(trim(principal),'') is null or principal is distinct from src.principal then raise exception 'Reviewed buying principal required';end if;
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state)
 values(src.account_id,'meta-lead:'||meta,jsonb_build_object('contactOnly',true,'sellerRequest',jsonb_build_object('id',lead,'ownerName',p_payload->>'name','phone',lead_phone,'aiConsented',true,'consentScope','meta_direct_principal')),'awaiting_address') returning id into screen;
 insert into public.icash_seller_intakes(id,request_id,guest_hash,duplicate_key,agent_hash,name,address,phone,ai_consented,consent_version,consent_text,sharing_text,attribution,state,contact_consent_scope,data_rights_until,assigned_account,screening_id,created_at)
 values(lead,gen_random_uuid(),encode(sha256(convert_to('meta:'||meta,'UTF8')),'hex'),encode(sha256(convert_to('meta:'||src.account_id||':'||lead_phone,'UTF8')),'hex'),encode(sha256(convert_to('meta-webhook:'||src.id,'UTF8')),'hex'),p_payload->>'name',null,lead_phone,true,src.consent_version,src.consent_text,'Direct request to the buying principal named on the Meta form.',
 jsonb_build_object('source','meta','channel','instant_form','campaign',p_payload->>'campaignId','adId',p_payload->>'adId','adsetId',p_payload->>'adsetId','formId',src.form_id,'pageId',src.page_id,'metaLeadId',meta,'contactTimezone',src.timezone,'contactTimezoneSource','reviewed_meta_form'),
 'awaiting_address','meta_direct_principal',least(submitted+interval '30 days',src.reviewed_until),src.account_id,screen,submitted);
 insert into public.icash_deal_files(account_id,screening_id,terms) values(src.account_id,screen,jsonb_build_object('buyer',principal,'seller','','priceCents',null,'priceSource','proposed','intakeOnly',true));
 insert into public.icash_meta_leads(lead_id,source_id,account_id,screening_id,meta_id,submitted_at,page_id,form_id,ad_id,adset_id,campaign_id,consent_receipt,consent_text,consent_version,timezone,call_now,contact_until,link_hash,link_expires_at)
 values(lead,src.id,src.account_id,screen,meta,submitted,src.page_id,src.form_id,p_payload->>'adId',p_payload->>'adsetId',p_payload->>'campaignId',p_payload->'consentResponses',src.consent_text,src.consent_version,src.timezone,
 src.call_now_key is not null and exists(select 1 from jsonb_array_elements(p_payload->'consentResponses') e where e->>'checkbox_key'=src.call_now_key and e->'is_checked'='true'::jsonb),least(submitted+interval '30 days',src.reviewed_until),p_link_hash,submitted+interval '7 days');
 insert into public.icash_meta_lead_receipts(meta_id,lead_id,source_id,ad_id,campaign_id,submitted_at) values(meta,lead,src.id,p_payload->>'adId',p_payload->>'campaignId',submitted);
 return jsonb_build_object('leadId',lead,'accountId',src.account_id,'duplicate',false);
end $$;

alter function public.icash_seller_contact_evidence(uuid,uuid,uuid,text) rename to icash_seller_evidence_before_meta;
create function public.icash_seller_contact_evidence(p_account uuid,p_screening uuid,p_lead uuid,p_phone text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;l public.icash_seller_intakes;principal text;binding jsonb;
begin
 select * into m from public.icash_meta_leads where lead_id=p_lead and account_id=p_account and screening_id=p_screening for share;
 if not found then return public.icash_seller_evidence_before_meta(p_account,p_screening,p_lead,p_phone);end if;
 select * into l from public.icash_seller_intakes where id=p_lead for share;
 if m.paused or m.declined_at is not null or l.phone is distinct from p_phone or l.assigned_account is distinct from p_account
  or l.screening_id is distinct from p_screening or not l.ai_consented or l.contact_consent_scope is distinct from 'meta_direct_principal'
  or l.consent_version is distinct from m.consent_version or l.consent_text is distinct from m.consent_text
  or m.submitted_at>now() or m.submitted_at<=now()-interval '30 days' or m.contact_until<=now()
  or not exists(select 1 from public.icash_meta_lead_sources where id=m.source_id and enabled and reviewed_until>now() and account_id=m.account_id and page_id=m.page_id and form_id=m.form_id and consent_text=m.consent_text and consent_version=m.consent_version and timezone=m.timezone and icash_meta_lead_sources.principal=(select i.principal from public.icash_customer_identities i where i.account_id=p_account))
  or exists(select 1 from public.icash_text_suppressions where phone=p_phone)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex'))
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=p_screening and state<>'resolved') then return null;end if;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=p_account;
 if nullif(trim(principal),'') is null then return null;end if;
 binding:=jsonb_build_object('lead',l.id,'account',p_account,'screening',p_screening,'phone',p_phone,'principal',principal,'metaLeadId',m.meta_id,'formId',m.form_id,'consent',m.consent_receipt,'consentVersion',m.consent_version,'consentText',m.consent_text,'submittedAt',m.submitted_at,'timezone',m.timezone);
 return jsonb_build_object('timezone',m.timezone,'until',m.contact_until,'evidence','meta-intake:'||l.id||':'||encode(sha256(convert_to(binding::text,'UTF8')),'hex'));
end $$;

-- A seller's text-only request also survives conversion to a property card.
alter function public.icash_seller_voice_permission_current(uuid,uuid) rename to icash_seller_voice_permission_before_meta;
create function public.icash_seller_voice_permission_current(p_account uuid,p_permission uuid) returns boolean
language sql security invoker set search_path='' as $$
 select not exists(select 1 from public.icash_contact_permissions p join public.icash_meta_leads m on m.lead_id=p.seller_intake_id and m.account_id=p.account_id where p.account_id=p_account and p.id=p_permission and m.voice_paused)
 and public.icash_seller_voice_permission_before_meta(p_account,p_permission);
$$;
revoke all on function public.icash_seller_voice_permission_current(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_voice_permission_current(uuid,uuid) to service_role;

create function public.icash_meta_contact_only(p_account uuid,p_screening uuid,p_phone text) returns boolean
language sql security invoker set search_path='' as $$
 select exists(select 1 from public.icash_meta_leads m join public.icash_seller_intakes l on l.id=m.lead_id join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id
 where m.account_id=p_account and m.screening_id=p_screening and l.phone=p_phone and s.state='awaiting_address'
 and public.icash_seller_contact_evidence(m.account_id,m.screening_id,m.lead_id,l.phone) is not null);
$$;
create function public.icash_meta_voice_context(p_account uuid,p_job uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('leadId',m.lead_id,'name',l.name,'state',l.state,'address',l.address)
 from public.icash_voice_jobs j join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id
 join public.icash_meta_leads m on m.lead_id=p.seller_intake_id and m.account_id=p.account_id and m.screening_id=p.screening_id
 join public.icash_seller_intakes l on l.id=m.lead_id
 where j.account_id=p_account and j.id=p_job and j.cancellation_notice_id is null and j.operational_contact_id is null
 and not m.voice_paused and public.icash_meta_contact_only(p.account_id,p.screening_id,p.phone) and public.icash_seller_voice_permission_current(p.account_id,p.id);
$$;
create function public.icash_meta_call_now(p_account uuid,p_job uuid) returns boolean
language sql security invoker set search_path='' as $$
 select exists(select 1 from public.icash_meta_leads m join public.icash_voice_jobs j on j.id=m.voice_job_id and j.account_id=m.account_id
 join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id
 where m.account_id=p_account and j.id=p_job and m.call_now and m.submitted_at<=now() and m.submitted_at>now()-interval '5 minutes'
 and j.state in ('ready','issued') and j.callback_id is null and j.sms_source_message_id is null and j.provider_call_sid is null and j.conversation_id is null
 and public.icash_seller_voice_permission_current(p.account_id,p.id));
$$;

-- Keep the generic billing path, with an explicit verified contact-only branch.
-- The exception admits an address-gathering call; it grants no quoting authority.
do $$declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_reserve_before_fractional(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 needle:='and not public.icash_cancellation_voice_current(p_account,p_operation) and';
 if position(needle in def)=0 then raise exception 'Current voice admission prerequisite changed';end if;
 execute replace(def,needle,needle||' not exists(select 1 from public.icash_voice_jobs meta_job where meta_job.account_id=p_account and ''voice:''||meta_job.id=p_operation and public.icash_meta_voice_context(p_account,meta_job.id) is not null) and');
 def:=pg_get_functiondef('public.icash_reserve_before_activation(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 needle:='not public.icash_claim_inventory(p_account,screen,phone)';
 if position(needle in def)=0 then raise exception 'Current inventory admission prerequisite changed';end if;
 execute replace(def,needle,'(not public.icash_meta_contact_only(p_account,screen,phone) and not public.icash_claim_inventory(p_account,screen,phone))');
end $$;

create function public.icash_meta_claim_voice(p_account uuid,p_job uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare j public.icash_voice_jobs;p public.icash_contact_permissions;c public.icash_voice_configs;h integer;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' or j.due_at>now() or public.icash_meta_voice_context(p_account,p_job) is null then return false;end if;
 select * into p from public.icash_contact_permissions where id=j.permission_id and account_id=p_account for share;
 select * into c from public.icash_voice_configs where account_id=p_account and enabled and reviewed_until>now() for share;
 if c.account_id is null or not public.icash_outreach_voice_current(p_account) then return false;end if;
 h:=extract(hour from now() at time zone p.timezone);
 if (h<9 or h>=20) and not public.icash_meta_call_now(p_account,p_job) and not public.icash_requested_seller_call_current(p_account,p_job) then return false;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;if not found then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(p.contact_key,17));
 if exists(select 1 from public.icash_voice_jobs v join public.icash_voice_contact_targets t on t.id=coalesce(v.permission_id,v.operational_contact_id)
  where v.id<>j.id and (v.state='dispatching' or v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')) and (v.account_id=p_account or t.contact_key=p.contact_key))
  or exists(select 1 from public.icash_live_conversations where state in ('waiting','review') and (account_id=p_account or contact_key=p.contact_key)) then return false;end if;
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id
  where o.operation_key='voice:'||j.id and o.account_id=p_account and o.rate_id=c.seller_rate_id and r.operation='seller_call' and r.voice_max_duration_seconds>=c.max_duration_seconds) then return false;end if;
 if not public.icash_claim_operation('voice:'||j.id) then return false;end if;
 update public.icash_voice_jobs set state='dispatching',updated_at=now(),operation_key='voice:'||id where id=j.id;
 return true;
end $$;

create function public.icash_meta_save_address(p_lead uuid,p_address text,p_channel text,p_evidence text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;l public.icash_seller_intakes;
begin
 if length(trim(p_address)) not between 8 and 300 or p_channel not in ('sms','call','form') or length(p_evidence) not between 10 and 300 then raise exception 'Confirmed address evidence required';end if;
 select * into m from public.icash_meta_leads where lead_id=p_lead for update;
 select * into l from public.icash_seller_intakes where id=p_lead for update;
 if m.lead_id is null or public.icash_seller_contact_evidence(m.account_id,m.screening_id,m.lead_id,l.phone) is null then return jsonb_build_object('status','unavailable');end if;
 if l.address=p_address and l.state<>'awaiting_address' then return jsonb_build_object('status',l.state,'leadId',l.id);end if;
 if l.state='unmatched' and coalesce((l.lookup_costs->>'dealmachine')::bigint,-1)=0 and jsonb_array_length(l.lookup_history)=0 and (l.property is null or l.property='null'::jsonb) and not exists(select 1 from public.icash_seller_matches where lead_id=l.id) then
  update public.icash_seller_intakes set lookup_history=jsonb_build_array(jsonb_build_object('address',l.address,'state',l.state,'checkedAt',l.checked_at,'lookupCosts',l.lookup_costs,'result',l.result,'evidence',p_evidence)) where id=l.id;
 elsif l.state<>'awaiting_address' then return jsonb_build_object('status','review_required','leadId',l.id);end if;
 update public.icash_seller_intakes set address=trim(p_address),state='received',claim_token=null,claimed_at=null,checked_at=null,hold_reason=null where id=l.id;
 update public.icash_meta_leads set address_confirmed_at=coalesce(address_confirmed_at,now()),address_channel=coalesce(address_channel,p_channel),response_at=coalesce(response_at,now()),response_channel=coalesce(response_channel,p_channel),next_attempt_at=now() where lead_id=l.id;
 return jsonb_build_object('status','received','leadId',l.id);
end $$;

-- The website worker cannot research Meta intakes on its generic sweep. Only
-- the enabled Meta service can enter this transaction after current admission.
do $$declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_claim_seller_lookup_for(uuid)'::regprocedure);
 needle:='where state=''received'' and';
 if position(needle in def)=0 then raise exception 'Seller lookup prerequisite changed';end if;
 execute replace(def,needle,'where state=''received'' and (contact_consent_scope is distinct from ''meta_direct_principal'' or id::text=current_setting(''icash.meta_lookup_lead'',true)) and');
end $$;
create function public.icash_meta_claim_lookup(p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;l public.icash_seller_intakes;claim jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_meta_leads where lead_id=p_id for update;
 select * into l from public.icash_seller_intakes where id=p_id for update;
 if m.lead_id is null or l.state<>'received' or l.address is null
  or public.icash_seller_contact_evidence(m.account_id,m.screening_id,m.lead_id,l.phone) is null
  or not public.icash_credit_acquisition_allowed(m.account_id)
  or not exists(select 1 from public.icash_accounts where id=m.account_id and not bot_paused) then return null;end if;
 perform set_config('icash.meta_lookup_lead',p_id::text,true);
 claim:=public.icash_claim_seller_lookup_for(p_id);
 perform set_config('icash.meta_lookup_lead','',true);
 return claim;
end $$;

-- New service-only entrypoints are not callable from public browsers.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'icash_meta_%'
 loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
revoke all on function public.icash_seller_contact_evidence(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_seller_contact_evidence(uuid,uuid,uuid,text) to service_role;
commit;
