begin;
-- LOCAL REVIEW CANDIDATE ONLY. Apply AFTER general-reception-rejected-setup-recovery.sql.
-- Bounded, audit-preserving recovery: three corrected preparation attempts TOTAL.
-- Installation does not relabel any attempt, reset any action, or contact a provider.
-- A confirmed rejection is permanent. Every later attempt has its own distinct
-- action/nonce/fingerprint and requires fresh, independently verified absence proof.
alter table icash_reception_private.setup_attempts
 drop constraint setup_attempts_action_check,
 add constraint setup_attempts_action_check check(action in ('prepare_branch','prepare_branch_retry','prepare_branch_retry_2','prepare_branch_retry_3','configure_branch','route','restore')),
 drop constraint setup_attempts_rejected_422,
 add constraint setup_attempts_rejected_422 check(state<>'rejected' or (
  action in ('prepare_branch','prepare_branch_retry','prepare_branch_retry_2','prepare_branch_retry_3')
  and original_phone is null and result is not null and jsonb_typeof(result)='object'
  and result->'provider_status' is not distinct from '422'::jsonb
  and result->'branch_absent' is not distinct from 'true'::jsonb
  and result ?& array['evidence_reference','provider_observed_at','branch_absence_checked_at','recorded_at']));

create function public.icash_confirm_reception_setup_rejection(
 p_action text,p_nonce text,p_fingerprint text,p_evidence_reference text,
 p_provider_observed_at timestamptz,p_branch_absence_checked_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $$
declare c icash_reception_private.config;r icash_reception_private.setup_attempts;t timestamptz;
 actions text[]:=array['prepare_branch','prepare_branch_retry','prepare_branch_retry_2','prepare_branch_retry_3'];attempt_index integer;
begin
 attempt_index:=array_position(actions,p_action);
 if attempt_index is null or p_nonce is null or p_nonce !~ '^[a-f0-9]{32}$'
  or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
  or p_evidence_reference is null or length(btrim(p_evidence_reference)) not between 10 and 2000
  or p_provider_observed_at is null or not isfinite(p_provider_observed_at)
  or p_branch_absence_checked_at is null or not isfinite(p_branch_absence_checked_at) then return false; end if;
 select * into c from icash_reception_private.config where id=1 for update;
 if not found or c.enabled or c.branch_id is not null
  or c.account_id<>'48dfb798-8c1a-404f-88c0-c396cc067062'::uuid
  or c.owner_user_id<>'592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
  or exists(select 1 from icash_reception_private.receipts)
  or exists(select 1 from icash_reception_private.setup_attempts a
    where array_position(actions,a.action)>attempt_index or (a.state='started' and a.action<>p_action)) then return false; end if;
 select * into r from icash_reception_private.setup_attempts where action=p_action for update;
 t:=clock_timestamp();
 if not found or r.state<>'started' or r.nonce<>p_nonce or r.fingerprint<>p_fingerprint
  or r.original_phone is not null or r.result is not null
  or p_provider_observed_at<r.started_at or p_provider_observed_at>t
  or p_branch_absence_checked_at<p_provider_observed_at or p_branch_absence_checked_at>t
  or p_branch_absence_checked_at<t-interval '10 minutes' then return false; end if;
 update icash_reception_private.setup_attempts set state='rejected',finished_at=t,
  result=jsonb_build_object('provider_status',422,'branch_absent',true,'attempt_action',p_action,
   'evidence_reference',p_evidence_reference,'provider_observed_at',p_provider_observed_at,
   'branch_absence_checked_at',p_branch_absence_checked_at,'recorded_at',t)
 where action=p_action;
 return true;
end $$;
revoke all on function public.icash_confirm_reception_setup_rejection(text,text,text,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.icash_confirm_reception_setup_rejection(text,text,text,text,timestamptz,timestamptz) to service_role;

-- Preserve the original public signature and ACL, but route its narrow action
-- through the same exact-evidence implementation. Already rejected returns false.
create or replace function public.icash_confirm_reception_setup_rejected_422(
 p_nonce text,p_fingerprint text,p_evidence_reference text,
 p_provider_observed_at timestamptz,p_branch_absence_checked_at timestamptz
) returns boolean language sql security definer set search_path='' as $$
 select public.icash_confirm_reception_setup_rejection('prepare_branch',p_nonce,p_fingerprint,
  p_evidence_reference,p_provider_observed_at,p_branch_absence_checked_at);
$$;

create or replace function icash_reception_private.guard_setup_recovery_audit()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='TRUNCATE' then
  if exists(select 1 from icash_reception_private.setup_attempts where state='rejected' or action in ('prepare_branch_retry','prepare_branch_retry_2','prepare_branch_retry_3')) then
   raise exception 'Reception recovery audit cannot be removed';
  end if;
  return null;
 end if;
 if TG_OP='DELETE' then
  if old.state='rejected' or old.action in ('prepare_branch_retry','prepare_branch_retry_2','prepare_branch_retry_3') then raise exception 'Reception recovery audit cannot be removed'; end if;
  return old;
 end if;
 if old.state='rejected' then raise exception 'Rejected reception setup audit is immutable'; end if;
 if old.action in ('prepare_branch_retry','prepare_branch_retry_2','prepare_branch_retry_3') or new.state='rejected' then
  if (to_jsonb(new)-array['state','finished_at','result']) is distinct from (to_jsonb(old)-array['state','finished_at','result'])
   then raise exception 'Reception recovery identity is immutable'; end if;
  if old.state<>'started' or new.state not in ('verified','rejected') then raise exception 'Reception recovery audit cannot be reset'; end if;
 end if;
 return new;
end $$;

create or replace function public.icash_get_reception_setup()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema_version',1,
  'attempts',coalesce((select jsonb_object_agg(action,jsonb_build_object('state',state,'started_at',started_at,'finished_at',finished_at,'provider_status',case when state='rejected' then result->'provider_status' else null end)) from icash_reception_private.setup_attempts),'{}'::jsonb),
  'original_phone',(select original_phone from icash_reception_private.setup_attempts where action='route'),
  'route_started_at',(select started_at from icash_reception_private.setup_attempts where action='route'));
$$;

create or replace function public.icash_claim_reception_setup(p_action text,p_nonce text,p_fingerprint text,p_original_phone jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare c icash_reception_private.config; r icash_reception_private.setup_attempts; predecessor text;t timestamptz;
begin
 if p_action is null or p_action not in ('prepare_branch','prepare_branch_retry','prepare_branch_retry_2','prepare_branch_retry_3','configure_branch','route','restore')
  or p_nonce is null or p_nonce !~ '^[a-f0-9]{32}$'
  or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then return false; end if;
 select * into c from icash_reception_private.config where id=1 for update;
 if not found or c.account_id<>'48dfb798-8c1a-404f-88c0-c396cc067062'::uuid
  or c.owner_user_id<>'592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
  or exists(select 1 from icash_reception_private.setup_attempts where action=p_action) then return false; end if;
 if p_action in ('prepare_branch_retry','prepare_branch_retry_2','prepare_branch_retry_3') then
  predecessor:=case p_action when 'prepare_branch_retry' then 'prepare_branch'
   when 'prepare_branch_retry_2' then 'prepare_branch_retry' when 'prepare_branch_retry_3' then 'prepare_branch_retry_2' end;
  select * into r from icash_reception_private.setup_attempts where action=predecessor for share;
  t:=clock_timestamp();
  if not found or r.state<>'rejected' or r.result->'provider_status' is distinct from '422'::jsonb
   or r.result->'branch_absent' is distinct from 'true'::jsonb
   or r.finished_at is null or not isfinite(r.finished_at) or r.finished_at<r.started_at or r.finished_at>t
   or r.result->>'recorded_at' is null or r.finished_at is distinct from (r.result->>'recorded_at')::timestamptz
   or r.result->>'branch_absence_checked_at' is null
   or not isfinite((r.result->>'branch_absence_checked_at')::timestamptz)
   or (r.result->>'branch_absence_checked_at')::timestamptz<t-interval '10 minutes'
   or (r.result->>'branch_absence_checked_at')::timestamptz>r.finished_at
   or c.enabled or c.branch_id is not null or exists(select 1 from icash_reception_private.receipts)
   or exists(select 1 from icash_reception_private.setup_attempts where state='started')
   or p_original_phone is not null then return false; end if;
 elsif p_action in ('prepare_branch','configure_branch') then
  if c.enabled or exists(select 1 from icash_reception_private.receipts)
   or exists(select 1 from icash_reception_private.setup_attempts where state='started')
   or p_original_phone is not null then return false; end if;
 elsif p_action='route' then
  if not c.enabled or c.config_hash is null or c.branch_id is null
   or exists(select 1 from icash_reception_private.setup_attempts where state='started')
   or p_original_phone is null or jsonb_typeof(p_original_phone)<>'object'
   or octet_length(p_original_phone::text)>=100000
   or p_original_phone->>'phone_number' is distinct from '+17816093521'
   or coalesce(p_original_phone->>'sid','') !~ '^PN[0-9a-fA-F]{32}$'
   or coalesce(p_original_phone->>'account_sid','') !~ '^AC[0-9a-fA-F]{32}$'
   or coalesce(p_original_phone->>'voice_application_sid','')<>''
   or coalesce(p_original_phone->>'trunk_sid','')<>''
   or coalesce(p_original_phone->>'voice_method','') not in ('POST','GET')
   or coalesce(p_original_phone->>'voice_fallback_method','') not in ('POST','GET') then return false; end if;
 else
  select * into r from icash_reception_private.setup_attempts where action='route';
  if not found or r.original_phone is null or r.started_at>clock_timestamp()-interval '30 seconds'
   or p_original_phone is not null then return false; end if;
 end if;
 insert into icash_reception_private.setup_attempts(action,nonce,fingerprint,original_phone)
 values(p_action,p_nonce,p_fingerprint,p_original_phone);
 return true;
end $$;

create or replace function public.icash_complete_reception_setup(p_action text,p_nonce text,p_result jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare c icash_reception_private.config; r icash_reception_private.setup_attempts;predecessor text;
begin
 if p_action is null or p_nonce is null or p_result is null or jsonb_typeof(p_result)<>'object' then return false; end if;
 select * into c from icash_reception_private.config where id=1 for update;
 select * into r from icash_reception_private.setup_attempts where action=p_action for update;
 if not found or r.nonce<>p_nonce or r.state<>'started' then return false; end if;
 if p_action in ('prepare_branch','prepare_branch_retry','prepare_branch_retry_2','prepare_branch_retry_3','configure_branch') then
  if p_action in ('prepare_branch_retry','prepare_branch_retry_2','prepare_branch_retry_3') then
   predecessor:=case p_action when 'prepare_branch_retry' then 'prepare_branch'
    when 'prepare_branch_retry_2' then 'prepare_branch_retry' when 'prepare_branch_retry_3' then 'prepare_branch_retry_2' end;
   if c.branch_id is not null or not exists(select 1 from icash_reception_private.setup_attempts prior
    where prior.action=predecessor and prior.state='rejected'
     and prior.result->'provider_status'='422'::jsonb and prior.result->'branch_absent'='true'::jsonb
     and prior.finished_at>=prior.started_at and prior.finished_at<=clock_timestamp()) then return false; end if;
  end if;
  if c.enabled or exists(select 1 from icash_reception_private.receipts)
   or (select count(*) from jsonb_object_keys(p_result))<>7
   or p_result->>'call_profile' is distinct from c.call_profile
   or p_result->>'rate_id' is distinct from c.rate_id::text
   or p_result->'max_duration_seconds' is distinct from to_jsonb(c.max_duration_seconds)
   or p_result->'customer_charge_cap_cents' is distinct from to_jsonb(c.customer_charge_cap_cents)
   or coalesce(p_result->>'branch_id','') !~ '^agtbrch_[A-Za-z0-9]{1,160}$'
   or p_result->>'branch_id'='agtbrch_8901m3sw5tn6fvkae4d334netswh'
   or coalesce(p_result->>'reviewed_version_id','') !~ '^agtvrsn_[A-Za-z0-9]{1,160}$'
   or coalesce(p_result->>'config_hash','') !~ '^[a-f0-9]{64}$' then return false; end if;
  update icash_reception_private.config set agent_id='agent_7801m3qsygdwfv5tggatf7w68y3d',
   branch_id=p_result->>'branch_id',reviewed_version_id=p_result->>'reviewed_version_id',
   config_hash=p_result->>'config_hash' where id=1 and not enabled;
 elsif p_action not in ('route','restore') or p_result<>'{}'::jsonb then return false;
 end if;
 update icash_reception_private.setup_attempts set state='verified',finished_at=clock_timestamp(),result=p_result where action=p_action;
 return true;
end $$;

-- Existing triggers keep their identity and use the replaced audit guard.
-- Existing get/claim/complete ACLs are preserved; no private-table grants added.
commit;

-- GUARDED OPERATOR TEMPLATE ONLY. No invocation is executed above.
-- Independently verify the exact provider request returned422 and that a fresh
-- branch list for the pinned agent has no matching reception branch.
-- Trusted private lookup (do not expose identifiers to the application):
-- select action,nonce,fingerprint,state,started_at,finished_at
--  from icash_reception_private.setup_attempts
--  where action in ('prepare_branch','prepare_branch_retry','prepare_branch_retry_2','prepare_branch_retry_3')
--  order by started_at;
-- select public.icash_confirm_reception_setup_rejection(
--  p_action => '<exact started action>', p_nonce => '<exact stored nonce>',
--  p_fingerprint => '<exact stored fingerprint>',
--  p_evidence_reference => '<verified422 analytics and fresh branch-list references>',
--  p_provider_observed_at => '<actual provider evidence timestamp>'::timestamptz,
--  p_branch_absence_checked_at => '<actual absence-check timestamp>'::timestamptz);
-- Require true and read back rejected/provider_status422. Claim only the NEXT
-- bounded action within10min of absence evidence. Never alter rejected evidence
-- to refresh an expired window. There is no fourth corrected preparation action.
