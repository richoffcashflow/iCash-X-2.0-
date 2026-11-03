-- Only unchanged, old terminal calls with an explicit missing/bad conversation
-- identity use slower read-only recovery. No call, cost, receipt or hold changes.
-- Compatible with the previous handler: its generic reason keeps its cadence.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_finish_recorded_reception_work(uuid,uuid,text,text,uuid,bigint,text,jsonb)'::regprocedure);
 needle:='then null else t+interval ''1 minute'' end,';
 replacement:=$replacement$then null
   -- recorded-reception-identity-backoff-v1: a bound callback or other
   -- transition during this lease must remain due, even when finish rereads
   -- its new row version. Both orders serialize on the original session lock.
   when last_action<>'claim_reconcile' and next_reconcile_at<=t then t
   when p_outcome='retry' and p_payload->>'reason' in ('conversation_identity_required','conversation_binding_required')
    and last_action='claim_reconcile' and call_ended_at<=t-interval '24 hours'
    and call_terminal_status in ('completed','failed','busy','no-answer','canceled')
    and state in ('available','expired','deletion_pending','deleted')
    and recording_sid is not null and register_claimed_at is not null and conversation_id is null
    and billing_state='reserved' and reconcile_attempts>=3
    then t+case when reconcile_attempts>=12 then interval '1 hour'
      when reconcile_attempts>=6 then interval '15 minutes' else interval '5 minutes' end
   else t+interval '1 minute' end,$replacement$;
 if strpos(d,'recorded-reception-identity-backoff-v1')>0 then
  if strpos(d,replacement)=0 or md5(replace(d,replacement,needle))<>'f20187f3c69c46055163d1a5692d8ad7' then raise exception 'Installed reception recovery differs';end if;
  return;
 end if;
 if md5(d)<>'f20187f3c69c46055163d1a5692d8ad7' then raise exception 'Recorded reception completion changed';end if;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Recorded reception retry expression changed';end if;
 execute replace(d,needle,replacement);
end $patch$;
commit;
