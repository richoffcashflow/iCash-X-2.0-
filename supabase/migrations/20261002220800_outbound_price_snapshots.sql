-- Disabled by absence of reviewed enabled policy. No existing financial functions altered.
create table public.icash_outbound_price_snapshots (
 operation_key text primary key references public.icash_operation_spend(operation_key),
 account_id uuid not null references public.icash_accounts(id),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<16384),
 created_at timestamptz not null default now()
);
alter table public.icash_outbound_price_snapshots enable row level security;
revoke all on public.icash_outbound_price_snapshots from public,anon,authenticated,service_role;
grant select on public.icash_outbound_price_snapshots to service_role;
create function public.icash_record_outbound_price_snapshot(p_operation text,p_account uuid,p_snapshot jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.icash_operation_spend o join public.icash_live_conversations c on c.operation_key=o.operation_key and c.account_id=o.account_id where o.operation_key=p_operation and o.account_id=p_account and o.state='dispatched' and c.state='complete' and c.conversation_id=p_snapshot->>'conversationId' and c.agent_id=p_snapshot->>'agentId' and c.contact_key=p_snapshot->>'destinationHash') then raise exception 'Unbound outbound snapshot';end if;
 -- First writer wins. Caller rereads the canonical immutable snapshot and validates all bindings.
 insert into public.icash_outbound_price_snapshots(operation_key,account_id,snapshot) values(p_operation,p_account,p_snapshot) on conflict(operation_key) do nothing;
end $$;
revoke all on function public.icash_record_outbound_price_snapshot(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_record_outbound_price_snapshot(text,uuid,jsonb) to service_role;
