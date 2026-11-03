-- Extend the real priority/retry schemas for actual batch selection and exact
-- preflight claim/admission functions. The final purchase boundary is inert.
alter table public.icash_discovery_configs add column research_version integer not null default 1;
alter table icash_research_private.owner_exports add column id uuid,add column terminal_at timestamptz,add column capacity_review_id uuid;
create table icash_research_private.targeting_settings(id integer primary key,mobile_verified boolean);
insert into icash_research_private.targeting_settings values(1,true);
create function public.icash_prospecting_outreach_floor(uuid) returns bigint language sql stable as $$select 0::bigint$$;
create function public.icash_owner_active_export_enabled() returns boolean language sql stable
 set search_path='' as $$select enabled from icash_research_private.owner_export_settings where id=1$$;
create table public.fixture_ready_admissions(items jsonb,request_preview jsonb);
create function public.icash_admit_owner_batch(uuid,uuid,uuid,jsonb,jsonb,jsonb) returns text
language plpgsql set search_path='' as $$begin
 insert into public.fixture_ready_admissions values($4,$5);
 return 'fixture_paid_boundary';
end$$;

-- Construct synthetic history only, before any assertions or competing calls.
-- Four original properties plus a fifth fresh competitor reproduce live drift.
create function public.fixture_ready_seed(n integer) returns jsonb language plpgsql set search_path='' as $$
<<seed_values>>
declare c jsonb;s public.icash_screening_jobs;sid uuid;items jsonb;request jsonb;ids jsonb;raw jsonb;receipts jsonb;preview jsonb;idx integer;
begin
 c:=public.fixture_preflight_seed(n,true,interval '2 minutes');
 select * into s from public.icash_screening_jobs where id=(c->>'screening')::uuid;
 items:=jsonb_build_array(jsonb_build_object('screeningId',s.id,'snapshot',s.snapshot,'ids',jsonb_build_array('per_'||n)));
 for idx in 1..3 loop
  sid:=md5('ready-sibling-'||n||'-'||idx)::uuid;
  s.snapshot:=jsonb_set(jsonb_set(s.snapshot,'{propertyId}',to_jsonb('prop_'||(n*100+idx))),'{raw,data,dm_property_id}',to_jsonb('prop_'||(n*100+idx)));
  insert into public.icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at)
   values(sid,s.account_id,'synthetic-ready-sibling-'||n||'-'||idx,s.snapshot,'complete','{"financialCheck":{"status":"eligible"},"fixtureScore":0}',now()-interval '1 hour');
  items:=items||jsonb_build_array(jsonb_build_object('screeningId',sid,'snapshot',s.snapshot,'ids',jsonb_build_array('per_'||(n*100+idx))));
 end loop;
 select jsonb_agg(i->'ids'->0 order by pos) into ids from jsonb_array_elements(items) with ordinality x(i,pos);
 request:=jsonb_build_object('people_ids',ids,'fields','["person_full_name","has_active_phone_number"]'::jsonb,
  'property_match','owner','anchor','person','limit',4,'require_phone',true,'scrub_dnc',true,'active_phones_only',true);
 select p.receipts into receipts from icash_research_private.owner_export_preflights p where p.id=(c->>'preflight')::uuid;
 raw:=jsonb_set(receipts->'create'->'raw','{data,total_count}','4');
 receipts:=jsonb_build_object('create',jsonb_build_object('httpStatus',200,'raw',raw,'rawText',raw::text));
 raw:='{"total_people":4,"total_results":4,"total_properties":4,"credits":{"used":0}}';
 receipts:=receipts||jsonb_build_object('baseline',jsonb_build_object('httpStatus',200,'raw',raw,'rawText',raw::text));
 raw:='{"total_people":2,"total_results":2,"total_properties":2,"credits":{"used":0}}';
 receipts:=receipts||jsonb_build_object('eligible',jsonb_build_object('httpStatus',200,'raw',raw,'rawText',raw::text));
 alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable;
 update icash_research_private.owner_export_preflights p set items=seed_values.items,request=seed_values.request,
  fingerprint=md5(jsonb_build_array(seed_values.items,seed_values.request)::text),receipts=seed_values.receipts,
  state='ready',created_at=now()-interval '36 minutes',started_at=now()-interval '22 minutes 10 seconds',checked_at=now()-interval '22 minutes',
  cleanup_attempts=1,deleted_at=now()-interval '21 minutes 59 seconds'
  where p.id=(c->>'preflight')::uuid;
 alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable;
 delete from icash_research_private.owner_export_preflight_items where preflight_id=(c->>'preflight')::uuid;
 insert into icash_research_private.owner_export_preflight_items
  select (c->>'preflight')::uuid,(c->>'account')::uuid,(i->>'screeningId')::uuid,md5((i->'snapshot')::text) from jsonb_array_elements(items)i;
 select jsonb_build_object('data',jsonb_agg(jsonb_build_object('dm_property_id',i->'snapshot'->>'propertyId','found',true,
  'contacts',jsonb_build_array(jsonb_build_object('dm_person_id',i->'ids'->0,'contact_type','owner','is_likely_owner',true,'availability',jsonb_build_object('phones',1))))))
 into preview from jsonb_array_elements(items)i;
 return c||jsonb_build_object('items',items,'request',request,'preview',preview);
end $$;
