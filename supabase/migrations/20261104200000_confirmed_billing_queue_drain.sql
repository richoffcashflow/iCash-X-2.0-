-- A settled call must not consume the only provider-recovery turn for a minute.
-- Read back existing financial evidence; update queue bookkeeping only.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare d text; needle text;
begin
 d:=pg_get_functiondef('public.icash_claim_outbound_billing(integer,integer)'::regprocedure);
 if md5(d) is distinct from '3b562919a5c3733032d8e558c51c112c' then
  raise exception 'Outbound billing claim changed; review before applying';
 end if;
 needle:=' with candidate as (select q.call_id from icash_outbound_billing_private.queue q';
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'Expected exactly one billing candidate query';
 end if;
 execute replace(d,needle,$patch$
 -- Bound the scan BEFORE the canonical settlement readback. Pending rows only:
 -- active/expired leases and explicit review remain with their existing paths.
 with due_rows as materialized (
  select q.call_id,q.account_id,q.operation_key
  from icash_outbound_billing_private.queue q
  where q.state='pending' and q.attempts<12 and q.next_attempt_at<=t
  order by q.next_attempt_at,q.created_at,q.call_id
  for update skip locked limit 100
 ), receipts as materialized (
  select q.call_id,q.operation_key,
   public.icash_get_outbound_usage_settlement(q.account_id,q.call_id) receipt from due_rows q
 )
 update icash_outbound_billing_private.queue q
 set state='completed',reason='ledger_confirmed_batch',updated_at=clock_timestamp()
 from receipts c where q.call_id=c.call_id and q.state='pending'
  and c.receipt->'settled'='true'::jsonb and c.receipt->>'operationKey'=q.operation_key;
 with candidate as (select q.call_id from icash_outbound_billing_private.queue q$patch$);
end $migration$;
commit;
