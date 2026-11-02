-- Free exact-owner counts precede new purchases. Install inactive. No original
-- export, receipt, customer reservation or provider billing row is changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table icash_research_private.owner_export_settings add column preflight_enabled boolean not null default false;
create table icash_research_private.owner_export_preflights(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 fingerprint text not null,items jsonb not null,request jsonb not null,created_at timestamptz not null default clock_timestamp(),
 state text not null check(state in ('creating','waiting','checking','ready','empty','held')),
 lease uuid not null default gen_random_uuid(),started_at timestamptz not null default clock_timestamp(),next_check_at timestamptz,
 list_id jsonb,list_name text not null,receipts jsonb not null default '{}',checked_at timestamptz,
 cleanup_token uuid,cleanup_until timestamptz,cleanup_attempts integer not null default 0,
 cleanup_receipts jsonb not null default '[]',deleted_at timestamptz,
 unique(account_id,fingerprint)
);
create table icash_research_private.owner_export_preflight_items(
 preflight_id uuid not null references icash_research_private.owner_export_preflights(id),
 account_id uuid not null,screening_id uuid not null,snapshot_hash text not null,
 primary key(preflight_id,screening_id)
);
create index owner_preflight_screening on icash_research_private.owner_export_preflight_items(account_id,screening_id);
create index owner_preflight_cleanup on icash_research_private.owner_export_preflights(created_at) where list_id is not null and deleted_at is null and cleanup_attempts<3;
alter table icash_research_private.owner_export_preflights enable row level security;
alter table icash_research_private.owner_export_preflight_items enable row level security;
revoke all on icash_research_private.owner_export_preflights,icash_research_private.owner_export_preflight_items from public,anon,authenticated,service_role;

create function icash_research_private.guard_owner_preflight() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or row(old.id,old.account_id,old.fingerprint,old.items,old.request,old.created_at,old.list_name)
  is distinct from row(new.id,new.account_id,new.fingerprint,new.items,new.request,new.created_at,new.list_name)
  or (old.list_id is not null and old.list_id is distinct from new.list_id)
  or exists(select 1 from jsonb_each(old.receipts) r where new.receipts->r.key is distinct from r.value) or not new.cleanup_receipts @> old.cleanup_receipts
  or new.cleanup_attempts<old.cleanup_attempts
  or (old.checked_at is not null and row(old.state,old.checked_at) is distinct from row(new.state,new.checked_at))
  or (old.deleted_at is not null and old.deleted_at is distinct from new.deleted_at)
 then raise exception 'Original free preflight evidence is immutable';end if;
 return new;
end $$;
create trigger owner_preflight_immutable before update or delete on icash_research_private.owner_export_preflights for each row execute function icash_research_private.guard_owner_preflight();

create function public.icash_owner_preflight_empty(p_account uuid,p_screening uuid,p_snapshot jsonb) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from icash_research_private.owner_export_preflight_items i
 join icash_research_private.owner_export_preflights p on p.id=i.preflight_id
 where i.account_id=p_account and i.screening_id=p_screening and i.snapshot_hash=md5(p_snapshot::text)
 and p.state='empty' and p.created_at>now()-interval '24 hours'
 and coalesce(p.request->'mobile_only','false'::jsonb)=to_jsonb(public.icash_owner_targeting_pool(p_account,p_screening)='mobile'))
 and exists(select 1 from icash_research_private.owner_export_settings where id=1 and preflight_enabled);
$$;

create function public.icash_claim_owner_preflight(p_account uuid,p_items jsonb,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p icash_research_private.owner_export_preflights;item jsonb;ids jsonb;finger text;new_id uuid:=gen_random_uuid();
begin
 if not exists(select 1 from icash_research_private.owner_export_settings where id=1 and preflight_enabled) then return '{"status":"disabled"}';end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 5
  or octet_length(p_items::text)>524288 or jsonb_typeof(p_request->'people_ids') is distinct from 'array' then return '{"status":"held"}';end if;
 select jsonb_agg(to_jsonb(id) order by position) into ids from(
  select v#>>'{}' id,min(i.ordinality*1000+x.ordinality) position from jsonb_array_elements(p_items) with ordinality i(item,ordinality),jsonb_array_elements(i.item->'ids') with ordinality x(v,ordinality) group by v
 ) q;
 if ids is distinct from p_request->'people_ids' or jsonb_array_length(ids) not between 1 and 125
  or exists(select 1 from jsonb_array_elements_text(ids) id where id !~ '^per_[1-9][0-9]{0,15}$' or substring(id from 5)::numeric>9007199254740991)
  or (p_request @> '{"property_match":"owner","anchor":"person","require_phone":true,"scrub_dnc":true,"active_phones_only":true}') is distinct from true then return '{"status":"held"}';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('owner-preflight:'||p_account,0)) then return '{"status":"pending"}';end if;
 if not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused)
  or not public.icash_membership_work_allowed(p_account) or not public.icash_owner_export_people_available(ids) then return '{"status":"held"}';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if not exists(select 1 from public.icash_screening_jobs s where s.id=(item->>'screeningId')::uuid and s.account_id=p_account and s.state='complete' and s.snapshot=item->'snapshot')
   or not public.icash_owner_enrichment_unstarted(p_account,(item->>'screeningId')::uuid,'owners:'||p_account||':'||(item->>'screeningId')) then return '{"status":"held"}';end if;
 end loop;
 finger:=md5(jsonb_build_array(p_items,p_request)::text);
 select * into p from icash_research_private.owner_export_preflights where account_id=p_account and fingerprint=finger for update;
 if found then
  if p.items is distinct from p_items or p.request is distinct from p_request then return '{"status":"held"}';end if;
  if p.state in ('ready','empty') then return jsonb_build_object('status',case when p.checked_at>clock_timestamp()-interval '30 minutes' or p.state='empty' then p.state else 'held' end);end if;
  if p.state='held' or p.created_at<clock_timestamp()-interval '30 minutes' or (p.state='waiting' and p.cleanup_attempts>0) then return '{"status":"held"}';end if;
  if p.state<>'waiting' or p.next_check_at>clock_timestamp() or not public.icash_dealmachine_capacity_available(3) then
   return jsonb_build_object('status',case when p.state in ('creating','checking') and p.started_at<clock_timestamp()-interval '90 seconds' then 'held' else 'pending' end);
  end if;
  update icash_research_private.owner_export_preflights set state='checking',lease=gen_random_uuid(),started_at=clock_timestamp() where id=p.id returning * into p;
 else
  if not public.icash_dealmachine_capacity_available(1) then return '{"status":"quota_wait"}';end if;
  insert into icash_research_private.owner_export_preflights(id,account_id,fingerprint,items,request,state,list_name)
   values(new_id,p_account,finger,p_items,p_request,'creating','icash-owner-preflight-'||new_id) returning * into p;
  insert into icash_research_private.owner_export_preflight_items select p.id,p_account,(i->>'screeningId')::uuid,md5((i->'snapshot')::text) from jsonb_array_elements(p_items) i;
 end if;
 return jsonb_build_object('status',case when p.state='creating' then 'create' else 'check' end,'id',p.id,'lease',p.lease,'listId',p.list_id,'name',p.list_name,'ids',ids,'mobileOnly',p.request->'mobile_only'='true'::jsonb);
end $$;

create function public.icash_record_owner_preflight(p_id uuid,p_lease uuid,p_step text,p_receipt jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare p icash_research_private.owner_export_preflights;raw jsonb;d jsonb;n integer;valid boolean:=false;lid jsonb;
begin
 select * into p from icash_research_private.owner_export_preflights where id=p_id for update;
 if not found or p.lease is distinct from p_lease or p_step not in ('create','baseline','eligible') or p_receipt is null or octet_length(p_receipt::text)>2200000 then return 'held';end if;
 if p.receipts ? p_step then return case when p.receipts->p_step=p_receipt then case when p.state='waiting' then 'pending' else p.state end else 'held' end;end if;
 if (p_step='create' and p.state<>'creating') or (p_step<>'create' and p.state<>'checking') or (p_step='eligible' and not p.receipts ? 'baseline') then return 'held';end if;
 update icash_research_private.owner_export_preflights set receipts=receipts||jsonb_build_object(p_step,p_receipt) where id=p.id;
 begin
  raw:=p_receipt->'raw';d:=raw->'data';n:=jsonb_array_length(p.request->'people_ids');
  valid:=p_receipt->'httpStatus'='200'::jsonb and (p_receipt->>'rawText')::jsonb=raw and p.started_at>clock_timestamp()-interval '90 seconds';
  if p_step='create' then
   lid:=d->'list_id';
   valid:=valid and jsonb_typeof(lid) in ('string','number') and (lid#>>'{}') ~ '^[A-Za-z0-9_-]{1,100}$' and d->>'name'=p.list_name and d->>'source_type'='people';
   if valid is true then update icash_research_private.owner_export_preflights set list_id=lid where id=p.id;end if;
   valid:=valid and d->>'status'='completed' and d->'total_count'=to_jsonb(n);
  else
   valid:=valid and jsonb_typeof(raw->'total_people')='number' and (raw->>'total_people') ~ '^[0-9]{1,3}$'
    and (raw->>'total_people')::integer between 0 and n and raw->'total_results'=raw->'total_people'
    and jsonb_typeof(raw->'total_properties')='number' and (raw->>'total_properties') ~ '^[0-9]{1,10}$'
    and not raw ? 'data' and (not raw ? 'credits' or (jsonb_typeof(raw->'credits')='object' and not exists(select 1 from jsonb_each(raw->'credits') c where c.value is distinct from '0'::jsonb)));
   if p_step='baseline' then valid:=valid and raw->'total_people'=to_jsonb(n);end if;
  end if;
 exception when others then valid:=false;
 end;
 if valid is distinct from true then update icash_research_private.owner_export_preflights set state='held',checked_at=clock_timestamp() where id=p.id;return 'held';end if;
 if p_step='create' then update icash_research_private.owner_export_preflights set state='waiting',next_check_at=clock_timestamp()+interval '30 seconds' where id=p.id;return 'pending';end if;
 if p_step='baseline' then return 'checking';end if;
 update icash_research_private.owner_export_preflights set state=case when raw->'total_people'='0'::jsonb then 'empty' else 'ready' end,checked_at=clock_timestamp() where id=p.id returning * into p;
 return p.state;
end $$;

create function public.icash_claim_owner_preflight_cleanup(p_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p icash_research_private.owner_export_preflights;
begin
 if not public.icash_dealmachine_capacity_available(1) then return null;end if;
 select * into p from icash_research_private.owner_export_preflights where (p_id is null or id=p_id) and list_id is not null and deleted_at is null and cleanup_attempts<3
  and (cleanup_until is null or cleanup_until<clock_timestamp()) and (state in ('empty','ready','held') or started_at<clock_timestamp()-interval '5 minutes')
  order by created_at,id limit 1 for update skip locked;
 if not found then return null;end if;
 update icash_research_private.owner_export_preflights set cleanup_token=gen_random_uuid(),cleanup_until=clock_timestamp()+interval '5 minutes',cleanup_attempts=cleanup_attempts+1 where id=p.id returning * into p;
 return jsonb_build_object('id',p.id,'token',p.cleanup_token,'listId',p.list_id);
end $$;
create function public.icash_record_owner_preflight_cleanup(p_id uuid,p_token uuid,p_receipt jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare p icash_research_private.owner_export_preflights;valid boolean:=false;
begin
 select * into p from icash_research_private.owner_export_preflights where id=p_id for update;
 if not found or p.cleanup_token is distinct from p_token or p.deleted_at is not null or p_receipt is null or octet_length(p_receipt::text)>131072
  or exists(select 1 from jsonb_array_elements(p.cleanup_receipts) r where r->>'token'=p_token::text) then return false;end if;
 begin valid:=(p_receipt->>'rawText')::jsonb=p_receipt->'raw' and ((p_receipt->'httpStatus'='200'::jsonb and p_receipt#>'{raw,data,deleted}'='true'::jsonb) or p_receipt->'httpStatus'='404'::jsonb);exception when others then valid:=false;end;
 update icash_research_private.owner_export_preflights set cleanup_receipts=cleanup_receipts||jsonb_build_array(jsonb_build_object('token',p_token,'receipt',p_receipt)),deleted_at=case when valid is true then clock_timestamp() else null end where id=p.id;
 return valid is true;
end $$;

create function public.icash_defer_owner_preflight(p_id uuid,p_account uuid,p_screening uuid,p_token text,p_operation text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from icash_research_private.owner_export_preflight_items i join icash_research_private.owner_export_preflights p on p.id=i.preflight_id
  join public.icash_screening_jobs s on s.id=i.screening_id and s.account_id=i.account_id
  where i.account_id=p_account and i.screening_id=p_screening and i.snapshot_hash=md5(s.snapshot::text)
  and p.state in ('creating','waiting','checking') and p.created_at>clock_timestamp()-interval '30 minutes') then return false;end if;
 return public.icash_defer_owner_enrichment(p_id,p_account,p_screening,p_token,p_operation);
end $$;

-- Keep final purchase authority in SQL, even while an older handler drains.
do $patch$
declare d text;needle text;f text;
begin
 d:=pg_get_functiondef('public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 needle:='if p_request is distinct from expected then return ''held'';end if;';
 if strpos(d,needle)=0 then raise exception 'Owner export admission prerequisite changed';end if;
 execute replace(d,needle,needle||E'\n if exists(select 1 from icash_research_private.owner_export_settings where id=1 and preflight_enabled) and not exists(select 1 from icash_research_private.owner_export_preflights p where p.account_id=p_account and p.fingerprint=md5(jsonb_build_array(p_items,p_request)::text) and p.items=p_items and p.request=p_request and p.state=''ready'' and p.checked_at>clock_timestamp()-interval ''30 minutes'') then return ''held'';end if;');
 foreach f in array array['icash_enrichment_before_prospecting_budget(uuid)','icash_owner_batch_candidates(uuid,uuid)','icash_pending_opportunity_count(uuid)'] loop
  d:=pg_get_functiondef(('public.'||f)::regprocedure);needle:='where s.account_id=p_account';
  if strpos(d,needle)=0 then raise exception 'Owner preflight scheduler prerequisite changed';end if;
  execute replace(d,needle,needle||' and not public.icash_owner_preflight_empty(s.account_id,s.id,s.snapshot)');
 end loop;
 d:=pg_get_functiondef('public.icash_owner_export_findings()'::regprocedure);
 needle:='where e.terminal_at is null and e.capacity_review_id is null and b.created_at<now()-interval ''5 minutes''';
 if strpos(d,needle)=0 then raise exception 'Owner export monitoring prerequisite changed';end if;
 execute replace(d,needle,needle||E'\n union all select ''owner_export''::text,p.id,p.account_id,p.created_at from icash_research_private.owner_export_preflights p where p.state in (''held'',''creating'',''checking'') and p.started_at<now()-interval ''5 minutes''');
end $patch$;
revoke all on function icash_research_private.guard_owner_preflight() from public,anon,authenticated,service_role;
revoke all on function public.icash_owner_preflight_empty(uuid,uuid,jsonb),public.icash_claim_owner_preflight(uuid,jsonb,jsonb),public.icash_record_owner_preflight(uuid,uuid,text,jsonb),public.icash_claim_owner_preflight_cleanup(uuid),public.icash_record_owner_preflight_cleanup(uuid,uuid,jsonb),public.icash_defer_owner_preflight(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.icash_owner_preflight_empty(uuid,uuid,jsonb),public.icash_claim_owner_preflight(uuid,jsonb,jsonb),public.icash_record_owner_preflight(uuid,uuid,text,jsonb),public.icash_claim_owner_preflight_cleanup(uuid),public.icash_record_owner_preflight_cleanup(uuid,uuid,jsonb),public.icash_defer_owner_preflight(uuid,uuid,uuid,text,text) to service_role;
commit;
