-- Give eligible newly funded accounts access to their protected request pool.
-- This is scheduling only; every provider request still uses the atomic limiter.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_owner_active_export_capacity()'::regprocedure);
 if md5(d)<>'8ea19b4d6de0fca19265db1d4663f843' then raise exception 'New-user export capacity prerequisite changed';end if;
 d:=replace(d,'public.icash_owner_active_export_capacity()','public.icash_owner_active_export_capacity(p_account uuid)');
 execute replace(d,'public.icash_dealmachine_capacity_available(3)','public.icash_dealmachine_capacity_available(3,p_account)');

 d:=pg_get_functiondef('public.icash_outbound_search_due(uuid)'::regprocedure);
 if md5(d)<>'5bcdaf85d8414b121cdb08104f96398f' then raise exception 'New-user search scheduling prerequisite changed';end if;
 execute replace(d,'public.icash_dealmachine_capacity_available()','public.icash_dealmachine_capacity_available(2,p_account)');

 d:=pg_get_functiondef('public.icash_enrichment_candidate(uuid)'::regprocedure);
 if md5(d)<>'1c00583c90386cfc8e2fc6ce9f06edd7' then raise exception 'New-user contact scheduling prerequisite changed';end if;
 d:=replace(d,'public.icash_dealmachine_capacity_available()','public.icash_dealmachine_capacity_available(2,p_account)');
 execute replace(d,'public.icash_owner_active_export_capacity()','public.icash_owner_active_export_capacity(p_account)');

 d:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 if md5(d)<>'f1ee49aef89a9557ad6b31cb93d2f840' then raise exception 'New-user acquisition scheduling prerequisite changed';end if;
 -- Filter by the account before ranking/LIMIT. A global ordinary-pool check
 -- would incorrectly stop every newly funded account at the reserve boundary.
 d:=replace(d,' if not public.icash_dealmachine_capacity_available() then return null;end if;','');
 needle:='where d.enabled and d.auto_enabled and d.next_run_at<=now()';
 d:=replace(d,needle,needle||' and public.icash_dealmachine_capacity_available(2,d.account_id)');
 needle:='case when d.next_run_at<now()-interval ''10 minutes'' then d.next_run_at end nulls last,';
 d:=replace(d,needle,needle||E'\n  public.icash_new_user_request_reserve_eligible(d.account_id) desc,');
 -- Keep the existing overdue-account aging escape, due-preflight/retry order,
 -- financial quote, backlog, source eligibility and final admission checks.
 d:=replace(d,'and public.icash_owner_active_export_capacity() in (''disabled'',''ready'')'||E'\n   then',
  'and public.icash_owner_active_export_capacity(d.account_id) in (''disabled'',''ready'')'||E'\n   then');
 d:=replace(d,'where c.contacts_enabled and public.icash_owner_active_export_capacity()','where c.contacts_enabled and public.icash_owner_active_export_capacity(c.account_id)');
 execute d;

 d:=pg_get_functiondef('public.icash_resume_prospecting_ticket()'::regprocedure);
 if md5(d)<>'18737fd983247a44e209c2bd347ef84f' then raise exception 'New-user ticket scheduling prerequisite changed';end if;
 d:=replace(d,'public.icash_dealmachine_capacity_available()','public.icash_dealmachine_capacity_available(2,x.account_id)');
 execute replace(d,'public.icash_owner_active_export_capacity()','public.icash_owner_active_export_capacity(x.account_id)');

 d:=pg_get_functiondef('public.icash_owner_preflight_due_at(uuid,uuid)'::regprocedure);
 if md5(d)<>'470d62a2b58b43afe1217235c85abfbf' then raise exception 'New-user preflight priority prerequisite changed';end if;
 execute replace(d,'public.icash_dealmachine_capacity_available(3)','public.icash_dealmachine_capacity_available(3,p_account)');

 d:=pg_get_functiondef('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure);
 if md5(d)<>'ba5c62b61b1a33cd80215e78dde10b5a' then raise exception 'New-user preflight claim prerequisite changed';end if;
 d:=replace(d,'public.icash_dealmachine_capacity_available(3)','public.icash_dealmachine_capacity_available(3,p_account)');
 execute replace(d,'public.icash_dealmachine_capacity_available(1)','public.icash_dealmachine_capacity_available(1,p_account)');

 d:=pg_get_functiondef('icash_research_private.owner_preflight_quota_resume(uuid,jsonb,jsonb)'::regprocedure);
 if md5(d)<>'d5e4294425f94d13d1b9042efd60cebe' then raise exception 'New-user preflight recovery prerequisite changed';end if;
 execute replace(d,'public.icash_dealmachine_capacity_available(case when d.step=''baseline'' then 3 else 1 end)',
  'public.icash_dealmachine_capacity_available(case when d.step=''baseline'' then 3 else 1 end,p.account_id)');

 d:=pg_get_functiondef('public.icash_claim_owner_preflight_cleanup(uuid)'::regprocedure);
 if md5(d)<>'7be99ed4f1291f556c56fd36abae3a63' then raise exception 'New-user preflight cleanup prerequisite changed';end if;
 d:=replace(d,' if not public.icash_dealmachine_capacity_available(1) then return null;end if;','');
 d:=replace(d,'where (p_id is null or id=p_id) and list_id is not null',
  'where (p_id is null or id=p_id) and public.icash_dealmachine_capacity_available(1,account_id) and list_id is not null');
 execute replace(d,'jsonb_build_object(''id'',p.id,''token'',p.cleanup_token,''listId'',p.list_id)',
  'jsonb_build_object(''id'',p.id,''token'',p.cleanup_token,''listId'',p.list_id,''accountId'',p.account_id)');
end $patch$;

revoke all on function public.icash_owner_active_export_capacity(uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_owner_active_export_capacity(uuid) to service_role;
commit;
