-- Read-only production definitions captured November 4 for disposable tests.
-- Dependencies and data are synthetic; no provider or production connection.
CREATE OR REPLACE FUNCTION public.icash_admit_owner_active_export(p_account uuid, p_primary uuid, p_batch uuid, p_items jsonb, p_preview jsonb, p_config jsonb, p_request jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

 if public.icash_owner_targeting_pool(p_account,p_primary)='mobile' then
  if not exists(select 1 from icash_research_private.targeting_settings where id=1 and mobile_verified) then return 'held';end if;
  expected:=expected||'{"mobile_only":true}'::jsonb;end if;
 if exists(select 1 from jsonb_array_elements(p_items) i where public.icash_owner_targeting_pool(p_account,(i->>'screeningId')::uuid)<>public.icash_owner_targeting_pool(p_account,p_primary)) then return 'held';end if;
 if p_request is distinct from expected then return 'held';end if;
 if exists(select 1 from icash_research_private.owner_export_settings where id=1 and preflight_enabled) and not exists(select 1 from icash_research_private.owner_export_preflights p where p.account_id=p_account and p.fingerprint=md5(jsonb_build_array(p_items,p_request)::text) and p.items=p_items and p.request=p_request and p.state='ready' and p.checked_at>clock_timestamp()-interval '30 minutes') then return 'held';end if;
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
 if exists(select 1 from icash_research_private.owner_exports where terminal_at is null and capacity_review_id is null) then return 'export_busy';end if;
 admission:=public.icash_admit_owner_batch(p_account,p_primary,p_batch,p_items,p_preview,p_config||'{"ownerContract":"owner-active-export-v1"}');
 if admission<>'claimed' then return admission;end if;
 insert into icash_research_private.owner_exports(id,request) values(p_batch,p_request);
 return 'claimed';
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_owner_active_export_capacity()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when not coalesce(public.icash_owner_active_export_enabled(),false) then 'disabled'
  when exists(select 1 from icash_research_private.owner_exports where terminal_at is null and capacity_review_id is null) then 'export_busy'
  when not public.icash_dealmachine_capacity_available(3) then 'quota_wait'
  else 'ready' end;
$function$
;

CREATE OR REPLACE FUNCTION public.icash_owner_active_export_capacity(p_account uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when not coalesce(public.icash_owner_active_export_enabled(),false) then 'disabled'
  when exists(select 1 from icash_research_private.owner_exports where terminal_at is null and capacity_review_id is null) then 'export_busy'
  when not public.icash_dealmachine_capacity_available(3,p_account) then 'quota_wait'
  else 'ready' end;
$function$
;

CREATE OR REPLACE FUNCTION public.icash_owner_export_findings()
 RETURNS TABLE(kind text, resource_id uuid, account_id uuid, since timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select 'owner_export'::text,e.id,b.account_id,b.created_at
 from icash_research_private.owner_exports e join icash_research_private.owner_batches b on b.id=e.id
 where e.terminal_at is null and e.capacity_review_id is null and b.created_at<now()-interval '5 minutes'
 union all select 'owner_export'::text,p.id,p.account_id,p.created_at from icash_research_private.owner_export_preflights p where p.state in ('held','creating','checking') and p.started_at<now()-interval '5 minutes' and not exists(select 1 from icash_research_private.owner_export_preflights child where child.supersedes=p.id);
$function$
;

CREATE OR REPLACE FUNCTION public.icash_record_owner_export_receipt(p_account uuid, p_batch uuid, p_receipt jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;
