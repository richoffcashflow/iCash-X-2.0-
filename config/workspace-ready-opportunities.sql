-- A read-only default view of real eligible research and actual seller responses.
-- Use the same 24-hour research expiry as runScreeningJob and automatic draft
-- admission. Historical responses remain accessible independently of freshness.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function public.icash_workspace_ready_opportunities(p_account uuid,p_query text default '',p_offset integer default 0,p_limit integer default 7)
returns table(id uuid,state text,result jsonb,completed_at timestamptz,engagement jsonb)
language sql stable security invoker set search_path='' as $$
 select s.id,s.state,s.result,s.completed_at,
  jsonb_build_object('responded',coalesce(o.responded,false),'interested',coalesce(o.interested,false),'optedOut',coalesce(o.opted_out,false))
 from public.icash_screening_jobs s
 left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
 where s.account_id=p_account and s.state='complete' and coalesce(s.snapshot->>'practice','false')<>'true'
  and (coalesce(o.responded,false) or coalesce(o.purchase_signed,false) or (
   s.result->'financialCheck'->>'status'='eligible' and s.snapshot->>'propertyType'='house'
   and not coalesce(o.opted_out,false)
   and s.snapshot->>'propertyId'=s.result->'property'->>'propertyId'
   and s.completed_at between now()-interval '24 hours' and now()
   and case when pg_catalog.pg_input_is_valid(s.snapshot->>'fetchedAt','timestamp with time zone')
    then (s.snapshot->>'fetchedAt')::timestamptz between now()-interval '24 hours' and now() else false end))
  and (p_query='' or position(lower(p_query) in lower(s.result->'property'->>'address'))>0)
 order by coalesce(o.purchase_signed,false) desc,coalesce(o.interested and not o.opted_out,false) desc,
  coalesce(o.responded,false) desc,o.response_at desc nulls last,s.created_at desc,s.id desc
 limit greatest(1,least(25,p_limit)) offset greatest(0,least(60000,p_offset));
$$;
revoke all on function public.icash_workspace_ready_opportunities(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.icash_workspace_ready_opportunities(uuid,text,integer,integer) to service_role;
commit;
