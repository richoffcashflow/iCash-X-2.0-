begin;
-- OPTIONAL, LOCAL REVIEW ONLY. Apply after operational-contact-eligibility.sql
-- and operational-sms-eligibility.sql. Both core migrations are required.
-- No network call or source-policy activation. Saved national-provider status is
-- not an independent registry check, state clearance, legal review, or consent.
alter table public.icash_dnc_verification_sources
 add column evidence_kind text not null default 'legacy_record' check(evidence_kind in ('legacy_record','national_provider_observation')),
 add column observation_provider text,
 add column observation_scope text,
 add column max_observation_age_seconds integer,
 add constraint icash_dnc_observation_policy_shape check(evidence_kind='legacy_record' or (
  observation_provider='dealmachine' and observation_provider is not null
  and observation_scope='national_only' and observation_scope is not null
  and max_observation_age_seconds between 1 and 2592000 and max_observation_age_seconds is not null));
create unique index icash_dnc_provider_observation_policy on public.icash_dnc_verification_sources(observation_provider)
 where evidence_kind='national_provider_observation';
insert into public.icash_dnc_verification_sources(name,source_reference,enabled,expires_at,evidence_kind,observation_provider,observation_scope,max_observation_age_seconds)
 values('DealMachine saved national-DNC observations','https://api.docs.dealmachine.com/concepts/response-format#phones',false,'2000-01-01T00:00:00Z',
 'national_provider_observation','dealmachine','national_only',86400);
comment on column public.icash_dnc_verification_sources.max_observation_age_seconds is 'Explicit operational maximum age from the saved request-start lower bound, not provider registry freshness. The optional DealMachine policy starts disabled and expired.';
alter table public.icash_dnc_verification_receipts
 add column evidence_kind text not null default 'legacy_record' check(evidence_kind in ('legacy_record','national_provider_observation')),
 add column observation_provenance jsonb not null default '{}'::jsonb,
 add column observation_recorded_at timestamptz,
 add constraint icash_dnc_observation_receipt_shape check(evidence_kind='legacy_record' or coalesce((
  observation_recorded_at is not null and jsonb_typeof(observation_provenance)='object'
  and observation_provenance ?& array['provider','scope','sourceTable','accountId','ownerUserId','screeningId','operationKey','savedResultHash','hashBasis',
   'providerCostHash','providerOperationHash','requestStartedAt','sourceRecordedAt','ingestedAt','freshnessBasis','providerCheckedAt','registryUpdatedAt',
   'stateClearance','consentVerification','providerReferenceKind','reportedDoNotCall','maxObservationAgeSeconds']
  and jsonb_typeof(observation_provenance->'accountId')='string' and jsonb_typeof(observation_provenance->'screeningId')='string'
  and jsonb_typeof(observation_provenance->'ownerUserId')='string' and jsonb_typeof(observation_provenance->'operationKey')='string'
  and observation_provenance->>'savedResultHash' ~ '^[a-f0-9]{64}$'
  and observation_provenance->>'providerCostHash' ~ '^[a-f0-9]{64}$' and observation_provenance->>'providerOperationHash' ~ '^[a-f0-9]{64}$'
  and observation_provenance->'reportedDoNotCall'='false'::jsonb and jsonb_typeof(observation_provenance->'maxObservationAgeSeconds')='number'
  and observation_provenance->>'sourceTable'='icash_owner_contacts' and observation_provenance->>'providerReferenceKind'='application_derived_idempotency_key'
  and observation_provenance->>'provider'='dealmachine'
  and observation_provenance->>'scope'='national_only'
  and observation_provenance->>'freshnessBasis'='saved_request_start_lower_bound'
  and observation_provenance->>'consentVerification'='not_performed'
  and observation_provenance->>'stateClearance'='not_established'
  and observation_provenance->'providerCheckedAt'='null'::jsonb
  and observation_provenance->'registryUpdatedAt'='null'::jsonb),false));
comment on column public.icash_dnc_verification_receipts.observation_provenance is 'Typed saved-response provenance. For national_provider_observation, checked_at is only the saved request-start lower bound; providerCheckedAt and registryUpdatedAt remain unknown.';

create table public.icash_dealmachine_dnc_ingestions(
 screening_id uuid primary key references public.icash_owner_contacts(screening_id),
 account_id uuid not null references public.icash_accounts(id),owner_user_id uuid not null references auth.users(id),
 operation_key text not null unique references public.icash_operation_spend(operation_key),
 source_id uuid not null references public.icash_dnc_verification_sources(id),
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),provider_operation_hash text not null check(provider_operation_hash ~ '^[a-f0-9]{64}$'),provider_cost_hash text not null check(provider_cost_hash ~ '^[a-f0-9]{64}$'),
 request_started_at timestamptz not null,source_recorded_at timestamptz not null,ingested_at timestamptz not null,
 original_expires_at timestamptz not null,observations integer not null check(observations>=0),held_phones integer not null check(held_phones>=0),
 outcome text not null check(outcome in ('observations_recorded','no_explicit_clear_status','source_too_old'))
);
alter table public.icash_dealmachine_dnc_ingestions enable row level security;
revoke all on public.icash_dealmachine_dnc_ingestions from public,anon,authenticated,service_role;
grant select on public.icash_dealmachine_dnc_ingestions to service_role;
create trigger icash_dealmachine_dnc_ingestion_immutable before update or delete on public.icash_dealmachine_dnc_ingestions
 for each row execute function public.icash_authority_no_mutation();

-- Invalid authentic saved bindings are quarantined once so bounded automatic
-- batches cannot be starved by a repeatedly rejected front-of-queue source.
create table public.icash_dealmachine_dnc_rejections(
 screening_id uuid primary key references public.icash_owner_contacts(screening_id),account_id uuid not null references public.icash_accounts(id),
 operation_key text not null,source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 source_recorded_at timestamptz not null,rejected_at timestamptz not null,reason text not null check(length(reason) between 1 and 300)
);
alter table public.icash_dealmachine_dnc_rejections enable row level security;
revoke all on public.icash_dealmachine_dnc_rejections from public,anon,authenticated,service_role;
grant select on public.icash_dealmachine_dnc_rejections to service_role;
create trigger icash_dealmachine_dnc_rejection_immutable before update or delete on public.icash_dealmachine_dnc_rejections
 for each row execute function public.icash_authority_no_mutation();

create function public.icash_dealmachine_observation_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='icash_owner_contacts' then
  if (exists(select 1 from public.icash_dealmachine_dnc_ingestions where screening_id=old.screening_id)
   or exists(select 1 from public.icash_dealmachine_dnc_rejections where screening_id=old.screening_id))
   and (tg_op='DELETE' or to_jsonb(new) is distinct from to_jsonb(old)) then raise exception 'Ingested owner-source binding is immutable';end if;
 elsif old.evidence_kind='national_provider_observation' then
  if tg_op='DELETE' or to_jsonb(new)-'revoked_at' is distinct from to_jsonb(old)-'revoked_at'
   or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then raise exception 'Derived DNC observation is immutable';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger icash_dealmachine_owner_source_immutable before update or delete on public.icash_owner_contacts
 for each row execute function public.icash_dealmachine_observation_immutable();
create trigger icash_dealmachine_dnc_observation_immutable before update or delete on public.icash_dnc_verification_receipts
 for each row execute function public.icash_dealmachine_observation_immutable();

create function public.icash_dealmachine_request_started_at(p_result jsonb) returns timestamptz language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p_result->'fetchedAt') is distinct from 'string' or (p_result->>'fetchedAt') !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then return null;end if;
 return (p_result->>'fetchedAt')::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end $$;
create function public.icash_dealmachine_cost_observation_hash(p public.icash_cost_observations) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('provider',p.provider,'eventKey',p.event_key,'sourceRef',p.source_ref,'amount',p.amount,'units',p.units,'recordedAt',p.observed_at)::text,'UTF8')),'hex')
$$;

-- Validate the actual normalized OwnerResult contract emitted by owner-enrichment.ts.
create function public.icash_dealmachine_saved_owner_result_valid(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare field text;person jsonb;ph jsonb;used integer;people integer;deduplicated integer;found_count integer;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>262144 or jsonb_typeof(p->'contacts') is distinct from 'array'
  or jsonb_typeof(p->'requestedPersonIds') is distinct from 'array' or jsonb_typeof(p->'providerCredits') is distinct from 'object'
  or p->'outreachAuthorized' is distinct from 'false'::jsonb then return false;end if;
 found_count:=jsonb_array_length(p->'contacts');
 if found_count>25 or jsonb_array_length(p->'requestedPersonIds') not between 1 and 25
  or exists(select 1 from jsonb_array_elements(p->'requestedPersonIds') x where jsonb_typeof(x) is distinct from 'string' or (x#>>'{}') !~ '^per_[A-Za-z0-9]{1,100}$')
  or (select count(distinct value) from jsonb_array_elements(p->'requestedPersonIds'))<>jsonb_array_length(p->'requestedPersonIds') then return false;end if;
 foreach field in array array['used','people','properties','deduplicated'] loop
  if jsonb_typeof(p->'providerCredits'->field) is distinct from 'number' or (p->'providerCredits'->>field) !~ '^[0-9]{1,3}$' then return false;end if;
 end loop;
 used:=(p->'providerCredits'->>'used')::integer;people:=(p->'providerCredits'->>'people')::integer;deduplicated:=(p->'providerCredits'->>'deduplicated')::integer;
 if people<>found_count or (p->'providerCredits'->>'properties')::integer<>0 or used+deduplicated<>found_count
  or p->'creditsUsed' is distinct from p->'providerCredits'->'used' or p->'peopleCredits' is distinct from p->'providerCredits'->'people'
  or (select count(distinct value->>'personId') from jsonb_array_elements(p->'contacts'))<>found_count then return false;end if;
 for person in select value from jsonb_array_elements(p->'contacts') loop
  if jsonb_typeof(person) is distinct from 'object' or not (p->'requestedPersonIds' ? coalesce(person->>'personId',''))
   or jsonb_typeof(person->'likelyOwner') is distinct from 'boolean'
   or person->'ownershipVerified' is distinct from 'false'::jsonb or person->'outreachAuthorized' is distinct from 'false'::jsonb
   or jsonb_typeof(person->'phones') is distinct from 'array' then return false;end if;
  if jsonb_array_length(person->'phones')>20 then return false;end if;
  for ph in select value from jsonb_array_elements(person->'phones') loop
   if jsonb_typeof(ph) is distinct from 'object' or ph->>'permission' is distinct from 'unverified'
    or not (ph ? 'number') or (jsonb_typeof(ph->'number') not in ('string','null')) then return false;end if;
  end loop;
 end loop;
 return true;
end $$;
create function public.icash_dealmachine_operation_hash(o public.icash_operation_spend,r public.icash_credit_reservations) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('operationKey',o.operation_key,'accountId',o.account_id,'rateId',o.rate_id,
 'reservationId',o.credit_reservation_id,'operationCreatedAt',o.created_at,'dispatchedAt',o.dispatched_at,'chargeCapCents',o.charge_cap_cents,
 'reservationAccountId',r.account_id,'reservationOperationKey',r.operation_key,'reservationAmountCents',r.amount_cents)::text,'UTF8')),'hex')
$$;
create function public.icash_dealmachine_credit_manifest_hash(p_operation text) returns text language sql stable security invoker set search_path='' as $$
 select case when count(*)=4 then encode(sha256(convert_to(jsonb_agg(jsonb_build_object('field',field,'hash',public.icash_dealmachine_cost_observation_hash(c)) order by field)::text,'UTF8')),'hex') end
 from unnest(array['used','people','properties','deduplicated']) field
 join public.icash_cost_observations c on c.provider='dealmachine'
  and c.event_key=p_operation||case when field='used' then '' else ':'||field end
  and c.source_ref='dealmachine:owners:'||p_operation||case when field='used' then '' else ':'||field end and c.units='provider_credits'
$$;

-- The only new writer. It accepts owned saved-record identifiers, never a phone,
-- status, timestamp, receipt hash, or evidence payload from its caller.
create function public.icash_ingest_dealmachine_dnc_observations(p_account uuid,p_user uuid,p_screening uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare oc public.icash_owner_contacts;o public.icash_operation_spend;cost public.icash_cost_observations;reservation public.icash_credit_reservations;field text;operation_hash text;
 policy public.icash_dnc_verification_sources;prior public.icash_dealmachine_dnc_ingestions;
 item record;source_hash text;cost_hash text;started timestamptz;stamp timestamptz;expiry timestamptz;observations integer:=0;held integer:=0;outcome text;provenance jsonb;failure text;
begin
 if p_account is null or p_user is null or p_screening is null then raise exception 'Owned saved-source identifiers required';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended(p_screening::text,936));
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for share;
 if not found then raise exception 'Saved-source account ownership mismatch';end if;
 select * into oc from public.icash_owner_contacts where screening_id=p_screening and account_id=p_account for share;
 if not found then raise exception 'Owned saved owner result required';end if;
 select * into policy from public.icash_dnc_verification_sources where evidence_kind='national_provider_observation' and observation_provider='dealmachine' for share;
 stamp:=clock_timestamp();
 if not found or not policy.enabled or policy.expires_at<=stamp then return jsonb_build_object('status','source_policy_disabled','observations',0);end if;
 source_hash:=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex');
 started:=public.icash_dealmachine_request_started_at(oc.result);
 if not public.icash_dealmachine_saved_owner_result_valid(oc.result) or started is null or started>stamp or oc.created_at>stamp or started>oc.created_at
  or jsonb_typeof(oc.result->'contacts') is distinct from 'array' or jsonb_typeof(oc.result->'requestedPersonIds') is distinct from 'array'
  or jsonb_array_length(oc.result->'contacts')>25 or jsonb_array_length(oc.result->'requestedPersonIds') not between 1 and 25
  or jsonb_typeof(oc.result->'creditsUsed') is distinct from 'number'
  or coalesce(oc.result->>'creditsUsed','') !~ '^[0-9]{1,3}$'
  or oc.result->'providerCredits'->'used' is distinct from oc.result->'creditsUsed'
  or coalesce(oc.result->>'propertyId','') !~ '^prop_[A-Za-z0-9]{1,100}$'
  or not exists(select 1 from public.icash_screening_jobs s where s.id=p_screening and s.account_id=p_account and s.state='complete'
   and s.snapshot->>'propertyId'=oc.result->>'propertyId' and coalesce(s.snapshot->>'practice','false')<>'true') then raise exception 'Saved provider result shape or original timestamp invalid';end if;
 select * into o from public.icash_operation_spend where operation_key=oc.operation_key and account_id=p_account for share;
 if not found or o.operation_key is distinct from 'owners:'||p_account||':'||p_screening
  or o.state not in ('dispatched','settled') or o.dispatched_at is null or o.created_at<started or o.dispatched_at<o.created_at or o.dispatched_at>oc.created_at
  or not exists(select 1 from public.icash_operation_rates where id=o.rate_id and operation='owner_enrichment')
  or not exists(select 1 from public.icash_credit_reservations where id=o.credit_reservation_id and account_id=p_account and operation_key=o.operation_key)
  then raise exception 'Actual owner-enrichment provider-operation binding required';end if;
 select * into reservation from public.icash_credit_reservations where id=o.credit_reservation_id and account_id=p_account and operation_key=o.operation_key for share;
 if not found then raise exception 'Actual provider-operation reservation binding required';end if;
 perform 1 from public.icash_operation_rates where id=o.rate_id and operation='owner_enrichment' for share;
 if not found then raise exception 'Actual provider-operation rate binding required';end if;
 operation_hash:=public.icash_dealmachine_operation_hash(o,reservation);
 foreach field in array array['used','people','properties','deduplicated'] loop
  select * into cost from public.icash_cost_observations where provider='dealmachine' and event_key=o.operation_key||case when field='used' then '' else ':'||field end for share;
  if not found or cost.source_ref is distinct from ('dealmachine:owners:'||o.operation_key||(case when field='used' then '' else ':'||field end)) or cost.units<>'provider_credits'
   or cost.amount is distinct from (oc.result->'providerCredits'->>field)::numeric or cost.observed_at<o.dispatched_at or cost.observed_at>oc.created_at
   then raise exception 'Matching saved DealMachine provider-credit observation required';end if;
 end loop;
 cost_hash:=public.icash_dealmachine_credit_manifest_hash(o.operation_key);
 select * into prior from public.icash_dealmachine_dnc_ingestions where screening_id=p_screening;
 if found then
  if row(prior.account_id,prior.owner_user_id,prior.operation_key,prior.source_hash,prior.provider_operation_hash,prior.provider_cost_hash,prior.request_started_at,prior.source_recorded_at)
   is distinct from row(p_account,p_user,oc.operation_key,source_hash,operation_hash,cost_hash,started,oc.created_at) then raise exception 'Saved-source replay binding changed';end if;
  return jsonb_build_object('status','already_recorded','originalOutcome',prior.outcome,'observations',prior.observations,'heldPhones',prior.held_phones,'recordedAt',prior.ingested_at);
 end if;
 if exists(select 1 from public.icash_dealmachine_dnc_rejections where screening_id=p_screening) then return jsonb_build_object('status','source_rejected','observations',0);end if;
 -- Re-read wall clock after every operation/credit lock; a policy may have
 -- expired while this importer waited, even though its row stayed unchanged.
 stamp:=clock_timestamp();
 if policy.expires_at<=stamp then return jsonb_build_object('status','source_policy_disabled','observations',0);end if;
 expiry:=least(started+make_interval(secs=>policy.max_observation_age_seconds),policy.expires_at);
 if expiry<=stamp then outcome:='source_too_old';
 else
  for item in
   select public.icash_operational_phone(ph->>'number') phone,
    bool_and(ph->'doNotCall' is not distinct from 'false'::jsonb) all_explicit_false,
    bool_or(person->'likelyOwner'='true'::jsonb and coalesce(person->>'personId','') ~ '^per_[A-Za-z0-9]{1,100}$' and oc.result->'requestedPersonIds' ? (person->>'personId')) owner_match
   from jsonb_array_elements(oc.result->'contacts') person
   cross join lateral jsonb_array_elements(case when jsonb_typeof(person->'phones')='array' then person->'phones' else '[]'::jsonb end) ph
   group by public.icash_operational_phone(ph->>'number')
  loop
   if item.phone is null or item.all_explicit_false is distinct from true or item.owner_match is distinct from true then held:=held+1;continue;end if;
   provenance:=jsonb_build_object('provider','dealmachine','scope','national_only','sourceTable','icash_owner_contacts',
    'accountId',p_account,'ownerUserId',p_user,'screeningId',p_screening,'operationKey',oc.operation_key,
    'savedResultHash',source_hash,'hashBasis','canonical_saved_owner_result_jsonb','providerCostHash',cost_hash,'providerOperationHash',operation_hash,
    'requestStartedAt',started,'sourceRecordedAt',oc.created_at,'ingestedAt',stamp,'freshnessBasis','saved_request_start_lower_bound',
    'providerCheckedAt',null,'registryUpdatedAt',null,'stateClearance','not_established','consentVerification','not_performed',
    'providerReferenceKind','application_derived_idempotency_key','reportedDoNotCall',false,'maxObservationAgeSeconds',policy.max_observation_age_seconds);
   insert into public.icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear,
    evidence_kind,observation_provenance,observation_recorded_at)
   values(policy.id,item.phone,encode(sha256(convert_to(item.phone,'UTF8')),'hex'),
    'dealmachine:owner-result:'||p_screening||':'||source_hash||':'||encode(sha256(convert_to(item.phone,'UTF8')),'hex'),source_hash,started,expiry,true,
    'national_provider_observation',provenance,stamp);
   observations:=observations+1;
  end loop;
  outcome:=case when observations>0 then 'observations_recorded' else 'no_explicit_clear_status' end;
 end if;
 insert into public.icash_dealmachine_dnc_ingestions(screening_id,account_id,owner_user_id,operation_key,source_id,source_hash,provider_operation_hash,provider_cost_hash,
  request_started_at,source_recorded_at,ingested_at,original_expires_at,observations,held_phones,outcome)
 values(p_screening,p_account,p_user,oc.operation_key,policy.id,source_hash,operation_hash,cost_hash,started,oc.created_at,stamp,expiry,observations,held,outcome);
 return jsonb_build_object('status',outcome,'observations',observations,'heldPhones',held,'recordedAt',stamp);
exception when raise_exception then
 failure:=SQLERRM;
 -- Ownership errors are never transformed into writes against someone else's source.
 if oc.screening_id is null or source_hash is null or not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user)
  or policy.id is null or not policy.enabled or policy.expires_at<=clock_timestamp() then raise;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended(p_screening::text,936));
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for share;
 if not found then raise;end if;
 select * into policy from public.icash_dnc_verification_sources where evidence_kind='national_provider_observation'
  and observation_provider='dealmachine' for share;
 if not found or not policy.enabled or policy.expires_at<=clock_timestamp() then raise;end if;
 perform 1 from public.icash_owner_contacts current_source where current_source.screening_id=p_screening and current_source.account_id=p_account
  and current_source.operation_key=oc.operation_key and current_source.created_at=oc.created_at
  and encode(sha256(convert_to(current_source.result::text,'UTF8')),'hex')=source_hash for share;
 if not found then raise;end if;
 insert into public.icash_dealmachine_dnc_rejections(screening_id,account_id,operation_key,source_hash,source_recorded_at,rejected_at,reason)
 values(p_screening,p_account,oc.operation_key,source_hash,oc.created_at,clock_timestamp(),left(failure,300)) on conflict(screening_id) do nothing;
 return jsonb_build_object('status','source_rejected','observations',0,'reason',failure);
end $$;

-- Retain the core's exact locking boundary. New typed observations must also be
-- bound to this tenant, property, original owner result and immutable ingestion.
alter function public.icash_lock_operational_dnc(uuid,uuid) rename to icash_lock_operational_dnc_before_dm_observations;
create function public.icash_lock_operational_dnc(p_account uuid,p_contact uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.icash_operational_contacts;d public.icash_dnc_verification_receipts;i public.icash_dealmachine_dnc_ingestions;
 oc public.icash_owner_contacts;cost public.icash_cost_observations;o public.icash_operation_spend;reservation public.icash_credit_reservations;policy public.icash_dnc_verification_sources;stamp timestamptz;
begin
 if not public.icash_lock_operational_dnc_before_dm_observations(p_account,p_contact) then return false;end if;
 select * into c from public.icash_operational_contacts where id=p_contact and account_id=p_account;
 select * into d from public.icash_dnc_verification_receipts where id=c.dnc_receipt_id;
 if d.evidence_kind='legacy_record' then return true;end if;
 select * into i from public.icash_dealmachine_dnc_ingestions where screening_id=c.screening_id and account_id=p_account;
 select * into oc from public.icash_owner_contacts where screening_id=c.screening_id and account_id=p_account for share;
 select * into o from public.icash_operation_spend where operation_key=i.operation_key and account_id=p_account for share;
 select * into reservation from public.icash_credit_reservations where id=o.credit_reservation_id for share;
 perform 1 from public.icash_operation_rates where id=o.rate_id for share;
 perform 1 from public.icash_cost_observations where provider='dealmachine'
  and event_key in (i.operation_key,i.operation_key||':people',i.operation_key||':properties',i.operation_key||':deduplicated') order by event_key for share;
 select * into policy from public.icash_dnc_verification_sources where id=d.source_id;
 stamp:=clock_timestamp();
 return coalesce(i.screening_id is not null and oc.screening_id is not null and i.observations>0
  and i.source_id=d.source_id and i.source_hash=c.source_hash and i.source_hash=d.receipt_hash
  and i.source_hash=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex') and i.operation_key=oc.operation_key and i.owner_user_id=c.owner_user_id
  and o.state in ('dispatched','settled') and i.provider_operation_hash=public.icash_dealmachine_operation_hash(o,reservation)
  and exists(select 1 from public.icash_operation_rates where id=o.rate_id and operation='owner_enrichment')
  and i.provider_cost_hash=public.icash_dealmachine_credit_manifest_hash(i.operation_key)
  and public.icash_dealmachine_saved_owner_result_valid(oc.result)
  and d.observation_provenance->>'accountId'=p_account::text and d.observation_provenance->>'screeningId'=c.screening_id::text
  and d.observation_provenance->>'providerOperationHash'=i.provider_operation_hash and d.observation_provenance->>'providerCostHash'=i.provider_cost_hash
  and d.observation_provenance->>'savedResultHash'=i.source_hash and d.observation_provenance->>'operationKey'=i.operation_key
  and d.checked_at=i.request_started_at and d.expires_at=i.original_expires_at and d.observation_recorded_at=i.ingested_at
  and policy.evidence_kind='national_provider_observation' and policy.observation_provider='dealmachine' and policy.observation_scope='national_only'
  and policy.enabled and policy.expires_at>stamp and i.request_started_at+make_interval(secs=>policy.max_observation_age_seconds)>stamp,false);
end $$;

-- Exclude foreign/changed typed observations before the core candidate LIMIT and
-- INSERT, avoiding duplicate operational projections from a globally shared phone.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_prepare_operational_contacts(uuid)'::regprocedure);
 needle:=$n$join public.icash_dnc_verification_receipts receipt on receipt.phone=public.icash_operational_phone(ph->>'number')$n$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Operational DNC candidate boundary changed';end if;
 execute replace(definition,needle,needle||$n$
 and (receipt.evidence_kind='legacy_record' or (
  receipt.evidence_kind='national_provider_observation'
  and receipt.observation_provenance->>'accountId'=oc.account_id::text
  and receipt.observation_provenance->>'screeningId'=oc.screening_id::text
  and receipt.observation_provenance->>'operationKey'=oc.operation_key
  and receipt.observation_provenance->>'savedResultHash'=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex')
  and exists(select 1 from public.icash_dealmachine_dnc_ingestions ingestion
   where ingestion.screening_id=oc.screening_id and ingestion.account_id=oc.account_id
    and ingestion.source_id=receipt.source_id and ingestion.owner_user_id=a.owner_user_id
    and ingestion.source_hash=receipt.receipt_hash and ingestion.operation_key=oc.operation_key
    and ingestion.source_recorded_at=oc.created_at and ingestion.request_started_at=receipt.checked_at
    and ingestion.original_expires_at=receipt.expires_at and ingestion.ingested_at=receipt.observation_recorded_at and ingestion.observations>0
    and ingestion.provider_operation_hash=public.icash_dealmachine_operation_hash(spend,(select r from public.icash_credit_reservations r where r.id=spend.credit_reservation_id))
    and exists(select 1 from public.icash_operation_rates original_rate where original_rate.id=spend.rate_id and original_rate.operation='owner_enrichment')
    and ingestion.provider_cost_hash=public.icash_dealmachine_credit_manifest_hash(oc.operation_key)
    and public.icash_dealmachine_saved_owner_result_valid(oc.result))))$n$);
end $patch$;

-- Bounded automatic saved-record ingestion; this neither fetches new data nor
-- enables the policy. All processed source bindings are excluded before LIMIT.
alter function public.icash_prepare_operational_contacts(uuid) rename to icash_prepare_operational_contacts_before_dm_observations;
create function public.icash_prepare_operational_contacts(p_account uuid default null) returns integer
language plpgsql security invoker set search_path='' as $$
declare candidate record;
begin
 if exists(select 1 from public.icash_dnc_verification_sources where evidence_kind='national_provider_observation'
  and observation_provider='dealmachine' and enabled and expires_at>clock_timestamp()) then
  for candidate in select oc.account_id,a.owner_user_id,oc.screening_id from public.icash_owner_contacts oc
   join public.icash_accounts a on a.id=oc.account_id
   join public.icash_operation_spend o on o.operation_key=oc.operation_key and o.account_id=oc.account_id and o.state in ('dispatched','settled')
   join public.icash_operation_rates rate on rate.id=o.rate_id and rate.operation='owner_enrichment'
   join public.icash_cost_observations cost on cost.provider='dealmachine' and cost.event_key=o.operation_key and cost.source_ref='dealmachine:owners:'||o.operation_key
   where (p_account is null or oc.account_id=p_account) and not a.bot_paused
    and not exists(select 1 from public.icash_dealmachine_dnc_ingestions i where i.screening_id=oc.screening_id)
    and not exists(select 1 from public.icash_dealmachine_dnc_rejections rejected where rejected.screening_id=oc.screening_id)
    and public.icash_dealmachine_request_started_at(oc.result) between '-infinity'::timestamptz and least(oc.created_at,clock_timestamp())
    and o.operation_key='owners:'||oc.account_id||':'||oc.screening_id and o.dispatched_at is not null
    and o.created_at>=public.icash_dealmachine_request_started_at(oc.result) and o.dispatched_at between o.created_at and oc.created_at
    and cost.units='provider_credits' and to_jsonb(cost.amount)=oc.result->'creditsUsed'
    and cost.observed_at between o.dispatched_at and oc.created_at
    and jsonb_typeof(oc.result->'contacts')='array' and jsonb_typeof(oc.result->'requestedPersonIds')='array'
    and jsonb_array_length(case when jsonb_typeof(oc.result->'contacts')='array' then oc.result->'contacts' else '[]'::jsonb end)<=25
    and jsonb_array_length(case when jsonb_typeof(oc.result->'requestedPersonIds')='array' then oc.result->'requestedPersonIds' else '[]'::jsonb end) between 1 and 25
    and coalesce(oc.result->>'creditsUsed','') ~ '^[0-9]{1,3}$' and oc.result->'providerCredits'->'used'=oc.result->'creditsUsed'
    and exists(select 1 from public.icash_screening_jobs s where s.id=oc.screening_id and s.account_id=oc.account_id and s.state='complete'
     and s.snapshot->>'propertyId'=oc.result->>'propertyId' and coalesce(s.snapshot->>'practice','false')<>'true')
   order by oc.created_at,oc.screening_id limit 100
  loop
   begin perform public.icash_ingest_dealmachine_dnc_observations(candidate.account_id,candidate.owner_user_id,candidate.screening_id);
   exception when raise_exception then null; -- Invalid saved bindings stay held; unrelated valid sources continue.
   end;
  end loop;
 end if;
 return public.icash_prepare_operational_contacts_before_dm_observations(p_account);
end $$;

-- Existing typed targets can become ineligible while their original deadline
-- remains in the future (for example, a tighter source policy or changed trail).
-- Filter them before bounded selection as well as at the existing final checks.
-- These queues already hold the common operating-budget lock before selection.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_queue_voice_jobs()'::regprocedure);
 needle:=$n$where op.channel='voice' and op.revoked_at is null and op.eligibility_until>now()$n$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Operational voice candidate boundary changed';end if;
 definition:=replace(definition,needle,needle||$n$
 and (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=op.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
  or public.icash_operational_contact_current(op.account_id,op.id,'voice',false))$n$);
 needle:=$n$where call.party='seller' and cb.state='pending_dispatch_review' and cb.due_at>now()-interval '15 minutes'$n$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Operational callback candidate boundary changed';end if;
 execute replace(definition,needle,needle||$n$
 and (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=op.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
  or public.icash_operational_contact_current(op.account_id,op.id,'voice',false))$n$);
 definition:=pg_get_functiondef('public.icash_project_operational_sms_contacts(uuid)'::regprocedure);
 needle:=$n$where oc.channel='sms' and (p_account is null or oc.account_id=p_account) and oc.revoked_at is null and oc.eligibility_until>now()$n$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Operational SMS projection candidate boundary changed';end if;
 execute replace(definition,needle,needle||$n$
   and (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=oc.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
    or public.icash_operational_contact_current(oc.account_id,oc.id,'sms',false))$n$);
end $patch$;

-- National saved observations are operational-only. They cannot be laundered
-- through the old independent-verification/consent approval workflow.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_decide_authority_review(uuid,uuid,text,text,jsonb)'::regprocedure);
 needle:='select * into dnc from public.icash_dnc_verification_receipts where id=';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Legacy authority DNC boundary changed';end if;
 execute replace(definition,needle,'select * into dnc from public.icash_dnc_verification_receipts where evidence_kind=''legacy_record'' and id=');
 definition:=pg_get_functiondef('public.icash_sms_thread_review_before_operational(uuid,uuid,boolean)'::regprocedure);
 needle:='join public.icash_dnc_verification_receipts dr on dr.id';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Legacy SMS review DNC boundary changed';end if;
 execute replace(definition,needle,'join public.icash_dnc_verification_receipts dr on dr.evidence_kind=''legacy_record'' and dr.id');
end $patch$;

-- No broad evidence write grants. The narrow definer above is the sole new writer.
revoke insert,update,delete,truncate,references,trigger on public.icash_dnc_verification_sources,public.icash_dnc_verification_receipts from service_role;
revoke all on function public.icash_dealmachine_observation_immutable(),public.icash_dealmachine_request_started_at(jsonb),
 public.icash_dealmachine_cost_observation_hash(public.icash_cost_observations),public.icash_dealmachine_saved_owner_result_valid(jsonb),
 public.icash_dealmachine_operation_hash(public.icash_operation_spend,public.icash_credit_reservations),public.icash_dealmachine_credit_manifest_hash(text),public.icash_ingest_dealmachine_dnc_observations(uuid,uuid,uuid),
 public.icash_lock_operational_dnc_before_dm_observations(uuid,uuid),public.icash_lock_operational_dnc(uuid,uuid),
 public.icash_prepare_operational_contacts_before_dm_observations(uuid),public.icash_prepare_operational_contacts(uuid) from public,anon,authenticated;
grant execute on function public.icash_dealmachine_request_started_at(jsonb),public.icash_dealmachine_saved_owner_result_valid(jsonb),
 public.icash_dealmachine_operation_hash(public.icash_operation_spend,public.icash_credit_reservations),public.icash_dealmachine_credit_manifest_hash(text),public.icash_dealmachine_cost_observation_hash(public.icash_cost_observations),public.icash_ingest_dealmachine_dnc_observations(uuid,uuid,uuid),
 public.icash_lock_operational_dnc(uuid,uuid),public.icash_prepare_operational_contacts(uuid) to service_role;
commit;
