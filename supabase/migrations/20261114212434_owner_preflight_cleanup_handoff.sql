-- Expired free lists may request their own cleanup before ordinary renewal.
-- No lifetime, original receipt, paid admission, or global FIFO is rewritten.
-- The migration runner owns the SQL transaction and its migration ledger.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if md5(pg_get_functiondef('public.icash_claim_owner_preflight_cleanup(uuid)'::regprocedure))<>'cb0e5bd167d5c5141b0f5d83fd1804cd'
  or md5(pg_get_functiondef('public.icash_record_owner_preflight_cleanup(uuid,uuid,jsonb)'::regprocedure))<>'f716d1379f9411b5fe7b6afdf1d5fbb8'
  or md5(pg_get_functiondef('icash_research_private.owner_preflight_renewable(uuid)'::regprocedure))<>'7edcd890a645cf4dd49e814167b55571'
  or md5(pg_get_functiondef('icash_research_private.guard_owner_preflight_generation()'::regprocedure))<>'7627d5dddf3009e1f01681173d460111'
  or md5(pg_get_functiondef('icash_research_private.owner_preflight_list_known(uuid,boolean)'::regprocedure))<>'ce6db8ef12979924314acb3d0f59a56b'
  or md5(pg_get_functiondef('public.icash_defer_owner_enrichment(uuid,uuid,uuid,text,text)'::regprocedure))<>'5255607712113f2953b00d5a6ba58057'
  then raise exception 'Cleanup handoff evidence prerequisite changed';end if;
end$$;

create table icash_research_private.owner_preflight_cleanup_policy(
 id integer primary key check(id=1),enabled boolean not null default false,
 release_sha text check(release_sha ~ '^[0-9a-f]{40}$'),activated_at timestamptz,
 function_hashes jsonb not null default '{}'::jsonb check(jsonb_typeof(function_hashes)='object'),
 trigger_hashes jsonb not null default '{}'::jsonb check(jsonb_typeof(trigger_hashes)='object'),
 check((release_sha is null)=(activated_at is null)),
 check(not enabled or (release_sha is not null and activated_at is not null))
);
insert into icash_research_private.owner_preflight_cleanup_policy(id) values(1);
create table icash_research_private.owner_preflight_cleanup_admissions(
 request_id uuid primary key,preflight_id uuid not null references icash_research_private.owner_export_preflights(id),
 account_id uuid not null,token uuid not null unique,list_id jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index owner_preflight_cleanup_admissions_preflight on icash_research_private.owner_preflight_cleanup_admissions(preflight_id);
alter table icash_research_private.owner_preflight_cleanup_policy enable row level security;
alter table icash_research_private.owner_preflight_cleanup_admissions enable row level security;
revoke all on icash_research_private.owner_preflight_cleanup_policy,icash_research_private.owner_preflight_cleanup_admissions from public,anon,authenticated,service_role;
create function icash_research_private.guard_owner_preflight_cleanup_admission() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'Original cleanup admission is immutable';end$$;
create trigger owner_preflight_cleanup_admission_immutable before update or delete on icash_research_private.owner_preflight_cleanup_admissions
 for each row execute function icash_research_private.guard_owner_preflight_cleanup_admission();

-- Read-only identity/source proof. A busy cleanup lease still needs a bounded
-- ticket wait; neither this predicate nor that wait authorizes contact work.
create function icash_research_private.owner_preflight_cleanup_current(p_account uuid,p_id uuid) returns boolean
language plpgsql stable set search_path='' as $$
declare p icash_research_private.owner_export_preflights;item jsonb;
begin
 if not exists(select 1 from icash_research_private.owner_preflight_cleanup_policy where id=1 and enabled)
  or not exists(select 1 from icash_research_private.owner_export_settings where id=1 and enabled and preflight_enabled and preflight_renewal_enabled)
  then return false;end if;
 select * into p from icash_research_private.owner_export_preflights where id=p_id and account_id=p_account;
 if not found or p.state<>'waiting' or p.created_at>now()-interval '30 minutes' or p.started_at>now()-interval '5 minutes'
  or p.deleted_at is not null or p.cleanup_attempts>=3 or p.checked_at is not null
  or not icash_research_private.owner_preflight_list_known(p.id)
  or p.fingerprint is distinct from md5(jsonb_build_array(p.items,p.request)::text)
  or exists(select 1 from icash_research_private.owner_export_preflights child where child.supersedes=p.id
   or (child.account_id=p_account and child.fingerprint=p.fingerprint and child.generation>p.generation))
  or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused)
  or not public.icash_membership_work_allowed(p_account)
  or not public.icash_owner_export_people_available(p.request->'people_ids') then return false;end if;
 for item in select value from jsonb_array_elements(p.items) loop
  if public.icash_owner_enrichment_retry_current(p_account,(item->>'screeningId')::uuid) is distinct from true
   or not exists(select 1 from public.icash_screening_jobs s where s.id=(item->>'screeningId')::uuid
    and s.account_id=p_account and s.snapshot=item->'snapshot')
   or coalesce(p.request->'mobile_only','false'::jsonb) is distinct from to_jsonb(public.icash_owner_targeting_pool(p_account,(item->>'screeningId')::uuid)='mobile')
   then return false;end if;
 end loop;
 return true;
end $$;

do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure);
 if md5(d)<>'c9ab68267808952a61a20f8cfd3391fa' then raise exception 'Cleanup handoff claim prerequisite changed';end if;
 needle:='  if p.state=''held'' or p.created_at<clock_timestamp()-interval ''30 minutes'' or (p.state=''waiting'' and p.cleanup_attempts>0) then return ''{"status":"held"}'';end if;';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Cleanup handoff boundary changed';end if;
 execute replace(d,needle,$new$  if icash_research_private.owner_preflight_cleanup_current(p_account,p.id) then
   return jsonb_build_object('status','cleanup_required','id',p.id,'screeningId',p.items->0->>'screeningId');
  end if;
$new$||needle);
end $patch$;

-- The same try-advisory lock as ordinary claim prevents its preflight/budget
-- renewal ordering from crossing this budget/preflight ordering. Never wait on
-- a preflight row while holding budget: FIFO cleanup may already own that row.
create function public.icash_admit_owner_preflight_cleanup(p_account uuid,p_id uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p icash_research_private.owner_export_preflights;token uuid:=gen_random_uuid();
begin
 if p_account is null or p_id is null or p_request is null then return '{"status":"held"}';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('owner-preflight:'||p_account,0)) then return '{"status":"pending"}';end if;
 begin
  perform 1 from public.icash_operating_budget where id=1 and enabled for update nowait;
  if not found then return '{"status":"held"}';end if;
  select * into p from icash_research_private.owner_export_preflights where id=p_id and account_id=p_account for update nowait;
 exception when lock_not_available then return '{"status":"pending"}';end;
 if not found or icash_research_private.owner_preflight_cleanup_current(p_account,p_id) is distinct from true then return '{"status":"held"}';end if;
 if p.cleanup_until>=clock_timestamp() then return '{"status":"pending"}';end if;
 if exists(select 1 from icash_research_private.owner_preflight_cleanup_admissions where request_id=p_request)
  or exists(select 1 from icash_research_private.requests where id=p_request) then return '{"status":"held"}';end if;
 if public.icash_take_dealmachine_request('owner_preview',p_account,'owner-preflight-cleanup:'||p_id,p_request) is distinct from true
  then return '{"status":"quota_wait"}';end if;
 -- Only an admitted provider attempt consumes the unchanged three-attempt cap.
 update icash_research_private.owner_export_preflights set cleanup_token=token,cleanup_until=clock_timestamp()+interval '5 minutes',cleanup_attempts=cleanup_attempts+1 where id=p_id;
 insert into icash_research_private.owner_preflight_cleanup_admissions(request_id,preflight_id,account_id,token,list_id)
 values(p_request,p_id,p_account,token,p.list_id);
 return jsonb_build_object('status','admitted','id',p_id,'accountId',p_account,'token',token,'listId',p.list_id,'requestId',p_request);
end $$;

create function public.icash_defer_owner_preflight_cleanup(p_id uuid,p_account uuid,p_screening uuid,p_token text,p_operation text,p_preflight uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found or p_operation is distinct from 'owners:'||p_account||':'||p_screening
  or icash_research_private.owner_preflight_cleanup_current(p_account,p_preflight) is distinct from true
  or not exists(select 1 from icash_research_private.owner_export_preflights p where p.id=p_preflight
   and p.account_id=p_account and p.items->0->>'screeningId'=p_screening::text) then return false;end if;
 -- Existing token/source, 8-deferral, 24-hour and exponential-backoff gates stay
 -- authoritative. No fresh-preflight fairness/continuation marker is granted.
 return public.icash_defer_owner_enrichment(p_id,p_account,p_screening,p_token,p_operation);
end $$;
revoke all on function icash_research_private.guard_owner_preflight_cleanup_admission(),icash_research_private.owner_preflight_cleanup_current(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.icash_admit_owner_preflight_cleanup(uuid,uuid,uuid),public.icash_defer_owner_preflight_cleanup(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_admit_owner_preflight_cleanup(uuid,uuid,uuid),public.icash_defer_owner_preflight_cleanup(uuid,uuid,uuid,text,text,uuid) to service_role;

-- Snapshot the exact installed contract; a fixed required signature set in
-- activation also rejects an empty, incomplete, null or substituted manifest.
update icash_research_private.owner_preflight_cleanup_policy set function_hashes=(
 select jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure))) from unnest(array[
  'public.icash_claim_owner_preflight(uuid,jsonb,jsonb)',
  'icash_research_private.owner_preflight_cleanup_current(uuid,uuid)',
  'public.icash_admit_owner_preflight_cleanup(uuid,uuid,uuid)',
  'public.icash_defer_owner_preflight_cleanup(uuid,uuid,uuid,text,text,uuid)',
  'public.icash_claim_owner_preflight_cleanup(uuid)',
  'public.icash_record_owner_preflight_cleanup(uuid,uuid,jsonb)',
  'icash_research_private.owner_preflight_renewable(uuid)',
  'icash_research_private.guard_owner_preflight_generation()',
  'icash_research_private.owner_preflight_list_known(uuid,boolean)',
  'public.icash_defer_owner_enrichment(uuid,uuid,uuid,text,text)',
  'public.icash_owner_enrichment_retry_current(uuid,uuid)',
  'public.icash_owner_enrichment_retry_safe(uuid,uuid)',
  'public.icash_owner_enrichment_unstarted(uuid,uuid,text)',
  'public.icash_take_dealmachine_request(text,uuid,text,uuid)',
  'icash_research_private.guard_owner_preflight()',
  'icash_research_private.guard_owner_preflight_cleanup_admission()',
  'public.icash_owner_export_people_available(jsonb)',
  'public.icash_owner_targeting_pool(uuid,uuid)',
  'public.icash_membership_work_allowed(uuid)'
 ]) signature) where id=1;
update icash_research_private.owner_preflight_cleanup_policy set trigger_hashes=(
 select jsonb_object_agg(t.tgname,md5(pg_get_triggerdef(t.oid))) from pg_trigger t
 where (t.tgrelid='icash_research_private.owner_export_preflights'::regclass and t.tgname in ('owner_preflight_immutable','owner_preflight_generation_immutable'))
  or (t.tgrelid='icash_research_private.owner_preflight_cleanup_admissions'::regclass and t.tgname='owner_preflight_cleanup_admission_immutable')) where id=1;
create function icash_research_private.activate_owner_preflight_cleanup(p_release text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare p icash_research_private.owner_preflight_cleanup_policy;signature text;required text[]:=array[
 'public.icash_claim_owner_preflight(uuid,jsonb,jsonb)',
 'icash_research_private.owner_preflight_cleanup_current(uuid,uuid)',
 'public.icash_admit_owner_preflight_cleanup(uuid,uuid,uuid)',
 'public.icash_defer_owner_preflight_cleanup(uuid,uuid,uuid,text,text,uuid)',
 'public.icash_claim_owner_preflight_cleanup(uuid)',
 'public.icash_record_owner_preflight_cleanup(uuid,uuid,jsonb)',
 'icash_research_private.owner_preflight_renewable(uuid)',
 'icash_research_private.guard_owner_preflight_generation()',
 'icash_research_private.owner_preflight_list_known(uuid,boolean)',
 'public.icash_defer_owner_enrichment(uuid,uuid,uuid,text,text)',
 'public.icash_owner_enrichment_retry_current(uuid,uuid)',
 'public.icash_owner_enrichment_retry_safe(uuid,uuid)',
 'public.icash_owner_enrichment_unstarted(uuid,uuid,text)',
 'public.icash_take_dealmachine_request(text,uuid,text,uuid)',
 'icash_research_private.guard_owner_preflight()',
 'icash_research_private.guard_owner_preflight_cleanup_admission()',
 'public.icash_owner_export_people_available(jsonb)',
 'public.icash_owner_targeting_pool(uuid,uuid)',
 'public.icash_membership_work_allowed(uuid)'];
begin
 if p_release is null or p_release!~'^[a-f0-9]{40}$' then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return false;end if;
 select * into p from icash_research_private.owner_preflight_cleanup_policy where id=1 for update;
 if not found or p.enabled or p.activated_at is not null or p.release_sha is not null
  or jsonb_typeof(p.function_hashes) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p.function_hashes))<>cardinality(required) then return false;end if;
 foreach signature in array required loop
  if to_regprocedure(signature) is null or (p.function_hashes->>signature) is null
   or (p.function_hashes->>signature) is distinct from md5(pg_get_functiondef(to_regprocedure(signature))) then return false;end if;
 end loop;
 if jsonb_typeof(p.trigger_hashes) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p.trigger_hashes))<>3
  or exists(select 1 from (values
   ('owner_preflight_immutable','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_owner_preflight()'::regprocedure),
   ('owner_preflight_generation_immutable','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_owner_preflight_generation()'::regprocedure),
   ('owner_preflight_cleanup_admission_immutable','icash_research_private.owner_preflight_cleanup_admissions'::regclass,'icash_research_private.guard_owner_preflight_cleanup_admission()'::regprocedure)
  ) expected(name,relation,guard) left join pg_trigger t on t.tgname=expected.name and t.tgrelid=expected.relation
  where t.oid is null or t.tgisinternal or t.tgenabled not in ('O','A') or t.tgfoid<>expected.guard
   or (p.trigger_hashes->>expected.name) is distinct from md5(pg_get_triggerdef(t.oid))) then return false;end if;
 update icash_research_private.owner_preflight_cleanup_policy
  set enabled=true,release_sha=p_release,activated_at=clock_timestamp() where id=1;
 return true;
end $$;
revoke all on function icash_research_private.activate_owner_preflight_cleanup(text) from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
