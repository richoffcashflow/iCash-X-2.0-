begin;
-- Confirm ended carrier sessions independently of delayed prices. Financial
-- reservations remain fully held; no old receipt, approval or charge is changed.
create table icash_reception_private.terminal_attestations (
 receipt_id uuid primary key references icash_reception_private.receipts(receipt_id),
 account_id uuid not null references public.icash_accounts(id),
 call_sid text not null,conversation_id text not null,branch_id text not null,version_id text not null,
 carrier_receipt_hash text not null check(carrier_receipt_hash ~ '^[a-f0-9]{64}$'),
 ai_receipt_hash text not null check(ai_receipt_hash ~ '^[a-f0-9]{64}$'),
 observed_at timestamptz not null default now()
);
alter table icash_reception_private.terminal_attestations enable row level security;
revoke all on icash_reception_private.terminal_attestations from public,anon,authenticated,service_role;
create trigger reception_terminal_immutable before update or delete on icash_reception_private.terminal_attestations for each row execute function icash_recorded_reception_private.immutable();
create trigger reception_terminal_no_truncate before truncate on icash_reception_private.terminal_attestations for each statement execute function icash_recorded_reception_private.immutable();
create function public.icash_attest_reception_terminal(p_account uuid,p_user uuid,p_evidence jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r icash_reception_private.receipts;c icash_reception_private.config;
begin
 select * into c from icash_reception_private.config where id=1 and account_id=p_account and owner_user_id=p_user for update;
 if not found or not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then return false;end if;
 if p_evidence is null or jsonb_typeof(p_evidence)<>'object' or p_evidence->'terminal' is distinct from 'true'::jsonb then return false;end if;
 select * into r from icash_reception_private.receipts where receipt_id::text=p_evidence->>'receiptId' and account_id=p_account for update;
 if not found or r.state<>'completed' or r.terminal_at is null or r.conversation_id is null
  or row(r.call_sid,r.called_number,r.caller_hash,r.conversation_id,r.branch_id,r.reviewed_version_id)
    is distinct from row(p_evidence->>'callSid',p_evidence->>'calledNumber',p_evidence->>'callerHash',p_evidence->>'conversationId',p_evidence->>'branchId',p_evidence->>'versionId')
  or encode(sha256(convert_to(r.receipt_nonce,'UTF8')),'hex') is distinct from p_evidence->>'nonceHash'
  or coalesce(p_evidence->>'providerAccountSid','') !~ '^AC[0-9a-fA-F]{32}$'
  or coalesce(p_evidence->>'twilioReceiptHash','') !~ '^[a-f0-9]{64}$' or coalesce(p_evidence->>'elevenLabsReceiptHash','') !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(p_evidence->'carrierSeconds') is distinct from 'number' or jsonb_typeof(p_evidence->'durationSeconds') is distinct from 'number'
  or (p_evidence->>'carrierSeconds')::numeric not between 0 and r.max_duration_seconds+60
  or (p_evidence->>'durationSeconds')::numeric not between 0 and r.max_duration_seconds+2 then return false;end if;
 insert into icash_reception_private.terminal_attestations(receipt_id,account_id,call_sid,conversation_id,branch_id,version_id,carrier_receipt_hash,ai_receipt_hash)
 values(r.receipt_id,r.account_id,r.call_sid,r.conversation_id,r.branch_id,r.reviewed_version_id,p_evidence->>'twilioReceiptHash',p_evidence->>'elevenLabsReceiptHash') on conflict(receipt_id) do nothing;
 return true;
end $$;
revoke all on function public.icash_attest_reception_terminal(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_attest_reception_terminal(uuid,uuid,jsonb) to service_role;

create function icash_recorded_reception_private.legacy_calls_pending() returns boolean language sql stable set search_path='' as $$
 select exists(
  select 1 from icash_reception_private.receipts r
  left join public.icash_operation_spend o on o.operation_key=to_jsonb(r)->>'operation_key'
  where r.state='reserved' or o.state='reserved' or (o.state='dispatched' and not (
   r.state='completed' and r.terminal_at is not null and exists(
    select 1 from icash_reception_private.terminal_attestations t
    join public.icash_credit_reservations cr on cr.id=o.credit_reservation_id
    where t.receipt_id=r.receipt_id and t.account_id=r.account_id and t.call_sid=r.call_sid
     and t.conversation_id=r.conversation_id and t.branch_id=r.branch_id and t.version_id=r.reviewed_version_id
     and o.account_id=r.account_id and cr.account_id=r.account_id and cr.operation_key=o.operation_key
     and cr.status='reserved' and cr.amount_cents=o.charge_cap_cents
   )
  ))
 );
$$;
revoke all on function icash_recorded_reception_private.legacy_calls_pending() from public,anon,authenticated,service_role;

create or replace function icash_recorded_reception_private.guard_config() returns trigger language plpgsql set search_path='' as $$
declare r public.icash_operation_rates;p icash_recorded_reception_private.cost_policies;
begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Versioned reception configuration cannot be removed';end if;
 if tg_op='UPDATE' and (to_jsonb(new)-'enabled') is distinct from (to_jsonb(old)-'enabled') then raise exception 'Versioned reception approval is immutable';end if;
 perform 1 from icash_reception_private.config where id=1 for update;
 if not found then raise exception 'Historical reception coordination row required';end if;
 if new.enabled then
  if exists(select 1 from icash_reception_private.config where enabled)
   or icash_recorded_reception_private.legacy_calls_pending() then raise exception 'Historical reception must be disabled and drained';end if;
  if exists(select 1 from icash_recorded_reception_private.sessions where config_id<>new.id and call_ended_at is null) then raise exception 'Previous recorded reception must be drained';end if;
 end if;
 if new.cost_policy_id is not null then
  select * into p from icash_recorded_reception_private.cost_policies where id=new.cost_policy_id for share;
  if not found or p.account_id<>new.account_id or p.rate_id<>new.rate_id or to_jsonb(p)-'enabled' is distinct from new.cost_policy_snapshot
   or p.rate_snapshot is distinct from new.rate_snapshot or p.approved_at>new.approved_at or p.reviewed_until<new.reviewed_until
   or p.components->'other'->'pricingPolicy' is distinct from new.pricing_policy or (new.enabled and not p.enabled) then raise exception 'Exact standing policy approval required';end if;
 end if;
 if tg_op='INSERT' or new.enabled then
  select * into r from public.icash_operation_rates where id=new.rate_id for share;
  if not found or r.version not like 'recorded-reception-30d-speech-v1:%'
   or not icash_recorded_reception_private.micros(r.costs_micros->'other')
   or (r.costs_micros->>'other')::numeric < 20000+ceil(new.max_total_seconds::numeric/60)*4400+(new.max_total_seconds/60)*3100
   or r.operation<>'incoming_call' or r.voice_max_duration_seconds is distinct from new.max_total_seconds
   or r.charge_cents<>new.charge_cap_cents or icash_recorded_reception_private.rate_binding(r) is distinct from new.rate_snapshot
   or not isfinite(r.verified_at) or not isfinite(r.expires_at) or r.verified_at>new.approved_at
   or r.expires_at<new.reviewed_until then raise exception 'Exact reviewed incoming rate snapshot required';end if;
 end if;
 return new;
end $$;

create or replace function public.icash_reserve_recorded_reception(p_config_id uuid,p_call_sid text,p_provider_account_sid text,p_from_phone text,p_to_phone text,p_direction text,p_caller_hash text,p_nonce_hash text,p_stop_token_hash text,p_config_hash text,p_version_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c icash_recorded_reception_private.configs;s icash_recorded_reception_private.sessions;r public.icash_operation_rates;o public.icash_operation_spend;b public.icash_operating_budget;t timestamptz;op text;planned numeric;p icash_recorded_reception_private.cost_policies;
begin
 if coalesce(p_call_sid,'') !~ '^CA[0-9a-fA-F]{32}$' or coalesce(p_provider_account_sid,'') !~ '^AC[0-9a-fA-F]{32}$'
  or (coalesce(p_from_phone,'') !~ '^\+[1-9][0-9]{7,14}$' and coalesce(p_from_phone,'') not in ('anonymous','restricted','unknown')) or coalesce(p_to_phone,'') !~ '^\+[1-9][0-9]{7,14}$' or p_direction is distinct from 'inbound'
  or coalesce(p_caller_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_nonce_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_stop_token_hash,'') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('allowed',false,'reason','invalid_input');end if;
 -- Lock this version BEFORE the shared historical lane, matching config
 -- UPDATE's row lock then guard lock. Financial locks remain unchanged.
 select * into c from icash_recorded_reception_private.configs where id=p_config_id for update;
 if not found or not c.enabled then return jsonb_build_object('allowed',false,'reason','disabled');end if;
 perform 1 from icash_reception_private.config where id=1 for update;
 if not found or exists(select 1 from icash_reception_private.config where enabled) or icash_recorded_reception_private.legacy_calls_pending() then return jsonb_build_object('allowed',false,'reason','legacy_lane_not_drained');end if;
 if row(c.called_number,c.provider_account_sid,c.config_hash,c.version_id) is distinct from row(p_to_phone,p_provider_account_sid,p_config_hash,p_version_id) then return jsonb_build_object('allowed',false,'reason','config_changed');end if;
 if c.call_profile='owner_quick_test' and c.owner_caller_hash is distinct from p_caller_hash then return jsonb_build_object('allowed',false,'reason','caller_not_authorized');end if;
 if exists(select 1 from icash_recorded_reception_private.sessions where lower(call_sid)=lower(p_call_sid)) or exists(select 1 from icash_reception_private.receipts where lower(call_sid)=lower(p_call_sid)) then return jsonb_build_object('allowed',false,'reason','duplicate_call');end if;
 if exists(select 1 from icash_recorded_reception_private.sessions where nonce_hash=p_nonce_hash or stop_token_hash=p_stop_token_hash) then return jsonb_build_object('allowed',false,'reason','duplicate_nonce');end if;
 if exists(select 1 from icash_recorded_reception_private.sessions where call_ended_at is null) then return jsonb_build_object('allowed',false,'reason','concurrency_limit');end if;
 select * into b from public.icash_operating_budget where id=1 for update;
 if not found or not b.enabled or b.require_company_reserve then return jsonb_build_object('allowed',false,'reason','spending_disabled');end if;
 perform 1 from public.icash_accounts where id=c.account_id and owner_user_id=c.owner_user_id and not bot_paused for update;
 if not found then return jsonb_build_object('allowed',false,'reason','account_paused_or_changed');end if;
 perform 1 from public.icash_wallets where account_id=c.account_id for update;
 if not found then return jsonb_build_object('allowed',false,'reason','wallet_missing');end if;
 select * into r from public.icash_operation_rates where id=c.rate_id for share;t:=icash_recorded_reception_private.clock_now();
 if c.cost_policy_id is not null then
  select * into p from icash_recorded_reception_private.cost_policies where id=c.cost_policy_id for share;
  t:=icash_recorded_reception_private.clock_now();
  if not found or not p.enabled or to_jsonb(p)-'enabled' is distinct from c.cost_policy_snapshot
   or p.approved_at>t or p.reviewed_until<t+make_interval(secs=>c.max_total_seconds+60)
   or p.standard_cost_multiplier is distinct from b.standard_cost_multiplier or p.elevenlabs_cost_multiplier is distinct from b.elevenlabs_cost_multiplier then return jsonb_build_object('allowed',false,'reason','cost_policy_unavailable');end if;
 end if;
 if c.approved_at>t or c.reviewed_until<t+make_interval(secs=>c.max_total_seconds+60) then return jsonb_build_object('allowed',false,'reason','outside_review');end if;
 if not r.enabled or icash_recorded_reception_private.rate_binding(r) is distinct from c.rate_snapshot or r.operation<>'incoming_call'
  or r.verified_at>t or r.expires_at<t+make_interval(secs=>c.max_total_seconds+60) then return jsonb_build_object('allowed',false,'reason','rate_unavailable');end if;
 if ((select count(*) from icash_recorded_reception_private.sessions where caller_hash=p_caller_hash and created_at>t-make_interval(secs=>c.caller_window_seconds))+(select count(*) from icash_reception_private.receipts where caller_hash=p_caller_hash and reserved_at>t-make_interval(secs=>c.caller_window_seconds)))>=c.caller_max_calls then return jsonb_build_object('allowed',false,'reason','caller_throttled');end if;
 op:='recorded-reception:'||p_call_sid;
 if exists(select 1 from public.icash_operation_spend where lower(operation_key)=lower(op)) or exists(select 1 from public.icash_credit_reservations where lower(operation_key)=lower(op)) then return jsonb_build_object('allowed',false,'reason','operation_conflict');end if;
 begin
  perform public.icash_reserve_operation(c.account_id,op,c.rate_id,least(c.reviewed_until,r.expires_at));
  select * into strict o from public.icash_operation_spend where operation_key=op for update;
  select ceil(sum(value::text::numeric)*(10000+r.buffer_bps)/10000) into planned from jsonb_each(r.costs_micros);
  if o.account_id<>c.account_id or o.rate_id<>c.rate_id or o.state<>'reserved' or o.charge_cap_cents<>c.charge_cap_cents or o.reserved_micros<>planned
   or o.customer_price_micros is not null
   or (c.cost_policy_id is not null and row(o.standard_cost_multiplier,o.elevenlabs_cost_multiplier) is distinct from row(p.standard_cost_multiplier,p.elevenlabs_cost_multiplier))
   or not exists(select 1 from public.icash_credit_reservations cr where cr.id=o.credit_reservation_id and cr.account_id=c.account_id and cr.operation_key=op and cr.status='reserved' and cr.amount_cents=c.charge_cap_cents) then raise exception 'Exact customer reserve required';end if;
  if not public.icash_claim_operation(op) then raise exception 'Recorded reception claim denied';end if;
  select * into strict o from public.icash_operation_spend where operation_key=op;
  if o.state<>'dispatched' then raise exception 'Dispatched operation required';end if;
  t:=icash_recorded_reception_private.clock_now();
  if t+make_interval(secs=>c.max_total_seconds+60)>least(c.reviewed_until,r.expires_at) then raise exception 'Review expired during admission';end if;
  insert into icash_recorded_reception_private.sessions(cost_policy_id,cost_policy_snapshot,configuration,config_id,account_id,operation_key,provider_account_sid,call_sid,direction,from_phone,to_phone,caller_hash,contact_key,config_hash,agent_id,branch_id,version_id,call_profile,rate_id,rate_snapshot,reserved_micros,charge_cap_cents,max_total_seconds,standard_cost_multiplier,elevenlabs_cost_multiplier,nonce_hash,stop_token_hash,disclosure_version,pricing_policy,created_at,updated_at,call_deadline_at,consent_deadline_at,next_reconcile_at)
  values(c.cost_policy_id,c.cost_policy_snapshot,icash_recorded_reception_private.config_json(c),c.id,c.account_id,op,p_provider_account_sid,p_call_sid,p_direction,p_from_phone,p_to_phone,p_caller_hash,encode(sha256(convert_to(p_from_phone,'UTF8')),'hex'),c.config_hash,c.agent_id,c.branch_id,c.version_id,c.call_profile,c.rate_id,c.rate_snapshot,o.reserved_micros,c.charge_cap_cents,c.max_total_seconds,o.standard_cost_multiplier,o.elevenlabs_cost_multiplier,p_nonce_hash,p_stop_token_hash,c.disclosure_version,c.pricing_policy,t,t,t+interval '60 seconds',t+interval '60 seconds',t+interval '30 seconds') returning * into s;
 exception when raise_exception or check_violation or unique_violation or no_data_found then return jsonb_build_object('allowed',false,'reason','customer_funding_denied');end;
 return jsonb_build_object('allowed',true,'reason','reserved','session',to_jsonb(s));
end $$;

commit;
