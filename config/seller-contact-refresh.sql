-- Prospective, one-request national DNC refresh for an otherwise eligible reminder.
-- The old purchase, original DNC observation, send history and expiry remain immutable.
begin;
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
commit;
