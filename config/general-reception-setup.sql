begin;
-- LOCAL REVIEW CANDIDATE. Apply only after general-reception.sql and its
-- customer funding bridge. This installs narrow preparation controls, not an
-- enablement, budget, rate, account, credential or provider change.
create table icash_reception_private.setup_attempts (
 action text primary key check(action in ('prepare_branch','configure_branch','route','restore')),
 nonce text not null unique check(nonce ~ '^[a-f0-9]{32}$'),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 state text not null default 'started' check(state in ('started','verified')),
 started_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 original_phone jsonb,
 result jsonb,
 check((action='route')=(original_phone is not null)),
 check(original_phone is null or (jsonb_typeof(original_phone)='object'
  and octet_length(original_phone::text)<100000
  and original_phone->>'phone_number'='+17816093521'
  and original_phone->>'sid' ~ '^PN[0-9a-fA-F]{32}$'
  and original_phone->>'account_sid' ~ '^AC[0-9a-fA-F]{32}$')),
 check((state='started' and finished_at is null) or (state='verified' and finished_at is not null))
);
alter table icash_reception_private.setup_attempts enable row level security;
revoke all on icash_reception_private.setup_attempts from public,anon,authenticated,service_role;

create function public.icash_get_reception_setup()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema_version',1,
  'attempts',coalesce((select jsonb_object_agg(action,jsonb_build_object('state',state,'started_at',started_at,'finished_at',finished_at)) from icash_reception_private.setup_attempts),'{}'::jsonb),
  'original_phone',(select original_phone from icash_reception_private.setup_attempts where action='route'),
  'route_started_at',(select started_at from icash_reception_private.setup_attempts where action='route'));
$$;

-- One durable claim per fixed action. An uncertain provider response NEVER
-- releases the claim. Recovery is an independently reviewed database operation.
create function public.icash_claim_reception_setup(p_action text,p_nonce text,p_fingerprint text,p_original_phone jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare c icash_reception_private.config; r icash_reception_private.setup_attempts;
begin
 if p_action is null or p_action not in ('prepare_branch','configure_branch','route','restore')
  or p_nonce is null or p_nonce !~ '^[a-f0-9]{32}$'
  or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then return false; end if;
 select * into c from icash_reception_private.config where id=1 for update;
 if not found or c.account_id<>'48dfb798-8c1a-404f-88c0-c396cc067062'::uuid
  or c.owner_user_id<>'592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
  or exists(select 1 from icash_reception_private.setup_attempts where action=p_action) then return false; end if;
 if p_action in ('prepare_branch','configure_branch') then
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

create function public.icash_complete_reception_setup(p_action text,p_nonce text,p_result jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare c icash_reception_private.config; r icash_reception_private.setup_attempts;
begin
 if p_action is null or p_nonce is null or p_result is null or jsonb_typeof(p_result)<>'object' then return false; end if;
 select * into c from icash_reception_private.config where id=1 for update;
 select * into r from icash_reception_private.setup_attempts where action=p_action for update;
 if not found or r.nonce<>p_nonce or r.state<>'started' then return false; end if;
 if p_action in ('prepare_branch','configure_branch') then
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
revoke all on function public.icash_get_reception_setup() from public,anon,authenticated,service_role;
revoke all on function public.icash_claim_reception_setup(text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.icash_complete_reception_setup(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.icash_get_reception_setup() to service_role;
grant execute on function public.icash_claim_reception_setup(text,text,text,jsonb) to service_role;
grant execute on function public.icash_complete_reception_setup(text,text,jsonb) to service_role;
commit;
