-- Only a newly verified, never-connected browser parent may use Twilio's
-- documented zero connectivity cost. Original quotes and all other costs stay.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $patch$
declare d text;needle text:='if c.settled_at is not null then return true;end if;';
begin
 d:=pg_get_functiondef('public.icash_settle_customer_phone_call(uuid)'::regprocedure);
 if md5(d)<>'e3e7cae8c13b1c552c53e974a7a2c685' then raise exception 'Customer call settlement prerequisite changed';end if;
 d:=replace(d,'costs jsonb;evidence text;','costs jsonb;evidence text;unanswered jsonb;');
 if strpos(d,needle)=0 then raise exception 'Customer call settlement lock boundary changed';end if;
 d:=replace(d,needle,needle||$guard$
 if c.parent_receipt->>'kind'='verified_unanswered_browser_parent' then
  -- Existing budget + call-row locks make a concurrent child/connection win.
  unanswered:=c.parent_receipt->'costEvidence';
  if c.connection_type is distinct from 'browser' or c.recording_required is distinct from true
   or c.connected_at is not null or c.recipient_answered_at is not null or c.child_sid is not null
   or c.recording_sid is not null or c.recording_deleted_at is not null or c.recording_state is distinct from 'absent'
   or c.parent_receipt->>'sid' is distinct from c.parent_sid or coalesce(c.parent_sid,'')!~'^CA[a-fA-F0-9]{32}$'
   or (c.parent_receipt->>'status' in ('busy','failed','no-answer','canceled')) is distinct from true
   or c.parent_receipt->'costMicros' is distinct from '0'::jsonb or c.parent_receipt->>'currency' is distinct from 'USD'
   or coalesce(c.parent_receipt->>'receiptHash','')!~'^[a-f0-9]{64}$'
   or unanswered->>'policy' is distinct from 'twilio-unanswered-connectivity-v1'
   or unanswered->>'accountSid' is distinct from c.provider_account_sid
   or unanswered->>'fromPhone' is distinct from c.business_phone or unanswered->>'toPhone' is distinct from c.callback_phone
   or unanswered->>'direction' is distinct from 'outbound-api'
   or (unanswered->'duration'=any(array['null'::jsonb,'""'::jsonb,'"0"'::jsonb])) is distinct from true
   or (unanswered->'priceUnit'=any(array['null'::jsonb,'"USD"'::jsonb,'"usd"'::jsonb])) is distinct from true
   or (unanswered->'price'='null'::jsonb or (jsonb_typeof(unanswered->'price')='string' and length(unanswered->>'price')<=80
     and unanswered->>'price'~'^-?0{1,10}(\.0+)?$' and unanswered->>'priceUnit' in ('USD','usd'))) is distinct from true
   or unanswered->'childrenComplete' is distinct from 'true'::jsonb or unanswered->'recordingsComplete' is distinct from 'true'::jsonb
   or unanswered->'childrenCount' is distinct from '0'::jsonb or unanswered->'recordingsCount' is distinct from '0'::jsonb
   or coalesce(unanswered->>'childInventoryHash','')!~'^[a-f0-9]{64}$' or coalesce(unanswered->>'recordingInventoryHash','')!~'^[a-f0-9]{64}$'
   or c.child_receipt->>'kind' is distinct from 'verified_empty_child_list_after_parent_end'
   or c.child_receipt->'costMicros' is distinct from '0'::jsonb or c.child_receipt->>'currency' is distinct from 'USD'
   or c.child_receipt->>'receiptHash' is distinct from unanswered->>'childInventoryHash' or c.child_receipt->>'sid' is not null
   or c.recording_receipt->>'status' is distinct from 'absent' or c.recording_receipt->'costMicros' is distinct from '0'::jsonb
   or c.recording_receipt->>'currency' is distinct from 'USD'
   or c.recording_receipt->>'callSid' is distinct from c.parent_sid
   or c.recording_receipt->>'providerAccountSid' is distinct from c.provider_account_sid
   or c.recording_receipt->>'policy' is distinct from 'customer-phone-recorded-v1'
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
$guard$);
 execute d;
end $patch$;
commit;
