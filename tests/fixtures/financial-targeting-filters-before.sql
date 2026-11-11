CREATE OR REPLACE FUNCTION public.icash_targeting_filters(d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare segment text:=d->>'segment';cutoff date:=(d->>'asOf')::date;
begin
 case segment
 when 'off_market' then return '[{"filter_id":"market_status","operator":"contains_any","value":[6]}]';
 when 'sale_7_10' then return jsonb_build_array(jsonb_build_object('filter_id','last_sale_date','operator','date_range','value',jsonb_build_object('start',to_char(cutoff-interval '10 years','YYYY-MM-DD'),'end',to_char(cutoff-interval '7 years','YYYY-MM-DD'))));
 when 'sale_10_plus' then return jsonb_build_array(jsonb_build_object('filter_id','last_sale_date','operator','is_before','value',to_char(cutoff-interval '10 years','YYYY-MM-DD')));
 when 'buyer_fit' then return (select jsonb_agg(jsonb_build_object('filter_id',key,'operator','range','value',value) order by key) from jsonb_each(d->'ranges'));
 when 'out_of_state_absentee' then return '[{"filter_id":"has_absentee_owners","value":true},{"filter_id":"has_out_of_state_owners","value":true}]';
 when 'vacant_absentee' then return '[{"filter_id":"is_vacant_home","value":true},{"filter_id":"has_absentee_owners","value":true}]';
 when 'out_of_state_old_sale' then return jsonb_build_array(
  jsonb_build_object('filter_id','has_absentee_owners','value',true),jsonb_build_object('filter_id','has_out_of_state_owners','value',true),
  jsonb_build_object('filter_id','last_sale_date','operator','is_before','value',to_char(cutoff-interval '10 years','YYYY-MM-DD')));
 when 'off_market_repairs' then return '[{"filter_id":"market_status","operator":"contains_any","value":[6]},{"filter_id":"estimated_repair_cost","operator":"greater_than_or_equal","value":25000}]';
 when 'mobile' then return '[]';
 else return null;
 end case;
end $function$
;
