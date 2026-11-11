-- Correct provider request shape without changing the financial policy or receipts.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function icash_research_private.combine_financial_filters(p_filters jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb:='[]';f jsonb;previous jsonb;position integer;bounds jsonb;bound jsonb;range_filter jsonb;ending date;minimum numeric;
begin
 if jsonb_typeof(p_filters) is distinct from 'array' then return null;end if;
 for f in select value from jsonb_array_elements(p_filters) loop
  select (ordinality-1)::integer,value into position,previous from jsonb_array_elements(result) with ordinality
   where value->>'filter_id'=f->>'filter_id';
  if not found then result:=result||jsonb_build_array(f);continue;end if;
  if previous->'operator' is not distinct from f->'operator' and previous->'value'=f->'value' then continue;end if;
  if previous->>'operator' in ('greater_than','greater_than_or_equal') and f->>'operator' in ('greater_than','greater_than_or_equal')
   and jsonb_typeof(previous->'value')='number' and jsonb_typeof(f->'value')='number' then
   if (f->>'value')::numeric>(previous->>'value')::numeric or(f->'value'=previous->'value' and f->>'operator'='greater_than') then result:=jsonb_set(result,array[position::text],f);end if;
   continue;
  end if;
  if f->>'filter_id'='last_sale_date' then
   if previous->>'operator'='is_before' and f->>'operator'='is_before' then
    result:=jsonb_set(result,array[position::text],previous||jsonb_build_object('value',least(previous->>'value',f->>'value')));continue;
   end if;
   range_filter:=case when previous->>'operator'='date_range' then previous when f->>'operator'='date_range' then f end;
   bound:=case when previous->>'operator'='is_before' then previous when f->>'operator'='is_before' then f end;
   if range_filter is not null and bound is not null then
    bounds:=range_filter->'value';ending:=least((bounds->>'end')::date,(bound->>'value')::date-1);
    if (bounds->>'start')::date>ending then return null;end if;
    result:=jsonb_set(result,array[position::text],range_filter||jsonb_build_object('value',jsonb_build_object('start',bounds->>'start','end',to_char(ending,'YYYY-MM-DD'))));continue;
   end if;
  end if;
  range_filter:=case when previous->>'operator'='range' then previous when f->>'operator'='range' then f end;
  bound:=case when previous->>'operator' in('greater_than','greater_than_or_equal') then previous when f->>'operator' in('greater_than','greater_than_or_equal') then f end;
  if range_filter is not null and bound is not null then
   bounds:=range_filter->'value';
   if jsonb_typeof(bounds->'min') is distinct from 'number' or jsonb_typeof(bounds->'max') is distinct from 'number' or jsonb_typeof(bound->'value') is distinct from 'number' then return null;end if;
   if bound->>'operator'='greater_than' and (bounds->>'min')::numeric<=(bound->>'value')::numeric then return null;end if;
   minimum:=greatest((bounds->>'min')::numeric,(bound->>'value')::numeric);
   if minimum>(bounds->>'max')::numeric then return null;end if;
   result:=jsonb_set(result,array[position::text],range_filter||jsonb_build_object('value',jsonb_build_object('min',minimum,'max',bounds->'max')));continue;
  end if;
  return null;
 end loop;
 return result;
exception when others then return null;
end $$;
revoke all on function icash_research_private.combine_financial_filters(jsonb) from public,anon,authenticated,service_role;
do $patch$
declare source text:=pg_get_functiondef('icash_research_private.financial_query_valid(jsonb,jsonb,jsonb,jsonb)'::regprocedure);needle text;
begin
 if md5(source)<>'b3a1d6f0592d952f9ee10bfe8b2e4237' then raise exception 'Financial query validator prerequisite changed';end if;
 needle:=' return p_query=jsonb_build_object(';
 if (length(source)-length(replace(source,needle,'')))<>length(needle) then raise exception 'Financial query shape boundary changed';end if;
 execute replace(source,needle,$new$ filters:=icash_research_private.combine_financial_filters(filters);
 if filters is null then return false;end if;
$new$||needle);
end $patch$;
commit;
