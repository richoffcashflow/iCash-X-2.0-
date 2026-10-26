-- Use the original committed batch admission as the request-start lower bound.
-- Do not rewrite saved contacts, replay purchases, renew evidence or change costs.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$
declare item record;
begin
 for item in select * from (values
  ('icash_dealmachine_saved_owner_result_valid(jsonb)','2f4b81508c12158e9bbdc360d8cda432'),
  ('icash_ingest_dealmachine_dnc_observations(uuid,uuid,uuid)','14017b5a4b9a7a4bf9549be0c3f7df46'),
  ('icash_lock_operational_dnc(uuid,uuid)','f5aa7c7cfca6ecc716578b21b0e10ca0'),
  ('icash_prepare_operational_contacts(uuid)','9701c96543479d20b109ecac23e614fe')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(('public.'||item.signature)::regprocedure))<>item.checksum then
   raise exception 'Owner batch source prerequisite changed: %',item.signature;
  end if;
 end loop;
end $guard$;

create function public.icash_dealmachine_owner_source_started_at(p_account uuid,p_screening uuid)
returns timestamptz language plpgsql stable security definer set search_path='' as $$
declare oc public.icash_owner_contacts;b icash_research_private.owner_batches;item jsonb;result jsonb;
begin
 select * into oc from public.icash_owner_contacts where account_id=p_account and screening_id=p_screening;
 if not found then return null;end if;
 if not (oc.result ? 'allocation') then return public.icash_dealmachine_request_started_at(oc.result);end if;
 if jsonb_typeof(oc.result->'allocation') is distinct from 'object'
  or oc.result->'allocation'->>'method' is distinct from 'unique-person-order-v1' then return null;end if;
 select batch.* into b from icash_research_private.owner_batch_items binding
 join icash_research_private.owner_batches batch on batch.id=binding.batch_id
 where binding.screening_id=p_screening and binding.operation_key=oc.operation_key
  and batch.account_id=p_account and batch.id::text=oc.result->'allocation'->>'batchId'
  and batch.state='complete' and batch.created_at<=oc.created_at;
 if not found or b.paid_receipt is null or jsonb_typeof(b.items) is distinct from 'array'
  or jsonb_typeof(b.results) is distinct from 'array' then return null;end if;
 if (select count(*) from jsonb_array_elements(b.items) x where x->>'screeningId'=p_screening::text)<>1
  or (select count(*) from jsonb_array_elements(b.results) x where x->>'screeningId'=p_screening::text)<>1 then return null;end if;
 select x into item from jsonb_array_elements(b.items) x where x->>'screeningId'=p_screening::text;
 select x->'result' into result from jsonb_array_elements(b.results) x where x->>'screeningId'=p_screening::text;
 if result is distinct from oc.result or item->'ids' is distinct from oc.result->'requestedPersonIds'
  or item->'snapshot'->>'propertyId' is distinct from oc.result->>'propertyId'
  or oc.operation_key is distinct from 'owners:'||p_account||':'||p_screening then return null;end if;
 -- Completed batch receipts/results are private and write-once through their
 -- existing service RPCs. Their original admission precedes the paid request.
 return b.created_at;
end $$;
revoke all on function public.icash_dealmachine_owner_source_started_at(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_dealmachine_owner_source_started_at(uuid,uuid) to service_role;

do $patch$
declare d text;old text;replacement text;
begin
 -- Allocated people credits count unique people; saved contacts also retain
 -- the explicitly recorded shared owners. Actual batch proof is mandatory at
 -- ingestion and every final DNC check through the source helper above.
 d:=pg_get_functiondef('public.icash_dealmachine_saved_owner_result_valid(jsonb)'::regprocedure);
 d:=replace(d,'found_count integer;','found_count integer;shared_count integer:=0;');
 old:=' if people<>found_count or (p->''providerCredits''->>''properties'')::integer<>0 or used+deduplicated<>found_count';
 replacement:=$new$ if p ? 'allocation' then
  if jsonb_typeof(p->'allocation') is distinct from 'object'
   or p->'allocation'->>'method' is distinct from 'unique-person-order-v1'
   or coalesce(p->'allocation'->>'batchId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(p->'allocation'->'sharedContacts') is distinct from 'number'
   or coalesce(p->'allocation'->>'sharedContacts','') !~ '^[0-9]{1,2}$' then return false;end if;
  shared_count:=(p->'allocation'->>'sharedContacts')::integer;
  if shared_count>found_count then return false;end if;
 end if;
 if people+shared_count<>found_count or (p->'providerCredits'->>'properties')::integer<>0 or used+deduplicated<>people$new$;
 if position(old in d)=0 then raise exception 'Owner source shape prerequisite changed';end if;
 execute replace(d,old,replacement);

 d:=pg_get_functiondef('public.icash_ingest_dealmachine_dnc_observations(uuid,uuid,uuid)'::regprocedure);
 old:='started:=public.icash_dealmachine_request_started_at(oc.result);';
 if position(old in d)=0 then raise exception 'Owner source importer prerequisite changed';end if;
 execute replace(d,old,'started:=public.icash_dealmachine_owner_source_started_at(p_account,p_screening);');

 d:=pg_get_functiondef('public.icash_prepare_operational_contacts(uuid)'::regprocedure);
 old:='oc.result,oc.created_at,a.owner_user_id from public.icash_owner_contacts oc';
 if position(old in d)=0 then raise exception 'Owner source candidate prerequisite changed';end if;
 d:=replace(d,old,'oc.result,oc.created_at,a.owner_user_id,public.icash_dealmachine_owner_source_started_at(oc.account_id,oc.screening_id) as source_started_at from public.icash_owner_contacts oc');
 old:='public.icash_dealmachine_request_started_at(oc.result)';
 if (length(d)-length(replace(d,old,'')))/length(old)<>2 then raise exception 'Owner source candidate timestamps changed';end if;
 execute replace(d,old,'oc.source_started_at');

 d:=pg_get_functiondef('public.icash_lock_operational_dnc(uuid,uuid)'::regprocedure);
 old:='and public.icash_dealmachine_saved_owner_result_valid(oc.result)';
 if position(old in d)=0 then raise exception 'Owner source final check prerequisite changed';end if;
 execute replace(d,old,old||E'\n  and i.request_started_at=public.icash_dealmachine_owner_source_started_at(p_account,c.screening_id)');
end $patch$;
commit;
