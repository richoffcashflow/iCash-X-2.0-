-- Isolated synthetic records. No production identifiers, provider access or money.
create role anon;create role authenticated;create role service_role;
create schema auth;create schema icash_seller_agreement_private;create schema icash_call_offer_private;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create table public.icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false);
create table public.icash_operating_budget(id int primary key);insert into public.icash_operating_budget values(1);
create table public.icash_outreach_campaigns(account_id uuid);
create table public.icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb,result jsonb,completed_at timestamptz);
create table public.icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb);
create table public.icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text,state text,test_mode boolean,provider_id text,terms jsonb,recipients jsonb);
create table public.icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,recipient text,sender text,retired_at timestamptz,paused boolean default false,manual_only boolean default false,ai_mode text default 'auto',dnc_checked_at timestamptz);
create table public.icash_text_messages(id uuid primary key,account_id uuid,thread_id uuid,direction text,state text,provider_id text,body text,customer_author_id uuid,asset_ids uuid[] default '{}',attachments jsonb default '[]',created_at timestamptz default now());
create table public.icash_contract_text_deliveries(envelope_id uuid,signer_id text,account_id uuid,thread_id uuid,message_id uuid unique);
create table public.icash_operation_spend(operation_key text primary key,account_id uuid,state text);
create table public.icash_property_controls(account_id uuid,property_id text,manual boolean);
create table public.icash_text_suppressions(phone text);
create table public.icash_contact_suppressions(contact_key text);
create table public.icash_agreement_cancellations(deal_id uuid,late_activity boolean);
create table public.icash_text_ai_jobs(account_id uuid,id uuid,outgoing_id uuid,analysis jsonb,thread_id uuid,state text,message_id uuid);
create table public.icash_sms_seller_openings(thread_id uuid,owner_question_id uuid);
create table public.icash_seller_opener_assignments(account_id uuid,message_id uuid);
create table public.icash_sms_inbound_invitations(account_id uuid,message_id uuid,thread_id uuid,sender text,recipient text,deal_id uuid,expires_at timestamptz,called_number text,reply_id uuid);
create table public.icash_inbound_voice_routes(called_number text,business_number text,enabled boolean,reviewed_until timestamptz,agent_config_hash text);
create table icash_seller_agreement_private.confirmations(id uuid primary key,call_key text,account_id uuid,deal_id uuid,confirmation jsonb,terms jsonb,envelope_id uuid,state text,created_at timestamptz default now());
create table icash_call_offer_private.offers(account_id uuid,deal_id uuid,snapshot jsonb,state jsonb);
create table icash_seller_agreement_private.delivery_recovery(id uuid primary key,account_id uuid,requested_by uuid,deal_id uuid,phone text,seller_name text,expected_terms jsonb,envelope_id uuid,request_key text,state text,result jsonb,created_at timestamptz default now(),claimed_at timestamptz,expires_at timestamptz);
create table public.fixture_controls(sms boolean default true,membership boolean default true);
insert into public.fixture_controls default values;
create function public.icash_membership_work_allowed(uuid) returns boolean language sql as $$select membership from public.fixture_controls$$;
create function public.icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select sms from public.fixture_controls$$;
create function public.icash_outreach_sms_current(uuid) returns boolean language sql as $$select sms from public.fixture_controls$$;
create function public.icash_customer_authored_text(uuid,uuid) returns boolean language sql as $$select false$$;
create function public.icash_seller_recovery_nonprice_current(uuid,uuid) returns boolean language sql as $$select false$$;
create function public.icash_seller_conversation_message_current(uuid,uuid) returns boolean language sql as $$select false$$;
create function public.icash_seller_limited_contact(uuid,uuid) returns boolean language sql as $$select true$$;
create function public.icash_limited_seller_text_current(uuid,uuid) returns boolean language sql as $$select false$$;
create function public.icash_manual_handoff_reply(uuid,uuid) returns boolean language sql as $$select false$$;
create function public.icash_buyer_package_data(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
create function public.icash_buyer_factual_text(uuid,uuid,text) returns text language sql as $$select null::text$$;
create function public.icash_sms_inbound_campaign_current(uuid) returns boolean language sql as $$select false$$;
-- Existing transport/budget internals have their own suites. This terminal stub
-- models one atomic dispatch claim after the real installed admission wrapper.
create function public.icash_claim_text_before_campaign(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql as $$
begin
 if exists(select 1 from public.icash_operation_spend where operation_key='text:'||p_message) then return null;end if;
 insert into public.icash_operation_spend values('text:'||p_message,p_account,'dispatched');
 update public.icash_text_messages set state='dispatching' where id=p_message and account_id=p_account and state='ready';
 return jsonb_build_object('messageId',p_message);
end$$;
create function public.icash_signing_action_allowed(p_account uuid,p_envelope uuid) returns boolean language sql stable as $$
 select exists(select 1 from public.icash_signing_envelopes e join public.icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id
 where e.id=p_envelope and e.account_id=p_account and e.state not in ('cancellation_pending','cancelled') and d.stage not in ('cancellation_pending','cancelled','closed')
 and not exists(select 1 from public.icash_agreement_cancellations c where c.deal_id=d.id and c.late_activity));
$$;

insert into auth.users values('00000000-0000-4000-8000-000000000006','owner@example.invalid',now());
insert into public.icash_accounts values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000006',false);
insert into public.icash_screening_jobs values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','complete','{"propertyId":"fixture-property"}','{"financialCheck":{"status":"hold"}}',now());
insert into public.icash_deal_files select '00000000-0000-4000-8000-000000000004',account_id,id,'draft',jsonb_build_object('seller','Fixture Seller','buyer','Fixture Buyer','priceCents',9000000,'closingDate',to_char(now()+interval '30 days','YYYY-MM-DD'),'inspectionDays',10) from public.icash_screening_jobs;
insert into public.icash_signing_envelopes select '00000000-0000-4000-8000-000000000007',account_id,id,'purchase','awaiting_counterparty',false,'fixture-provider',terms,'[{"id":"1","name":"Fixture Seller","phone":"+12025550101"},{"id":"2","name":"Fixture Buyer","email":"owner@example.invalid"}]'::jsonb from public.icash_deal_files;
insert into public.icash_text_threads(id,account_id,deal_id,party,recipient,sender) select '00000000-0000-4000-8000-000000000005',account_id,id,'seller','+12025550101','+12025550102' from public.icash_deal_files;
insert into public.icash_text_messages(id,account_id,thread_id,direction,state,body) select '00000000-0000-4000-8000-000000000008',account_id,id,'outgoing','ready','Review your contract: https://docuseal.com/s/fixture_only' from public.icash_text_threads;
insert into public.icash_contract_text_deliveries select e.id,'1',e.account_id,m.thread_id,m.id from public.icash_signing_envelopes e cross join public.icash_text_messages m;
insert into icash_call_offer_private.offers select d.account_id,d.id,s.snapshot,'{"acceptedPriceCents":9000000,"quotedPriceCents":9000000,"factsPending":false,"payoffPending":false,"contractBlocked":false,"acceptanceConditional":false}'::jsonb from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id;
insert into icash_seller_agreement_private.confirmations select '00000000-0000-4000-8000-000000000009','outbound:fixture-call',account_id,deal_id,jsonb_build_object('sellerLegalName',terms->>'seller','agreedPriceCents',terms->'priceCents','closingDate',terms->>'closingDate','sendTextRequested',true,'termsConfirmed',true,'priceAndDateConfirmed',true,'allDecisionMakersAgree',true,'soleOwner',true,'materialFactsChanged',false),terms,id,'ready',now() from public.icash_signing_envelopes;
insert into icash_seller_agreement_private.delivery_recovery select '00000000-0000-4000-8000-000000000010',account_id,'00000000-0000-4000-8000-000000000006',deal_id,'+12025550101','Fixture Seller',terms,envelope_id,'seller-confirmed:'||id,'needs_review','{"sent":false,"status":"held"}',now(),now()-interval '3 minutes',now()+interval '24 hours' from icash_seller_agreement_private.confirmations;
