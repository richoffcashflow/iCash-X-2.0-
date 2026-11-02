-- Expired FREE evidence needs a new immutable check, never a reset or purchase.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table icash_research_private.owner_export_settings add column preflight_renewal_enabled boolean not null default false;
alter table icash_research_private.owner_export_preflights
 add column generation integer not null default 1 check(generation>0),
 add column supersedes uuid unique references icash_research_private.owner_export_preflights(id),
 drop constraint owner_export_preflights_account_id_fingerprint_key,
 add unique(account_id,fingerprint,generation);

create function icash_research_private.owner_preflight_renewable(p_id uuid) returns boolean
language sql stable set search_path='' as $fn$
 select exists(select 1 from icash_research_private.owner_export_preflights p
  where p.id=p_id and p.list_id is not null and p.deleted_at is not null
   and p.started_at<=now()-interval '5 minutes'
   and not exists(select 1 from icash_research_private.owner_export_preflights child where child.supersedes=p.id)
   and case when p.state='ready' then p.checked_at<=now()-interval '30 minutes'
    when p.state='empty' then p.created_at<=now()-interval '24 hours'
    else p.created_at<=now()-interval '30 minutes' end)
  and exists(select 1 from icash_research_private.owner_export_settings where id=1 and enabled and preflight_enabled and preflight_renewal_enabled);
$fn$;

create function icash_research_private.guard_owner_preflight_generation() returns trigger
language plpgsql set search_path='' as $fn$
declare p icash_research_private.owner_export_preflights;
begin
 if tg_op='UPDATE' then
  if row(old.generation,old.supersedes) is distinct from row(new.generation,new.supersedes) then raise exception 'Preflight generation is immutable';end if;
 elsif new.supersedes is null then
  if new.generation<>1 then raise exception 'First preflight generation required';end if;
 else
  select * into p from icash_research_private.owner_export_preflights where id=new.supersedes;
  if p.id is null or not icash_research_private.owner_preflight_renewable(p.id)
   or row(new.account_id,new.fingerprint,new.items,new.request) is distinct from row(p.account_id,p.fingerprint,p.items,p.request)
   or new.generation<>p.generation+1 or new.state<>'creating' or new.list_id is not null or new.receipts<>'{}'::jsonb
   or new.checked_at is not null or new.deleted_at is not null or new.cleanup_attempts<>0 or new.next_check_at is not null
   or new.list_name<>'icash-owner-preflight-'||new.id or new.created_at<clock_timestamp()-interval '5 seconds'
   or new.created_at>clock_timestamp()+interval '5 seconds' then raise exception 'Fresh source-bound preflight required';end if;
 end if;
 return new;
end $fn$;
create trigger owner_preflight_generation_immutable before insert or update on icash_research_private.owner_export_preflights
 for each row execute function icash_research_private.guard_owner_preflight_generation();

do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure);
 if md5(d)<>'e648f751cee7588439b7ece0cd788a88' then raise exception 'Preflight claim prerequisite changed';end if;
 d:=replace(d,'new_id uuid:=gen_random_uuid();','new_id uuid:=gen_random_uuid();parent_id uuid;next_generation integer:=1;cached boolean;renew boolean:=false;');
 needle:='where account_id=p_account and fingerprint=finger for update;'||E'\n if found then';
 if strpos(d,needle)=0 then raise exception 'Preflight cache lookup changed';end if;
 d:=replace(d,needle,'where account_id=p_account and fingerprint=finger order by generation desc limit 1 for update;'||E'\n cached:=found;\n if cached and icash_research_private.owner_preflight_renewable(p.id) then parent_id:=p.id;next_generation:=p.generation+1;renew:=true;end if;\n if cached and not renew then');
 needle:='if not found then return ''{"status":"held"}'';end if;';
 if strpos(d,needle)=0 then raise exception 'Preflight creation lock changed';end if;
 d:=replace(d,needle,needle||$new$
  if renew then
   -- Pause and source changes that won the shared budget lock also win renewal.
   perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
   if not found or not public.icash_membership_work_allowed(p_account) or not public.icash_owner_export_people_available(ids)
    or p.items is distinct from p_items or p.request is distinct from p_request
    or not exists(select 1 from public.icash_discovery_configs c join public.icash_operation_rates r on r.id=c.contact_rate_id
     where c.account_id=p_account and c.enabled and c.contacts_enabled and c.data_rights_until>now()
      and r.enabled and r.operation='owner_enrichment' and r.expires_at>now())
    or not exists(select 1 from public.icash_wallets where account_id=p_account and balance_cents>reserved_cents)
    then return '{"status":"held"}';end if;
   for item in select value from jsonb_array_elements(p_items) loop
    if not exists(select 1 from public.icash_screening_jobs s where s.id=(item->>'screeningId')::uuid and s.account_id=p_account
      and s.state='complete' and s.snapshot=item->'snapshot' and s.completed_at between now()-interval '24 hours' and now()
      and s.result->'financialCheck'->>'status'='eligible' and not s.snapshot ? 'sellerRequest'
      and s.snapshot->>'propertyType'='house' and public.icash_research_state_allowed(s.snapshot->'raw'->'data'->>'state'))
     or not public.icash_owner_enrichment_unstarted(p_account,(item->>'screeningId')::uuid,'owners:'||p_account||':'||(item->>'screeningId'))
     or coalesce(p_request->'mobile_only','false'::jsonb) is distinct from to_jsonb(public.icash_owner_targeting_pool(p_account,(item->>'screeningId')::uuid)='mobile')
     or exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=item->'snapshot'->>'propertyId' and manual)
     then return '{"status":"held"}';end if;
   end loop;
  end if;
$new$);
 d:=replace(d,'items,request,state,list_name)'||E'\n   values(new_id,p_account,finger,p_items,p_request,''creating'',''icash-owner-preflight-''||new_id)',
 'items,request,state,list_name,supersedes,generation)'||E'\n   values(new_id,p_account,finger,p_items,p_request,''creating'',''icash-owner-preflight-''||new_id,parent_id,next_generation)');
 if strpos(d,'parent_id,next_generation)')=0 then raise exception 'Preflight insert changed';end if;
 execute d;
 d:=pg_get_functiondef('public.icash_owner_export_findings()'::regprocedure);
 needle:='p.state in (''held'',''creating'',''checking'') and p.started_at<now()-interval ''5 minutes''';
 if strpos(d,needle)=0 then raise exception 'Preflight findings changed';end if;
 execute replace(d,needle,needle||' and not exists(select 1 from icash_research_private.owner_export_preflights child where child.supersedes=p.id)');
end $patch$;
revoke all on function icash_research_private.owner_preflight_renewable(uuid),icash_research_private.guard_owner_preflight_generation()
 from public,anon,authenticated,service_role;
commit;
