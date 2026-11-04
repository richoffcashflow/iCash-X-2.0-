begin;
create function public.icash_seller_contact_refresh_summary() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',p.enabled,'prospectiveFrom',p.activated_at,
  'heldBeforeActivation',(select count(*) from public.icash_seller_gaps g where g.state='needs_review' and g.review_reason='contact_checks_expired' and g.created_at<p.activated_at),
  'newAwaitingCheck',(select count(*) from public.icash_seller_gaps g where g.state='needs_review' and g.review_reason='contact_checks_expired' and g.created_at>=p.activated_at and g.due_at<=now() and g.expires_at>now() and not exists(select 1 from icash_seller_recovery_private.contact_refreshes f where f.gap_id=g.id)),
  'requests',(select count(*) from icash_seller_recovery_private.contact_refreshes),
  'unknownRequests',(select count(*) from icash_seller_recovery_private.contact_refreshes where response_at is null and requested_at<now()-interval '2 minutes'),
  'savedResponsesPending',(select count(*) from icash_seller_recovery_private.contact_refreshes where state='responded'),
  'outcomes',coalesce((select jsonb_object_agg(outcome,n) from (select outcome,count(*) n from icash_seller_recovery_private.contact_refreshes where outcome is not null group by outcome) counts),'{}'::jsonb),
  'scope','national provider observation; state clearance and consent not established; no historical replay')
 from icash_seller_recovery_private.contact_refresh_policy p where p.id=1;
$$;
revoke all on function public.icash_seller_contact_refresh_summary() from public,anon,authenticated;
grant execute on function public.icash_seller_contact_refresh_summary() to service_role;
commit;
