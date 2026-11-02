-- Keep one free list attached to its original, still-eligible property cohort.
-- This changes selection only; the original paid admission and holds remain.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create index owner_preflight_recent_cohorts on icash_research_private.owner_export_preflights(account_id,created_at desc)
 where state in ('creating','waiting','checking','ready');

create function icash_research_private.owner_preflight_cohort(p_account uuid,p_primary uuid) returns jsonb
language sql stable set search_path='' as $$
 select p.items from icash_research_private.owner_export_preflights p
 where p.account_id=p_account and p.items->0->>'screeningId'=p_primary::text
 and p.created_at>now()-interval '5 minutes' and p.state in ('creating','waiting','checking','ready')
 and (p.state='ready' or (p.deleted_at is null and p.cleanup_attempts=0))
 and exists(select 1 from icash_research_private.owner_export_settings where id=1 and enabled and preflight_enabled)
 and not exists(
  select 1 from jsonb_array_elements(p.items) i
  left join public.icash_screening_jobs s on s.id=(i->>'screeningId')::uuid and s.account_id=p_account
  where s.id is null or s.snapshot is distinct from i->'snapshot' or s.state is distinct from 'complete'
   or (s.completed_at between now()-interval '24 hours' and now()) is distinct from true
   or s.result->'financialCheck'->>'status' is distinct from 'eligible' or s.snapshot ? 'sellerRequest'
   or s.snapshot->>'propertyType' is distinct from 'house'
   or public.icash_research_state_allowed(s.snapshot->'raw'->'data'->>'state') is distinct from true
   or coalesce(p.request->'mobile_only','false'::jsonb) is distinct from to_jsonb(public.icash_owner_targeting_pool(p_account,s.id)='mobile')
   or public.icash_owner_enrichment_unstarted(p_account,s.id,'owners:'||p_account||':'||s.id) is distinct from true
   or exists(select 1 from public.icash_property_controls pc where pc.account_id=p_account and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
   or (s.id<>p_primary and exists(select 1 from public.icash_automation_tickets t where t.screening_id=s.id))
 )
 and public.icash_owner_export_people_available(p.request->'people_ids')
 order by p.created_at,p.id limit 1;
$$;

create function public.icash_owner_preflight_sibling_waiting(p_account uuid,p_screening uuid,p_snapshot jsonb,p_primary uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from icash_research_private.owner_export_preflight_items i
  join icash_research_private.owner_export_preflights p on p.id=i.preflight_id and p.account_id=i.account_id
  where i.account_id=p_account and i.screening_id=p_screening and i.snapshot_hash=md5(p_snapshot::text)
   and p.items->0->>'screeningId'<>p_primary::text
   and p.created_at>now()-interval '5 minutes' and p.state in ('creating','waiting','checking','ready')
   and p.items=icash_research_private.owner_preflight_cohort(p_account,(p.items->0->>'screeningId')::uuid)
 );
$$;
revoke all on function icash_research_private.owner_preflight_cohort(uuid,uuid),public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid) to service_role;

do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_owner_batch_candidates(uuid,uuid)'::regprocedure);
 needle:='n integer;result jsonb;';
 if strpos(d,needle)=0 or strpos(d,'owner_preflight_cohort')>0 then raise exception 'Owner batch candidate declaration changed';end if;
 d:=replace(d,needle,needle||'pinned jsonb;');
 needle:=' select coalesce(jsonb_agg(jsonb_build_object(''screeningId'',id,''snapshot'',snapshot) order by (id=p_screening) desc,id),''[]'') into result from (';
 if strpos(d,needle)=0 then raise exception 'Owner batch candidate selection changed';end if;
 d:=replace(d,needle,E' pinned:=icash_research_private.owner_preflight_cohort(p_account,p_screening);\n if pinned is not null and jsonb_array_length(pinned)>n then return ''[]'';end if;\n'||needle);
 needle:='where s.account_id=p_account';
 if strpos(d,needle)=0 then raise exception 'Owner batch scope changed';end if;
 d:=replace(d,needle,needle||E'\n  and (pinned is null or exists(select 1 from jsonb_array_elements(pinned) i where i->>''screeningId''=s.id::text and i->''snapshot''=s.snapshot))\n  and not public.icash_owner_preflight_sibling_waiting(s.account_id,s.id,s.snapshot,p_screening)');
 needle:=' if not exists(select 1 from jsonb_array_elements(result) v where v->>''screeningId''=p_screening::text)';
 if strpos(d,needle)=0 then raise exception 'Owner batch candidate result changed';end if;
 d:=replace(d,needle,E' if pinned is not null and jsonb_array_length(result)<>jsonb_array_length(pinned) then return ''[]'';end if;\n'||needle);
 execute d;

 -- A sibling cannot get its own new ticket while its original leader waits
 -- for indexing. It stays in the pending buffer and becomes available again
 -- on a changed source/control, completed work or the bounded cohort expiry.
 d:=pg_get_functiondef('public.icash_enrichment_before_prospecting_budget(uuid)'::regprocedure);
 needle:='where s.account_id=p_account';
 if strpos(d,needle)=0 then raise exception 'Owner enrichment scheduler scope changed';end if;
 execute replace(d,needle,needle||' and not public.icash_owner_preflight_sibling_waiting(s.account_id,s.id,s.snapshot,s.id)');

 -- The existing per-account advisory lock arbitrates overlapping workers.
 -- Share the ticket issuer's short database lock before the final sibling
 -- check. The transaction ends before the free provider request begins.
 d:=pg_get_functiondef('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure);
 needle:=' else'||E'\n  if not public.icash_dealmachine_capacity_available(1)';
 if strpos(d,needle)=0 then raise exception 'Owner preflight creation boundary changed';end if;
 execute replace(d,needle,E' else\n  perform 1 from public.icash_operating_budget where id=1 for update;\n  if not found then return ''{"status":"held"}'';end if;\n  if exists(select 1 from jsonb_array_elements(p_items) i where i->>''screeningId''<>p_items->0->>''screeningId'' and exists(select 1 from public.icash_automation_tickets t where t.screening_id=(i->>''screeningId'')::uuid)) then return ''{"status":"quota_wait"}'';end if;\n  if exists(select 1 from jsonb_array_elements(p_items) i where public.icash_owner_preflight_sibling_waiting(p_account,(i->>''screeningId'')::uuid,i->''snapshot'',(p_items->0->>''screeningId'')::uuid)) then return ''{"status":"quota_wait"}'';end if;\n  if icash_research_private.owner_preflight_cohort(p_account,(p_items->0->>''screeningId'')::uuid) is not null and icash_research_private.owner_preflight_cohort(p_account,(p_items->0->>''screeningId'')::uuid) is distinct from p_items then return ''{"status":"pending"}'';end if;\n  if not public.icash_dealmachine_capacity_available(1)');
end $patch$;
commit;
