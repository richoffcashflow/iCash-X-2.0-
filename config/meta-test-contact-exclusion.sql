begin;
set local lock_timeout='3s';

-- Source-scoped owner test contacts are excluded before routing or outreach.
-- Keep their original connector receipt for audit; never mark real consent.
alter table public.icash_meta_lead_sources add column test_lead_names text[] not null default '{}'
 check(cardinality(test_lead_names)<=100);
create function public.icash_meta_is_test_contact(p_source uuid,p_name text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_meta_lead_sources s cross join lateral unnest(s.test_lead_names) excluded(name)
 where s.id=p_source and nullif(trim(p_name),'') is not null
 and regexp_replace(lower(trim(p_name)),'[[:space:]]+',' ','g')=regexp_replace(lower(trim(excluded.name)),'[[:space:]]+',' ','g'));
$$;
revoke all on function public.icash_meta_is_test_contact(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_meta_is_test_contact(uuid,text) to service_role;

do $patch$
declare def text;needle text;
begin
 def:=pg_get_functiondef('public.icash_meta_accept_lead(uuid,jsonb,text)'::regprocedure);
 needle:='meta:=p_payload->>''metaId'';';
 if (length(def)-length(replace(def,needle,'')))/length(needle)<>1 then raise exception 'Meta acceptance prerequisite changed';end if;
 execute replace(def,needle,'if public.icash_meta_is_test_contact(src.id,p_payload->>''name'') then raise exception ''META_TEST_LEAD'';end if; '||needle);

 def:=pg_get_functiondef('public.icash_make_receive_lead(jsonb,boolean)'::regprocedure);
 needle:='digest:=encode(sha256(convert_to(p_payload::text,''UTF8'')),''hex'');';
 if (length(def)-length(replace(def,needle,'')))/length(needle)<>1 then raise exception 'Make receipt prerequisite changed';end if;
 execute replace(def,needle,'p_test:=p_test or exists(select 1 from public.icash_meta_lead_sources s cross join lateral jsonb_array_elements(p_payload->''field_data'') f where s.page_id=p_payload->>''page_id'' and s.form_id=p_payload->>''form_id'' and f->>''name''=''full_name'' and public.icash_meta_is_test_contact(s.id,f#>>''{values,0}'')); '||needle);
end $patch$;
commit;
