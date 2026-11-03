-- Retain original explicit zero-phone free previews for every batch sibling.
-- No backfill, contact authority, provider retry, reservation or settlement.
begin;
set local lock_timeout='5s';
create table icash_research_private.owner_empty_preview_receipts(
 request_id uuid primary key references icash_research_private.requests(id),
 batch_id uuid not null unique,account_id uuid not null references public.icash_accounts(id),
 items jsonb not null,receipt jsonb not null,observed_at timestamptz not null
);
create table icash_research_private.owner_empty_preview_items(
 request_id uuid not null references icash_research_private.owner_empty_preview_receipts(request_id),
 account_id uuid not null,screening_id uuid not null references public.icash_screening_jobs(id),
 snapshot_hash text not null,expires_at timestamptz not null,
 primary key(request_id,screening_id)
);
create index owner_empty_preview_screening on icash_research_private.owner_empty_preview_items(account_id,screening_id,expires_at);
alter table icash_research_private.owner_empty_preview_receipts enable row level security;
alter table icash_research_private.owner_empty_preview_items enable row level security;
revoke all on icash_research_private.owner_empty_preview_receipts,icash_research_private.owner_empty_preview_items from public,anon,authenticated,service_role;
create function icash_research_private.guard_empty_owner_preview() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Original empty owner preview is immutable';end $$;
create trigger owner_empty_preview_receipt_immutable before update or delete on icash_research_private.owner_empty_preview_receipts for each row execute function icash_research_private.guard_empty_owner_preview();
create trigger owner_empty_preview_item_immutable before update or delete on icash_research_private.owner_empty_preview_items for each row execute function icash_research_private.guard_empty_owner_preview();

-- Mirrors the property-bound owner classification, with numeric phones=0 as
-- the only phone-absence proof. Unknown metadata never excludes a property.
create function icash_research_private.owner_preview_has_no_phones(p_row jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare person jsonb;owners integer:=0;likely boolean;prior jsonb;seen jsonb:='{}';field text;unknown_or_present boolean:=false;
begin
 if p_row->'found' is distinct from 'true'::jsonb then return false;end if;
 if jsonb_typeof(p_row->'contacts') is distinct from 'array' then return null;end if;
 for person in select value from jsonb_array_elements(p_row->'contacts') loop
  if jsonb_typeof(person) is distinct from 'object' or jsonb_typeof(person->'dm_person_id') is distinct from 'string' or (person->>'dm_person_id') !~ '^per_[a-zA-Z0-9]{1,100}$' or person->>'dm_person_id' is null
   or (person->'contact_type' is not null and person->'contact_type'<>'null'::jsonb and (jsonb_typeof(person->'contact_type')<>'string' or person->>'contact_type'='')) then return null;end if;
  foreach field in array array['is_likely_owner','is_in_owner_family','is_resident','is_likely_renter'] loop
   if person->field is not null and person->field<>'null'::jsonb and jsonb_typeof(person->field)<>'boolean' then return null;end if;
  end loop;
  if person->'availability' is not null and person->'availability'<>'null'::jsonb and jsonb_typeof(person->'availability')<>'object' then return null;end if;
  if person#>'{availability,phones}' is not null and person#>'{availability,phones}'<>'null'::jsonb
   and (jsonb_typeof(person#>'{availability,phones}')<>'number' or (person#>>'{availability,phones}') !~ '^[0-9]+$'
    or (person#>>'{availability,phones}')::numeric>9007199254740991) then return null;end if;
  prior:=seen->(person->>'dm_person_id');
  if prior is not null and prior is distinct from jsonb_build_array(person->'contact_type',person->'is_likely_owner',person->'is_in_owner_family',person->'is_resident',person->'is_likely_renter',person#>'{availability,phones}') then return null;end if;
  seen:=seen||jsonb_build_object(person->>'dm_person_id',jsonb_build_array(person->'contact_type',person->'is_likely_owner',person->'is_in_owner_family',person->'is_resident',person->'is_likely_renter',person#>'{availability,phones}'));
  likely:=(person->>'contact_type' is null or person->>'contact_type'='owner') and person->'is_likely_renter' is distinct from 'true'::jsonb
   and (person->'is_likely_owner'='true'::jsonb or person->>'is_likely_owner' is null and person->>'contact_type'='owner');
  if likely is true then
   owners:=owners+1;
   if person#>'{availability,phones}' is distinct from '0'::jsonb then unknown_or_present:=true;end if;
  end if;
 end loop;
 return owners>0 and not unknown_or_present;
exception when others then return null;
end $$;

create function public.icash_record_empty_owner_preview(p_account uuid,p_batch uuid,p_request uuid,p_items jsonb,p_preview jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare request icash_research_private.requests;s public.icash_screening_jobs;item jsonb;raw jsonb;found_count integer;empty_items jsonb:='[]';
 saved icash_research_private.owner_empty_preview_receipts;checked timestamptz:=clock_timestamp();expiry timestamptz;no_phones boolean;
begin
 if p_account is null or p_batch is null or p_request is null or jsonb_typeof(p_items) is distinct from 'array'
  or jsonb_array_length(p_items) not between 1 and 5 or octet_length(p_items::text)>524288 or octet_length(p_preview::text)>2097152
  or jsonb_typeof(p_preview->'data') is distinct from 'array' or jsonb_array_length(p_preview->'data')<>jsonb_array_length(p_items)
  or p_preview->'credits' is distinct from '{"used":0,"people":0,"properties":0,"deduplicated":0}'::jsonb
  or (select count(distinct x->>'screeningId') from jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items)
  or (select count(distinct x->'snapshot'->>'propertyId') from jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items)
  or (select count(distinct x->>'dm_property_id') from jsonb_array_elements(p_preview->'data') x)<>jsonb_array_length(p_items)
 then return false;end if;
 select * into request from icash_research_private.requests where id=p_request;
 if not found or not request.admitted or request.kind<>'owner_preview' or request.account_id is distinct from p_account
  or request.operation_key is distinct from 'owner-batch:'||p_batch or request.result->>'outcome' is distinct from 'response'
  or request.result->'httpStatus' is distinct from '200'::jsonb or request.result->'creditsUsed' is distinct from '0'::jsonb
  or request.result->'returned' is distinct from to_jsonb(jsonb_array_length(p_items))
  or request.finished_at is null or request.finished_at<request.created_at or request.finished_at>checked
 then return false;end if;
 -- Exact idempotent acknowledgments preserve the original observation/expiry.
 select * into saved from icash_research_private.owner_empty_preview_receipts where request_id=p_request;
 if found then return row(saved.batch_id,saved.account_id,saved.items,saved.receipt,saved.observed_at)
  is not distinct from row(p_batch,p_account,p_items,p_preview,request.finished_at);end if;
 if request.created_at<=checked-interval '2 minutes' then return false;end if;
 if exists(select 1 from jsonb_array_elements(p_preview->'data') x where jsonb_typeof(x) is distinct from 'object'
  or jsonb_typeof(x->'dm_property_id') is distinct from 'string' or x->>'dm_property_id' !~ '^prop_[0-9]{1,20}$'
  or jsonb_typeof(x->'found') is distinct from 'boolean' or x ? 'error') then return false;end if;
 select count(*) into found_count from jsonb_array_elements(p_preview->'data') x where x->'found'='true'::jsonb;
 if p_preview#>'{totals,submitted}' is distinct from to_jsonb(jsonb_array_length(p_items))
  or p_preview#>'{totals,found}' is distinct from to_jsonb(found_count)
  or p_preview#>'{totals,not_found}' is distinct from to_jsonb(jsonb_array_length(p_items)-found_count) then return false;end if;
 -- Same order as paid owner admission. A concurrent Pause or original paid
 -- operation wins before this read-only-result write, with no funds changed.
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
 if not found or not public.icash_membership_work_allowed(p_account) then return false;end if;
 for item in select value from jsonb_array_elements(p_items) loop
  select value into strict raw from jsonb_array_elements(p_preview->'data') where value->>'dm_property_id'=item->'snapshot'->>'propertyId';
  no_phones:=icash_research_private.owner_preview_has_no_phones(raw);
  if no_phones is null then return false;end if;
  if not no_phones then continue;end if;
  select * into s from public.icash_screening_jobs where id=(item->>'screeningId')::uuid and account_id=p_account;
  if not found or s.state<>'complete' or s.snapshot is distinct from item->'snapshot' or s.completed_at>request.created_at
   or s.result->'financialCheck'->>'status' is distinct from 'eligible' or s.snapshot ? 'sellerRequest'
   or not public.icash_owner_enrichment_unstarted(p_account,s.id,'owners:'||p_account||':'||s.id)
   or exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=s.snapshot->>'propertyId' and manual)
  then return false;end if;
  expiry:=least(request.finished_at+interval '24 hours',s.completed_at+interval '24 hours',(s.snapshot->>'fetchedAt')::timestamptz+interval '24 hours');
  if expiry<=checked or s.snapshot->>'fetchedAt' is null or (s.snapshot->>'fetchedAt')::timestamptz>request.created_at then return false;end if;
  empty_items:=empty_items||jsonb_build_array(jsonb_build_object('screeningId',s.id,'snapshotHash',md5(s.snapshot::text),'expiresAt',expiry));
 end loop;
 if jsonb_array_length(empty_items)=0 then return false;end if;
 insert into icash_research_private.owner_empty_preview_receipts(request_id,batch_id,account_id,items,receipt,observed_at)
 values(p_request,p_batch,p_account,p_items,p_preview,request.finished_at) on conflict do nothing;
 if not found then
  select * into saved from icash_research_private.owner_empty_preview_receipts where request_id=p_request;
  return saved.request_id is not null and row(saved.batch_id,saved.account_id,saved.items,saved.receipt,saved.observed_at)
   is not distinct from row(p_batch,p_account,p_items,p_preview,request.finished_at);
 end if;
 insert into icash_research_private.owner_empty_preview_items(request_id,account_id,screening_id,snapshot_hash,expires_at)
 select p_request,p_account,(i->>'screeningId')::uuid,i->>'snapshotHash',(i->>'expiresAt')::timestamptz from jsonb_array_elements(empty_items) i;
 return true;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or no_data_found or too_many_rows then return false;
end $$;

alter function public.icash_owner_preflight_empty(uuid,uuid,jsonb) rename to icash_owner_preflight_empty_before_preview;
create function public.icash_owner_preflight_empty(p_account uuid,p_screening uuid,p_snapshot jsonb) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from icash_research_private.owner_empty_preview_items i
  where i.account_id=p_account and i.screening_id=p_screening and i.snapshot_hash=md5(p_snapshot::text) and i.expires_at>now())
 or public.icash_owner_preflight_empty_before_preview(p_account,p_screening,p_snapshot);
$$;
revoke all on function icash_research_private.guard_empty_owner_preview(),icash_research_private.owner_preview_has_no_phones(jsonb),public.icash_owner_preflight_empty_before_preview(uuid,uuid,jsonb),public.icash_record_empty_owner_preview(uuid,uuid,uuid,jsonb,jsonb),public.icash_owner_preflight_empty(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.icash_record_empty_owner_preview(uuid,uuid,uuid,jsonb,jsonb),public.icash_owner_preflight_empty(uuid,uuid,jsonb) to service_role;
commit;
