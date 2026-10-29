-- Install disabled; activate only after the matching production handler is live.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table icash_research_private.owner_export_settings(id integer primary key check(id=1),enabled boolean not null default false);
insert into icash_research_private.owner_export_settings values(1,false);
create table icash_research_private.owner_exports(
 id uuid primary key references icash_research_private.owner_batches(id),
 request jsonb not null,receipt jsonb,recovery jsonb,recovery_history jsonb not null default '[]',
 csv text,artifact_sha256 text,parsed_rows jsonb,terminal_at timestamptz,completed_at timestamptz,
 next_recover_at timestamptz not null default now(),recovery_attempts integer not null default 0,
 lease_token uuid,lease_until timestamptz
);
-- An unknown POST keeps this slot indefinitely. Lease expiry never clears it.
create unique index owner_export_one_pending on icash_research_private.owner_exports((true)) where terminal_at is null;
create index owner_export_recovery_due on icash_research_private.owner_exports(next_recover_at) where completed_at is null and receipt is not null and recovery_attempts<6;
alter table icash_research_private.owner_export_settings enable row level security;
alter table icash_research_private.owner_exports enable row level security;
revoke all on icash_research_private.owner_export_settings,icash_research_private.owner_exports from public,anon,authenticated,service_role;

create function icash_research_private.guard_owner_export() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Original export evidence is immutable';end if;
 if old.id is distinct from new.id or old.request is distinct from new.request
  or (old.receipt is not null and old.receipt is distinct from new.receipt)
  or (old.csv is not null and row(old.csv,old.artifact_sha256) is distinct from row(new.csv,new.artifact_sha256))
  or (old.parsed_rows is not null and old.parsed_rows is distinct from new.parsed_rows)
  or (old.terminal_at is not null and old.terminal_at is distinct from new.terminal_at)
  or (old.completed_at is not null and old is distinct from new)
  or new.recovery_attempts<old.recovery_attempts
  or not (new.recovery_history @> old.recovery_history) then raise exception 'Original export evidence is immutable';end if;
 return new;
end $$;
create trigger owner_export_immutable before update or delete on icash_research_private.owner_exports for each row execute function icash_research_private.guard_owner_export();
revoke all on function icash_research_private.guard_owner_export() from public,anon,authenticated,service_role;

create function public.icash_owner_active_export_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select enabled from icash_research_private.owner_export_settings where id=1;
$$;

-- Reuse every existing financial/recipient/snapshot admission check for one
-- property as well as a batch. Version zero remains restricted to one item.
do $$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_claim_owner_batch(uuid,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
 needle:='coalesce(c.research_version,0) not in (1,2)';
 if strpos(d,needle)=0 then raise exception 'Owner batch version guard changed';end if;
 execute replace(d,needle,'(coalesce(c.research_version,0) not in (1,2) and not (coalesce(c.research_version,0)=0 and jsonb_array_length(p_items)=1 and p_config->>''ownerContract''=''owner-active-export-v1''))');
end $$;

create function public.icash_admit_owner_active_export(p_account uuid,p_primary uuid,p_batch uuid,p_items jsonb,p_preview jsonb,p_config jsonb,p_request jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare ids jsonb;expected jsonb;admission text;item jsonb;person text;preview jsonb;match jsonb;
begin
 if not public.icash_owner_active_export_enabled() then return 'held';end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 5 then return 'held';end if;
 select jsonb_agg(to_jsonb(id) order by position) into ids from (
  select v#>>'{}' as id,min(i.ordinality*1000+p.ordinality) as position
  from jsonb_array_elements(p_items) with ordinality i(item,ordinality),jsonb_array_elements(i.item->'ids') with ordinality p(v,ordinality) group by v
 ) u;
 if jsonb_array_length(ids) not between 1 and 125 or exists(select 1 from jsonb_array_elements_text(ids) id where id !~ '^per_[0-9]{1,100}$') then return 'held';end if;
 expected:=jsonb_build_object('people_ids',ids,'fields','["person_full_name","has_active_phone_number"]'::jsonb,'property_match','owner','anchor','person','limit',jsonb_array_length(ids),'require_phone',true,'scrub_dnc',true,'active_phones_only',true);
 if p_request is distinct from expected then return 'held';end if;
 -- SQL repeats owner/phone availability proof before any quota or wallet claim.
 for item in select value from jsonb_array_elements(p_items) loop
  select value into strict preview from jsonb_array_elements(p_preview->'data') where value->>'dm_property_id'=item->'snapshot'->>'propertyId' and value->'found'='true'::jsonb;
  if (select count(distinct value) from jsonb_array_elements(item->'ids'))<>jsonb_array_length(item->'ids') then return 'held';end if;
  for person in select value from jsonb_array_elements_text(item->'ids') loop
   select value into match from jsonb_array_elements(preview->'contacts') where value->>'dm_person_id'=person limit 1;
   if not found or (match->>'contact_type' is not null and match->>'contact_type'<>'owner')
    or match->'is_likely_renter'='true'::jsonb
    or (match->'is_likely_owner'='true'::jsonb or (match->>'is_likely_owner' is null and match->>'contact_type'='owner')) is distinct from true
    or match->'availability'->'phones'='0'::jsonb then return 'held';end if;
  end loop;
 end loop;
 if not pg_try_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0)) then return 'export_busy';end if;
 if exists(select 1 from icash_research_private.owner_exports where terminal_at is null) then return 'export_busy';end if;
 admission:=public.icash_admit_owner_batch(p_account,p_primary,p_batch,p_items,p_preview,p_config||'{"ownerContract":"owner-active-export-v1"}');
 if admission<>'claimed' then return admission;end if;
 insert into icash_research_private.owner_exports(id,request) values(p_batch,p_request);
 return 'claimed';
end $$;

create function public.icash_record_owner_export_receipt(p_account uuid,p_batch uuid,p_receipt jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare e icash_research_private.owner_exports;r jsonb:=p_receipt->'raw';terminal boolean;
begin
 select x.* into e from icash_research_private.owner_exports x join icash_research_private.owner_batches b on b.id=x.id where x.id=p_batch and b.account_id=p_account for update of x;
 if not found or jsonb_typeof(p_receipt) is distinct from 'object' or octet_length(p_receipt::text)>1100000 or jsonb_typeof(p_receipt->'httpStatus') is distinct from 'number' or (p_receipt->>'httpStatus')::integer not between 100 and 599 or jsonb_typeof(p_receipt->'rawText') is distinct from 'string' then return false;end if;
 if e.receipt is not null then return e.receipt=p_receipt;end if;
 if r is distinct from 'null'::jsonb and (p_receipt->>'rawText')::jsonb is distinct from r then return false;end if;
 if r is distinct from 'null'::jsonb and not public.icash_record_owner_batch_receipt(p_account,p_batch,r) then return false;end if;
 terminal:=p_receipt->'httpStatus'='200'::jsonb and coalesce(r->>'export_id','') ~ '^[-a-zA-Z0-9_]{1,128}$' and jsonb_typeof(r->'record_count')='number' and coalesce(r->>'record_count','') ~ '^[0-9]{1,3}$' and r->'file_count'='1'::jsonb;
 update icash_research_private.owner_exports set receipt=p_receipt,terminal_at=case when terminal then clock_timestamp() else null end where id=p_batch;
 return true;
end $$;

create function public.icash_claim_owner_export_recovery(p_batch uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e icash_research_private.owner_exports;b icash_research_private.owner_batches;token uuid:=gen_random_uuid();
begin
 select * into e from icash_research_private.owner_exports where (p_batch is null or id=p_batch) and completed_at is null and receipt is not null
  and coalesce(receipt->'raw'->>'export_id','') ~ '^[-a-zA-Z0-9_]{1,128}$' and recovery_attempts<6 and next_recover_at<=clock_timestamp() and (lease_until is null or lease_until<clock_timestamp())
 order by next_recover_at,id limit 1 for update skip locked;
 if not found then return null;end if;
 select * into strict b from icash_research_private.owner_batches where id=e.id;
 update icash_research_private.owner_exports set lease_token=token,lease_until=clock_timestamp()+interval '90 seconds',recovery_attempts=recovery_attempts+1,next_recover_at=clock_timestamp()+interval '10 minutes' where id=e.id;
 return jsonb_build_object('id',e.id,'accountId',b.account_id,'createdAt',to_char(b.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'items',b.items,'preview',b.preview_receipt,'request',e.request,'receipt',e.receipt,'recovery',e.recovery->'raw','csv',e.csv,'lease',token);
end $$;

create function public.icash_record_owner_export_recovery(p_batch uuid,p_lease uuid,p_receipt jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare e icash_research_private.owner_exports;d jsonb:=p_receipt->'raw'->'data';
begin
 select * into e from icash_research_private.owner_exports where id=p_batch and lease_token=p_lease and lease_until>clock_timestamp() and completed_at is null for update;
 if not found or p_receipt is null or octet_length(p_receipt::text)>524288 then return false;end if;
 update icash_research_private.owner_exports set recovery=p_receipt,recovery_history=recovery_history||jsonb_build_array(p_receipt),
  terminal_at=case when terminal_at is not null then terminal_at when p_receipt->'httpStatus'='200'::jsonb and d->>'export_id'=e.receipt->'raw'->>'export_id' and d->>'status' in ('completed','failed') then clock_timestamp() else null end where id=p_batch;
 return true;
end $$;

create function public.icash_record_owner_export_artifact(p_batch uuid,p_lease uuid,p_csv text) returns boolean
language plpgsql security definer set search_path='' as $$
declare e icash_research_private.owner_exports;
begin
 select * into e from icash_research_private.owner_exports where id=p_batch and lease_token=p_lease and lease_until>clock_timestamp() and completed_at is null for update;
 if not found or p_csv is null or octet_length(p_csv)>1048576 or e.recovery->'httpStatus' is distinct from '200'::jsonb
  or e.recovery->'raw'->'data'->>'status' is distinct from 'completed'
  or e.recovery->'raw'->'data'->>'export_id' is distinct from e.receipt->'raw'->>'export_id' then return false;end if;
 if e.csv is not null then return e.csv=p_csv;end if;
 update icash_research_private.owner_exports set csv=p_csv,artifact_sha256=encode(sha256(convert_to(p_csv,'UTF8')),'hex') where id=p_batch;
 return true;
end $$;

create function public.icash_owner_export_result_valid(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare person jsonb;phone jsonb;used integer;people integer;shared integer;
begin
 if jsonb_typeof(p->'contacts') is distinct from 'array' or jsonb_array_length(p->'contacts')>25 or jsonb_typeof(p->'requestedPersonIds') is distinct from 'array' or jsonb_array_length(p->'requestedPersonIds') not between 1 and 25
  or octet_length(p::text)>262144 or p->'outreachAuthorized' is distinct from 'false'::jsonb
  or p->'allocation'->>'method' is distinct from 'active-export-used-order-v1'
  or coalesce(p->'allocation'->>'batchId','') !~ '^[0-9a-f-]{36}$'
  or p->'activityEvidence'->>'contract' is distinct from 'owner-active-export-v1'
  or coalesce(p->'activityEvidence'->>'exportId','') !~ '^[-a-zA-Z0-9_]{1,128}$'
  or coalesce(p->'activityEvidence'->>'artifactSha256','') !~ '^[a-f0-9]{64}$'
  or coalesce(p->>'creditsUsed','') !~ '^[0-9]{1,2}$' or coalesce(p->>'peopleCredits','') !~ '^[0-9]{1,2}$'
  or coalesce(p->'allocation'->>'sharedContacts','') !~ '^[0-9]{1,2}$' then return false;end if;
 used:=(p->>'creditsUsed')::integer;people:=(p->>'peopleCredits')::integer;shared:=(p->'allocation'->>'sharedContacts')::integer;
 if used>people or people+shared<>jsonb_array_length(p->'contacts') or (select count(distinct value) from jsonb_array_elements(p->'requestedPersonIds'))<>jsonb_array_length(p->'requestedPersonIds')
  or (select count(distinct value->>'personId') from jsonb_array_elements(p->'contacts'))<>jsonb_array_length(p->'contacts') then return false;end if;
 for person in select value from jsonb_array_elements(p->'contacts') loop
  if not (p->'requestedPersonIds' ? coalesce(person->>'personId','')) or person->'likelyOwner' is distinct from 'true'::jsonb
   or person->'ownershipVerified' is distinct from 'false'::jsonb or person->'outreachAuthorized' is distinct from 'false'::jsonb
   or jsonb_typeof(person->'phones') is distinct from 'array' or jsonb_array_length(person->'phones') not between 1 and 3 then return false;end if;
  for phone in select value from jsonb_array_elements(person->'phones') loop
   if coalesce(phone->>'number','') !~ '^[0-9]{10}$' or phone->'doNotCall' is distinct from 'false'::jsonb or phone->>'permission' is distinct from 'unverified'
    or phone->>'activity' is distinct from 'active' or phone->>'activityBasis' is distinct from 'provider_export_filter' then return false;end if;
  end loop;
 end loop;
 return true;
end $$;

create function public.icash_save_owner_active_export(p_batch uuid,p_lease uuid,p_results jsonb,p_rows jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare e icash_research_private.owner_exports;b icash_research_private.owner_batches;receipt jsonb;credits jsonb;item jsonb;r jsonb;person text;row_data jsonb;match jsonb;contacts jsonb;phones jsonb;expected jsonb;assigned text[]:='{}';unique_count integer;remaining integer;used integer;i integer;op text;key text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into e from icash_research_private.owner_exports where id=p_batch for update;
 select * into b from icash_research_private.owner_batches where id=p_batch for update;
 if e.completed_at is not null then return b.results=p_results and e.parsed_rows=p_rows;end if;
 if e.id is null or e.lease_token is distinct from p_lease or e.lease_until<=clock_timestamp() or e.csv is null or e.receipt->'httpStatus' is distinct from '200'::jsonb then return false;end if;
 receipt:=e.receipt->'raw';credits:=receipt->'credits';
 if jsonb_typeof(credits) is distinct from 'object' or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>125 or octet_length(p_rows::text)>1048576
  or jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results)<>jsonb_array_length(b.items)
  or receipt->'record_count' is distinct from to_jsonb(jsonb_array_length(p_rows)) or receipt->'file_count' is distinct from '1'::jsonb
  or credits->'people' is distinct from receipt->'record_count' or e.recovery->'raw'->'data'->'record_count' is distinct from receipt->'record_count'
  or coalesce(credits->>'used','') !~ '^[0-9]{1,3}$' or jsonb_typeof(credits->'used') is distinct from 'number'
  or (credits->>'used')::integer>jsonb_array_length(p_rows)
  or (credits ? 'properties' and credits->'properties' is distinct from '0'::jsonb) then raise exception 'Export credit contract mismatch';end if;
 for key in select jsonb_object_keys(credits) loop
  if key not in ('used','people','properties','deduplicated','licensed') or jsonb_typeof(credits->key) is distinct from 'number' or coalesce(credits->>key,'') !~ '^[0-9]{1,3}$' then raise exception 'Unverified export credit field';end if;
 end loop;
 if (select count(distinct value->>'internal_person_id') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows)
  or exists(select 1 from jsonb_array_elements(p_rows) x where not(e.request->'people_ids' ? ('per_'||(x->>'internal_person_id'))) or coalesce(x->>'has_active_phone_number','') not in ('Yes','true')) then raise exception 'Export owner mapping mismatch';end if;
 remaining:=(credits->>'used')::integer;
 for item in select value from jsonb_array_elements(b.items) loop
  contacts:='[]';unique_count:=0;
  for person in select value from jsonb_array_elements_text(item->'ids') loop
   select value into row_data from jsonb_array_elements(p_rows) where 'per_'||(value->>'internal_person_id')=person;
   if not found then continue;end if;
   if not(person=any(assigned)) then assigned:=array_append(assigned,person);unique_count:=unique_count+1;end if;
   select p into strict match from jsonb_array_elements(b.preview_receipt->'data') property,jsonb_array_elements(property->'contacts') p where property->>'dm_property_id'=item->'snapshot'->>'propertyId' and p->>'dm_person_id'=person limit 1;
   phones:='[]';
   for i in 1..3 loop
    if coalesce(row_data->>('phone_'||i),'')='' then continue;end if;
    if coalesce(row_data->>('is_phone_'||i||'_dnc'),'') not in ('No','false') then raise exception 'Export DNC evidence mismatch';end if;
    phones:=phones||jsonb_build_array(jsonb_build_object('number',row_data->>('phone_'||i),'doNotCall',false,'type',row_data->>('people_phone_'||i||'_type_id'),'permission','unverified','activity','active','activityBasis','provider_export_filter'));
   end loop;
   contacts:=contacts||jsonb_build_array(jsonb_build_object('personId',person,'name',row_data->>'person_full_name','likelyOwner',true,'propertyContactType',case when match->>'contact_type'='owner' then 'owner' else null end,
    'matchFlags',jsonb_build_object('is_likely_owner',match->'is_likely_owner','is_in_owner_family',match->'is_in_owner_family','is_resident',match->'is_resident','is_likely_renter',match->'is_likely_renter'),
    'ownershipVerified',false,'outreachAuthorized',false,'phones',phones,'emails','[]'::jsonb));
  end loop;
  used:=least(remaining,unique_count);remaining:=remaining-used;
  select value->'result' into strict r from jsonb_array_elements(p_results) where value->>'screeningId'=item->>'screeningId';
  expected:=jsonb_build_object('propertyId',item->'snapshot'->>'propertyId','creditsUsed',used,'peopleCredits',unique_count,'providerCredits',credits,'requestedPersonIds',item->'ids','contacts',contacts,'outreachAuthorized',false,
   'fetchedAt',to_char(b.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'allocation',jsonb_build_object('batchId',p_batch,'method','active-export-used-order-v1','sharedContacts',jsonb_array_length(contacts)-unique_count),
   'activityEvidence',jsonb_build_object('contract','owner-active-export-v1','exportId',receipt->>'export_id','artifactSha256',e.artifact_sha256));
  if r is distinct from expected or not public.icash_owner_export_result_valid(r) then raise exception 'Export allocation or source mismatch';end if;
  op:='owners:'||b.account_id||':'||(item->>'screeningId');
  perform public.icash_save_contacts(b.account_id,(item->>'screeningId')::uuid,op,r);
 end loop;
 if remaining<>0 or cardinality(assigned)<>jsonb_array_length(p_rows) then raise exception 'Export allocation incomplete';end if;
 update icash_research_private.owner_batches set state='complete',results=p_results where id=p_batch;
 update icash_research_private.owner_exports set parsed_rows=p_rows,completed_at=clock_timestamp() where id=p_batch;
 for op in select operation_key from icash_research_private.owner_batch_items where batch_id=p_batch order by operation_key loop
  if not public.icash_settle_dealmachine_usage(op) then raise exception 'Export actual usage settlement held';end if;
 end loop;
 return true;
end $$;

-- The original lookup contract stays intact. Export rows have a separate
-- contract and require the original private batch/CSV/receipt at every use.
do $$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_dealmachine_saved_owner_result_valid(jsonb)'::regprocedure);
 needle:='begin';if strpos(d,'active-export-used-order-v1')>0 then raise exception 'Export validator already installed';end if;
 execute replace(d,needle,needle||E'\n if p->''allocation''->>''method''=''active-export-used-order-v1'' then return public.icash_owner_export_result_valid(p);end if;');
 d:=pg_get_functiondef('public.icash_dealmachine_owner_source_started_at(uuid,uuid)'::regprocedure);
 needle:='or oc.result->''allocation''->>''method'' is distinct from ''unique-person-order-v1''';
 if strpos(d,needle)=0 then raise exception 'Owner source guard changed';end if;
 d:=replace(d,needle,'or coalesce(oc.result->''allocation''->>''method'','''') not in (''unique-person-order-v1'',''active-export-used-order-v1'')');
 needle:='return b.created_at;';
 if strpos(d,needle)=0 then raise exception 'Owner source clock changed';end if;
 execute replace(d,needle,'if oc.result->''allocation''->>''method''=''active-export-used-order-v1'' and not exists(select 1 from icash_research_private.owner_exports e where e.id=b.id and e.completed_at is not null and e.csv is not null and e.artifact_sha256=oc.result->''activityEvidence''->>''artifactSha256'' and e.receipt->''raw''->>''export_id''=oc.result->''activityEvidence''->>''exportId'' and e.receipt->''raw''=b.paid_receipt and e.receipt->''raw''->''credits''=oc.result->''providerCredits'') then return null;end if;'||E'\n '||needle);
end $$;
revoke all on function public.icash_owner_active_export_enabled(),public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb),public.icash_record_owner_export_receipt(uuid,uuid,jsonb),public.icash_claim_owner_export_recovery(uuid),public.icash_record_owner_export_recovery(uuid,uuid,jsonb),public.icash_record_owner_export_artifact(uuid,uuid,text),public.icash_save_owner_active_export(uuid,uuid,jsonb,jsonb),public.icash_owner_export_result_valid(jsonb) from public,anon,authenticated;
grant execute on function public.icash_owner_active_export_enabled(),public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb),public.icash_record_owner_export_receipt(uuid,uuid,jsonb),public.icash_claim_owner_export_recovery(uuid),public.icash_record_owner_export_recovery(uuid,uuid,jsonb),public.icash_record_owner_export_artifact(uuid,uuid,text),public.icash_save_owner_active_export(uuid,uuid,jsonb,jsonb),public.icash_owner_export_result_valid(jsonb) to service_role;
commit;
