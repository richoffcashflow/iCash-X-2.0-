-- An unanswered seller child is free; its completed browser parent and saved
-- parent recording remain billable under the original rate and allocations.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $patch$
declare d text;needle text:=' for receipt in select c.parent_receipt union all select c.child_receipt where c.child_receipt is not null loop';
begin
 d:=pg_get_functiondef('public.icash_settle_customer_phone_call(uuid)'::regprocedure);
 if md5(d)<>'4f891f3e51feb3d3ffcf5ef54c6c2343' then raise exception 'Customer child settlement prerequisite changed';end if;
 if strpos(d,needle)=0 then raise exception 'Customer child settlement receipt boundary changed';end if;
 d:=replace(d,needle,$guard$
 if c.child_receipt->>'kind'='verified_unanswered_browser_child' then
  -- Budget + call locks protect the final current identity, answer and receipts.
  unanswered:=c.child_receipt->'costEvidence';
  if c.connection_type is distinct from 'browser' or c.recording_required is distinct from true
   or c.connected_at is null or c.recipient_answered_at is not null
   or coalesce(c.parent_sid,'')!~'^CA[a-fA-F0-9]{32}$' or coalesce(c.child_sid,'')!~'^CA[a-fA-F0-9]{32}$' or c.child_sid=c.parent_sid
   or c.child_receipt->>'sid' is distinct from c.child_sid
   or (c.child_receipt->>'status' in ('busy','failed','no-answer','canceled')) is distinct from true
   or c.child_receipt->'costMicros' is distinct from '0'::jsonb or c.child_receipt->>'currency' is distinct from 'USD'
   or coalesce(c.child_receipt->>'receiptHash','')!~'^[a-f0-9]{64}$'
   or unanswered->>'policy' is distinct from 'twilio-unanswered-child-connectivity-v1'
   or unanswered->>'accountSid' is distinct from c.provider_account_sid or unanswered->>'parentSid' is distinct from c.parent_sid
   or unanswered->>'fromPhone' is distinct from c.business_phone or unanswered->>'toPhone' is distinct from c.recipient_phone
   or unanswered->>'direction' is distinct from 'outbound-dial'
   or (unanswered->'duration'=any(array['null'::jsonb,'""'::jsonb,'"0"'::jsonb])) is distinct from true
   or (unanswered->'priceUnit'=any(array['null'::jsonb,'"USD"'::jsonb,'"usd"'::jsonb])) is distinct from true
   or (unanswered->'price'='null'::jsonb or (jsonb_typeof(unanswered->'price')='string' and length(unanswered->>'price')<=80
     and unanswered->>'price'~'^-?0{1,10}(\.0+)?$' and unanswered->>'priceUnit' in ('USD','usd'))) is distinct from true
   or unanswered->'parentChildrenComplete' is distinct from 'true'::jsonb or unanswered->'parentChildrenCount' is distinct from '1'::jsonb
   or unanswered->'descendantsComplete' is distinct from 'true'::jsonb or unanswered->'descendantsCount' is distinct from '0'::jsonb
   or unanswered->'recordingsComplete' is distinct from 'true'::jsonb or unanswered->'recordingsCount' is distinct from '0'::jsonb
   or coalesce(unanswered->>'parentChildrenHash','')!~'^[a-f0-9]{64}$' or coalesce(unanswered->>'descendantsHash','')!~'^[a-f0-9]{64}$'
   or coalesce(unanswered->>'recordingInventoryHash','')!~'^[a-f0-9]{64}$'
   or unanswered->'originalParentReceipt' is distinct from c.parent_receipt
   or unanswered->'originalRecordingReceipt' is distinct from c.recording_receipt
   or c.parent_receipt->>'sid' is distinct from c.parent_sid or c.parent_receipt->>'status' is distinct from 'completed'
   or c.parent_receipt->>'currency' is distinct from 'USD' or coalesce(c.parent_receipt->>'receiptHash','')!~'^[a-f0-9]{64}$'
   or jsonb_typeof(c.parent_receipt->'costMicros') is distinct from 'number'
   or (case when jsonb_typeof(c.parent_receipt->'costMicros')='number' then (c.parent_receipt->>'costMicros')::numeric>0 else false end) is distinct from true
   or unanswered->'originalChildReceipt'->>'sid' is distinct from c.child_sid
   or (unanswered->'originalChildReceipt'->>'status' in ('busy','failed','no-answer','canceled')) is distinct from true
   or unanswered->'originalChildReceipt'->>'currency' is distinct from 'USD'
   or (unanswered->'originalChildReceipt'->'costMicros'=any(array['null'::jsonb,'0'::jsonb])) is distinct from true
   or coalesce(unanswered->'originalChildReceipt'->>'receiptHash','')!~'^[a-f0-9]{64}$'
   or (c.recording_state in ('available','deleted')) is distinct from true or coalesce(c.recording_sid,'')!~'^RE[a-fA-F0-9]{32}$'
   or c.recording_receipt->>'sid' is distinct from c.recording_sid or c.recording_receipt->>'status' is distinct from 'completed'
   then return false;end if;
  begin
   if (isfinite((unanswered->>'observedAt')::timestamptz) and isfinite((unanswered->>'createdAt')::timestamptz)
     and isfinite((unanswered->>'endedAt')::timestamptz)
     and (unanswered->>'observedAt')::timestamptz between clock_timestamp()-interval '2 minutes' and clock_timestamp()+interval '5 seconds'
     and (unanswered->>'createdAt')::timestamptz between c.created_at-interval '5 seconds' and c.created_at+interval '2 minutes'
     and (unanswered->>'endedAt')::timestamptz between (unanswered->>'createdAt')::timestamptz and (unanswered->>'observedAt')::timestamptz-interval '30 seconds') is distinct from true
    then return false;end if;
  exception when invalid_datetime_format or datetime_field_overflow then return false;
  end;
 end if;
$guard$||needle);
 execute d;
end $patch$;
commit;
