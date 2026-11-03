-- Keep the original, exactly identified free list while its provider/search
-- indexes catch up. Never recreate it or weaken the final positive-count gate.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table icash_research_private.owner_export_settings add column preflight_indexing_enabled boolean not null default false;

alter table icash_research_private.owner_export_preflights
 add column indexing_checks integer not null default 0 check(indexing_checks between 0 and 6),
 add column indexing_next_step text check(indexing_next_step in ('metadata','baseline')),
 add column indexing_reason text check(indexing_reason in ('provider_list_building','provider_search_indexing','provider_indexing_exhausted','provider_list_status_invalid'));

create function icash_research_private.owner_preflight_list_known(p_id uuid,p_complete boolean default false) returns boolean
language plpgsql stable set search_path='' as $$
declare p icash_research_private.owner_export_preflights;r jsonb;d jsonb;n integer;valid boolean;
begin
 select * into p from icash_research_private.owner_export_preflights where id=p_id;
 if not found or jsonb_typeof(p.request->'people_ids') is distinct from 'array' then return false;end if;
 n:=jsonb_array_length(p.request->'people_ids');
 r:=p.receipts->'create';d:=r->'raw'->'data';
 begin
  valid:=n between 1 and 125 and r->'httpStatus'='200'::jsonb and (r->>'rawText')::jsonb=r->'raw'
   and jsonb_typeof(p.list_id) in ('string','number') and (p.list_id#>>'{}') ~ '^[A-Za-z0-9_-]{1,100}$'
   and d->'list_id'=p.list_id and d->>'name'=p.list_name and d->>'source_type'='people'
   and d->>'status' in ('idle','building','completed')
   and jsonb_typeof(d->'total_count')='number' and (d->>'total_count') ~ '^[0-9]{1,3}$'
   and (d->>'total_count')::integer between 0 and n
   and (not r->'raw' ? 'credits' or (jsonb_typeof(r->'raw'->'credits')='object'
    and not exists(select 1 from jsonb_each(r->'raw'->'credits') c where c.value is distinct from '0'::jsonb)));
  if valid is distinct from true then return false;end if;
  if not p_complete or (d->>'status'='completed' and d->'total_count'=to_jsonb(n)) then return true;end if;
  r:=p.receipts->'metadata';d:=r->'raw'->'data';
  return (r->'httpStatus'='200'::jsonb and (r->>'rawText')::jsonb=r->'raw'
   and d->'list_id'=p.list_id and d->>'name'=p.list_name and d->>'source_type'='people'
   and d->>'status'='completed' and d->'total_count'=to_jsonb(n)
   and (not r->'raw' ? 'credits' or (jsonb_typeof(r->'raw'->'credits')='object'
    and not exists(select 1 from jsonb_each(r->'raw'->'credits') c where c.value is distinct from '0'::jsonb)))) is true;
 exception when others then return false;
 end;
end $$;

create function icash_research_private.record_owner_preflight_indexing(p_id uuid,p_lease uuid,p_step text,p_receipt jsonb) returns text
language plpgsql set search_path='' as $$
declare p icash_research_private.owner_export_preflights;r jsonb;d jsonb;n integer;valid boolean:=false;k text;complete boolean:=false;
begin
 select * into p from icash_research_private.owner_export_preflights where id=p_id for update;
 if not found or p.lease is distinct from p_lease or p_receipt is null or octet_length(p_receipt::text)>2200000
  or p_step not in ('create','metadata','baseline') then return 'held';end if;
 k:=case when p_step='create' then 'create' else 'indexing:'||p_lease||':'||p_step end;
 if p.receipts ? k then return case when p.receipts->k=p_receipt then case when p.state='waiting' then 'pending' else p.state end else 'held' end;end if;
 if (p_step='create' and p.state<>'creating') or (p_step<>'create' and p.state<>'checking')
  or p.deleted_at is not null or p.cleanup_attempts<>0 or p.created_at<=clock_timestamp()-interval '30 minutes'
  or p.created_at>clock_timestamp() or p.started_at<=clock_timestamp()-interval '90 seconds'
  or (p_step<>'create' and not icash_research_private.owner_preflight_list_known(p.id)) then return 'held';end if;
 -- Every observation is appended under its one-use handler, including malformed
 -- metadata. A later successful check never overwrites an earlier zero/error.
 update icash_research_private.owner_export_preflights set receipts=receipts||jsonb_build_object(k,p_receipt) where id=p.id;
 begin
  r:=p_receipt->'raw';d:=r->'data';n:=jsonb_array_length(p.request->'people_ids');
  valid:=p_receipt->'httpStatus'='200'::jsonb and (p_receipt->>'rawText')::jsonb=r and n between 1 and 125
   and (not r ? 'credits' or (jsonb_typeof(r->'credits')='object'
    and not exists(select 1 from jsonb_each(r->'credits') c where c.value is distinct from '0'::jsonb)));
  if p_step in ('create','metadata') then
   valid:=valid and jsonb_typeof(d->'list_id') in ('string','number') and (d->'list_id'#>>'{}') ~ '^[A-Za-z0-9_-]{1,100}$'
    and (p_step='create' or d->'list_id'=p.list_id) and d->>'name'=p.list_name and d->>'source_type'='people'
    and d->>'status' in ('idle','building','completed') and jsonb_typeof(d->'total_count')='number'
    and (d->>'total_count') ~ '^[0-9]{1,3}$' and (d->>'total_count')::integer between 0 and n;
   complete:=valid is true and d->>'status'='completed' and d->'total_count'=to_jsonb(n);
  else
   valid:=valid and icash_research_private.owner_preflight_list_known(p.id,true)
    and jsonb_typeof(r->'total_people')='number' and (r->>'total_people') ~ '^[0-9]{1,3}$'
    and (r->>'total_people')::integer between 0 and n-1 and r->'total_results'=r->'total_people'
    and jsonb_typeof(r->'total_properties')='number' and (r->>'total_properties') ~ '^[0-9]{1,10}$' and not r ? 'data';
  end if;
 exception when others then valid:=false;
 end;
 if valid is distinct from true then
  update icash_research_private.owner_export_preflights set state='held',checked_at=clock_timestamp(),indexing_reason='provider_list_status_invalid' where id=p.id;
  return 'held';
 end if;
 if p_step='create' then
  update icash_research_private.owner_export_preflights set list_id=d->'list_id',state='waiting',next_check_at=least(created_at+interval '30 minutes',clock_timestamp()+interval '90 seconds'),
   indexing_next_step='metadata',indexing_reason='provider_list_building' where id=p.id;
  return 'pending';
 end if;
 if p_step='metadata' and complete then
  update icash_research_private.owner_export_preflights set receipts=receipts||jsonb_build_object('metadata',p_receipt),
   indexing_next_step='baseline',indexing_reason='provider_search_indexing' where id=p.id and not receipts ? 'metadata';
  return 'checking';
 end if;
 if greatest(p.indexing_checks,1)>=6 then
  update icash_research_private.owner_export_preflights set state='held',checked_at=clock_timestamp(),indexing_checks=6,
   indexing_reason='provider_indexing_exhausted' where id=p.id;
  return 'held';
 end if;
 update icash_research_private.owner_export_preflights set state='waiting',indexing_checks=greatest(indexing_checks,1),
  indexing_next_step=case when p_step='metadata' then 'metadata' else 'baseline' end,
  indexing_reason=case when p_step='metadata' then 'provider_list_building' else 'provider_search_indexing' end,
  next_check_at=least(created_at+interval '30 minutes',clock_timestamp()+interval '90 seconds') where id=p.id;
 return 'pending';
end $$;

do $patch$
declare d text;needle text;replacement text;signature text;created text;expected text;
begin
 for signature,expected in select * from (values
  ('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)','1d6e3b374d07415593a4158840260a5a'),
  ('public.icash_record_owner_preflight(uuid,uuid,text,jsonb)','f9f677642b85267f8f3b199b81f74d7a'),
  ('public.icash_claim_owner_preflight_cleanup(uuid)','47ed003af6353c9a41336b9d859d90da'),
  ('public.icash_defer_owner_preflight(uuid,uuid,uuid,text,text)','fb031f5e049b7181d6be0eb7ad6eb1dd'),
  ('icash_research_private.owner_preflight_cohort(uuid,uuid)','2f0cae49088ef7457180deb94e30b634'),
  ('public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid)','6ae55612293ca698391f2f2fcca939eb'),
  ('public.icash_owner_preflight_due_at(uuid,uuid)','fc16398c43e96cd241a63e32cae07707'),
  ('icash_research_private.owner_preflight_ready_current(uuid)','f8d62d79349450db162734f0f5de226d')) reviewed(signature,hash)
 loop
  if md5(pg_get_functiondef(signature::regprocedure))<>expected then raise exception 'Preflight indexing prerequisite changed: %',signature;end if;
 end loop;
 d:=pg_get_functiondef('public.icash_record_owner_preflight(uuid,uuid,text,jsonb)'::regprocedure);
 needle:='p_step not in (''create'',''baseline'',''eligible'')';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing recorder steps changed';end if;
 d:=replace(d,needle,'p_step not in (''create'',''baseline'',''eligible'',''metadata'')');
 needle:='if p.receipts ? p_step then';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing receipt guard changed';end if;
 d:=replace(d,needle,$new$if exists(select 1 from icash_research_private.owner_export_settings where id=1 and preflight_indexing_enabled) and (p_step='metadata'
  or (p_step='create' and p_receipt->'raw'->'data'->>'status' in ('idle','building'))
  or (p_step='baseline' and jsonb_typeof(p_receipt->'raw'->'total_people')='number'
   and (p_receipt->'raw'->>'total_people') ~ '^[0-9]{1,3}$'
   and (p_receipt->'raw'->>'total_people')::integer<jsonb_array_length(p.request->'people_ids'))) then
  return icash_research_private.record_owner_preflight_indexing(p_id,p_lease,p_step,p_receipt);
 end if;
 if p_step='metadata' or (p.indexing_next_step='metadata' and p_step in ('baseline','eligible')) then return 'held';end if;
 if p.receipts ? p_step then$new$);
 needle:='if p_step=''baseline'' then return ''checking'';end if;';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing final gate changed';end if;
 execute replace(d,needle,needle||E'\n update icash_research_private.owner_export_preflights set indexing_next_step=null,indexing_reason=null where id=p.id;');

 d:=pg_get_functiondef('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure);
 needle:='update icash_research_private.owner_export_preflights set state=''checking'',lease=gen_random_uuid(),started_at=clock_timestamp()';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing check claim changed';end if;
 d:=replace(d,needle,$new$if p.indexing_next_step is not null and (p.indexing_checks>=6 or not exists(
   select 1 from icash_research_private.owner_export_settings where id=1 and preflight_indexing_enabled)) then return '{"status":"held"}';end if;
  update icash_research_private.owner_export_preflights set indexing_checks=indexing_checks+case when indexing_next_step is null then 0 else 1 end,state='checking',lease=gen_random_uuid(),started_at=clock_timestamp()$new$);
 needle:='''mobileOnly'',p.request->''mobile_only''=''true''::jsonb)';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing claim output changed';end if;
 execute replace(d,needle,'''mobileOnly'',p.request->''mobile_only''=''true''::jsonb,''nextStep'',p.indexing_next_step)');

 d:=pg_get_functiondef('public.icash_defer_owner_preflight(uuid,uuid,uuid,text,text)'::regprocedure);
 needle:='return public.icash_defer_owner_enrichment(p_id,p_account,p_screening,p_token,p_operation);';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing retry delegation changed';end if;
 execute replace(d,needle,$new$if not public.icash_defer_owner_enrichment(p_id,p_account,p_screening,p_token,p_operation) then return false;end if;
 -- Do not consume another ticket merely to rediscover the same 90-second wait.
 -- The existing retry count/deadline and all original authorization stay intact.
 update public.icash_automation_tickets t set owner_preview_retry_after=greatest(t.owner_preview_retry_after,(
  select max(p.next_check_at) from icash_research_private.owner_export_preflights p
  join icash_research_private.owner_export_preflight_items i on i.preflight_id=p.id and i.account_id=p.account_id
  join public.icash_screening_jobs s on s.id=i.screening_id and s.account_id=i.account_id
  where i.account_id=p_account and i.screening_id=p_screening and i.snapshot_hash=md5(s.snapshot::text)
   and p.state='waiting' and p.indexing_next_step is not null and p.created_at>clock_timestamp()-interval '30 minutes'
   and p.deleted_at is null and p.cleanup_attempts=0))
 where t.id=p_id and t.account_id=p_account and t.screening_id=p_screening and t.token=p_token
  and t.state='held' and t.outcome='owner_preview_rate_limited';
 return true;$new$);

 -- Preserve the already-installed cohort/cleanup/priority windows and every
 -- account/source/financial predicate; only recognize the original known list.
 created:=$proof$p.list_id is not null and p.receipts->'create'->'httpStatus'='200'::jsonb
 and p.receipts->'create'->'raw'->'data'->'list_id'=p.list_id
 and p.receipts->'create'->'raw'->'data'->>'name'=p.list_name
 and p.receipts->'create'->'raw'->'data'->>'source_type'='people'
 and p.receipts->'create'->'raw'->'data'->>'status'='completed'
 and p.receipts->'create'->'raw'->'data'->'total_count'=to_jsonb(jsonb_array_length(p.request->'people_ids'))$proof$;
 foreach signature in array array['icash_research_private.owner_preflight_cohort(uuid,uuid)','public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid)','public.icash_claim_owner_preflight_cleanup(uuid)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  needle:=case when signature like '%cleanup%' then replace(created,'p.','') else created end;
  replacement:=case when signature like '%cleanup%' then 'icash_research_private.owner_preflight_list_known(id)' else 'icash_research_private.owner_preflight_list_known(p.id)' end;
  if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing list lifetime proof changed: %',signature;end if;
  execute replace(d,needle,replacement);
 end loop;
 d:=pg_get_functiondef('public.icash_owner_preflight_due_at(uuid,uuid)'::regprocedure);
 needle:=$proof$and jsonb_typeof(p.list_id) in ('string','number') and (p.list_id#>>'{}') ~ '^[A-Za-z0-9_-]{1,100}$'
   and p.receipts->'create'->'httpStatus'='200'::jsonb
   and p.receipts->'create'->'raw'->'data'->'list_id'=p.list_id
   and p.receipts->'create'->'raw'->'data'->>'name'=p.list_name
   and p.receipts->'create'->'raw'->'data'->>'source_type'='people'
   and p.receipts->'create'->'raw'->'data'->>'status'='completed'
   and p.receipts->'create'->'raw'->'data'->'total_count'=to_jsonb(
    case when jsonb_typeof(p.request->'people_ids')='array' then jsonb_array_length(p.request->'people_ids') end)$proof$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing due proof changed';end if;
 execute replace(d,needle,'and icash_research_private.owner_preflight_list_known(p.id)');
 d:=pg_get_functiondef('icash_research_private.owner_preflight_ready_current(uuid)'::regprocedure);
 needle:=$proof$and raw->'data'->>'source_type'='people' and raw->'data'->>'status'='completed'
   and raw->'data'->'total_count'=to_jsonb(n)$proof$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing ready proof changed';end if;
 execute replace(d,needle,'and raw->''data''->>''source_type''=''people'' and icash_research_private.owner_preflight_list_known(p.id,true)');
end $patch$;
revoke all on function icash_research_private.owner_preflight_list_known(uuid,boolean),icash_research_private.record_owner_preflight_indexing(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
commit;
