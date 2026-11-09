-- Bounded edits to reviewed production functions; no original receipt rewrites.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_targeting_filters(jsonb)'::regprocedure);
 needle:=$n$ when 'mobile' then return '[]';$n$;
 if strpos(d,needle)=0 then raise exception 'Targeting filter boundary changed';end if;
 execute replace(d,needle,$n$ when 'out_of_state_old_sale' then return jsonb_build_array(
  jsonb_build_object('filter_id','has_absentee_owners','value',true),jsonb_build_object('filter_id','has_out_of_state_owners','value',true),
  jsonb_build_object('filter_id','last_sale_date','operator','is_before','value',to_char(cutoff-interval '10 years','YYYY-MM-DD')));
 when 'off_market_repairs' then return '[{"filter_id":"market_status","operator":"contains_any","value":[6]},{"filter_id":"estimated_repair_cost","operator":"greater_than_or_equal","value":25000}]';
$n$||needle);
 d:=pg_get_functiondef('public.icash_targeting_definition_valid(jsonb)'::regprocedure);
 needle:=$n$'vacant_absentee','mobile'$n$;
 if strpos(d,needle)=0 then raise exception 'Targeting definition boundary changed';end if;
 execute replace(d,needle,$n$'vacant_absentee','out_of_state_old_sale','off_market_repairs','mobile'$n$);

 d:=pg_get_functiondef('public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 if md5(d)<>'4cdc81fd590f2871038f06d9ed062255' then raise exception 'Owner export admission prerequisite changed';end if;
 needle:=$n$ if p_request is distinct from expected then return 'held';end if;$n$;
 if strpos(d,needle)=0 then raise exception 'Owner export request boundary changed';end if;
 execute replace(d,needle,$n$
 -- Output-only usage fields do not change the owner audience or credit cap.
 -- Original requests stay valid for their original outstanding preflights.
 if p_request->'fields'='["person_full_name","has_active_phone_number","phone_1_usage_2_months_id","phone_1_usage_12_months_id","phone_2_usage_2_months_id","phone_2_usage_12_months_id","phone_3_usage_2_months_id","phone_3_usage_12_months_id"]'::jsonb then
  expected:=jsonb_set(expected,'{fields}',p_request->'fields');
 end if;
$n$||needle);
 d:=pg_get_functiondef('public.icash_save_owner_active_export(uuid,uuid,jsonb,jsonb)'::regprocedure);
 if md5(d)<>'ba208152879c73def06c765ccc91680c' then raise exception 'Owner export saver prerequisite changed';end if;
 needle:=$n$'activityBasis','provider_export_filter'));$n$;
 if strpos(d,needle)=0 then raise exception 'Owner export phone boundary changed';end if;
 execute replace(d,needle,$n$'activityBasis','provider_export_filter')
  ||case when row_data ? ('phone_'||i||'_usage_2_months_id') then jsonb_build_object('usage2Months',row_data->>('phone_'||i||'_usage_2_months_id')) else '{}'::jsonb end
  ||case when row_data ? ('phone_'||i||'_usage_12_months_id') then jsonb_build_object('usage12Months',row_data->>('phone_'||i||'_usage_12_months_id')) else '{}'::jsonb end);$n$);

 d:=pg_get_functiondef('public.icash_operational_contact_current(uuid,uuid,text,boolean)'::regprocedure);
 if md5(d)<>'87b3d2c38e35b766ef901b34ae6aa388' then raise exception 'Operational contact prerequisite changed';end if;
 needle:=' h:=extract(hour from stamp at time zone c.timezone);';
 if strpos(d,needle)=0 then raise exception 'Operational quality boundary changed';end if;
 execute replace(d,needle,$n$ if p_channel='sms' and not public.icash_owner_sms_quality_current(p_account,c.screening_id,c.phone) then return false;end if;
$n$||needle);
end $patch$;
commit;
