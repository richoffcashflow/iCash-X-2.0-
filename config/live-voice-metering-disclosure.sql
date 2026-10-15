begin;
-- Local-only candidate, applied only after live-voice-metering.sql. This
-- enriches an existing account read; it does not activate metering, create
-- debits, change rates, or expose provider/session/ledger identifiers.
create function public.icash_has_provisional_voice_usage(p_account uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from icash_voice_meter_private.meters m
  join icash_voice_meter_private.entries e on e.operation_key=m.operation_key
  join public.icash_credit_ledger l on l.id=e.ledger_id and l.account_id=m.account_id
  where m.account_id=p_account and m.state in ('active','stopping','terminal') and m.provisional_cents>0
   and e.delta_cents>0 and e.cumulative_cents<=m.provisional_cents
   and l.kind='usage' and l.delta_cents=-e.delta_cents
   and l.event_key='usage-meter:'||m.operation_key||':'||e.elapsed_seconds
 )
$$;
revoke all on function public.icash_has_provisional_voice_usage(uuid) from public,anon,authenticated;
grant execute on function public.icash_has_provisional_voice_usage(uuid) to service_role;

-- Call the original loader unchanged first: it owns authentication binding,
-- account claims and the complete existing response. Derive the account only
-- from its authorized result, never directly from a new caller argument.
alter function public.icash_load_workspace_account(uuid,text) rename to icash_load_workspace_account_before_voice_disclosure;
create function public.icash_load_workspace_account(p_user uuid,p_mode text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare snapshot jsonb;
begin
 snapshot:=public.icash_load_workspace_account_before_voice_disclosure(p_user,p_mode);
 -- Preserve the exact legacy response for test mode and unmetered/final-only
 -- accounts. Do not use the activation flag: existing unresolved deductions
 -- still need disclosure if metering is subsequently switched off.
 if p_mode='live' and public.icash_has_provisional_voice_usage((snapshot->>'accountId')::uuid) then
  snapshot:=jsonb_set(snapshot,'{account,provisionalVoiceUsage}','true'::jsonb);
 end if;
 return snapshot;
end $$;
revoke all on function public.icash_load_workspace_account(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_load_workspace_account(uuid,text) to service_role;
commit;
