-- Disposable local/native test foundation. No production data or providers.
create role anon;create role authenticated;create role service_role;
create schema icash_research_private;
create table public.icash_operating_budget(id integer primary key,enabled boolean);
create table public.icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false,workspace_ack_version text default 'fixture',membership_allowed boolean default true,acquisition_allowed boolean default true);
create table public.icash_wallets(account_id uuid primary key,balance_cents bigint,reserved_cents bigint);
create table public.icash_billing_reviews(account_id uuid,resolved_at timestamptz);
create table public.icash_support_cancel_requests(account_id uuid,confirmed_at timestamptz);
create table public.icash_control_events(id uuid default gen_random_uuid(),account_id uuid,created_at timestamptz,property_id text);
create table public.icash_seller_controls(id integer primary key,enabled boolean,data_rights_until timestamptz,review_ref text,lookup_used_micros bigint default 0,lookup_reserved_micros bigint default 0,lookup_allowance_micros bigint,assignment_fee_cents bigint default 1000000,seller_cost_reserve_cents bigint default 100000);
create table public.icash_seller_intakes(id uuid primary key,request_id uuid not null unique,name text default 'Fixture owner',phone text,address text,ai_consented boolean,consent_version text,consent_text text,contact_consent_scope text,attribution jsonb,state text,canonical_id uuid,created_at timestamptz,claim_token uuid,claimed_at timestamptz,checked_at timestamptz,lookup_costs jsonb,lookup_cap_micros bigint,lookup_cost_basis text,data_rights_until timestamptz,property jsonb,result jsonb,operation_key text,assigned_account uuid,screening_id uuid,assigned_at timestamptz,hold_reason text);
create table public.icash_optin_call_requests(lead_id uuid primary key references public.icash_seller_intakes(id),request_id uuid,phone text,account_id uuid,requested_by uuid,source text,request_version text,request_reference text,request_text text,requested_at timestamptz,expires_at timestamptz);
create table public.icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
create table public.icash_operation_spend(operation_key text);
create table public.icash_meta_leads(lead_id uuid);
create table public.icash_text_suppressions(phone text);
create table public.icash_contact_suppressions(contact_key text);
create table public.icash_dealmachine_request_budget(id integer primary key,minute_start timestamptz,minute_used integer,day_start timestamptz,day_used integer,minute_limit integer,day_limit integer);
create table public.icash_operation_rates(id uuid primary key,operation text,enabled boolean,verified_at timestamptz,expires_at timestamptz,costs_micros jsonb,evidence_ref text);
create table public.icash_data_cost_settings(provider text,credit_micros bigint,cost_basis text,source_ref text);
create table icash_research_private.requests(id uuid primary key,kind text,account_id uuid,operation_key text,admitted boolean,created_at timestamptz default now(),finished_at timestamptz,result jsonb);
create table icash_research_private.quota_feedback(id integer primary key,request_id uuid,request_started_at timestamptz,observed_at timestamptz,headers jsonb,blocked_until timestamptz);
create function public.icash_membership_work_allowed(uuid) returns boolean language sql stable as $$select membership_allowed from public.icash_accounts where id=$1$$;
create function public.icash_credit_acquisition_allowed(uuid) returns boolean language sql stable as $$select acquisition_allowed from public.icash_accounts where id=$1$$;
create function public.icash_address_state(text) returns text language sql immutable as $$select case when $1 like '% TX %' then 'TX' else 'XX' end$$;
create function public.icash_research_state_allowed(text) returns boolean language sql immutable as $$select $1='TX'$$;
create function public.icash_dealmachine_provider_available() returns boolean language sql stable as $$select coalesce((select blocked_until is null or blocked_until<=now() from icash_research_private.quota_feedback where id=1),false)$$;
CREATE OR REPLACE FUNCTION public.icash_claim_seller_lookup_for(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_seller_controls;l public.icash_seller_intakes;r public.icash_operation_rates;u public.icash_data_cost_settings;parts jsonb;cap bigint;token uuid:=gen_random_uuid();
begin
 select * into c from public.icash_seller_controls where id=1 for update;
 if not c.enabled or c.data_rights_until is null or c.data_rights_until<=now() or length(coalesce(c.review_ref,''))<10 then return null;end if;
 -- An ambiguous lookup is held permanently until an operator reconciles it.
 update public.icash_seller_intakes set state='review',hold_reason='Lookup outcome unknown; do not repeat automatically' where state='checking' and claimed_at<now()-interval '2 minutes';
 select * into r from public.icash_operation_rates where operation='property_search' and enabled and verified_at<=now() and expires_at>now() order by verified_at desc,id limit 1;
 select * into u from public.icash_data_cost_settings where provider='dealmachine';
 if r.id is null or u.credit_micros is null then return null;end if;
 parts:=r.costs_micros||jsonb_build_object('dealmachine',u.credit_micros,'acquisition',0);
 select sum(value::numeric)::bigint into cap from jsonb_each_text(parts);
 if cap<=0 or c.lookup_used_micros+c.lookup_reserved_micros+cap>c.lookup_allowance_micros then return null;end if;
 update public.icash_seller_intakes set state='review',hold_reason='Property state is excluded or needs an exact postal address; no paid research started' where state='received' and (not exists(select 1 from public.icash_meta_leads ml where ml.lead_id=icash_seller_intakes.id) or id::text=current_setting('icash.meta_lookup_lead',true)) and (p_id is null or id=p_id) and not public.icash_research_state_allowed(public.icash_address_state(address));
 select * into l from public.icash_seller_intakes where state='received' and (not exists(select 1 from public.icash_meta_leads ml where ml.lead_id=icash_seller_intakes.id) or id::text=current_setting('icash.meta_lookup_lead',true)) and (p_id is null or id=p_id) order by created_at,id limit 1 for update skip locked;
 if not found then return null;end if;
 update public.icash_seller_controls set lookup_reserved_micros=lookup_reserved_micros+cap where id=1;
 update public.icash_seller_intakes set state='checking',claim_token=token,claimed_at=now(),lookup_costs=parts,lookup_cap_micros=cap,lookup_cost_basis=u.cost_basis||'; '||u.source_ref||'; non-data allocations: '||r.evidence_ref,data_rights_until=c.data_rights_until where id=l.id;
 return jsonb_build_object('id',l.id,'token',token,'address',l.address,'assignmentFeeCents',c.assignment_fee_cents,'sellerCostReserveCents',c.seller_cost_reserve_cents);
end $function$;

CREATE OR REPLACE FUNCTION public.icash_finish_dealmachine_request(p_request uuid, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k text;v jsonb;clean jsonb;
begin
 if coalesce(p_result->>'outcome','') not in ('response','http_error','unknown') or jsonb_typeof(p_result) is distinct from 'object' then return false;end if;
 clean:=jsonb_build_object('outcome',p_result->>'outcome');
 foreach k in array array['httpStatus','returned','creditsUsed','minuteRemaining','dayRemaining','retryAfter','minuteLimit','minuteReset','dayLimit'] loop
  v:=p_result->k;
  if v is not null and v<>'null'::jsonb then
   if jsonb_typeof(v)<>'number' or v::text !~ '^[0-9]{1,10}$' then return false;end if;
   clean:=clean||jsonb_build_object(k,v);
  end if;
 end loop;
 update icash_research_private.requests set finished_at=now(),result=clean where id=p_request and admitted and finished_at is null;
 
 if not found then return false;end if;
 -- The response belongs to a durable admitted request. Retain its original
 -- observation even if another response arrived sooner; latest metadata uses
 -- request start order, and an older 429 can only extend an existing hold.
 update icash_research_private.quota_feedback f set
  request_id=case when f.request_started_at is null or r.created_at>=f.request_started_at then r.id else f.request_id end,
  request_started_at=greatest(f.request_started_at,r.created_at),observed_at=now(),
  headers=case when f.request_started_at is null or r.created_at>=f.request_started_at then clean else f.headers end,
  blocked_until=greatest(f.blocked_until,
   case when clean->>'httpStatus'='429' then now()+make_interval(secs=>least(86400,greatest(1,coalesce((clean->>'retryAfter')::bigint,60)))::integer)
    when clean->>'minuteRemaining'='0' and (clean->>'minuteReset')::bigint between extract(epoch from now()) and extract(epoch from now()+interval '2 minutes') then to_timestamp((clean->>'minuteReset')::bigint)
   end)
 from icash_research_private.requests r where f.id=1 and r.id=p_request and r.admitted;
 return true;
 
end $function$;

create function public.fixture_owner_demo_lead(p_lead uuid,p_request uuid) returns void language plpgsql as $$
declare stamp timestamptz:=clock_timestamp();
begin
 insert into public.icash_seller_intakes(id,request_id,phone,address,ai_consented,consent_version,consent_text,contact_consent_scope,attribution,state,created_at)
 values(p_lead,p_request,'+12142185280','45 Fixture Lane, Dallas, TX 75201',true,'icash-x-demo-contact-2026-10-10.1',
 'I agree to calls and texts from iCash X about this property demo, including automated texts and AI-generated voice calls. I have permission to use this number. Consent is not a condition of purchase. Message/data rates may apply. Reply STOP to end texts.',
 'icash_x_demo','{"source":"icash_x_demo","demoAccountId":"48dfb798-8c1a-404f-88c0-c396cc067062"}','received',stamp);
 insert into public.icash_optin_call_requests values(p_lead,p_request,'+12142185280','48dfb798-8c1a-404f-88c0-c396cc067062','592171a0-2bb9-484e-8c9a-dd5d2b43b5f7','demo_form','icash-optin-call-now-2026-10-16.1','icash-optin-call-now-2026-10-16.1','Call me now about this property, including outside normal calling hours.',stamp,stamp+interval '5 minutes');
end $$;
insert into public.icash_operating_budget values(1,true);
insert into public.icash_accounts(id,owner_user_id) values('48dfb798-8c1a-404f-88c0-c396cc067062','592171a0-2bb9-484e-8c9a-dd5d2b43b5f7');
insert into public.icash_wallets values('48dfb798-8c1a-404f-88c0-c396cc067062',816,0);
insert into public.icash_seller_controls(id,enabled,data_rights_until,review_ref,lookup_allowance_micros) values(1,true,now()+interval '30 days','Fixture data rights',10000000);
insert into public.icash_operation_rates values('10000000-0000-4000-8000-000000000001','property_search',true,now()-interval '1 hour',now()+interval '30 days','{"dealmachine":10000,"vercel":3000,"railway":3000,"acquisition":0}','Fixture original rate evidence');
insert into public.icash_data_cost_settings values('dealmachine',10000,'Fixture observed price','Fixture rate source');
insert into public.icash_dealmachine_request_budget values(1,now(),0,now()-interval '3 hours',9800,60,9800);
insert into icash_research_private.requests(id,kind,admitted,created_at,finished_at,result) values('10000000-0000-4000-8000-000000000002','property_search',true,now()-interval '2 hours',now()-interval '2 hours'+interval '1 second','{"outcome":"response","httpStatus":200,"minuteLimit":70,"dayLimit":10000,"dayRemaining":201}');
insert into icash_research_private.quota_feedback values(1,'10000000-0000-4000-8000-000000000002',now()-interval '2 hours',now()-interval '2 hours'+interval '1 second','{"outcome":"response","httpStatus":200,"minuteLimit":70,"dayLimit":10000,"dayRemaining":201}',null);

