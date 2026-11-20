-- Use the default CSV columns and serialize new purchases until the original
-- artifact validates. Preserve historical evidence and every owner/cost gate.
set local lock_timeout='3s';
create index icash_default_owner_export_unallocated on icash_research_private.owner_exports(id)
 where request->'fields'='[]'::jsonb and completed_at is null and receipt->'httpStatus'='200'::jsonb;
alter table icash_research_private.owner_export_capacity_reviews drop constraint owner_export_capacity_reviews_auto_policy_check,
 add constraint owner_export_capacity_reviews_auto_policy_check check(auto_policy is null or auto_policy in ('idle-v1','gateway-idle-v1','empty-idle-v1','unknown-idle-v1','credit-idle-v1','field-idle-v1'));
do $patch$
declare src text:=pg_get_functiondef('public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
begin
 if md5(src)<>'322fdd7298e57496156ac6141c6ecaf0' then raise exception 'Unexpected icash_admit_owner_active_export predecessor';end if;
 src:=replace(src,$old$ -- Output-only usage fields do not change the owner audience or credit cap.
 -- Original requests stay valid for their original outstanding preflights.
 if p_request->'fields' in ('["person_full_name","has_active_phone_number","phone_1_usage_2_months_id","phone_1_usage_12_months_id","phone_2_usage_2_months_id","phone_2_usage_12_months_id","phone_3_usage_2_months_id","phone_3_usage_12_months_id"]'::jsonb,'["person_full_name","has_active_phone_number","phones","phone_1_usage_2_months_id","phone_1_usage_12_months_id","phone_2_usage_2_months_id","phone_2_usage_12_months_id","phone_3_usage_2_months_id","phone_3_usage_12_months_id"]'::jsonb) then
  expected:=jsonb_set(expected,'{fields}',p_request->'fields');
 end if;
$old$,$new$ if p_request->'fields' is distinct from '[]'::jsonb then return 'held';end if;
 expected:=jsonb_set(expected,'{fields}','[]'::jsonb);
 if exists(select 1 from icash_research_private.owner_exports e where e.request->'fields'='[]'::jsonb
  and e.completed_at is null and e.receipt->'httpStatus'='200'::jsonb) then return 'export_busy';end if;
$new$);
 execute src;
end $patch$;
do $patch$
declare src text:=pg_get_functiondef('icash_research_private.credit_export_source(uuid,text)'::regprocedure);
begin
 if md5(src)<>'38b2326da19eeb8b0ced2c9ce872ea4c' then raise exception 'Unexpected credit_export_source predecessor';end if;
 src:=replace(src,$old$'fields',case when e.request->'fields'=$old$,$new$'fields',case when e.request->'fields'='[]'::jsonb then '[]'::jsonb when e.request->'fields'=$new$);
 execute src;
end $patch$;
do $patch$
declare src text:=pg_get_functiondef('icash_research_private.capacity_source_before_unknown(uuid,text)'::regprocedure);
begin
 if md5(src)<>'4a9b5ab5bfafab54dd63c351d5bacbd1' then raise exception 'Unexpected capacity_source_before_unknown predecessor';end if;
 src:=replace(src,$old$ if e.id is not null and b.id is not null and b.state='claimed'$old$,$new$ if e.receipt#>>'{raw,error,code}'='field_not_found' then
  if (e.request->'fields'?'phones') is distinct from true or e.receipt#>>'{raw,error,message}' is distinct from 'Field not found: "phones"' then return null;end if;
  message:='Field not found: "phones"';
 end if;
 if e.id is not null and b.id is not null and b.state='claimed'$new$);
 src:=replace(src,$old$or (e.receipt#>>'{raw,error,code}'='no_records_matched'$old$,$new$or (e.receipt#>>'{raw,error,code}' in ('no_records_matched','field_not_found')$new$);
 src:=replace(src,$old$then return 'empty-idle-v1';end if;$old$,$new$then return case when e.receipt#>>'{raw,error,code}'='field_not_found' then 'field-idle-v1' else 'empty-idle-v1' end;end if;$new$);
 execute src;
end $patch$;
do $patch$
declare src text:=pg_get_functiondef('icash_research_private.guard_capacity_precision_followup()'::regprocedure);
begin
 if md5(src)<>'751b5415a893e02017df0dfa8a5f2cdf' then raise exception 'Unexpected guard_capacity_precision_followup predecessor';end if;
 src:=replace(src,$old$'empty-idle-v1','unknown-idle-v1'$old$,$new$'empty-idle-v1','field-idle-v1','unknown-idle-v1'$new$);
 execute src;
end $patch$;
do $patch$
declare src text:=pg_get_functiondef('public.icash_claim_export_capacity_probe(uuid,text)'::regprocedure);
begin
 if md5(src)<>'c5d66e8c95750525b7e88bd72d94fdb2' then raise exception 'Unexpected icash_claim_export_capacity_probe predecessor';end if;
 src:=replace(src,$old$'empty-idle-v1','unknown-idle-v1'$old$,$new$'empty-idle-v1','field-idle-v1','unknown-idle-v1'$new$);
 execute src;
end $patch$;
do $patch$
declare src text:=pg_get_functiondef('public.icash_finish_automatic_export_capacity(uuid)'::regprocedure);
begin
 if md5(src)<>'ce075803a910a625741ae1f0730d791c' then raise exception 'Unexpected icash_finish_automatic_export_capacity predecessor';end if;
 src:=replace(src,$old$'empty-idle-v1','unknown-idle-v1'$old$,$new$'empty-idle-v1','field-idle-v1','unknown-idle-v1'$new$);
 src:=replace(src,$old$if r.auto_policy in ('unknown-idle-v1','credit-idle-v1') and$old$,$new$if r.auto_policy in ('field-idle-v1','unknown-idle-v1','credit-idle-v1') and$new$);
 execute src;
end $patch$;
