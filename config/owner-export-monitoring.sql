-- Apply after the application accepts the owner_export finding.
-- Report an aged, organization-blocking export using only resource/account IDs.
-- Original requests, receipts, capacity reviews and financial holds stay private.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function public.icash_owner_export_findings()
returns table(kind text,resource_id uuid,account_id uuid,since timestamptz)
language sql stable security definer set search_path='' as $$
 select 'owner_export'::text,e.id,b.account_id,b.created_at
 from icash_research_private.owner_exports e join icash_research_private.owner_batches b on b.id=e.id
 where e.terminal_at is null and e.capacity_review_id is null and b.created_at<now()-interval '5 minutes';
$$;
revoke all on function public.icash_owner_export_findings() from public,anon,authenticated;
grant execute on function public.icash_owner_export_findings() to service_role;
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_refresh_reviewed_workflow_snapshot()'::regprocedure);
 needle:='union all select kind,resource_id,account_id,since from public.icash_undispatched_outreach_findings()';
 if md5(d)<>'8979846103296bf1b20ebb4e1f474350' or position(needle in d)=0 then raise exception 'Owner export monitoring prerequisite changed';end if;
 execute replace(d,needle,needle||E'\n union all select kind,resource_id,account_id,since from public.icash_owner_export_findings()');
 d:=pg_get_functiondef('public.icash_reliability_severity(jsonb,timestamptz)'::regprocedure);
 needle:='(''text_receipt'',''text_review'',''call_receipt'',''contract_delivery'',''contract_preparation'')';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner export severity prerequisite changed';end if;
 execute replace(d,needle,'(''text_receipt'',''text_review'',''call_receipt'',''contract_delivery'',''contract_preparation'',''owner_export'')');
end $patch$;
commit;
