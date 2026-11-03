-- Keep an exact positive cohort for the same checked_at window already used by
-- preflight claim and paid admission. No receipt, deadline or paid gate changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function icash_research_private.owner_preflight_ready_current(p_id uuid) returns boolean
language plpgsql stable set search_path='' as $$
declare p icash_research_private.owner_export_preflights;receipt jsonb;raw jsonb;n integer;step text;valid boolean;
begin
 select * into p from icash_research_private.owner_export_preflights where id=p_id;
 if not found or p.state is distinct from 'ready' or p.checked_at is null
  or p.checked_at<=now()-interval '30 minutes' or p.checked_at>now()
  or p.created_at>p.checked_at then return false;end if;
 -- Repeat the original recorder's complete free-count proof. Bad historical
 -- JSON must refuse preference, never abort the organization scheduler.
 begin
  if jsonb_typeof(p.request->'people_ids') is distinct from 'array' then return false;end if;
  n:=jsonb_array_length(p.request->'people_ids');
  receipt:=p.receipts->'create';raw:=receipt->'raw';
  valid:=n between 1 and 125 and receipt->'httpStatus'='200'::jsonb
   and (receipt->>'rawText')::jsonb=raw
   and jsonb_typeof(p.list_id) in ('string','number') and (p.list_id#>>'{}') ~ '^[A-Za-z0-9_-]{1,100}$'
   and raw->'data'->'list_id'=p.list_id and raw->'data'->>'name'=p.list_name
   and raw->'data'->>'source_type'='people' and raw->'data'->>'status'='completed'
   and raw->'data'->'total_count'=to_jsonb(n);
  if valid is distinct from true then return false;end if;
  foreach step in array array['baseline','eligible'] loop
   receipt:=p.receipts->step;raw:=receipt->'raw';
   valid:=receipt->'httpStatus'='200'::jsonb and (receipt->>'rawText')::jsonb=raw
    and jsonb_typeof(raw->'total_people')='number' and (raw->>'total_people') ~ '^[0-9]{1,3}$'
    and (raw->>'total_people')::integer between 1 and n and raw->'total_results'=raw->'total_people'
    and jsonb_typeof(raw->'total_properties')='number' and (raw->>'total_properties') ~ '^[0-9]{1,10}$'
    and not raw ? 'data' and (not raw ? 'credits' or (jsonb_typeof(raw->'credits')='object'
     and not exists(select 1 from jsonb_each(raw->'credits') c where c.value is distinct from '0'::jsonb)));
   if step='baseline' then valid:=valid and raw->'total_people'=to_jsonb(n);end if;
   if valid is distinct from true then return false;end if;
  end loop;
 exception when others then return false;
 end;
 return true;
end $$;
revoke all on function icash_research_private.owner_preflight_ready_current(uuid) from public,anon,authenticated,service_role;

do $patch$
declare d text;signature text;expected_hash text;old_window text;replacement text;needle text;
begin
 old_window:=$window$(p.created_at>now()-interval '5 minutes' or
 (p.created_at>now()-interval '30 minutes' and p.state in ('waiting','checking','ready') and (p.list_id is not null and p.receipts->'create'->'httpStatus'='200'::jsonb
 and p.receipts->'create'->'raw'->'data'->'list_id'=p.list_id
 and p.receipts->'create'->'raw'->'data'->>'name'=p.list_name
 and p.receipts->'create'->'raw'->'data'->>'source_type'='people'
 and p.receipts->'create'->'raw'->'data'->>'status'='completed'
 and p.receipts->'create'->'raw'->'data'->'total_count'=to_jsonb(jsonb_array_length(p.request->'people_ids')))))$window$;
 replacement:=$new$((p.state='ready' and p.checked_at>now()-interval '30 minutes' and p.checked_at<=now()
  and icash_research_private.owner_preflight_ready_current(p.id))
 or (p.state<>'ready' and $new$||old_window||'))';
 for signature,expected_hash in select * from (values
  ('icash_research_private.owner_preflight_cohort(uuid,uuid)','8f11bc567fc67d357d6c7d066daa7da7'),
  ('public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid)','fce2d54bfb4cd9e34fe74e93387b8ad8')) expected(signature,hash)
 loop
  d:=pg_get_functiondef(signature::regprocedure);
  if md5(d)<>expected_hash or (length(d)-length(replace(d,old_window,'')))<>length(old_window) then
   raise exception 'Owner ready cohort prerequisite changed: %',signature;end if;
  execute replace(d,old_window,replacement);
 end loop;
 d:=pg_get_functiondef('public.icash_owner_preflight_due_at(uuid,uuid)'::regprocedure);
 if md5(d)<>'126210fe7817a2811548ae5e87298bbd' then raise exception 'Owner ready priority prerequisite changed';end if;
 needle:='select p.account_id,p.items,p.next_check_at from';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner ready priority timestamp changed';end if;
 d:=replace(d,needle,'select p.account_id,p.items,case when p.state=''ready'' then p.checked_at else p.next_check_at end next_check_at from');
 needle:=$old$where p.account_id=p_account and p.state='waiting'
   and p.created_at>now()-interval '30 minutes' and p.created_at<=now()
   and p.next_check_at<=now() and p.deleted_at is null and p.cleanup_attempts=0$old$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner ready priority scope changed';end if;
 execute replace(d,needle,$new$where p.account_id=p_account and (
   (p.state='waiting' and p.created_at>now()-interval '30 minutes' and p.created_at<=now()
    and p.next_check_at<=now() and p.deleted_at is null and p.cleanup_attempts=0)
   or (p.state='ready' and p.checked_at>now()-interval '30 minutes' and p.checked_at<=now()
    and icash_research_private.owner_preflight_ready_current(p.id)))$new$);
end $patch$;
commit;
