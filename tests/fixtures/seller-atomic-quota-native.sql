-- Disposable schema/rows only. All exercised production predicates are loaded
-- separately from seller-atomic-quota-predicates.json, without leaf stubs.
-- Unrelated signup, message dispatch, settlement and receipt-immutability
-- triggers are not installed. This fixture never calls a provider.
alter table public.icash_accounts add billing_model text default 'prepaid';
alter table public.icash_seller_intakes add sharing_text text;
alter table public.icash_seller_matches add assigned_at timestamptz;
alter table public.icash_meta_leads add account_id uuid,add screening_id uuid,
 add source_id uuid,add meta_id text,add submitted_at timestamptz,
 add page_id text,add form_id text,add consent_receipt jsonb,add consent_text text,
 add consent_version text,add timezone text,add contact_until timestamptz,
 add paused boolean default false,add declined_at timestamptz;
create table public.icash_customer_identities(account_id uuid primary key,principal text);
create table public.icash_timezone_names(name text primary key);
create table public.icash_research_state_exclusions(state_code text,effective_from date);
create table public.icash_memberships(account_id uuid,mode text,state text,paid_through timestamptz);
create table public.icash_spend_activations(account_id uuid,enabled boolean);
create table public.icash_daily_plans(account_id uuid,state text,mode text,consent_version text);
create table public.icash_outreach_campaigns(account_id uuid,enabled boolean,mode text);
create table public.icash_funding_orders(account_id uuid,mode text,state text,credited_at timestamptz);
create table public.icash_seller_responses(lead_id uuid,screening_id uuid,account_id uuid,state text);
create table public.icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb,result jsonb);
create table public.icash_deal_files(id uuid primary key,screening_id uuid,account_id uuid,stage text,terms jsonb);
create table public.icash_property_controls(account_id uuid,property_id text,manual boolean);
create table public.icash_handoffs(account_id uuid,screening_id uuid,state text);
create table public.icash_signing_envelopes(account_id uuid,deal_id uuid,test_mode boolean);
create table public.icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,recipient text,retired_at timestamptz,manual_only boolean,ai_mode text,paused boolean);
create table public.icash_text_messages(id uuid primary key,thread_id uuid,account_id uuid,direction text,state text,provider_id text);
create table public.icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid);
create table public.icash_voice_jobs(id uuid primary key,permission_id uuid,account_id uuid,callback_id uuid,state text,outcome text,operation_key text,provider_call_sid text,conversation_id uuid);
create table public.icash_call_recordings(account_id uuid,screening_id uuid,voice_job_id uuid);
create table public.icash_live_conversations(account_id uuid,screening_id uuid);
create table public.icash_meta_lead_sources(id uuid primary key,account_id uuid,page_id text,form_id text,principal text,enabled boolean,reviewed_until timestamptz,consent_key text,consent_text text,consent_version text,timezone text,routing_mode text,sharing_text text,contact_basis text);
create table public.icash_make_lead_inbox(meta_id text,page_id text,form_id text,payload jsonb,is_test boolean,state text);
insert into public.icash_customer_identities values('48dfb798-8c1a-404f-88c0-c396cc067062','SYNTHETIC Buyer');
insert into public.icash_timezone_names values('America/Chicago');
insert into public.icash_spend_activations values('48dfb798-8c1a-404f-88c0-c396cc067062',true);

create function public.fixture_seller_quota_seed(p_kind text,p_lead uuid,p_request uuid) returns void
language plpgsql as $$
declare account constant uuid:='48dfb798-8c1a-404f-88c0-c396cc067062';
 screen uuid:=gen_random_uuid();deal uuid:=gen_random_uuid();thread uuid:=gen_random_uuid();permission uuid:=gen_random_uuid();source uuid:=gen_random_uuid();
 stamp timestamptz:=now();meta text:=replace(p_lead::text,'-','');
 consent constant text:='I agree to marketing calls, texts and emails about my property from HomeOffer Network and its matched buyers, including automated texts and AI-generated voice calls. Consent is not a condition of buying or selling. Message/data rates may apply. Reply STOP to texts or unsubscribe from emails.';
 receipt jsonb;raw jsonb;
begin
 perform public.fixture_owner_demo_lead(p_lead,p_request);
 if p_kind in ('seller','untargeted','demo') then return;end if;
 update public.icash_seller_intakes set name='SYNTHETIC Seller',consent_version='homeoffer-seller-contact-2026-10-05.4',consent_text=consent,
  contact_consent_scope='homeoffer_network_and_matched_buyers',data_rights_until=stamp+interval '1 day',
  attribution='{"source":"fixture","contactTimezone":"America/Chicago","contactTimezoneSource":"seller_browser"}',
  assigned_account=account,screening_id=screen,sharing_text='SYNTHETIC reviewed network sharing with matched buyers.' where id=p_lead;
 if p_kind='refresh' then
  update public.icash_seller_intakes set state='assigned',checked_at=stamp-interval '25 hours',
   property=jsonb_build_object('id','fixture-property-'||p_lead,'fetchedAt',stamp-interval '25 hours'),result='{"financialCheck":{"status":"eligible"}}' where id=p_lead;
  insert into public.icash_seller_matches values(p_lead,account,screen,stamp);
  insert into public.icash_seller_responses values(p_lead,screen,account,'queued');
  insert into public.icash_screening_jobs values(screen,account,'complete',jsonb_build_object('propertyId','fixture-property-'||p_lead,'fetchedAt',stamp-interval '25 hours','sellerRequest',jsonb_build_object('id',p_lead)),'{"financialCheck":{"status":"eligible"}}');
  insert into public.icash_deal_files values(deal,screen,account,'draft','{}');
  insert into public.icash_text_threads values(thread,account,deal,'seller','+12142185280',null,false,'auto',false);
  insert into public.icash_text_messages values(gen_random_uuid(),thread,account,'outgoing','ready',null);
  insert into public.icash_contact_permissions values(permission,account,screen);
  insert into public.icash_voice_jobs values(gen_random_uuid(),permission,account,null,'held','fresh_screening_required',null,null,null);
 elsif p_kind in ('meta','meta_network','meta_submission') then
  receipt:='[{"checkbox_key":"fixture-consent","is_checked":true}]';
  if p_kind='meta_submission' then
   receipt:=jsonb_build_array(jsonb_build_object('kind','form_submission','provider','meta','metaId',meta,'pageId','10001','formId','10002','submittedAt',stamp::text));
   raw:=jsonb_build_object('created_time',stamp::text,'field_data',jsonb_build_array(jsonb_build_object('name','full_name','values',jsonb_build_array('SYNTHETIC Seller')),jsonb_build_object('name','phone_number','values',jsonb_build_array('+12142185280'))));
   insert into public.icash_make_lead_inbox values(meta,'10001','10002',raw,false,'accepted');
  end if;
  if p_kind<>'meta_network' then update public.icash_seller_intakes set contact_consent_scope='meta_direct_principal' where id=p_lead;end if;
  insert into public.icash_meta_lead_sources values(source,case when p_kind='meta_network' then null else account end,'10001','10002',case when p_kind='meta_network' then 'HomeOffer Network' else 'SYNTHETIC Buyer' end,true,stamp+interval '1 day','fixture-consent',consent,'homeoffer-seller-contact-2026-10-05.4','America/Chicago',case when p_kind='meta_network' then 'network_pool' else 'direct' end,'SYNTHETIC reviewed network sharing with matched buyers.',case when p_kind='meta_submission' then 'form_submission' else 'checkbox' end);
  insert into public.icash_meta_leads(lead_id,account_id,screening_id,source_id,meta_id,submitted_at,page_id,form_id,consent_receipt,consent_text,consent_version,timezone,contact_until)
   values(p_lead,account,screen,source,meta,stamp,'10001','10002',receipt,consent,'homeoffer-seller-contact-2026-10-05.4','America/Chicago',stamp+interval '1 day');
 else raise exception 'Unknown fixture kind: %',p_kind;end if;
end$$;
