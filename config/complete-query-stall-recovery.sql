-- Complete the supported immutable query-policy family, retaining every hold.
-- The caller owns the migration transaction; the rollout setting stays disabled.
set local lock_timeout='5s';
set local statement_timeout='60s';
select 1 from public.icash_operating_budget where id=1 for update;
do $patch$
declare source text:=pg_get_functiondef('public.icash_continue_stalled_research(uuid)'::regprocedure);
 old_policy text:=$old$  and coalesce(original_policy=jsonb_build_object('version','research-efficiency-v2',
   'exclusionListId',original_policy->>'exclusionListId')
   and original_policy->>'exclusionListId' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$',false)
$old$;
 new_policy text:=$new$  and coalesce(
   (original_policy=jsonb_build_object('version','research-efficiency-v2','exclusionListId',original_policy->'exclusionListId')
    and (original_policy->'exclusionListId'='null'::jsonb
     or (jsonb_typeof(original_policy->'exclusionListId')='string'
      and original_policy->>'exclusionListId' ~ '^[A-Za-z0-9_-]{1,100}$')))
   or (original_policy->>'version'='financial-prefilter-v1'
    and jsonb_typeof(original_policy->'exclusionListId')='string'
    and icash_research_private.financial_filters(original_policy) is not null),false)
$new$;
 old_plan text:=$old$and plan->>'version'='seller-targeting-v1');$old$;
begin
 if md5(source)<>'cbe20a876259b96a9b91bbaee979b492'
  or md5(pg_get_functiondef('icash_research_private.financial_filters(jsonb,jsonb)'::regprocedure))<>'b8652e71842c1e0dd7a2b2c3f5c1096d'
 then raise exception 'Complete query continuation prerequisite changed';end if;
 if (length(source)-length(replace(source,old_policy,'')))<>length(old_policy)
  or (length(source)-length(replace(source,old_plan,'')))<>length(old_plan)
 then raise exception 'Complete query continuation insertion changed';end if;
 source:=replace(source,old_policy,new_policy);
 source:=replace(source,old_plan,$new$and plan->>'version' in ('seller-targeting-v1','seller-filters-v1'));$new$);
 source:=replace(source,'-- Independent targeting keeps its exclusion list in the immutable query claim,','-- Versioned searches keep their exact policy in the immutable query claim,');
 execute source;
end $patch$;
