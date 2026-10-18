begin;
set local lock_timeout='3s';

-- Source: config/meta-instant-leads.sql
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

-- Source: config/meta-instant-lead-work.sql
set local lock_timeout='3s';
create table public.icash_meta_lead_inbox(
 meta_id text primary key,source_id uuid not null references public.icash_meta_lead_sources(id),notice jsonb not null,
 state text not null default 'pending' check(state in ('pending','fetching','accepted','review')),
 attempts integer not null default 0,claim_token uuid,claimed_at timestamptz,next_attempt_at timestamptz not null default now(),
 reason text,lead_id uuid references public.icash_meta_leads(lead_id),created_at timestamptz not null default now()
);
alter table public.icash_meta_lead_inbox enable row level security;
revoke all on public.icash_meta_lead_inbox from public,anon,authenticated;
grant all on public.icash_meta_lead_inbox to service_role;
create function public.icash_meta_receive_notice(p_notice jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare src uuid;
begin
 select id into src from public.icash_meta_lead_sources where page_id=p_notice->>'page_id' and form_id=p_notice->>'form_id' and enabled and reviewed_until>now();
 if src is null then return false;end if;
 insert into public.icash_meta_lead_inbox(meta_id,source_id,notice) values(p_notice->>'leadgen_id',src,p_notice) on conflict do nothing;
 return true;
end $$;
create function public.icash_meta_claim_notice() returns jsonb language plpgsql security invoker set search_path='' as $$
declare row public.icash_meta_lead_inbox;token uuid:=gen_random_uuid();
begin
 select * into row from public.icash_meta_lead_inbox where (state='pending' or state='fetching' and claimed_at<now()-interval '2 minutes') and next_attempt_at<=now() and attempts<8
 order by next_attempt_at,created_at limit 1 for update skip locked;
 if not found then return null;end if;
 update public.icash_meta_lead_inbox set state='fetching',attempts=attempts+1,claim_token=token,claimed_at=now(),next_attempt_at=now()+interval '2 minutes' where meta_id=row.meta_id;
 return jsonb_build_object('metaId',row.meta_id,'sourceId',row.source_id,'notice',row.notice,'token',token);
end $$;

create function public.icash_meta_queue_message(p_lead uuid,p_purpose text,p_key text,p_body text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;l public.icash_seller_intakes;t public.icash_text_threads;deal uuid;message uuid;
begin
 if p_purpose not in ('initial','address_link','reply','offer_ready') or length(p_key) not between 1 and 200 or length(p_body) not between 1 and 1000 then raise exception 'Invalid intake text';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_meta_leads where lead_id=p_lead for update;
 select * into l from public.icash_seller_intakes where id=p_lead;
 if m.lead_id is null or m.paused or m.declined_at is not null or not public.icash_outreach_sms_current(m.account_id) or not public.icash_membership_work_allowed(m.account_id)
  or not exists(select 1 from public.icash_accounts where id=m.account_id and not bot_paused)
  or not exists(select 1 from public.icash_wallets where account_id=m.account_id and balance_cents>0) then return null;end if;
 select mm.message_id into message from public.icash_meta_lead_messages mm where mm.lead_id=p_lead and mm.purpose=p_purpose and mm.evidence_key=p_key;
 if found then return message;end if;
 select id into deal from public.icash_deal_files where account_id=m.account_id and screening_id=m.screening_id and stage='draft';
 if deal is null then return null;end if;
 perform public.icash_prepare_seller_contacts(m.account_id,m.lead_id,m.screening_id,deal);
 select * into t from public.icash_text_threads where account_id=m.account_id and deal_id=deal and seller_intake_id=l.id and recipient=l.phone and party='seller' and not paused and not manual_only and ai_mode='auto';
 if t.id is null or not public.icash_seller_sms_permission_current(m.account_id,t.id,false) then return null;end if;
 -- Fixed purposes and a bounded conversational reply budget. No periodic blast.
 if p_purpose='reply' and (select count(*) from public.icash_meta_lead_messages mm where mm.lead_id=p_lead and mm.purpose='reply')>=6 then return null;end if;
 message:=public.icash_queue_text(m.account_id,t.id,gen_random_uuid(),p_body,'{}'::uuid[]);
 insert into public.icash_meta_lead_messages(message_id,lead_id,purpose,evidence_key) values(message,p_lead,p_purpose,p_key);
 return message;
end $$;

create function public.icash_meta_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare msg public.icash_text_messages;t public.icash_text_threads;m public.icash_meta_leads;h integer;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select ml.* into m from public.icash_meta_lead_messages mm join public.icash_meta_leads ml on ml.lead_id=mm.lead_id where mm.message_id=p_message and ml.account_id=p_account for share of ml;
 if not found then return null;end if;
 if not public.icash_sms_message_route_current(p_account,p_message) then return null;end if;
 select * into msg from public.icash_text_messages where id=p_message and account_id=p_account for update;
 if not found or msg.state<>'ready' or msg.direction<>'outgoing' or cardinality(msg.asset_ids)>0 or msg.attachments<>'[]'::jsonb then return null;end if;
 select * into t from public.icash_text_threads where id=msg.thread_id and account_id=p_account for update;
 if not found or t.seller_intake_id is distinct from m.lead_id or t.sender<>p_sender or not public.icash_seller_sms_permission_current(p_account,t.id,false) then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 if m.paused or m.declined_at is not null or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) then return null;end if;
 h:=extract(hour from now() at time zone t.timezone);
 if (h<9 or h>=20) and not (m.call_now and m.submitted_at>now()-interval '5 minutes') and not public.icash_seller_sms_inquiry_window(p_account,t.id) then return null;end if;
 -- The normal reserve snapshots actual-cost pricing, membership, credits,
 -- explicit channel disables, billing reviews and uncertain-send protection.
 perform public.icash_reserve_operation(p_account,'text:'||msg.id,t.sms_rate_id,t.permission_until);
 if not public.icash_claim_operation('text:'||msg.id) then return null;end if;
 update public.icash_text_messages set state='dispatching',updated_at=now() where id=msg.id;
 return jsonb_build_object('from',t.sender,'to',t.recipient,'message',msg.body,'attachments',msg.attachments);
end $$;

create function public.icash_meta_prepare_voice(p_lead uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;l public.icash_seller_intakes;p public.icash_contact_permissions;j public.icash_voice_jobs;deal uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_meta_leads where lead_id=p_lead for update;
 select * into l from public.icash_seller_intakes where id=p_lead;
 if m.lead_id is null or m.paused or m.voice_paused or m.declined_at is not null or not public.icash_outreach_voice_current(m.account_id)
  or not public.icash_membership_work_allowed(m.account_id) or not exists(select 1 from public.icash_accounts where id=m.account_id and not bot_paused)
  or not exists(select 1 from public.icash_wallets where account_id=m.account_id and balance_cents>0) then return null;end if;
 select id into deal from public.icash_deal_files where account_id=m.account_id and screening_id=m.screening_id and stage='draft';
 if deal is null then return null;end if;
 perform public.icash_prepare_seller_contacts(m.account_id,m.lead_id,m.screening_id,deal);
 select * into p from public.icash_contact_permissions where account_id=m.account_id and screening_id=m.screening_id and seller_intake_id=m.lead_id and phone=l.phone and revoked_at is null;
 if p.id is null or not public.icash_seller_voice_permission_current(m.account_id,p.id) then return null;end if;
 insert into public.icash_voice_jobs(account_id,permission_id) values(m.account_id,p.id) on conflict do nothing;
 select * into j from public.icash_voice_jobs where account_id=m.account_id and permission_id=p.id and callback_id is null and sms_source_message_id is null and cancellation_notice_id is null and meta_offer_lead_id is null;
 if j.id is null then return null;end if;
 update public.icash_meta_leads set voice_job_id=coalesce(voice_job_id,j.id),next_attempt_at=now()+interval '1 minute' where lead_id=m.lead_id;
 if j.state<>'ready' or j.due_at>now() then return null;end if;
 update public.icash_voice_jobs set state='issued',updated_at=now() where id=j.id;
 return jsonb_build_object('accountId',m.account_id,'voiceJobId',j.id);
end $$;

create function public.icash_meta_call_context(p_hash text,p_conversation text) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('leadId',m.lead_id,'accountId',m.account_id,'screeningId',m.screening_id,'state',l.state,'metaId',m.meta_id,'submittedAt',m.submitted_at,'address',l.address,'complete',s.state='complete')
 from public.icash_call_recordings r join public.icash_meta_leads m on m.screening_id=r.screening_id and m.account_id=r.account_id
 join public.icash_seller_intakes l on l.id=m.lead_id join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id
 where r.stop_token_hash=p_hash and r.conversation_id=p_conversation and r.party='seller' and r.to_phone=l.phone
 and r.call_ended_at is null and r.created_at>now()-interval '20 minutes' and r.state='recording' and r.recording_sid is not null
 and public.icash_seller_contact_evidence(m.account_id,m.screening_id,m.lead_id,l.phone) is not null;
$$;

create function public.icash_meta_observe_text() returns trigger language plpgsql security invoker set search_path='' as $$
declare lead uuid;body text:=lower(trim(new.body));
begin
 select m.lead_id into lead from public.icash_meta_leads m join public.icash_text_threads t on t.seller_intake_id=m.lead_id and t.account_id=m.account_id where t.id=new.thread_id and t.account_id=new.account_id;
 if lead is null then return new;end if;
 if new.direction='outgoing' and new.provider_id is not null and new.state in ('accepted','delivered') then
  update public.icash_meta_leads set first_outreach_at=coalesce(first_outreach_at,now()) where lead_id=lead;
 elsif new.direction='incoming' and new.state='received' then
  if body ~ '(don.t call|do not call|stop calling|text (me )?only|only text)' then
   update public.icash_meta_leads set voice_paused=true where lead_id=lead;
   update public.icash_voice_jobs j set state='held',outcome='seller_requested_text_only',updated_at=now() from public.icash_contact_permissions p where p.id=j.permission_id and p.seller_intake_id=lead and j.state in ('ready','issued') and j.provider_call_sid is null and j.conversation_id is null;
  end if;
  if body ~ '\m(stop|unsubscribe|wrong number|not interested|do not contact|don.t contact)\M' then
   update public.icash_meta_leads set declined_at=coalesce(declined_at,now()),paused=true where lead_id=lead;
  elsif body ~ '\m(human|real person|speak to someone|talk to someone)\M' then
   update public.icash_meta_leads set paused=true,response_at=coalesce(response_at,new.created_at),response_channel=coalesce(response_channel,'sms') where lead_id=lead;
   update public.icash_seller_intakes set hold_reason='Seller requested a person; automatic follow-up paused' where id=lead;
  elsif length(body)>=2 and body !~ '\m(automatic reply|auto.reply|delivery|voicemail|out of office)\M' then
   update public.icash_meta_leads set response_at=coalesce(response_at,new.created_at),response_channel=coalesce(response_channel,'sms') where lead_id=lead;
  end if;
 end if;
 return new;
end $$;
create trigger icash_meta_text_observation after insert or update of state,provider_id on public.icash_text_messages for each row execute function public.icash_meta_observe_text();

-- Contact-only messages belong to the address intake handler. Do not also
-- enqueue the existing property agent before a property is available.
do $$declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_enqueue_text_ai()'::regprocedure);
 needle:='if new.direction<>''incoming'' or new.account_id is null or new.thread_id is null then return new;end if;';
 if position(needle in def)=0 then raise exception 'SMS intake prerequisite changed';end if;
 execute replace(def,needle,needle||E'\n if exists(select 1 from public.icash_text_threads t join public.icash_meta_leads m on m.lead_id=t.seller_intake_id and m.account_id=t.account_id join public.icash_screening_jobs s on s.id=m.screening_id where t.id=new.thread_id and s.state=''awaiting_address'') then return new;end if;');
end $$;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'icash_meta_%'
 loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;

-- Source: config/meta-instant-lead-property.sql
set local lock_timeout='3s';
-- A direct Meta request stays with its named principal. Never enter the
-- website's shared-lead allocation or create a second screening/deal/thread.
do $$declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure);
 needle:='and (numbers_passed or not exists';
 if position(needle in def)=0 then raise exception 'Seller assignment prerequisite changed';end if;
 execute replace(def,needle,'and contact_consent_scope is distinct from ''meta_direct_principal'' '||needle);
end $$;

create function public.icash_meta_promote_property(p_lead uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;l public.icash_seller_intakes;quote jsonb;parts jsonb;property_snapshot jsonb;manifest jsonb;total bigint;charge bigint;rate uuid;operation text;evidence text;deal uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_meta_leads where lead_id=p_lead for update;
 select * into l from public.icash_seller_intakes where id=p_lead for update;
 if m.lead_id is null then return jsonb_build_object('status','not_meta');end if;
 if exists(select 1 from public.icash_seller_matches where lead_id=l.id and account_id=m.account_id and screening_id=m.screening_id) then return jsonb_build_object('status','property_ready','leadId',l.id);end if;
 if l.state not in ('qualified','numbers_review') or l.property->>'id' is null or l.result->'property'->>'address' is null or l.checked_at<now()-interval '24 hours'
  or l.data_rights_until<=now() or not public.icash_research_state_allowed(l.property->>'state') then return jsonb_build_object('status','research_required');end if;
 if public.icash_seller_contact_evidence(m.account_id,m.screening_id,l.id,l.phone) is null or not public.icash_credit_acquisition_allowed(m.account_id)
  or not exists(select 1 from public.icash_accounts where id=m.account_id and not bot_paused) then return jsonb_build_object('status','account_or_contact_held');end if;
 select id into deal from public.icash_deal_files where account_id=m.account_id and screening_id=m.screening_id and stage='draft' and terms->>'intakeOnly'='true' for update;
 if deal is null then return jsonb_build_object('status','deal_review_required');end if;
 quote:=public.icash_seller_acquisition_quote(l.id);
 if quote is null or l.lookup_costs is null or l.lookup_cost_basis is null then return jsonb_build_object('status','acquisition_cost_required');end if;
 parts:=l.lookup_costs||jsonb_build_object('acquisition',(quote->>'costMicros')::bigint);
 select sum(value::numeric)::bigint into total from jsonb_each_text(parts);
 charge:=ceil(total::numeric*2/10000);if public.icash_vip_active(m.account_id) then charge:=ceil(charge*0.8);end if;
 if coalesce(charge,0)<=0 then return jsonb_build_object('status','cost_required');end if;
 operation:='seller-lead:'||l.id||':'||m.account_id;
 evidence:='meta-direct-acquisition-v1; pricing all-usage-2x-20261018; '||quote::text||'; '||l.lookup_cost_basis;
 property_snapshot:=jsonb_build_object('propertyId',l.property->>'id','propertyType','house','fetchedAt',l.property->>'fetchedAt','raw',l.property->'raw','sellerCostReserveCents',l.property->'sellerCostReserveCents','sellerRequest',jsonb_build_object('id',l.id,'ownerName',l.name,'phone',l.phone,'aiConsented',l.ai_consented,'consentVersion',l.consent_version,'consentText',l.consent_text,'consentScope',l.contact_consent_scope,'shared',false,'maximumBuyers',1));
 begin
  update public.icash_screening_jobs s set snapshot=property_snapshot,result=l.result,state='complete',completed_at=l.checked_at where s.id=m.screening_id and s.account_id=m.account_id and s.state='awaiting_address';
  if not found or not public.icash_claim_inventory(m.account_id,m.screening_id,l.phone) then raise exception 'Property contact allocation held';end if;
  insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled)
  values('seller_lead',operation,charge,parts,0,evidence,now(),least(now()+interval '24 hours',l.data_rights_until),true) returning id into rate;
  perform public.icash_reserve_operation(m.account_id,operation,rate,l.data_rights_until,l.checked_at,l.numbers_passed);
  if not public.icash_claim_operation(operation) then raise exception 'Acquisition admission held';end if;
  select jsonb_object_agg(key,jsonb_build_object('amountMicros',value,'evidenceRef',evidence)) into manifest from jsonb_each(parts);
  perform public.icash_settle_complete_costs(operation,charge,manifest,evidence);
  update public.icash_operation_spend set cost_basis='estimated' where operation_key=operation;
  update public.icash_deal_files set terms=(terms-'intakeOnly')||jsonb_build_object('address',l.property->>'address','state',l.property->>'state'),updated_at=now() where id=deal;
  insert into public.icash_seller_matches(lead_id,account_id,screening_id,operation_key,charge_cents) values(l.id,m.account_id,m.screening_id,operation,charge);
  update public.icash_seller_intakes set state='assigned',operation_key=operation,assigned_at=now(),next_assignment_at='9999-12-31T23:59:59Z',customer_costs=parts,customer_cost_basis=evidence,customer_lead_multiplier=2,hold_reason=null where id=l.id;
  update public.icash_meta_leads set offer_ready_at=case when l.numbers_passed then now() else null end,next_attempt_at=now()+interval '1 minute' where lead_id=l.id;
  return jsonb_build_object('status','property_ready','leadId',l.id,'accountId',m.account_id,'screeningId',m.screening_id,'offerReady',l.numbers_passed);
 exception when others then
  update public.icash_seller_intakes set hold_reason='Property research saved; account or allocation review required before promotion' where id=l.id;
  return jsonb_build_object('status','promotion_held','leadId',l.id);
 end;
end $$;

alter function public.icash_finish_seller_lookup(uuid,uuid,jsonb) rename to icash_finish_seller_lookup_before_meta;
create function public.icash_finish_seller_lookup(p_id uuid,p_token uuid,p_output jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare saved boolean;
begin
 saved:=public.icash_finish_seller_lookup_before_meta(p_id,p_token,p_output);
 if saved and exists(select 1 from public.icash_meta_leads where lead_id=p_id) then perform public.icash_meta_promote_property(p_id);end if;
 return saved;
end $$;

create function public.icash_meta_response_report(p_account uuid) returns jsonb
language sql security invoker set search_path='' as $$
 with cohorts as (
 select m.*,l.ad_cost_micros,l.state,l.property,
 (select q->>'costMicros' from (select public.icash_seller_acquisition_quote(l.id) q) price) acquisition_micros
 from public.icash_meta_leads m join public.icash_seller_intakes l on l.id=m.lead_id
 where (p_account is null or m.account_id=p_account) and m.submitted_at>=now()-interval '30 days'
 ), groups as (
 select form_id,campaign_id,count(*) leads,count(*) filter(where response_at is not null) responses,
 count(*) filter(where address_confirmed_at is not null) addresses,count(*) filter(where offer_ready_at is not null) offers,
 count(*) filter(where submitted_at<=now()-interval '24 hours') mature_leads,
 count(*) filter(where submitted_at<=now()-interval '24 hours' and response_at<=submitted_at+interval '24 hours') responses_24h,
 count(*) filter(where acquisition_micros is null) cost_missing,sum(acquisition_micros::numeric) cost_micros,
 percentile_cont(0.5) within group(order by extract(epoch from(first_outreach_at-submitted_at))) filter(where first_outreach_at is not null) median_response_seconds
 from cohorts group by form_id,campaign_id
 ) select coalesce(jsonb_agg(jsonb_build_object('formId',form_id,'campaignId',campaign_id,'leads',leads,'responses',responses,'addresses',addresses,'offers',offers,
 'matureLeads',mature_leads,'responses24h',responses_24h,'responseRate24h',case when mature_leads>0 then responses_24h::numeric/mature_leads else null end,
 'costPerResponseCents',case when cost_missing=0 and responses>0 then ceil(cost_micros/10000/responses) else null end,
 'costBasis','recorded ad costs or labeled source estimate','missingCostCount',cost_missing,'medianFirstOutreachSeconds',median_response_seconds)), '[]'::jsonb) from groups;
$$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'icash_meta_%'
 loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
revoke all on function public.icash_finish_seller_lookup(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_finish_seller_lookup(uuid,uuid,jsonb) to service_role;

-- Source: config/meta-instant-address-form.sql
set local lock_timeout='3s';
-- Meta's shared completion URL contains no verified lead identity. Save the
-- visitor's candidate privately, then confirm it through the lead's SMS link.
create table public.icash_meta_address_requests(
 id uuid primary key,source_id uuid not null references public.icash_meta_lead_sources(id),phone text not null,
 candidate_address text not null check(length(candidate_address) between 8 and 300),lead_id uuid references public.icash_meta_leads(lead_id),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 minutes',
 check(phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$')
);
create index icash_meta_address_requests_match on public.icash_meta_address_requests(source_id,phone,created_at desc);
alter table public.icash_meta_address_requests enable row level security;
revoke all on public.icash_meta_address_requests from public,anon,authenticated;
grant all on public.icash_meta_address_requests to service_role;
create function public.icash_meta_request_address_link(p_request uuid,p_slug text,p_phone text,p_address text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare src uuid;lead uuid;existing public.icash_meta_address_requests;
begin
 select id into src from public.icash_meta_lead_sources where slug=p_slug and enabled and reviewed_until>now();
 if src is null then return null;end if;
 delete from public.icash_meta_address_requests where expires_at<now();
 select * into existing from public.icash_meta_address_requests where id=p_request;
 if found then
  if existing.phone is distinct from p_phone or existing.source_id is distinct from src or existing.candidate_address is distinct from p_address then return null;end if;
  return existing.lead_id;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('meta-address:'||p_phone,0));
 if exists(select 1 from public.icash_meta_address_requests where source_id=src and phone=p_phone and created_at>now()-interval '5 minutes') then return null;end if;
 select m.lead_id into lead from public.icash_meta_leads m join public.icash_seller_intakes l on l.id=m.lead_id
 where m.source_id=src and l.phone=p_phone and m.submitted_at>now()-interval '30 minutes' and not m.paused and m.declined_at is null
 and public.icash_seller_contact_evidence(m.account_id,m.screening_id,m.lead_id,l.phone) is not null order by m.created_at desc limit 1;
 insert into public.icash_meta_address_requests(id,source_id,phone,candidate_address,lead_id) values(p_request,src,p_phone,p_address,lead);
 return lead;
end $$;
create function public.icash_meta_address_session(p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;l public.icash_seller_intakes;candidate text;
begin
 select * into m from public.icash_meta_leads where link_hash=p_hash and link_expires_at>now();
 select * into l from public.icash_seller_intakes where id=m.lead_id;
 if m.lead_id is null or public.icash_seller_contact_evidence(m.account_id,m.screening_id,m.lead_id,l.phone) is null then return null;end if;
 select candidate_address into candidate from public.icash_meta_address_requests where source_id=m.source_id and phone=l.phone and expires_at>now() order by created_at desc limit 1;
 return jsonb_build_object('leadId',m.lead_id,'state',l.state,'address',coalesce(l.address,candidate,''));
end $$;
create function public.icash_meta_match_address_request(p_lead uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;l public.icash_seller_intakes;
begin
 select * into m from public.icash_meta_leads where lead_id=p_lead;
 select * into l from public.icash_seller_intakes where id=p_lead;
 update public.icash_meta_address_requests set lead_id=p_lead where source_id=m.source_id and phone=l.phone and lead_id is null and expires_at>now() and created_at>=m.submitted_at-interval '1 minute';
 return exists(select 1 from public.icash_meta_address_requests where lead_id=p_lead and expires_at>now());
end $$;
revoke all on function public.icash_meta_request_address_link(uuid,text,text,text),public.icash_meta_address_session(text),public.icash_meta_match_address_request(uuid) from public,anon,authenticated;
grant execute on function public.icash_meta_request_address_link(uuid,text,text,text),public.icash_meta_address_session(text),public.icash_meta_match_address_request(uuid) to service_role;

-- Source: config/meta-instant-lead-workspace.sql
create function public.icash_meta_workspace_leads(p_account uuid,p_query text default '',p_offset integer default 0,p_limit integer default 7,p_screening uuid default null) returns jsonb
language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(row),'[]'::jsonb) from (
 select m.lead_id "leadId",m.screening_id "screeningId",d.id "dealId",l.name,l.phone,l.address,l.state,m.paused,m.declined_at "declinedAt",
 m.submitted_at "submittedAt",m.first_outreach_at "firstOutreachAt",m.response_at "responseAt",m.address_confirmed_at "addressConfirmedAt",m.form_id "formId",m.campaign_id "campaignId",
 l.hold_reason "holdReason"
 from public.icash_meta_leads m join public.icash_seller_intakes l on l.id=m.lead_id join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id and s.state='awaiting_address'
 join public.icash_deal_files d on d.account_id=m.account_id and d.screening_id=m.screening_id
 where m.account_id=p_account and (p_screening is null or m.screening_id=p_screening)
 and (p_query='' or position(lower(p_query) in lower(coalesce(l.name,'')||' '||l.phone||' '||coalesce(l.address,'')))>0)
 order by m.created_at desc,m.lead_id limit greatest(1,least(25,p_limit)) offset greatest(0,least(60000,p_offset))
 ) row;
$$;
create function public.icash_meta_pause_lead(p_account uuid,p_lead uuid,p_paused boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_meta_leads where lead_id=p_lead and account_id=p_account for update;
 if not found or m.declined_at is not null and not p_paused then return false;end if;
 update public.icash_meta_leads set paused=p_paused,next_attempt_at=now() where lead_id=p_lead;
 if p_paused then
  update public.icash_text_messages msg set state='cancelled',updated_at=now() from public.icash_meta_lead_messages mm where mm.message_id=msg.id and mm.lead_id=p_lead and msg.state='ready';
  update public.icash_voice_jobs j set state='held',outcome='meta_lead_paused',updated_at=now() from public.icash_contact_permissions p where p.id=j.permission_id and p.seller_intake_id=p_lead and j.account_id=p_account and j.state in ('ready','issued')
   and not exists(select 1 from public.icash_operation_spend where operation_key='voice:'||j.id);
 else
  update public.icash_text_messages msg set state='ready',updated_at=now() from public.icash_meta_lead_messages mm where mm.message_id=msg.id and mm.lead_id=p_lead and msg.state='cancelled' and msg.provider_id is null and not exists(select 1 from public.icash_operation_spend where operation_key='text:'||msg.id);
  update public.icash_voice_jobs j set state='ready',outcome=null,due_at=now(),updated_at=now() from public.icash_contact_permissions p where p.id=j.permission_id and p.seller_intake_id=p_lead and j.account_id=p_account and j.state='held' and j.outcome='meta_lead_paused'
   and not exists(select 1 from public.icash_operation_spend where operation_key='voice:'||j.id);
 end if;
 return true;
end $$;
create function public.icash_meta_text_context(p_event text) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('leadId',m.lead_id,'accountId',m.account_id,'messageId',msg.id,'body',msg.body,'paused',m.paused,'declined',m.declined_at is not null,'complete',s.state='complete')
 from public.icash_text_messages msg join public.icash_text_threads t on t.id=msg.thread_id and t.account_id=msg.account_id
 join public.icash_meta_leads m on m.lead_id=t.seller_intake_id and m.account_id=t.account_id
 join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id
 where msg.event_id=p_event and msg.direction='incoming' and msg.state='received' and t.party='seller' and t.retired_at is null;
$$;
revoke all on function public.icash_meta_workspace_leads(uuid,text,integer,integer,uuid),public.icash_meta_pause_lead(uuid,uuid,boolean),public.icash_meta_text_context(text) from public,anon,authenticated;
grant execute on function public.icash_meta_workspace_leads(uuid,text,integer,integer,uuid),public.icash_meta_pause_lead(uuid,uuid,boolean),public.icash_meta_text_context(text) to service_role;

-- Source: config/meta-instant-lead-reception.sql
set local lock_timeout='3s';
alter function public.icash_recorded_reception_property_context(uuid,text) rename to icash_reception_context_before_meta;
create function public.icash_recorded_reception_property_context(p_id uuid,p_nonce_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;s icash_recorded_reception_private.sessions;m public.icash_meta_leads;t public.icash_text_threads;ids uuid[];principal text;assistant text;
begin
 context:=public.icash_reception_context_before_meta(p_id,p_nonce_hash);
 if context is null or context->>'status'<>'ambiguous' then return context;end if;
 select session.* into s from icash_recorded_reception_private.sessions session join icash_recorded_reception_private.configs c on c.id=session.config_id
 where session.id=p_id and session.nonce_hash=p_nonce_hash and session.state='recording' and session.recording_sid is not null
 and session.register_claimed_at is null and session.conversation_id is null and session.call_ended_at is null and session.end_requested_at is null
 and session.call_deadline_at>now() and c.enabled and c.reviewed_until>now() and c.context_policy='automatic_offer_v18';
 if not found then return context;end if;
 -- Only the single, already messaged seller thread can supply the return-call
 -- context. An ambiguous number never selects another account or property.
 select array_agg(id) into ids from public.icash_text_threads where account_id=s.account_id and sender=s.to_phone and recipient=s.from_phone and retired_at is null;
 if cardinality(ids) is distinct from 1 then return context;end if;
 select * into t from public.icash_text_threads where id=ids[1] and party='seller' and not paused and not manual_only;
 if not found then return context;end if;
 select * into m from public.icash_meta_leads where lead_id=t.seller_intake_id and account_id=s.account_id;
 if not found or not public.icash_meta_contact_only(m.account_id,m.screening_id,t.recipient)
 or not exists(select 1 from public.icash_text_messages where thread_id=t.id and account_id=t.account_id and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null and created_at>now()-interval '30 days') then return context;end if;
 insert into icash_seller_agreement_private.inbound_bindings(session_id,account_id,deal_id,thread_id) values(s.id,m.account_id,t.deal_id,t.id) on conflict do nothing;
 if not exists(select 1 from icash_seller_agreement_private.inbound_bindings where session_id=s.id and account_id=m.account_id and deal_id=t.deal_id and thread_id=t.id) then return null;end if;
 select i.principal,a.assistant_name into principal,assistant from public.icash_customer_identities i join public.icash_accounts a on a.id=i.account_id and not a.bot_paused where i.account_id=m.account_id;
 if principal is null then return null;end if;
 return jsonb_build_object('status','instant_lead','principal',principal,'assistantName',assistant);
end $$;
alter function public.icash_meta_call_context(text,text) rename to icash_meta_outbound_call_context;
create function public.icash_meta_call_context(p_hash text,p_conversation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;
begin
 context:=public.icash_meta_outbound_call_context(p_hash,p_conversation);
 if context is not null then return context;end if;
 select jsonb_build_object('leadId',m.lead_id,'accountId',m.account_id,'screeningId',m.screening_id,'state',l.state,'metaId',m.meta_id,'submittedAt',m.submitted_at,'address',l.address,'complete',screen.state='complete') into context
 from icash_recorded_reception_private.sessions s join icash_recorded_reception_private.configs c on c.id=s.config_id
 join icash_seller_agreement_private.inbound_bindings b on b.session_id=s.id and b.account_id=s.account_id
 join public.icash_text_threads t on t.id=b.thread_id and t.account_id=b.account_id and t.deal_id=b.deal_id and t.recipient=s.from_phone and t.sender=s.to_phone
 join public.icash_meta_leads m on m.lead_id=t.seller_intake_id and m.account_id=t.account_id
 join public.icash_seller_intakes l on l.id=m.lead_id join public.icash_screening_jobs screen on screen.id=m.screening_id and screen.account_id=m.account_id
 where s.stop_token_hash=p_hash and s.conversation_id=p_conversation and s.state='recording' and s.recording_sid is not null
 and s.call_ended_at is null and s.end_requested_at is null and s.call_deadline_at>now() and c.enabled and c.reviewed_until>now()
 and t.party='seller' and not t.paused and not t.manual_only and t.retired_at is null
 and public.icash_seller_contact_evidence(m.account_id,m.screening_id,m.lead_id,l.phone) is not null;
 return context;
end $$;
create function public.icash_meta_inbound_call_pending(p_hash text) returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from icash_recorded_reception_private.sessions s join icash_seller_agreement_private.inbound_bindings b on b.session_id=s.id and b.account_id=s.account_id
 join public.icash_text_threads t on t.id=b.thread_id and t.account_id=b.account_id join public.icash_meta_leads m on m.lead_id=t.seller_intake_id and m.account_id=t.account_id
 where s.stop_token_hash=p_hash and s.state='recording' and s.conversation_id is null and s.call_ended_at is null and s.end_requested_at is null and s.call_deadline_at>now());
$$;
revoke all on function public.icash_recorded_reception_property_context(uuid,text),public.icash_meta_call_context(text,text),public.icash_meta_inbound_call_pending(text) from public,anon,authenticated;
grant execute on function public.icash_recorded_reception_property_context(uuid,text),public.icash_meta_call_context(text,text),public.icash_meta_inbound_call_pending(text) to service_role;

-- Source: config/meta-instant-lead-measurement.sql
alter table public.icash_meta_leads add column offer_authorized_at timestamptz, add column offer_conversation_id text;
alter table public.icash_voice_jobs add column meta_offer_lead_id uuid unique references public.icash_meta_leads(lead_id);
drop index public.icash_voice_first_once;
create unique index icash_voice_first_once on public.icash_voice_jobs(permission_id) where callback_id is null and sms_source_message_id is null and cancellation_notice_id is null and meta_offer_lead_id is null;
create function public.icash_meta_offer_followup(p_lead uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;p public.icash_contact_permissions;j public.icash_voice_jobs;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_meta_leads where lead_id=p_lead for update;
 if not found or m.offer_ready_at is null or m.offer_authorized_at is not null or m.paused or m.voice_paused or m.declined_at is not null
 or not public.icash_outreach_voice_current(m.account_id) or not public.icash_membership_work_allowed(m.account_id)
 or not exists(select 1 from public.icash_accounts where id=m.account_id and not bot_paused)
 or not exists(select 1 from public.icash_wallets where account_id=m.account_id and balance_cents>0) then return null;end if;
 select * into p from public.icash_contact_permissions where account_id=m.account_id and seller_intake_id=m.lead_id and screening_id=m.screening_id and revoked_at is null;
 if p.id is null or not public.icash_seller_voice_permission_current(m.account_id,p.id) then return null;end if;
 -- Continue the present call. An accepted/uncertain call is never redialled.
 if exists(select 1 from public.icash_voice_jobs where permission_id=p.id and state in ('ready','issued','dispatching'))
 or exists(select 1 from public.icash_call_recordings where permission_id=p.id and call_ended_at is null)
 or exists(select 1 from public.icash_live_conversations where account_id=m.account_id and screening_id=m.screening_id and state in ('waiting','review'))
 or exists(select 1 from public.icash_voice_jobs where permission_id=p.id and state='held' and outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')) then return null;end if;
 insert into public.icash_voice_jobs(account_id,permission_id,meta_offer_lead_id) values(m.account_id,p.id,m.lead_id) on conflict do nothing;
 select * into j from public.icash_voice_jobs where meta_offer_lead_id=m.lead_id and account_id=m.account_id;
 if j.state<>'ready' or j.due_at>now() then return null;end if;
 update public.icash_voice_jobs set state='issued',updated_at=now() where id=j.id;
 return jsonb_build_object('accountId',m.account_id,'voiceJobId',j.id);
end $$;
create function public.icash_meta_note_offer_authorized(p_hash text,p_conversation text,p_price bigint) returns void
language plpgsql security invoker set search_path='' as $$
declare scope jsonb;
begin
 scope:=public.icash_meta_call_context(p_hash,p_conversation);
 if scope is null or scope->>'complete'<>'true' or p_price<=0 then return;end if;
 -- The server records this only after the ordinary offer tool returns an
 -- authorized quote. It stops an unnecessary second call, never grants a price.
 update public.icash_meta_leads set offer_authorized_at=coalesce(offer_authorized_at,now()),offer_conversation_id=p_conversation where lead_id=(scope->>'leadId')::uuid and account_id=(scope->>'accountId')::uuid;
end $$;
create function public.icash_meta_observe_call() returns trigger language plpgsql security invoker set search_path='' as $$
declare lead uuid;
begin
 select m.lead_id into lead from public.icash_meta_leads m join public.icash_seller_intakes l on l.id=m.lead_id
 where m.account_id=new.account_id and m.screening_id=new.screening_id and new.party='seller' and new.contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex');
 if lead is null then return new;end if;
 if new.state='complete' and new.completed_at is not null and public.icash_seller_human_answer(new.result->'transcript') then
  if new.result->>'optedOut'='true' or new.result->>'interested'='false' then
   update public.icash_meta_leads set declined_at=coalesce(declined_at,new.completed_at),paused=true where lead_id=lead;
  else
   update public.icash_meta_leads set response_at=coalesce(response_at,new.completed_at),response_channel=coalesce(response_channel,'call') where lead_id=lead;
  end if;
 end if;
 return new;
end $$;
create trigger icash_meta_call_observation after insert or update of state,result on public.icash_live_conversations for each row execute function public.icash_meta_observe_call();
create function public.icash_meta_observe_dial() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.call_sid is not null then update public.icash_meta_leads set first_outreach_at=coalesce(first_outreach_at,now()) where account_id=new.account_id and screening_id=new.screening_id;end if;
 return new;
end $$;
create trigger icash_meta_dial_observation after update of call_sid on public.icash_call_recordings for each row execute function public.icash_meta_observe_dial();

create table public.icash_meta_lead_events(
 id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.icash_meta_leads(lead_id),
 stage text not null check(stage in ('InstantFormReceived','SellerResponded','PropertyAddressConfirmed','CashOfferReady')),
 occurred_at timestamptz not null,delivered_at timestamptz,claim_token uuid,claimed_at timestamptz,attempts integer not null default 0,
 state text not null default 'pending' check(state in ('pending','sending','delivered','review')),unique(lead_id,stage)
);
alter table public.icash_meta_lead_events enable row level security;
revoke all on public.icash_meta_lead_events from public,anon,authenticated;
grant all on public.icash_meta_lead_events to service_role;
create function public.icash_meta_capture_stage() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='INSERT' then insert into public.icash_meta_lead_events(lead_id,stage,occurred_at) values(new.lead_id,'InstantFormReceived',greatest(now(),new.submitted_at+interval '1 second')) on conflict do nothing;end if;
 if new.response_at is not null then insert into public.icash_meta_lead_events(lead_id,stage,occurred_at) values(new.lead_id,'SellerResponded',new.response_at) on conflict do nothing;end if;
 if new.address_confirmed_at is not null then insert into public.icash_meta_lead_events(lead_id,stage,occurred_at) values(new.lead_id,'PropertyAddressConfirmed',new.address_confirmed_at) on conflict do nothing;end if;
 if new.offer_ready_at is not null then insert into public.icash_meta_lead_events(lead_id,stage,occurred_at) values(new.lead_id,'CashOfferReady',new.offer_ready_at) on conflict do nothing;end if;
 return new;
end $$;
create trigger icash_meta_stage_capture after insert or update of response_at,address_confirmed_at,offer_ready_at on public.icash_meta_leads for each row execute function public.icash_meta_capture_stage();
create function public.icash_meta_claim_event() returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.icash_meta_lead_events;m public.icash_meta_leads;token uuid:=gen_random_uuid();
begin
 update public.icash_meta_lead_events set state='review' where state in ('pending','sending') and (occurred_at<now()-interval '7 days' or attempts>=5 and claimed_at<now()-interval '2 minutes');
 select * into e from public.icash_meta_lead_events where (state='pending' or state='sending' and claimed_at<now()-interval '2 minutes') and occurred_at<=now()
 and (claimed_at is null or claimed_at<now()-interval '2 minutes') order by occurred_at limit 1 for update skip locked;
 if not found then return null;end if;
 select * into m from public.icash_meta_leads where lead_id=e.lead_id;
 update public.icash_meta_lead_events set state='sending',claim_token=token,claimed_at=now(),attempts=attempts+1 where id=e.id;
 return jsonb_build_object('id',e.id,'token',token,'leadId',m.meta_id,'name',e.stage,'occurredAt',e.occurred_at);
end $$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'icash_meta_%'
 loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
commit;
