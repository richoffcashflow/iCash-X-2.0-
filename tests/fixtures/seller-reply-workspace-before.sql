CREATE OR REPLACE FUNCTION public.icash_workspace_opportunities(p_account uuid, p_query text DEFAULT ''::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 7, p_responses_only boolean DEFAULT false)
 RETURNS TABLE(id uuid, state text, result jsonb, completed_at timestamp with time zone, engagement jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select s.id,s.state,s.result,s.completed_at,jsonb_build_object('responded',coalesce(o.responded,false),'interested',coalesce(o.interested,false),'optedOut',coalesce(o.opted_out,false)) from public.icash_screening_jobs s left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
 where s.account_id=p_account and s.state='complete'
  and (not p_responses_only or coalesce(o.responded,false) or coalesce(o.purchase_signed,false))
  and (p_query='' or position(lower(p_query) in lower(s.result->'property'->>'address'))>0)
 order by coalesce(o.purchase_signed,false) desc,coalesce(o.interested and not o.opted_out,false) desc,coalesce(o.responded,false) desc,o.response_at desc nulls last,public.icash_property_contact_priority(p_account,s.id) desc,s.created_at desc,s.id desc
 limit greatest(1,least(25,p_limit)) offset greatest(0,least(60000,p_offset));
$function$
;
CREATE OR REPLACE FUNCTION public.icash_workspace_ready_opportunities(p_account uuid, p_query text DEFAULT ''::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 7)
 RETURNS TABLE(id uuid, state text, result jsonb, completed_at timestamp with time zone, engagement jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select s.id,s.state,s.result,s.completed_at,
  jsonb_build_object('responded',coalesce(o.responded,false),'interested',coalesce(o.interested,false),'optedOut',coalesce(o.opted_out,false))
 from public.icash_screening_jobs s
 left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
 where s.account_id=p_account and s.state='complete' and coalesce(s.snapshot->>'practice','false')<>'true'
  and (coalesce(o.responded,false) or coalesce(o.purchase_signed,false) or (
   s.result->'financialCheck'->>'status'='eligible' and s.snapshot->>'propertyType'='house'
   and not coalesce(o.opted_out,false)
   and s.snapshot->>'propertyId'=s.result->'property'->>'propertyId'
   and (public.icash_property_contact_priority(p_account,s.id)>0 or (s.completed_at between now()-interval '24 hours' and now()
   and case when pg_catalog.pg_input_is_valid(s.snapshot->>'fetchedAt','timestamp with time zone')
    then (s.snapshot->>'fetchedAt')::timestamptz between now()-interval '24 hours' and now() else false end))))
  and (p_query='' or position(lower(p_query) in lower(s.result->'property'->>'address'))>0)
 order by coalesce(o.purchase_signed,false) desc,coalesce(o.interested and not o.opted_out,false) desc,
  coalesce(o.responded,false) desc,o.response_at desc nulls last,public.icash_property_contact_priority(p_account,s.id) desc,s.created_at desc,s.id desc
 limit greatest(1,least(25,p_limit)) offset greatest(0,least(60000,p_offset));
$function$
;


CREATE OR REPLACE FUNCTION public.icash_workspace_response_counts(p_account uuid)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO '' AS $function$
 select jsonb_build_object('responded',count(*) filter(where coalesce(o.responded,false) or coalesce(o.purchase_signed,false) or exists(select 1 from public.icash_meta_leads m where m.screening_id=s.id and m.account_id=s.account_id and m.response_at is not null)),'total',count(*))
 from public.icash_screening_jobs s left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
 where s.account_id=p_account and s.state in ('complete','awaiting_address');
$function$;
