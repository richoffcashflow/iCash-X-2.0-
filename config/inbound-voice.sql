-- Service-only inbound routing. No route is enabled by this migration.
create table public.icash_inbound_voice_routes(
 called_number text primary key check(called_number ~ '^\+1[2-9][0-9]{9}$'),
 business_number text not null check(business_number ~ '^\+1[2-9][0-9]{9}$'),
 agent_id text not null check(agent_id ~ '^agent_[A-Za-z0-9]+$'),
 rate_id uuid not null references public.icash_operation_rates(id),
 max_duration_seconds integer not null default 600 check(max_duration_seconds between 60 and 900),
 enabled boolean not null default false,reviewed_until timestamptz not null
);
create table public.icash_inbound_voice_receipts(
 call_sid text primary key check(call_sid ~ '^CA[a-fA-F0-9]{32}$'),
 conversation_id text not null unique,binding_hash text not null check(binding_hash ~ '^[a-f0-9]{64}$'),
 live_call_id uuid not null unique references public.icash_live_conversations(id),
 max_duration_seconds integer not null,created_at timestamptz not null default now()
);
create index if not exists icash_contact_permissions_phone_route on public.icash_contact_permissions(phone,account_id,screening_id);
alter table public.icash_inbound_voice_routes enable row level security;
alter table public.icash_inbound_voice_receipts enable row level security;
revoke all on public.icash_inbound_voice_routes,public.icash_inbound_voice_receipts from public,anon,authenticated;
grant all on public.icash_inbound_voice_routes,public.icash_inbound_voice_receipts to service_role;

create or replace function public.icash_validate_live_binding() returns trigger
language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.icash_screening_jobs where id=new.screening_id and account_id=new.account_id) then raise exception 'Tenant mismatch';end if;
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id where o.operation_key=new.operation_key and o.account_id=new.account_id and o.state='dispatched' and r.operation in ('seller_call','buyer_call','incoming_call')) then raise exception 'Dispatched call required';end if;
 if exists(select 1 from public.icash_voice_test_sessions where conversation_id=new.conversation_id) or exists(select 1 from public.icash_voice_test_config where agent_id=new.agent_id) then raise exception 'Practice is not live';end if;
 return new;
end $$;

create function public.icash_begin_inbound_voice(p_caller text,p_called text,p_agent text,p_call_sid text,p_conversation text,p_binding_hash text,p_token_hash text,p_agent_hash text)
returns jsonb language plpgsql set search_path='' as $$
declare route public.icash_inbound_voice_routes;receipt public.icash_inbound_voice_receipts;p public.icash_contact_permissions;
 cfg public.icash_voice_configs;rate public.icash_operation_rates;choices jsonb;candidate jsonb;call_id uuid;op text;duration integer;
begin
 if p_caller is null or p_caller !~ '^\+1[2-9][0-9]{9}$' or p_called is null or p_called !~ '^\+1[2-9][0-9]{9}$'
 or p_agent is null or p_agent !~ '^agent_[A-Za-z0-9]+$' or p_call_sid is null or p_call_sid !~ '^CA[a-fA-F0-9]{32}$'
 or p_conversation is null or p_conversation !~ '^conv_[A-Za-z0-9]+$' or p_binding_hash is null or p_binding_hash !~ '^[a-f0-9]{64}$'
 or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then return null;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into route from public.icash_inbound_voice_routes where called_number=p_called and enabled and agent_id=p_agent and reviewed_until>now() for share;
 if not found then return null;end if;
 select * into receipt from public.icash_inbound_voice_receipts where call_sid=p_call_sid;
 if found then
  if receipt.binding_hash<>p_binding_hash or receipt.conversation_id<>p_conversation or not exists(select 1 from public.icash_live_conversations c join public.icash_accounts a on a.id=c.account_id where c.id=receipt.live_call_id and c.state='waiting' and c.tool_token_hash=p_token_hash and c.tool_expires_at>now() and not a.bot_paused and exists(select 1 from public.icash_voice_configs v where v.account_id=c.account_id and v.agent_id=p_agent and v.enabled and v.reviewed_until>now() and v.agent_config_hash=p_agent_hash)) then return null;end if;
  return jsonb_build_object('maxSeconds',receipt.max_duration_seconds);
 end if;
 -- Count ALL matching live deal bindings before eligibility filtering: never pick an arbitrary tenant.
 select jsonb_agg(to_jsonb(x)) into choices from (
  select distinct cp.account_id,cp.screening_id,cp.party from public.icash_contact_permissions cp
  join public.icash_deal_files d on d.account_id=cp.account_id and d.screening_id=cp.screening_id
  join public.icash_text_threads t on t.account_id=d.account_id and t.deal_id=d.id and t.recipient=cp.phone
  where cp.phone=p_caller and t.sender=route.business_number and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
  limit 2
 ) x;
 if coalesce(jsonb_array_length(choices),0)<>1 then return null;end if;
 candidate:=choices->0;
 select * into p from public.icash_contact_permissions where account_id=(candidate->>'account_id')::uuid and screening_id=(candidate->>'screening_id')::uuid and party=candidate->>'party' and phone=p_caller and revoked_at is null and permission_until>now() limit 1 for share;
 if not found then return null;end if;
 select * into cfg from public.icash_voice_configs where account_id=p.account_id and enabled and agent_id=p_agent and reviewed_until>now() and agent_config_hash=p_agent_hash for share;
 if not found then return null;end if;
 if exists(select 1 from public.icash_voice_test_config where agent_id=p_agent) or exists(select 1 from public.icash_voice_test_sessions where conversation_id=p_conversation) then return null;end if;
 perform 1 from public.icash_accounts where id=p.account_id and not bot_paused for update;
 if not found then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(p.contact_key,17));
 if exists(select 1 from public.icash_contact_suppressions where contact_key=p.contact_key) or exists(select 1 from public.icash_text_suppressions where phone=p_caller) then return null;end if;
 if exists(select 1 from public.icash_live_conversations where state in ('waiting','review') and (account_id=p.account_id or contact_key=p.contact_key)) then return null;end if;
 if exists(select 1 from public.icash_voice_jobs j join public.icash_contact_permissions cp on cp.id=j.permission_id where (j.account_id=p.account_id or cp.contact_key=p.contact_key) and (j.state='dispatching' or (j.state='held' and j.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')))) then return null;end if;
 if exists(select 1 from public.icash_property_controls c join public.icash_screening_jobs s on s.snapshot->>'propertyId'=c.property_id and s.account_id=c.account_id where s.id=p.screening_id and s.account_id=p.account_id and c.manual) then return null;end if;
 duration:=least(route.max_duration_seconds,cfg.max_duration_seconds);
 select * into rate from public.icash_operation_rates where id=route.rate_id and operation='incoming_call' and enabled and expires_at>now() and voice_max_duration_seconds>=duration;
 if not found then return null;end if;
 op:='inbound:'||p_call_sid;
 perform public.icash_reserve_operation(p.account_id,op,rate.id,least(p.permission_until,cfg.reviewed_until,route.reviewed_until));
 if not public.icash_claim_operation(op) then raise exception 'Incoming call spend not authorized';end if;
 insert into public.icash_live_conversations(account_id,screening_id,party,agent_id,conversation_id,operation_key,contact_key,strategy_key,tool_token_hash,tool_expires_at)
 values(p.account_id,p.screening_id,p.party,p_agent,p_conversation,op,p.contact_key,case when p.party='buyer' then 'buyer_followup' else 'cash_interest' end,p_token_hash,now()+(duration+120)*interval '1 second') returning id into call_id;
 insert into public.icash_inbound_voice_receipts(call_sid,conversation_id,binding_hash,live_call_id,max_duration_seconds) values(p_call_sid,p_conversation,p_binding_hash,call_id,duration);
 return jsonb_build_object('maxSeconds',duration);
end $$;
revoke all on function public.icash_begin_inbound_voice(text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_begin_inbound_voice(text,text,text,text,text,text,text,text) to service_role;
