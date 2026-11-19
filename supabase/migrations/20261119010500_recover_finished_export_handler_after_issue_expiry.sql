set local lock_timeout='1s';
do $guard$ begin
 if md5(pg_get_functiondef('icash_research_private.unknown_capacity_source_snapshot(uuid)'::regprocedure))<>'b28d1311c34d499153e1db7fa4cd6908' then raise exception 'Export snapshot changed';end if;
end $guard$;
CREATE OR REPLACE FUNCTION icash_research_private.unknown_capacity_source_snapshot(p_export uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare e icash_research_private.owner_exports;b icash_research_private.owner_batches;q icash_research_private.requests;handlers jsonb;
begin
 select * into e from icash_research_private.owner_exports where id=p_export;
 select * into b from icash_research_private.owner_batches where id=p_export;
 select * into q from icash_research_private.requests where id=p_export;
 if e.id is null or b.id is null or q.id is null then return null;end if;
 select jsonb_agg(to_jsonb(t) order by t.id) into handlers from public.icash_automation_tickets t
 where t.account_id=b.account_id and t.screening_id=b.primary_screening and t.kind='contacts'
  and t.created_at<=b.created_at and (
   t.expires_at>=b.created_at or (
    -- An already-consumed handler can admit its batch before the route's
    -- 240-second deadline even though its two-minute issue token has expired.
    -- Require the precise finished unknown request and a terminal handler.
    b.created_at>t.expires_at and b.created_at<=t.created_at+interval '240 seconds'
    and q.created_at=b.created_at and q.account_id=b.account_id
    and q.operation_key='owner-batch:'||e.id and q.kind='owner_lookup' and q.admitted
    and q.result='{"outcome":"unknown"}'::jsonb and q.finished_at>=b.created_at
    and t.issue_attempts=1 and t.state='held' and t.outcome='held_for_reconciliation'
    and t.completed_at>=q.finished_at and t.completed_at<=now()-interval '5 minutes'
   ));
 if jsonb_array_length(handlers) is distinct from 1 then return null;end if;
 return jsonb_build_object('policy','unknown-idle-v1','export',to_jsonb(e)-'capacity_review_id',
  'batch',to_jsonb(b),'request',to_jsonb(q),'handler',handlers->0);
end $function$
;