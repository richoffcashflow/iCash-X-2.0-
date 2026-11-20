-- Recover a saved original that is blocking subsequent owner orders.
-- An untried file gets one priority turn. All due, lease, quota, receipt and
-- account validation stays in the original claim and settlement paths.
do $migration$
declare
 recovery text := pg_get_functiondef('public.icash_claim_owner_export_recovery(uuid)'::regprocedure);
 acquisition text := pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 old_order constant text := ' order by x.next_recover_at,x.id limit 1 for update skip locked;';
 new_order constant text := $patch$ order by (x.request->'fields'='[]'::jsonb and x.receipt->'httpStatus'='200'::jsonb
  and x.csv is not null and x.terminal_at is not null and x.recovery_attempts=0) desc nulls last,
  x.next_recover_at,x.id limit 1 for update skip locked;$patch$;
 old_gate constant text := 'if c.exhausted or backlog>=c.max_open_prospects or not public.icash_outbound_search_due(c.account_id) then';
 new_gate constant text := $patch$if c.exhausted or backlog>=c.max_open_prospects
  -- A full owner-lookup batch already exists and the next paid owner order
  -- must wait for a previous successful receipt. Continue servicing existing
  -- sellers and enrichment above, then reconsider when the receipt clears.
  or (c.contacts_enabled and backlog>=5 and exists(
   select 1 from icash_research_private.owner_exports e
   where e.request->'fields'='[]'::jsonb and e.completed_at is null
    and e.receipt->'httpStatus'='200'::jsonb))
  or not public.icash_outbound_search_due(c.account_id) then$patch$;
begin
 if strpos(recovery,new_order)=0 then
  if md5(recovery)<>'a1e2c51cffa0b2898a19aff8204c79f6' or strpos(recovery,old_order)=0 then raise exception 'Unexpected owner recovery source'; end if;
  execute replace(recovery,old_order,new_order);
 end if;
 if strpos(acquisition,new_gate)=0 then
  if md5(acquisition)<>'01aa118515bea5525c4fa7f209a6fec0' or strpos(acquisition,old_gate)=0 then raise exception 'Unexpected acquisition source'; end if;
  execute replace(acquisition,old_gate,new_gate);
 end if;
end
$migration$;
