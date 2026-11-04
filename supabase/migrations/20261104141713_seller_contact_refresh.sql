-- Atomic prospective seller contact refresh; no historical replay.
begin;
-- Source: config/seller-contact-refresh.sql
-- Prospective, one-request national DNC refresh for an otherwise eligible reminder.
-- The old purchase, original DNC observation, send history and expiry remain immutable.
set local lock_timeout='5s';
set local statement_timeout='30s';
create table icash_seller_recovery_private.contact_refresh_policy(
 id integer primary key check(id=1),enabled boolean not null,activated_at timestamptz not null,
 scan_due_at timestamptz,scan_gap_id uuid,check((scan_due_at is null)=(scan_gap_id is null))
);
insert into icash_seller_recovery_private.contact_refresh_policy(id,enabled,activated_at) values(1,true,clock_timestamp());
create table icash_seller_recovery_private.contact_refreshes(
 id uuid primary key default gen_random_uuid(),gap_id uuid not null unique references public.icash_seller_gaps(id),
 account_id uuid not null references public.icash_accounts(id),original_contact_id uuid not null references public.icash_operational_contacts(id),
 operation_key text not null unique references public.icash_operation_spend(operation_key),rate_id uuid not null references public.icash_operation_rates(id),
 unit_cost_micros bigint not null check(unit_cost_micros>0),request_id uuid not null unique,requested_at timestamptz not null,
 original_snapshot jsonb not null,state text not null default 'requested' check(state in ('requested','responded','processed')),
 http_status integer,response jsonb,response_at timestamptz,receipt_id uuid references public.icash_dnc_verification_receipts(id),
 successor_contact_id uuid references public.icash_operational_contacts(id),outcome text,
 check((response_at is null)=(http_status is null)),check(http_status between 100 and 599)
);
create index contact_refresh_pending on icash_seller_recovery_private.contact_refreshes(state,requested_at);
alter table icash_seller_recovery_private.contact_refresh_policy enable row level security;
alter table icash_seller_recovery_private.contact_refreshes enable row level security;
revoke all on icash_seller_recovery_private.contact_refresh_policy,icash_seller_recovery_private.contact_refreshes from public,anon,authenticated,service_role;
grant select on icash_seller_recovery_private.contact_refresh_policy,icash_seller_recovery_private.contact_refreshes to service_role;

-- Reject receipt rewriting, claim reassignment and deleting unknown outcomes.
create function icash_seller_recovery_private.keep_contact_refresh() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or to_jsonb(new)-array['state','http_status','response','response_at','receipt_id','successor_contact_id','outcome']
  is distinct from to_jsonb(old)-array['state','http_status','response','response_at','receipt_id','successor_contact_id','outcome']
  or (old.response_at is not null and row(new.http_status,new.response,new.response_at) is distinct from row(old.http_status,old.response,old.response_at))
  or (old.state='processed' and to_jsonb(new) is distinct from to_jsonb(old))
  or (old.state='responded' and new.state='requested') then raise exception 'Contact refresh receipt is immutable';end if;
 return new;
end $$;
create trigger contact_refresh_immutable before update or delete on icash_seller_recovery_private.contact_refreshes
 for each row execute function icash_seller_recovery_private.keep_contact_refresh();

-- Reuse the original exact owner-purchase binding validator. Only its original
-- request-age condition is omitted here: it validates ancestry, never freshness.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.icash_lock_operational_dnc(uuid,uuid)'::regprocedure);
 needle:='and i.request_started_at+make_interval(secs=>policy.max_observation_age_seconds)>stamp';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Original observation binding prerequisite changed';end if;
 d:=replace(d,'public.icash_lock_operational_dnc(', 'icash_seller_recovery_private.original_contact_binding(');
 execute replace(d,needle,'');
end $$;

create function icash_seller_recovery_private.contact_refresh_current(p_gap uuid,p_original uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare g public.icash_seller_gaps;t public.icash_text_threads;c public.icash_operational_contacts;d public.icash_dnc_verification_receipts;stamp timestamptz;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;if not found then return false;end if;
 perform 1 from icash_seller_recovery_private.contact_refresh_policy where id=1 and enabled for share;if not found then return false;end if;
 select th.* into t from public.icash_text_threads th join public.icash_seller_gaps gap on gap.thread_id=th.id where gap.id=p_gap;
 if not found then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 perform pg_advisory_xact_lock(hashtextextended(encode(sha256(convert_to(t.recipient,'UTF8')),'hex'),17));
 perform 1 from public.icash_accounts where id=t.account_id and not bot_paused for update;if not found then return false;end if;
 select * into t from public.icash_text_threads where id=t.id for update;
 select * into g from public.icash_seller_gaps where id=p_gap for update;
 select * into c from public.icash_operational_contacts where id=p_original and account_id=g.account_id for share;
 select * into d from public.icash_dnc_verification_receipts where id=c.dnc_receipt_id for share;
 stamp:=clock_timestamp();
 if c.id is null or t.operational_contact_id is distinct from c.id or c.screening_id<>g.screening_id or c.channel<>'sms'
  or c.revoked_at is not null or c.phone<>t.recipient or c.timezone<>t.timezone
  or d.evidence_kind is distinct from 'national_provider_observation' or d.clear is distinct from true or d.revoked_at is not null
  or t.account_id<>g.account_id or t.deal_id<>g.deal_id or t.party<>'seller' or t.seller_intake_id is not null
  or t.paused or t.manual_only or t.ai_mode<>'auto' or t.retired_at is not null
  or g.state<>'needs_review' or g.review_reason is distinct from 'contact_checks_expired' or g.reason<>'no_response' or g.stage<>'draft'
  or g.outgoing_id is not null or g.due_at>stamp or g.expires_at<=stamp
  or not exists(select 1 from public.icash_sms_routes where sender=t.sender and recipient=t.recipient and account_id=t.account_id and not needs_review)
  or not exists(select 1 from public.icash_customer_identities where account_id=c.account_id and principal=c.sending_principal)
  or not exists(select 1 from public.icash_accounts where id=c.account_id and owner_user_id=c.owner_user_id)
  or not exists(select 1 from public.icash_discovery_configs where account_id=c.account_id and contacts_enabled and data_rights_until>stamp)
  or exists(select 1 from public.icash_text_suppressions where phone=c.phone)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=c.contact_key)
  or exists(select 1 from public.icash_contact_permissions where account_id=c.account_id and screening_id=c.screening_id and phone=c.phone and revoked_at is not null)
  or exists(select 1 from public.icash_text_messages where thread_id=t.id and direction='outgoing' and state in ('ready','dispatching','needs_review'))
  or exists(select 1 from public.icash_text_ai_jobs where thread_id=t.id and state not in ('superseded','queued'))
  or exists(select 1 from public.icash_seller_gaps where thread_id=t.id and id<>g.id and state in ('open','queued'))
  or exists(select 1 from public.icash_seller_recovery_attempts where thread_id=t.id)
  or exists(select 1 from public.icash_property_controls pc join public.icash_screening_jobs s on s.account_id=pc.account_id and s.snapshot->>'propertyId'=pc.property_id where s.id=g.screening_id and pc.manual)
  or not exists(select 1 from public.icash_text_messages where id=g.source_id and g.source='text' and account_id=g.account_id and thread_id=t.id and direction='outgoing' and state='delivered' and provider_id is not null)
  or not exists(select 1 from public.icash_screening_jobs where id=g.screening_id and account_id=g.account_id and state='complete' and result->'financialCheck'->>'status'='eligible' and completed_at between stamp-interval '7 days' and stamp)
  or not exists(select 1 from public.icash_owner_contacts oc join public.icash_operation_spend spend on spend.operation_key=oc.operation_key and spend.account_id=oc.account_id and spend.state='settled' where oc.account_id=c.account_id and oc.screening_id=c.screening_id and public.icash_operational_source_phone(oc.result,c.phone))
  or public.icash_seller_text_cadence_current(g.account_id,t.id,null,true) is distinct from true
  or icash_seller_recovery_private.original_contact_binding(c.account_id,c.id) is distinct from true
 then return false;end if;
 return true;
end $$;

-- Exact single-phone response and credit accounting. An omitted/unknown DNC
-- boolean can be billed from a valid receipt but can never clear the contact.
create function icash_seller_recovery_private.phone_response_valid(p jsonb,p_phone text) returns boolean
language plpgsql immutable set search_path='' as $$
declare field text;m integer;
begin
 if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'data') is distinct from 'array' then return false;end if;
 if jsonb_array_length(p->'data')<>1 or jsonb_typeof(p#>'{data,0,matched}') is distinct from 'boolean' or p#>'{data,0,matched}' not in ('true'::jsonb,'false'::jsonb)
  or public.icash_operational_phone(p#>>'{data,0,input,number}') is distinct from p_phone then return false;end if;
 foreach field in array array['used','people','deduplicated'] loop
  if jsonb_typeof(p->'credits'->field) is distinct from 'number' or p->'credits'->>field not in ('0','1') then return false;end if;
 end loop;
 m:=case when p#>'{data,0,matched}'='true'::jsonb then 1 else 0 end;
 return coalesce(p#>'{totals,submitted}'='1'::jsonb and p#>'{totals,matched}'=to_jsonb(m) and p#>'{totals,unmatched}'=to_jsonb(1-m)
  and (p#>>'{credits,people}')::int=m and (p#>>'{credits,used}')::int+(p#>>'{credits,deduplicated}')::int=m,false);
end $$;

-- The refresh is a distinct typed observation, never a fabricated legacy record.
alter table public.icash_dnc_verification_receipts drop constraint icash_dnc_verification_receipts_evidence_kind_check;
alter table public.icash_dnc_verification_receipts add constraint icash_dnc_verification_receipts_evidence_kind_check
 check(evidence_kind in ('legacy_record','national_provider_observation','national_phone_observation'));
-- Preserve the existing national-owner shape unchanged; the new observation has
-- its own shape below, plus exact receipt/ancestry validation at every use.
do $$declare d text;begin
 select pg_get_constraintdef(oid) into d from pg_constraint where conrelid='public.icash_dnc_verification_receipts'::regclass and conname='icash_dnc_observation_receipt_shape';
 if d is null then raise exception 'National observation receipt prerequisite missing';end if;
 alter table public.icash_dnc_verification_receipts drop constraint icash_dnc_observation_receipt_shape;
 execute 'alter table public.icash_dnc_verification_receipts add constraint icash_dnc_observation_receipt_shape check (evidence_kind=''national_phone_observation'' or '||substring(d from 7)||')';
end $$;
alter table public.icash_dnc_verification_receipts add constraint icash_dnc_phone_observation_shape check(evidence_kind<>'national_phone_observation' or coalesce(
 observation_recorded_at is not null and observation_provenance->>'provider'='dealmachine'
 and observation_provenance->>'scope'='national_only' and observation_provenance->>'freshnessBasis'='saved_request_start_lower_bound'
 and observation_provenance->>'sourceTable'='icash_seller_recovery_private.contact_refreshes'
 and observation_provenance->>'consentVerification'='not_performed' and observation_provenance->>'stateClearance'='not_established'
 and observation_provenance->'providerCheckedAt'='null'::jsonb and observation_provenance->'registryUpdatedAt'='null'::jsonb
 and observation_provenance->'reportedDoNotCall'='false'::jsonb,false));
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.icash_dealmachine_observation_immutable()'::regprocedure);
 needle:='old.evidence_kind=''national_provider_observation''';
 if strpos(d,needle)=0 then raise exception 'Observation immutability prerequisite changed';end if;
 execute replace(d,needle,'old.evidence_kind in (''national_provider_observation'',''national_phone_observation'')');
 d:=pg_get_functiondef('icash_research_private.take_reserved_request(text,uuid,text,uuid)'::regprocedure);
 needle:='''buyer_search'',''property_lookup'',''photo'')';
 if strpos(d,needle)=0 then raise exception 'Shared request limiter prerequisite changed';end if;
 execute replace(d,needle,'''buyer_search'',''property_lookup'',''photo'',''phone_dnc'')');
end $$;
-- Phone checks use ordinary shared capacity and never the first-account reserve.

create function public.icash_record_seller_contact_refresh(p_id uuid,p_request uuid,p_status integer,p_response jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare f icash_seller_recovery_private.contact_refreshes;
begin
 select * into f from icash_seller_recovery_private.contact_refreshes where id=p_id and request_id=p_request for update;
 if not found or p_status not between 100 and 599 or octet_length(coalesce(p_response,'null'::jsonb)::text)>262144 then return false;end if;
 if f.response_at is not null then return f.http_status=p_status and f.response is not distinct from p_response;end if;
 update icash_seller_recovery_private.contact_refreshes set response=p_response,http_status=p_status,response_at=clock_timestamp(),state='responded' where id=f.id;
 return true;
end $$;

revoke all on all functions in schema icash_seller_recovery_private from public,anon,authenticated,service_role;
revoke all on function public.icash_record_seller_contact_refresh(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.icash_record_seller_contact_refresh(uuid,uuid,integer,jsonb) to service_role;
-- Source: config/seller-contact-refresh-billing.sql
-- One-phone follow-up checks use the existing DealMachine credit allocation,
-- 3x data/VIP policy, customer wallet and prospecting allowance. No legacy
-- owner purchase, rate, reservation or settlement is changed.
set local lock_timeout='5s';
set local statement_timeout='30s';

-- The narrow operation kind prevents a DNC request masquerading as a second
-- immutable owners:<account>:<screening> purchase. Preserve the current guard
-- bodies and fail migration when their expected policy boundary has changed.
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_reserve_before_fractional(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 needle:=$old$r.operation in ('property_search','owner_enrichment','buyer_discovery')$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'DealMachine reserve policy changed';end if;
 execute replace(d,needle,$new$r.operation in ('property_search','owner_enrichment','buyer_discovery','contact_revalidation')$new$);
 d:=pg_get_functiondef('public.icash_new_prospect_operation(uuid,text,uuid)'::regprocedure);
 needle:=$old$if kind in ('property_search','owner_enrichment') then return true;end if;$old$;
 if strpos(d,needle)=0 then raise exception 'Prospecting classification changed';end if;
 execute replace(d,needle,$new$if kind in ('property_search','owner_enrichment','contact_revalidation') then return true;end if;$new$);
 d:=pg_get_functiondef('public.icash_guard_prospecting_spend()'::regprocedure);
 needle:=$old$elsif kind in ('sms_send','mms_send') and public.icash_research_waiting_on_outreach(new.account_id) then$old$;
 if strpos(d,needle)=0 then raise exception 'Prospecting outreach reserve changed';end if;
 execute replace(d,needle,$new$elsif kind='contact_revalidation' then
  required:=public.icash_research_admission_quote(new.account_id,kind,required);
 $new$||needle);
end $patch$;

-- Caller already owns the exact gap/recipient/source locks. This helper may
-- only prepare a new operation once; the caller rolls back if its provider
-- request claim or any final contact control loses a race.
create function icash_seller_recovery_private.reserve_contact_refresh(
 p_account uuid,p_gap uuid,p_rate_expected uuid,p_unit_expected bigint
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.icash_discovery_configs;r public.icash_operation_rates;
 b public.icash_operating_budget;s public.icash_data_cost_settings;
 costs jsonb;part record;price numeric:=0;quote bigint;rate uuid;v_version text;
 op text:='dnc:'||p_gap;reservation jsonb;stamp timestamptz:=clock_timestamp();
begin
 if p_account is null or p_gap is null or p_rate_expected is null or p_unit_expected is null or p_unit_expected<=0 then return null;end if;
 select * into b from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return null;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
 if not found or not coalesce(public.icash_membership_work_allowed(p_account),false)
  or exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null)
  or exists(select 1 from public.icash_operation_spend where operation_key=op)
  or exists(select 1 from icash_seller_recovery_private.contact_refreshes where gap_id=p_gap) then return null;end if;
 perform 1 from public.icash_seller_gaps where id=p_gap and account_id=p_account
  and reason='no_response' and state='needs_review' and review_reason='contact_checks_expired'
  and outgoing_id is null and stage='draft' for update;
 if not found then return null;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account for share;
 if not found or not c.enabled or not c.auto_enabled or not c.contacts_enabled or c.data_rights_until<=stamp
  or c.contact_rate_id is distinct from p_rate_expected or c.property_credit_micros is distinct from p_unit_expected then return null;end if;
 select * into s from public.icash_data_cost_settings where provider='dealmachine' for share;
 if not found or s.credit_micros is distinct from p_unit_expected then return null;end if;
 select * into r from public.icash_operation_rates where id=c.contact_rate_id for share;
 stamp:=clock_timestamp();
 if not found or c.data_rights_until<=stamp or r.operation<>'owner_enrichment' or not r.enabled or r.verified_at>stamp or r.expires_at<=stamp
  or jsonb_typeof(r.costs_micros->'dealmachine') is distinct from 'number'
  or (r.costs_micros->>'dealmachine')::numeric<p_unit_expected then return null;end if;
 costs:=jsonb_set(r.costs_micros,'{dealmachine}',to_jsonb(p_unit_expected));
 -- Inherit every existing allocation. Only the maximum data units change to
 -- one; the underlying reserve function verifies all 16 categories again.
 for part in select key,value from jsonb_each_text(costs) loop
  price:=price+part.value::numeric*case when part.key='dealmachine' then 3
   when part.key='elevenlabs' then b.elevenlabs_cost_multiplier else b.standard_cost_multiplier end;
 end loop;
 quote:=greatest(1,ceil(price*(10000+r.buffer_bps)/100000000)::bigint);
 if quote>r.charge_cents then return null;end if;
 if public.icash_prospecting_available(p_account)<public.icash_research_admission_quote(p_account,'contact_revalidation',quote) then return null;end if;
 v_version:='dnc-one-credit-v1-'||md5(r.id::text||':'||p_unit_expected||':'||quote);
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled)
 values('contact_revalidation',v_version,quote,costs,r.buffer_bps,
  'One-phone DNC check; inherited allocation from rate '||r.id||'; https://api.docs.dealmachine.com/api-reference/phones/check-dnc',
  r.verified_at,r.expires_at,r.enabled) on conflict(version) do nothing;
 select id into rate from public.icash_operation_rates where icash_operation_rates.version=v_version
  and operation='contact_revalidation' and charge_cents=quote and costs_micros=costs
  and buffer_bps=r.buffer_bps and verified_at=r.verified_at and expires_at=r.expires_at and enabled;
 if rate is null then return null;end if;
 reservation:=public.icash_reserve_operation(p_account,op,rate,least(c.data_rights_until,r.expires_at),null,false);
 if reservation->>'state' is distinct from 'reserved' then raise exception 'New contact-check reservation required';end if;
 return reservation||jsonb_build_object('rateId',rate,'unitCostMicros',p_unit_expected);
end $$;

-- This function never treats a missing/ambiguous response as zero credits.
-- Actual spend uses only the immutable raw response for this exact request;
-- monthly dedup is honored only when the provider reports it.
create function icash_seller_recovery_private.settle_contact_refresh(p_operation text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare f icash_seller_recovery_private.contact_refreshes;o public.icash_operation_spend;
 r public.icash_operation_rates;body jsonb;item jsonb;field text;used integer;people integer;dedup integer;
 source text;phone text;components jsonb:='{}';part record;amount numeric;total numeric:=0;price numeric:=0;charge bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.dealmachine_cost_multiplier is null or o.data_unit_cost_micros is null then return false;end if;
 select * into f from icash_seller_recovery_private.contact_refreshes where operation_key=p_operation and account_id=o.account_id for share;
 if not found or f.rate_id is distinct from o.rate_id or f.unit_cost_micros is distinct from o.data_unit_cost_micros
  or p_operation is distinct from 'dnc:'||f.gap_id or f.request_id is null or f.requested_at is null
  or f.response is null or f.response_at is null or f.response_at<f.requested_at or f.response_at>clock_timestamp() then return false;end if;
 select * into r from public.icash_operation_rates where id=o.rate_id;
 if not found or r.operation<>'contact_revalidation' then return false;end if;
 if o.state='settled' then return true;end if;
 if o.state<>'dispatched' then return false;end if;
 select c.phone into phone from public.icash_operational_contacts c where c.id=f.original_contact_id and c.account_id=f.account_id;
 if phone is null or f.http_status is distinct from 200 then return false;end if;
 body:=f.response;
 foreach field in array array['used','people','deduplicated'] loop
  if jsonb_typeof(body->'credits'->field) is distinct from 'number' or (body->'credits'->>field) !~ '^[01]$' then return false;end if;
 end loop;
 used:=(body->'credits'->>'used')::integer;people:=(body->'credits'->>'people')::integer;dedup:=(body->'credits'->>'deduplicated')::integer;
 if used+dedup<>people or used*o.data_unit_cost_micros>(r.costs_micros->>'dealmachine')::numeric
  or jsonb_typeof(body->'data') is distinct from 'array' then return false;end if;
 if jsonb_array_length(body->'data')<>1 then return false;end if;
 item:=body->'data'->0;
 if public.icash_operational_phone(item->'input'->>'number') is distinct from phone
  or item->'matched' not in ('true'::jsonb,'false'::jsonb) or item->'matched' is null
  or people<>(case when item->'matched'='true'::jsonb then 1 else 0 end)
  or body->'totals'->'submitted' is distinct from '1'::jsonb
  or body->'totals'->'matched' is distinct from to_jsonb(people)
  or body->'totals'->'unmatched' is distinct from to_jsonb(1-people) then return false;end if;
 if not exists(select 1 from icash_research_private.requests req where req.id=f.request_id
  and req.account_id=f.account_id and req.operation_key=f.operation_key and req.kind='phone_dnc'
  and req.admitted and req.created_at<=f.response_at) then return false;end if;
 source:='dealmachine:dnc:'||f.request_id;
 perform public.icash_record_cost_observation('dealmachine',p_operation,source,used,'provider_credits');
 for part in select key,value from jsonb_each_text(r.costs_micros) loop
  amount:=case when part.key='dealmachine' then used*o.data_unit_cost_micros else part.value::numeric end;
  total:=total+amount;
  price:=price+amount*case when part.key='dealmachine' then o.dealmachine_cost_multiplier when part.key='elevenlabs' then o.elevenlabs_cost_multiplier else o.standard_cost_multiplier end;
  components:=components||jsonb_build_object(part.key,jsonb_build_object('amountMicros',amount,'basis','estimated','evidenceRef',
   case when part.key='dealmachine' then 'Observed one-phone DNC credits at saved '||o.data_cost_basis||': '||source else 'Inherited operation allocation: '||r.version end));
 end loop;
 charge:=ceil(price/10000);
 if charge>o.charge_cap_cents or total>o.reserved_micros then return false;end if;
 perform public.icash_settle_complete_costs(p_operation,charge,components,'DealMachine one-phone DNC usage v1: '||p_operation);
 update public.icash_operation_spend set cost_basis='estimated' where operation_key=p_operation;
 return true;
end $$;

-- Maintenance may finish the same saved response after a worker crash. It may
-- never settle an unknown DNC request from the maximum quote.
alter function public.icash_settle_estimated_operation(text) rename to icash_settle_estimate_before_contact_refresh;
create function public.icash_settle_estimated_operation(p_operation text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id
  where o.operation_key=p_operation and r.operation='contact_revalidation') then
  return icash_seller_recovery_private.settle_contact_refresh(p_operation);
 end if;
 return public.icash_settle_estimate_before_contact_refresh(p_operation);
end $$;
revoke all on function icash_seller_recovery_private.reserve_contact_refresh(uuid,uuid,uuid,bigint),
 icash_seller_recovery_private.settle_contact_refresh(text),public.icash_settle_estimate_before_contact_refresh(text)
 from public,anon,authenticated,service_role;
revoke all on function public.icash_settle_estimated_operation(text) from public,anon,authenticated;
grant execute on function public.icash_settle_estimated_operation(text) to service_role;
-- Source: config/seller-contact-refresh-workflow.sql
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.icash_claim_seller_contact_refresh() returns jsonb
language plpgsql security definer set search_path='' as $$
declare item record;f icash_seller_recovery_private.contact_refreshes;bill jsonb;req uuid;stamp timestamptz;
 policy icash_seller_recovery_private.contact_refresh_policy;visited boolean:=false;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;if not found then return null;end if;
 select * into policy from icash_seller_recovery_private.contact_refresh_policy where id=1 and enabled for update;if not found then return null;end if;
 -- An ambiguous phone-check purchase stops this new workflow until its real
 -- receipt is reconciled. A failing provider cannot accumulate new holds.
 if exists(select 1 from icash_seller_recovery_private.contact_refreshes pending
  join public.icash_operation_spend spend on spend.operation_key=pending.operation_key
  where pending.response_at is null or (pending.outcome='cost_review' and spend.state<>'settled')) then return null;end if;
 -- At most one new provider request per scheduler minute. Unknown requests
 -- remain one-use holds forever; a new worker never repeats their HTTP call.
 if exists(select 1 from icash_seller_recovery_private.contact_refreshes where requested_at>clock_timestamp()-interval '1 minute') then return null;end if;
 for item in
  select g.id gap_id,g.due_at,g.account_id,t.operational_contact_id,cfg.contact_rate_id,cfg.property_credit_micros
  from public.icash_seller_gaps g
  join public.icash_text_threads t on t.id=g.thread_id and t.account_id=g.account_id
  join public.icash_discovery_configs cfg on cfg.account_id=g.account_id
  where g.state='needs_review' and g.review_reason='contact_checks_expired' and g.reason='no_response' and g.stage='draft'
   and g.outgoing_id is null and g.due_at<=now() and g.expires_at>now() and g.created_at>=policy.activated_at
   and (policy.scan_due_at is null or (g.due_at,g.id)>(policy.scan_due_at,policy.scan_gap_id))
   and not exists(select 1 from icash_seller_recovery_private.contact_refreshes prior where prior.gap_id=g.id)
  order by g.due_at,g.id limit 20
 loop
  visited:=true;
  -- Held, paused and unaffordable accounts cannot occupy every bounded scan.
  -- Advance outside the per-item subtransaction so an ordinary admission hold
  -- retains its place in the round-robin scan without changing the gap.
  update icash_seller_recovery_private.contact_refresh_policy set scan_due_at=item.due_at,scan_gap_id=item.gap_id where id=1;
  if not icash_seller_recovery_private.contact_refresh_current(item.gap_id,item.operational_contact_id)
   or not public.icash_sms_outreach_window_current(item.account_id,(select thread_id from public.icash_seller_gaps where id=item.gap_id))
   or not public.icash_dealmachine_capacity_available(1) then continue;end if;
  begin
   bill:=icash_seller_recovery_private.reserve_contact_refresh(item.account_id,item.gap_id,item.contact_rate_id,item.property_credit_micros);
   if bill is null then continue;end if;
   req:=gen_random_uuid();stamp:=clock_timestamp();
   insert into icash_seller_recovery_private.contact_refreshes(gap_id,account_id,original_contact_id,operation_key,rate_id,unit_cost_micros,request_id,requested_at,original_snapshot)
   values(item.gap_id,item.account_id,item.operational_contact_id,bill->>'operationKey',(bill->>'rateId')::uuid,(bill->>'unitCostMicros')::bigint,req,stamp,
    public.icash_seller_contact_revalidation_snapshot(item.gap_id,item.operational_contact_id)) returning * into f;
   -- Dependent mutations must be sequential: SQL may evaluate an EXISTS
   -- initplan before volatile operands in a single boolean expression.
   if not public.icash_claim_operation(f.operation_key) then raise exception 'Contact refresh admission held' using errcode='P7502';end if;
   if not public.icash_take_dealmachine_request('phone_dnc',f.account_id,f.operation_key,req) then raise exception 'Contact refresh admission held' using errcode='P7502';end if;
   if not icash_seller_recovery_private.contact_refresh_current(item.gap_id,item.operational_contact_id) then raise exception 'Contact refresh admission held' using errcode='P7502';end if;
   if not exists(select 1 from public.icash_operation_spend spend join public.icash_operation_rates rate on rate.id=spend.rate_id
      where spend.operation_key=f.operation_key and spend.state='dispatched' and spend.permission_until>clock_timestamp()
      and rate.enabled and rate.verified_at<=clock_timestamp() and rate.expires_at>clock_timestamp())
    then raise exception 'Contact refresh admission held' using errcode='P7502';end if;
   return jsonb_build_object('id',f.id,'requestId',req,'phone',(select phone from public.icash_operational_contacts where id=f.original_contact_id));
  exception when sqlstate 'P7502' then continue;
   when raise_exception then
    if sqlerrm=any(array['Account spending not activated','Activation spending cap reached','Software membership is inactive',
     'Bot paused','Insufficient credits','Daily budget reached','Prospecting budget reached','Company budget exhausted',
     'Company daily limit','Automation on hold','Verified rate required','Permission expired','Wallet missing']) then continue;end if;
    raise;
  end;
 end loop;
 if not visited then
  update icash_seller_recovery_private.contact_refresh_policy set scan_due_at=null,scan_gap_id=null where id=1;
 end if;
 return null;
end $$;

alter function public.icash_lock_operational_dnc(uuid,uuid) rename to icash_lock_operational_dnc_before_phone_refresh;
create function public.icash_lock_operational_dnc(p_account uuid,p_contact uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.icash_operational_contacts;old public.icash_operational_contacts;d public.icash_dnc_verification_receipts;
 f icash_seller_recovery_private.contact_refreshes;policy public.icash_dnc_verification_sources;stamp timestamptz;
begin
 select * into c from public.icash_operational_contacts where id=p_contact and account_id=p_account;
 select * into d from public.icash_dnc_verification_receipts where id=c.dnc_receipt_id;
 if d.evidence_kind is distinct from 'national_phone_observation' then return public.icash_lock_operational_dnc_before_phone_refresh(p_account,p_contact);end if;
 perform 1 from public.icash_dnc_verification_receipts where id=d.id for share;
 select * into policy from public.icash_dnc_verification_sources where id=d.source_id for share;
 select * into f from icash_seller_recovery_private.contact_refreshes where receipt_id=d.id and successor_contact_id=c.id and account_id=p_account for share;
 if not found then return false;end if;
 select * into old from public.icash_operational_contacts where id=f.original_contact_id for share;
 perform 1 from public.icash_operation_spend where operation_key=f.operation_key and account_id=p_account and state='settled' for share;if not found then return false;end if;
 if not icash_seller_recovery_private.original_contact_binding(p_account,old.id) then return false;end if;
 stamp:=clock_timestamp();
 return coalesce(row(old.account_id,old.screening_id,old.phone,old.contact_key,old.owner_user_id,old.source_hash,old.sending_principal,old.timezone,old.timezone_basis,old.local_start_hour,old.local_end_hour)
  is not distinct from row(c.account_id,c.screening_id,c.phone,c.contact_key,c.owner_user_id,c.source_hash,c.sending_principal,c.timezone,c.timezone_basis,c.local_start_hour,c.local_end_hour)
  and old.revoked_at is null and c.channel='sms' and (f.state='responded' or (f.state='processed' and f.outcome='revalidated')) and f.http_status between 200 and 299 and f.response_at>=f.requested_at
  and icash_seller_recovery_private.phone_response_valid(f.response,c.phone)
  and f.response#>'{data,0,matched}'='true'::jsonb and f.response#>'{data,0,do_not_call}'='false'::jsonb
  and d.receipt_hash=encode(sha256(convert_to(f.response::text,'UTF8')),'hex')
  and d.observation_provenance->>'refreshId'=f.id::text and d.observation_provenance->>'accountId'=p_account::text
  and d.observation_provenance->>'screeningId'=c.screening_id::text and d.observation_provenance->>'originalContactId'=old.id::text
  and d.observation_provenance->>'operationKey'=f.operation_key and d.observation_provenance->>'requestId'=f.request_id::text
  and d.checked_at=f.requested_at and d.observation_recorded_at=f.response_at
  and d.checked_at<=stamp and d.expires_at<=f.requested_at+interval '24 hours' and d.expires_at>stamp
  and policy.enabled and policy.expires_at>stamp and policy.evidence_kind='national_provider_observation'
  and policy.observation_provider='dealmachine' and policy.observation_scope='national_only'
  and f.requested_at+make_interval(secs=>policy.max_observation_age_seconds)>stamp
  and exists(select 1 from public.icash_dnc_verification_receipts original where original.id=old.dnc_receipt_id and original.source_id=d.source_id and original.clear and original.revoked_at is null),false);
end $$;

create function public.icash_finish_seller_contact_refresh(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f icash_seller_recovery_private.contact_refreshes;c public.icash_operational_contacts;d public.icash_dnc_verification_receipts;src public.icash_dnc_verification_sources;
 receipt uuid;fresh uuid;until_at timestamptz;snapshot jsonb;review uuid;applied boolean:=false;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into f from icash_seller_recovery_private.contact_refreshes where id=p_id for update;
 if not found or f.response_at is null then return jsonb_build_object('status','response_missing');end if;
 if f.state='processed' then return jsonb_build_object('status',f.outcome);end if;
 -- Cost reconciliation is independent of contact eligibility and Pause. The
 -- real receipt remains available even when all contact authority has expired.
 if not icash_seller_recovery_private.settle_contact_refresh(f.operation_key) then
  update icash_seller_recovery_private.contact_refreshes set state='processed',outcome='cost_review' where id=f.id;
  return jsonb_build_object('status','cost_review');
 end if;
 select * into c from public.icash_operational_contacts where id=f.original_contact_id;
 if f.response#>'{data,0,matched}' is distinct from 'true'::jsonb or f.response#>'{data,0,do_not_call}' is distinct from 'false'::jsonb then
  update icash_seller_recovery_private.contact_refreshes set state='processed',outcome='not_clear' where id=f.id;
  return jsonb_build_object('status','not_clear');
 end if;
 if f.original_snapshot is distinct from public.icash_seller_contact_revalidation_snapshot(f.gap_id,c.id)
  or not icash_seller_recovery_private.contact_refresh_current(f.gap_id,c.id) then
  update icash_seller_recovery_private.contact_refreshes set state='processed',outcome='current_controls_hold' where id=f.id;
  return jsonb_build_object('status','current_controls_hold');
 end if;
 select * into d from public.icash_dnc_verification_receipts where id=c.dnc_receipt_id for share;
 select * into src from public.icash_dnc_verification_sources where id=d.source_id for share;
 until_at:=least(f.requested_at+interval '24 hours',f.requested_at+make_interval(secs=>src.max_observation_age_seconds),src.expires_at,
  (select data_rights_until from public.icash_discovery_configs where account_id=c.account_id));
 if until_at is null or until_at<=clock_timestamp() then
  update icash_seller_recovery_private.contact_refreshes set state='processed',outcome='fresh_response_expired' where id=f.id;
  return jsonb_build_object('status','fresh_response_expired');
 end if;
 insert into public.icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear,contact_timezone,timezone_source_reference,evidence_kind,observation_provenance,observation_recorded_at)
 values(src.id,c.phone,c.contact_key,'dealmachine:phone-dnc:'||f.id,encode(sha256(convert_to(f.response::text,'UTF8')),'hex'),f.requested_at,until_at,true,
  d.contact_timezone,d.timezone_source_reference,'national_phone_observation',jsonb_build_object('provider','dealmachine','scope','national_only',
  'sourceTable','icash_seller_recovery_private.contact_refreshes','refreshId',f.id,'accountId',f.account_id,'screeningId',c.screening_id,
  'originalContactId',c.id,'operationKey',f.operation_key,'requestId',f.request_id,'freshnessBasis','saved_request_start_lower_bound',
  'providerCheckedAt',null,'registryUpdatedAt',null,'stateClearance','not_established','consentVerification','not_performed','reportedDoNotCall',false),f.response_at) returning id into receipt;
 insert into public.icash_operational_contacts(account_id,screening_id,channel,phone,contact_key,timezone,timezone_basis,local_start_hour,local_end_hour,owner_user_id,sending_principal,source_hash,dnc_receipt_id,eligibility_until)
 values(c.account_id,c.screening_id,'sms',c.phone,c.contact_key,c.timezone,c.timezone_basis,c.local_start_hour,c.local_end_hour,c.owner_user_id,c.sending_principal,c.source_hash,receipt,until_at) returning id into fresh;
 update icash_seller_recovery_private.contact_refreshes set receipt_id=receipt,successor_contact_id=fresh where id=f.id;
 snapshot:=public.icash_seller_contact_revalidation_snapshot(f.gap_id,fresh);
 review:=public.icash_review_seller_contact_revalidation(f.gap_id,fresh,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),'Automatic exact new national phone observation: '||f.id);
 if review is not null then applied:=public.icash_apply_seller_contact_revalidation(review);end if;
 update icash_seller_recovery_private.contact_refreshes set state='processed',outcome=case when applied then 'revalidated' else 'current_controls_hold' end where id=f.id;
 return jsonb_build_object('status',case when applied then 'revalidated' else 'current_controls_hold' end);
end $$;

-- Retry receipt processing only, never the provider request or an uncertain SMS.
create function public.icash_resume_seller_contact_refresh() returns jsonb
language plpgsql security definer set search_path='' as $$
declare f record;begin
 for f in select id from icash_seller_recovery_private.contact_refreshes where state='responded' order by response_at limit 5 loop
  perform public.icash_finish_seller_contact_refresh(f.id);
 end loop;
 return null;
end $$;
update icash_seller_recovery_private.contact_revalidation_policy set enabled=true where id=1;
revoke all on function public.icash_claim_seller_contact_refresh(),public.icash_finish_seller_contact_refresh(uuid),public.icash_resume_seller_contact_refresh(),
 public.icash_lock_operational_dnc_before_phone_refresh(uuid,uuid),public.icash_lock_operational_dnc(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_claim_seller_contact_refresh(),public.icash_finish_seller_contact_refresh(uuid),public.icash_resume_seller_contact_refresh(),public.icash_lock_operational_dnc(uuid,uuid) to service_role;
-- Source: config/seller-contact-refresh-observability.sql
create function public.icash_seller_contact_refresh_summary() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',p.enabled,'prospectiveFrom',p.activated_at,
  'heldBeforeActivation',(select count(*) from public.icash_seller_gaps g where g.state='needs_review' and g.review_reason='contact_checks_expired' and g.created_at<p.activated_at),
  'newAwaitingCheck',(select count(*) from public.icash_seller_gaps g where g.state='needs_review' and g.review_reason='contact_checks_expired' and g.created_at>=p.activated_at and g.due_at<=now() and g.expires_at>now() and not exists(select 1 from icash_seller_recovery_private.contact_refreshes f where f.gap_id=g.id)),
  'requests',(select count(*) from icash_seller_recovery_private.contact_refreshes),
  'unknownRequests',(select count(*) from icash_seller_recovery_private.contact_refreshes where response_at is null and requested_at<now()-interval '2 minutes'),
  'savedResponsesPending',(select count(*) from icash_seller_recovery_private.contact_refreshes where state='responded'),
  'outcomes',coalesce((select jsonb_object_agg(outcome,n) from (select outcome,count(*) n from icash_seller_recovery_private.contact_refreshes where outcome is not null group by outcome) counts),'{}'::jsonb),
  'scope','national provider observation; state clearance and consent not established; no historical replay')
 from icash_seller_recovery_private.contact_refresh_policy p where p.id=1;
$$;
revoke all on function public.icash_seller_contact_refresh_summary() from public,anon,authenticated;
grant execute on function public.icash_seller_contact_refresh_summary() to service_role;
commit;
