-- CANDIDATE ONLY: apply separately after review; never invoked by a build.
-- No approval is created here, no customer financial rows are written, and no
-- old approval/production hold is changed. A claimed diagnostic stays held even
-- after HTTP 500, timeout, expiry, or a successful response. A future separately
-- reviewed original-outcome reconciliation is required to release it. Do not
-- drop this protection as rollback while any diagnostic outcome is unresolved.
begin;
create table icash_research_private.owner_export_diagnostic_slots (
 provider text primary key check(provider='dealmachine_active_phone_export_verification_20261029_v4'),
 approval jsonb not null,
 initial_state jsonb not null,
 claimed_at timestamptz not null default clock_timestamp()
);
alter table icash_research_private.owner_export_diagnostic_slots enable row level security;
revoke all on icash_research_private.owner_export_diagnostic_slots from public,anon,authenticated,service_role;

create function icash_research_private.guard_owner_export_diagnostic_slot() returns trigger
language plpgsql set search_path='' as $$
begin
 raise exception 'Diagnostic export slot requires reviewed original outcome reconciliation';
end $$;
create trigger owner_export_diagnostic_immutable before update or delete on icash_research_private.owner_export_diagnostic_slots
 for each row execute function icash_research_private.guard_owner_export_diagnostic_slot();
revoke all on function icash_research_private.guard_owner_export_diagnostic_slot() from public,anon,authenticated,service_role;

-- This trigger closes the reverse race, including direct production inserts.
-- It runs inside production admission's transaction, so rejection also rolls
-- back any financial/quota writes in that transaction.
create function icash_research_private.guard_owner_export_diagnostic_overlap() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not pg_try_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0)) then
  raise exception 'Organization export slot busy';
 end if;
 if exists(select 1 from icash_research_private.owner_export_diagnostic_slots) then
  raise exception 'Organization diagnostic export slot held';
 end if;
 return new;
end $$;
create trigger owner_export_diagnostic_overlap before insert on icash_research_private.owner_exports
 for each row execute function icash_research_private.guard_owner_export_diagnostic_overlap();
revoke all on function icash_research_private.guard_owner_export_diagnostic_overlap() from public,anon,authenticated,service_role;

create function public.icash_claim_owner_export_diagnostic(p_provider text,p_approval jsonb,p_state jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare
 expected jsonb; approved timestamptz; expires timestamptz; started timestamptz;
 uuid_pattern constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
 if p_provider is distinct from 'dealmachine_active_phone_export_verification_20261029_v4'
  or jsonb_typeof(p_approval) is distinct from 'object' or jsonb_typeof(p_state) is distinct from 'object'
  or not (p_approval @> '{"status":"approved","version":4,"explicitOwnerApproval":true,"maxCredits":1,"maxPaidRequests":1,"maxProviderRequests":4,"customerWalletCharge":false,"callsOrTexts":false,"automaticRetry":false,"allowAboveAppQuota":false}'::jsonb)
  or coalesce(p_approval->>'approvalId','') !~ uuid_pattern
  or coalesce(p_approval->>'accountId','') !~ uuid_pattern
  or coalesce(p_approval->>'screeningId','') !~ uuid_pattern
  or coalesce(p_state->>'runId','') !~ uuid_pattern
  or coalesce(p_approval->>'personId','') !~ '^per_[1-9][0-9]{0,30}$'
  or coalesce(p_approval->>'propertyId','') !~ '^prop_[1-9][0-9]{0,19}$'
  or coalesce(p_approval->>'reviewedCommit','') !~ '^[0-9a-f]{40}$'
  or coalesce(p_approval->>'requestHash','') !~ '^[0-9a-f]{64}$'
  or coalesce(p_approval->>'sourceOperation','')=''
  then return false;end if;
 -- jsonb has canonical key order, unlike the wire JSON hash. The runner must
 -- recompute SHA256 of its exact wire body; SQL binds that approved hash and
 -- independently enforces the entire semantic request, with no extra fields.
 expected:=jsonb_build_object('people_ids',jsonb_build_array(p_approval->>'personId'),'fields','["person_full_name","has_active_phone_number"]'::jsonb,'property_match','owner','anchor','person','limit',1,'require_phone',true,'scrub_dnc',true,'active_phones_only',true);
 if p_approval->'request' is distinct from expected
  or p_state is distinct from (p_approval||jsonb_build_object('status','started','runId',p_state->>'runId','startedAt',p_state->>'startedAt','requests','[]'::jsonb,'outreach',false))
  then return false;end if;
 begin
  approved:=(p_approval->>'approvedAt')::timestamptz;
  expires:=(p_approval->>'expiresAt')::timestamptz;
  started:=(p_state->>'startedAt')::timestamptz;
  if approved is null or expires is null or started is null
   or not isfinite(approved) or not isfinite(expires) or not isfinite(started)
   or approved>clock_timestamp() or expires<=clock_timestamp() or expires<=approved
   or expires-approved>interval '1 hour' or started<approved or started>clock_timestamp()
   or started<clock_timestamp()-interval '1 minute' then return false;end if;
  if not exists(select 1 from public.icash_owner_contacts c
   where c.account_id=(p_approval->>'accountId')::uuid and c.screening_id=(p_approval->>'screeningId')::uuid
    and c.operation_key=p_approval->>'sourceOperation'
    and c.created_at=(p_approval->>'sourceCreatedAt')::timestamptz
    and c.created_at<=clock_timestamp() and c.created_at>clock_timestamp()-interval '24 hours'
    and c.result->>'propertyId'=p_approval->>'propertyId'
    and c.result->'requestedPersonIds' @> jsonb_build_array(p_approval->>'personId')) then return false;end if;
 exception when invalid_datetime_format or datetime_field_overflow then return false;
 end;
 if not pg_try_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0)) then return false;end if;
 if exists(select 1 from icash_research_private.owner_exports where terminal_at is null)
  or exists(select 1 from icash_research_private.owner_export_diagnostic_slots) then return false;end if;
 -- Atomic exact original result CAS, not merely status/version comparison.
 update public.icash_integration_checks set result=p_state,checked_at=clock_timestamp()
  where provider=p_provider and result=p_approval;
 if not found then return false;end if;
 insert into icash_research_private.owner_export_diagnostic_slots(provider,approval,initial_state)
 values(p_provider,p_approval,p_state);
 return true;
end $$;
revoke all on function public.icash_claim_owner_export_diagnostic(text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.icash_claim_owner_export_diagnostic(text,jsonb,jsonb) to service_role;
commit;
