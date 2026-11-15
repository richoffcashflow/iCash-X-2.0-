-- Existing baseline+eligible continuations need two free requests, not the
-- three-request allowance for fresh owner work. Install disabled. No budgets,
-- original receipts, ticket IDs, list lifetimes or financial holds change.
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
do $$begin
 if md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))<>'af79d3cf17140cf94eff5ade974d9c84'
  or md5(pg_get_functiondef('public.icash_enrichment_candidate(uuid)'::regprocedure))<>'3cf7415e0d709213599d94204172155a'
  or md5(pg_get_functiondef('public.icash_owner_preflight_due_at(uuid,uuid)'::regprocedure))<>'5af0c8dd0a364999f031a76ea8fa89a2'
  or md5(pg_get_functiondef('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure))<>'dcfd6ac97ef35ff179158546dec0674c'
  or md5(pg_get_functiondef('public.icash_owner_active_export_capacity(uuid)'::regprocedure))<>'15d1c11fc3ce02cf8e93306d394f08bb'
  or md5(pg_get_functiondef('icash_research_private.owner_preflight_cohort(uuid,uuid)'::regprocedure))<>'8f08b730770d9a7365cc9f056906707a'
  or md5(pg_get_functiondef('icash_research_private.owner_preflight_list_known(uuid,boolean)'::regprocedure))<>'ce6db8ef12979924314acb3d0f59a56b'
  or md5(pg_get_functiondef('public.icash_dealmachine_capacity_available(integer)'::regprocedure))<>'3a6740504161af731f6e27ff4788f74a'
  or md5(pg_get_functiondef('public.icash_dealmachine_capacity_available(integer,uuid)'::regprocedure))<>'14c36dd47e50e3e1cfd0a2e5f58696ef'
 then raise exception 'Preflight step-capacity prerequisite changed';end if;
end $$;
create table icash_work_private.preflight_step_policy(
 id integer primary key check(id=1),enabled boolean not null default false,
 release_sha text check(release_sha~'^[a-f0-9]{40}$'),activated_at timestamptz,
 function_hashes jsonb not null default '{}',
 check((release_sha is null)=(activated_at is null)),
 check(not enabled or (release_sha is not null and activated_at is not null))
);
insert into icash_work_private.preflight_step_policy(id) values(1);
alter table icash_work_private.preflight_step_policy enable row level security;
revoke all on icash_work_private.preflight_step_policy from public,anon,authenticated,service_role;

create function icash_work_private.owner_preflight_two_step_current(p_id uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
begin
 -- A disabled overlay must stop before any original-source reads. SQL AND
 -- expression ordering does not guarantee this when ordinary capacity is two.
 if not exists(select 1 from icash_work_private.preflight_step_policy where id=1 and enabled) then return false;end if;
 return exists(select 1 from icash_research_private.owner_export_preflights p
  join public.icash_accounts a on a.id=p.account_id and not a.bot_paused
  join public.icash_wallets w on w.account_id=p.account_id and w.balance_cents>w.reserved_cents
  where p.id=p_id and p.state='waiting' and p.checked_at is null
   and p.created_at<=now() and p.created_at>now()-interval '30 minutes'
   and p.next_check_at<=now() and p.deleted_at is null and p.cleanup_attempts=0
   and (p.indexing_next_step is null or (p.indexing_next_step='baseline' and p.indexing_checks<6
    and exists(select 1 from icash_research_private.owner_export_settings where id=1 and preflight_indexing_enabled)))
   and not(p.receipts ?| array['baseline','eligible'])
   and p.fingerprint=md5(jsonb_build_array(p.items,p.request)::text)
   and public.icash_membership_work_allowed(p.account_id)
   and public.icash_owner_active_export_capacity(p.account_id) in ('ready','quota_wait')
   and icash_research_private.owner_preflight_list_known(p.id,true)
   and not exists(select 1 from jsonb_array_elements(p.items) item
    where public.icash_owner_enrichment_retry_current(p.account_id,(item->>'screeningId')::uuid) is distinct from true)
   and p.items=icash_research_private.owner_preflight_cohort(p.account_id,(p.items->0->>'screeningId')::uuid));
end;
$$;

-- No starter allowance: the accountless capacity check uses only the existing
-- ordinary paced allowance. Final requests still perform their atomic admission.
create function public.icash_owner_preflight_step_capacity(p_account uuid,p_screening uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_account is not null and p_screening is not null
  and public.icash_owner_active_export_capacity(p_account) in ('ready','quota_wait')
  and public.icash_dealmachine_capacity_available(2)
  and exists(select 1 from icash_research_private.owner_export_preflights p
   where p.account_id=p_account and p.items->0->>'screeningId'=p_screening::text
    and icash_work_private.owner_preflight_two_step_current(p.id));
$$;
create function icash_work_private.owner_preflight_step_due(p_account uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from icash_work_private.preflight_step_policy where id=1 and enabled)
  or not public.icash_dealmachine_capacity_available(2) then return false;end if;
 -- On each ordinary turn, leave two tokens to accrue the original third.
 -- Otherwise continuous two-token continuations could starve fresh work.
 if not exists(select 1 from icash_work_private.continuation_policy where id=1 and enabled and issued%3<>2) then return false;end if;
 if public.icash_owner_active_export_capacity(p_account) not in ('ready','quota_wait') then return false;end if;
 return public.icash_owner_preflight_due_at(p_account,null::uuid) is not null;
end;
$$;
revoke all on function icash_work_private.owner_preflight_two_step_current(uuid),icash_work_private.owner_preflight_step_due(uuid),public.icash_owner_preflight_step_capacity(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_owner_preflight_step_capacity(uuid,uuid) to service_role;
grant execute on function icash_work_private.owner_preflight_step_due(uuid) to service_role;

do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_owner_preflight_due_at(uuid,uuid)'::regprocedure);
 d:=replace(d,'select p.account_id,p.items,case when p.state=', 'select p.id,p.account_id,p.items,case when p.state=');
 needle:='where public.icash_dealmachine_capacity_available(3,p_account)';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight due capacity changed';end if;
 -- Parentheses retain every following source/ticket/financial predicate.
 d:=replace(d,needle,'where (public.icash_dealmachine_capacity_available(3,p_account) or (public.icash_dealmachine_capacity_available(2) and icash_work_private.owner_preflight_two_step_current(p.id)))');
 execute d;
 d:=pg_get_functiondef('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure);
 needle:='or not public.icash_dealmachine_capacity_available(3,p_account) then';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight claim capacity changed';end if;
 execute replace(d,needle,'or not (public.icash_dealmachine_capacity_available(3,p_account) or (public.icash_dealmachine_capacity_available(2) and icash_work_private.owner_preflight_two_step_current(p.id))) then');
 d:=pg_get_functiondef('public.icash_enrichment_candidate(uuid)'::regprocedure);
 needle:='select case when public.icash_dealmachine_capacity_available(2,p_account) and public.icash_owner_active_export_capacity(p_account) in (''disabled'',''ready'') then public.icash_enrichment_before_provider_quota(p_account) else null::uuid end;';
 if strpos(d,needle)=0 then raise exception 'Preflight candidate capacity changed';end if;
 execute replace(d,needle,'with candidate as materialized (select public.icash_enrichment_before_provider_quota(p_account) id
 where (public.icash_dealmachine_capacity_available(2,p_account) and public.icash_owner_active_export_capacity(p_account) in (''disabled'',''ready'')) or icash_work_private.owner_preflight_step_due(p_account))
 select id from candidate where (public.icash_dealmachine_capacity_available(2,p_account) and public.icash_owner_active_export_capacity(p_account) in (''disabled'',''ready'')) or public.icash_owner_preflight_step_capacity(p_account,id);');
 d:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 needle:='and public.icash_acquisition_capacity_available(d.account_id) and';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight acquisition capacity changed';end if;
 d:=replace(d,needle,'and (public.icash_acquisition_capacity_available(d.account_id) or icash_work_private.owner_preflight_step_due(d.account_id)) and');
 needle:='and public.icash_owner_active_export_capacity(d.account_id) in (''disabled'',''ready'')'||E'\n';
 if (length(d)-length(replace(d,needle,'')))<>3*length(needle) then raise exception 'Preflight ranking capacity changed';end if;
 -- A changed rank cannot authorize unrelated work: exact candidate and claim
 -- gates below remain bound to the same source and remaining phase.
 d:=replace(d,needle,'and (public.icash_owner_active_export_capacity(d.account_id) in (''disabled'',''ready'') or icash_work_private.owner_preflight_step_due(d.account_id))'||E'\n');
 needle:='where c.contacts_enabled and public.icash_owner_active_export_capacity(c.account_id) in (''disabled'',''ready'') and r.id=c.contact_rate_id';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight quote capacity changed';end if;
 execute replace(d,needle,'where c.contacts_enabled and (public.icash_owner_active_export_capacity(c.account_id) in (''disabled'',''ready'') or icash_work_private.owner_preflight_step_due(c.account_id)) and r.id=c.contact_rate_id');
end $patch$;

update icash_work_private.preflight_step_policy set function_hashes=(select jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure))) from unnest(array[
 'public.icash_next_acquisition()','public.icash_enrichment_candidate(uuid)','public.icash_owner_preflight_due_at(uuid,uuid)',
 'public.icash_claim_owner_preflight(uuid,jsonb,jsonb)','public.icash_owner_preflight_step_capacity(uuid,uuid)',
 'icash_work_private.owner_preflight_two_step_current(uuid)','icash_work_private.owner_preflight_step_due(uuid)',
 'public.icash_owner_active_export_capacity(uuid)','public.icash_take_dealmachine_request(text,uuid,text,uuid)',
 'icash_research_private.owner_preflight_cohort(uuid,uuid)','icash_research_private.owner_preflight_list_known(uuid,boolean)',
 'public.icash_dealmachine_capacity_available(integer)','public.icash_dealmachine_capacity_available(integer,uuid)',
 'icash_research_private.request_reserve_state(timestamptz)','icash_research_private.starter_request_allowance(uuid,timestamptz)',
 'public.icash_owner_enrichment_retry_current(uuid,uuid)','public.icash_owner_enrichment_unstarted(uuid,uuid,text)',
 'icash_research_private.unknown_export_late_capacity_blocked()']) signatures(signature)) where id=1;
create function icash_work_private.activate_preflight_step_capacity(p_release text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare p icash_work_private.preflight_step_policy;signature text;expected text[]:=array[
 'public.icash_next_acquisition()','public.icash_enrichment_candidate(uuid)','public.icash_owner_preflight_due_at(uuid,uuid)',
 'public.icash_claim_owner_preflight(uuid,jsonb,jsonb)','public.icash_owner_preflight_step_capacity(uuid,uuid)',
 'icash_work_private.owner_preflight_two_step_current(uuid)','icash_work_private.owner_preflight_step_due(uuid)',
 'public.icash_owner_active_export_capacity(uuid)','public.icash_take_dealmachine_request(text,uuid,text,uuid)',
 'icash_research_private.owner_preflight_cohort(uuid,uuid)','icash_research_private.owner_preflight_list_known(uuid,boolean)',
 'public.icash_dealmachine_capacity_available(integer)','public.icash_dealmachine_capacity_available(integer,uuid)',
 'icash_research_private.request_reserve_state(timestamptz)','icash_research_private.starter_request_allowance(uuid,timestamptz)',
 'public.icash_owner_enrichment_retry_current(uuid,uuid)','public.icash_owner_enrichment_unstarted(uuid,uuid,text)',
 'icash_research_private.unknown_export_late_capacity_blocked()'];
begin
 if p_release is null or p_release!~'^[a-f0-9]{40}$' then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then return false;end if;
 if not exists(select 1 from icash_work_private.continuation_policy where id=1 and enabled) then return false;end if;
 select * into p from icash_work_private.preflight_step_policy where id=1 for update;
 if not found or p.enabled or p.activated_at is not null or p.release_sha is not null
  or jsonb_typeof(p.function_hashes) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p.function_hashes))<>cardinality(expected) then return false;end if;
 foreach signature in array expected loop
  if (p.function_hashes->>signature) is distinct from md5(pg_get_functiondef(signature::regprocedure)) then return false;end if;
 end loop;
 update icash_work_private.preflight_step_policy set enabled=true,release_sha=p_release,activated_at=clock_timestamp() where id=1;
 return true;
end $$;
revoke all on function icash_work_private.activate_preflight_step_capacity(text) from public,anon,authenticated,service_role;
