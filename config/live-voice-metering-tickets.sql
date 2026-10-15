begin;
-- Apply only after the disabled accounting scaffold. No provider credential is
-- copied to the worker. Capabilities are short-lived, operation-bound, one-use.
create table icash_voice_meter_private.worker_state (
 id integer primary key check(id=1),last_claim_at timestamptz not null
);
create table icash_voice_meter_private.tickets (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 operation_key text not null references icash_voice_meter_private.meters(operation_key),
 issued_at timestamptz not null,expires_at timestamptz not null,consumed_at timestamptz,
 check(expires_at>issued_at and expires_at<=issued_at+interval '30 seconds')
);
create index voice_meter_ticket_operation on icash_voice_meter_private.tickets(operation_key,expires_at);
alter table icash_voice_meter_private.worker_state enable row level security;
alter table icash_voice_meter_private.tickets enable row level security;
revoke all on icash_voice_meter_private.worker_state,icash_voice_meter_private.tickets from public,anon,authenticated,service_role;

create function public.icash_next_voice_metering() returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate jsonb;m icash_voice_meter_private.meters;t timestamptz:=icash_voice_meter_private.clock_now();token text;
begin
 insert into icash_voice_meter_private.worker_state values(1,t) on conflict(id) do update set last_claim_at=excluded.last_claim_at;
 -- Recover only stale, database-proven never-claimed outbound admissions.
 -- Claimed/unknown calls retain their commitment regardless of lease age.
 perform icash_voice_meter_private.recover_unstarted(20);
 -- Disabling new admissions must not stop maintenance of an existing meter.
 for candidate in select value from jsonb_array_elements(public.icash_voice_meter_due(20)) loop
  if coalesce(candidate->>'callSid','') !~ '^CA[0-9a-fA-F]{32}$' then continue;end if;
  select * into m from icash_voice_meter_private.meters where operation_key=candidate->>'operationKey'
   and state in ('active','stopping') and next_check_at<=t for update skip locked;
  if not found then continue;end if;
  if exists(select 1 from icash_voice_meter_private.tickets where operation_key=m.operation_key and consumed_at is null and expires_at>t) then continue;end if;
  token:=gen_random_uuid()::text||gen_random_uuid()::text;
  insert into icash_voice_meter_private.tickets values(encode(sha256(convert_to(token,'UTF8')),'hex'),m.operation_key,t,t+interval '30 seconds',null);
  -- Expiry schedules a NEW claim, never releases funded exposure or redials.
  update icash_voice_meter_private.meters set next_check_at=t+interval '30 seconds' where operation_key=m.operation_key;
  return jsonb_build_object('token',token);
 end loop;
 return null;
end $$;
create function public.icash_consume_voice_metering(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket icash_voice_meter_private.tickets;m icash_voice_meter_private.meters;t timestamptz:=icash_voice_meter_private.clock_now();call_id text;
begin
 if coalesce(p_token,'') !~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){2}$' then return null;end if;
 update icash_voice_meter_private.tickets set consumed_at=t
 where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and consumed_at is null and expires_at>t returning * into ticket;
 if not found then return null;end if;
 select * into m from icash_voice_meter_private.meters where operation_key=ticket.operation_key and state in ('active','stopping');
 if not found then return null;end if;
 call_id:=coalesce(m.call_sid,case when m.session_kind='outbound' then
  (select r.call_sid from public.icash_call_recordings r where r.id=m.session_id and r.account_id=m.account_id and r.operation_key=m.operation_key)
  else (select r.call_sid from icash_recorded_reception_private.sessions r where r.id=m.session_id and r.account_id=m.account_id and r.operation_key=m.operation_key) end);
 if call_id is null then return null;end if;
 return jsonb_build_object('meter',icash_voice_meter_private.json(m)||jsonb_build_object('callSid',call_id));
end $$;
revoke all on function public.icash_next_voice_metering(),public.icash_consume_voice_metering(text) from public,anon,authenticated;
grant execute on function public.icash_next_voice_metering(),public.icash_consume_voice_metering(text) to service_role;
commit;
