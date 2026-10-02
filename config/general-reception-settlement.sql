begin;
-- LOCAL REVIEW CANDIDATE. Apply after general-reception-customer-funding.sql,
-- voice-usage-settlement.sql, customer-funded-margins.sql and fractional billing.
-- This migration installs a bridge only. It approves no costs, debits no wallet,
-- releases no reserve, enables no lane, changes no cap/rate/budget/pause setting.
-- A trusted database-owner review is required separately for EACH receipt.
-- No application/service-role API can manufacture or change that approval.

create table icash_reception_private.cost_reviews (
 operation_key text primary key references public.icash_operation_spend(operation_key),
 receipt_id uuid not null unique references icash_reception_private.receipts(receipt_id),
 attestation jsonb not null,
 components jsonb not null,
 evidence_ref text not null check(length(btrim(evidence_ref)) between 10 and 2000),
 reviewed_by text not null check(length(btrim(reviewed_by)) between 3 and 200),
 reviewed_at timestamptz not null default clock_timestamp() check(isfinite(reviewed_at))
);
alter table icash_reception_private.cost_reviews enable row level security;
revoke all on icash_reception_private.cost_reviews from public,anon,authenticated,service_role;

create function icash_reception_private.validate_cost_review(p_operation text,p_attestation jsonb,p_components jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare r icash_reception_private.receipts; binding jsonb; cat text; part jsonb; n numeric; total numeric:=0; basis text:='verified'; duration numeric;
begin
 select * into r from icash_reception_private.receipts where operation_key=p_operation;
 if not found or r.state not in ('completed','failed') or r.conversation_id is null then raise exception 'Terminal bound reception receipt required';end if;
 binding:=jsonb_build_object('receiptId',r.receipt_id,'operationKey',r.operation_key,'accountId',r.account_id,
  'callSid',r.call_sid,'receiptNonce',r.receipt_nonce,'configHash',r.config_hash,'agentId',r.agent_id,
  'branchId',r.branch_id,'versionId',r.reviewed_version_id,'conversationId',r.conversation_id,
  'callProfile',r.call_profile,'rateId',r.rate_id,'maxDurationSeconds',r.max_duration_seconds,'customerChargeCapCents',r.customer_charge_cap_cents);
 if jsonb_typeof(p_attestation) is distinct from 'object' then raise exception 'Provider attestation required';end if;
 if (select count(*) from jsonb_object_keys(p_attestation))<>4 or p_attestation->'schemaVersion' is distinct from '1'::jsonb
  or p_attestation->'binding' is distinct from binding or jsonb_typeof(p_attestation->'durationSeconds') is distinct from 'number'
  or jsonb_typeof(p_attestation->'providers') is distinct from 'object' then raise exception 'Receipt attestation binding mismatch';end if;
 duration:=(p_attestation->>'durationSeconds')::numeric;
 if duration<0 or duration>r.max_duration_seconds+2 then raise exception 'Duration requires separate review';end if;
 if (select count(*) from jsonb_object_keys(p_attestation->'providers'))<>2 then raise exception 'Both provider receipts required';end if;
 foreach cat in array array['twilio','elevenlabs'] loop
  part:=p_attestation->'providers'->cat;
  if jsonb_typeof(part) is distinct from 'object' then raise exception 'Provider receipt missing';end if;
  if (select count(*) from jsonb_object_keys(part))<>3 or part->>'currency' is distinct from 'USD'
   or jsonb_typeof(part->'amountMicros') is distinct from 'number'
   or jsonb_typeof(part->'receiptHash') is distinct from 'string'
   or (part->>'receiptHash') !~ '^[a-f0-9]{64}$' then raise exception 'Verified USD receipt required';end if;
  n:=(part->>'amountMicros')::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid provider cost';end if;
 end loop;
 if jsonb_typeof(p_components) is distinct from 'object' then raise exception 'Complete reviewed costs required';end if;
 if (select count(*) from jsonb_object_keys(p_components))<>16 then raise exception 'All 16 cost categories required';end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  part:=p_components->cat;
  if jsonb_typeof(part->'amountMicros') is distinct from 'number' or jsonb_typeof(part->'evidenceRef') is distinct from 'string'
   or length(btrim(part->>'evidenceRef')) not between 10 and 2000 or (part->>'basis') is null
   or (part->>'basis') not in ('verified','estimated') then raise exception 'Reviewed cost and basis required: %',cat;end if;
  n:=(part->>'amountMicros')::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid reviewed cost';end if;
  total:=total+n;
  if part->>'basis'='estimated' then basis:='estimated';end if;
 end loop;
 if total>9007199254740991 then raise exception 'Cost total out of range';end if;
 foreach cat in array array['twilio','elevenlabs'] loop
  if p_components->cat->>'basis' is distinct from 'verified'
   or p_components->cat->'amountMicros' is distinct from p_attestation->'providers'->cat->'amountMicros'
   then raise exception 'Actual provider receipt does not match manifest';end if;
 end loop;
 -- Inclusive ElevenLabs receipt: no double-counting a model allocation.
 if p_components->'llm'->'amountMicros' is distinct from '0'::jsonb or p_components->'llm'->>'basis' is distinct from 'verified' then raise exception 'Inclusive ElevenLabs model cost required';end if;
 return basis;
end $$;

create function icash_reception_private.guard_cost_review()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP<>'INSERT' then raise exception 'Reception cost review is immutable';end if;
 if not exists(select 1 from icash_reception_private.receipts r where r.operation_key=new.operation_key and r.receipt_id=new.receipt_id
  and r.terminal_at<=new.reviewed_at and new.reviewed_at<=clock_timestamp()) then raise exception 'Reviewed receipt or time mismatch';end if;
 perform icash_reception_private.validate_cost_review(new.operation_key,new.attestation,new.components);
 return new;
end $$;
create trigger reception_cost_review_guard before insert or update or delete on icash_reception_private.cost_reviews
 for each row execute function icash_reception_private.guard_cost_review();
create trigger reception_cost_review_no_truncate before truncate on icash_reception_private.cost_reviews
 for each statement execute function icash_reception_private.guard_cost_review();

-- Confirm a previous atomic settlement without depending on provider response
-- stability or availability. This exposes only financial outcome, no receipt PII.
create function public.icash_get_general_reception_settlement(p_operation text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('settled',true,'chargedCents',o.charged_cents,'costBasis',o.cost_basis,
  'providerMarginVerified',o.cost_basis='verified' and public.icash_account_margin_ok(r.account_id,0,0,false))
 from icash_reception_private.receipts r
 join icash_reception_private.cost_reviews v on v.operation_key=r.operation_key and v.receipt_id=r.receipt_id
 join public.icash_operation_spend o on o.operation_key=r.operation_key and o.account_id=r.account_id
 join public.icash_cost_manifests m on m.operation_key=o.operation_key
 join public.icash_credit_reservations cr on cr.id=o.credit_reservation_id and cr.operation_key=o.operation_key and cr.account_id=o.account_id
 where r.operation_key=p_operation and r.state in ('completed','failed') and o.state='settled'
  and o.cost_basis in ('verified','estimated') and o.charged_cents between 0 and r.customer_charge_cap_cents
  and m.components=v.components and m.evidence_ref=v.evidence_ref and o.settlement_evidence=v.evidence_ref
  and m.charge_cents=o.charged_cents and m.actual_micros=o.actual_micros
  and ((o.charged_cents=0 and cr.status='released') or (o.charged_cents>0 and cr.status='settled' and cr.settled_cents=o.charged_cents));
$$;

-- The only mutation allowed to the collector is settling an already reviewed,
-- exactly matching receipt. Caller provides no price, category costs or approval.
create function public.icash_settle_general_reception(p_operation text,p_attestation jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r icash_reception_private.receipts; review icash_reception_private.cost_reviews; o public.icash_operation_spend;
 rate public.icash_operation_rates; cr public.icash_credit_reservations; total numeric; required numeric; charge bigint; basis text; prior public.icash_cost_manifests;
begin
 -- Global ledger lock FIRST, matching all reserve/settlement paths. Do not take
 -- config/receipt locks here: terminal receipt and review are immutable, and
 -- reception admission takes config before budget. This avoids reversing order.
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.state not in ('dispatched','settled') then return jsonb_build_object('settled',false,'reason','operation_not_dispatched');end if;
 select * into r from icash_reception_private.receipts where operation_key=p_operation;
 if not found or r.state not in ('completed','failed') then return jsonb_build_object('settled',false,'reason','receipt_not_terminal');end if;
 select * into review from icash_reception_private.cost_reviews where operation_key=p_operation and receipt_id=r.receipt_id;
 if not found then return jsonb_build_object('settled',false,'reason','cost_review_required');end if;
 if p_attestation is distinct from review.attestation then return jsonb_build_object('settled',case when o.state='settled' then null::boolean else false end,'reason',case when o.state='settled' then 'settlement_status_unconfirmed' else 'cost_review_mismatch' end);end if;
 basis:=icash_reception_private.validate_cost_review(p_operation,p_attestation,review.components);
 select * into rate from public.icash_operation_rates where id=o.rate_id;
 select * into cr from public.icash_credit_reservations where id=o.credit_reservation_id;
 if r.operation_key is distinct from 'reception:'||r.call_sid or o.account_id is distinct from r.account_id
  or o.rate_id is distinct from r.rate_id or rate.operation is distinct from 'incoming_call'
  or o.charge_cap_cents is distinct from r.customer_charge_cap_cents or o.reserved_micros is distinct from r.reserved_usd_micros
  or o.customer_price_micros is not null or cr.operation_key is distinct from o.operation_key or cr.account_id is distinct from r.account_id
  or cr.amount_cents is distinct from r.customer_charge_cap_cents
  or (o.state='dispatched' and cr.status is distinct from 'reserved')
  or (r.call_profile='owner_quick_test' and (r.customer_charge_cap_cents<>65 or r.max_duration_seconds<>60 or r.rate_id<>'f93ace00-83fc-4d09-a37c-6d9d9f0a38f0'::uuid))
  or (r.call_profile='normal' and (r.customer_charge_cap_cents<>430 or r.max_duration_seconds<>600 or r.rate_id<>'e827a7c9-8648-4999-885c-f136fd07100e'::uuid))
  or r.call_profile not in ('normal','owner_quick_test') then return jsonb_build_object('settled',false,'reason','reservation_mismatch');end if;
 if o.standard_cost_multiplier is null or o.elevenlabs_cost_multiplier is null
  or o.standard_cost_multiplier<1 or o.elevenlabs_cost_multiplier<1
  or o.standard_cost_multiplier::text in ('NaN','Infinity','-Infinity')
  or o.elevenlabs_cost_multiplier::text in ('NaN','Infinity','-Infinity') then raise exception 'Reviewed price multipliers required';end if;
 select sum((value->>'amountMicros')::numeric) into total from jsonb_each(review.components);
 required:=total*o.standard_cost_multiplier-(review.components->'elevenlabs'->>'amountMicros')::numeric*(o.standard_cost_multiplier-o.elevenlabs_cost_multiplier);
 -- Compare numeric before bigint cast. Never clamp above-cap usage and never
 -- zero it out: preserve the hold for additional review, without increasing cap.
 if required>r.customer_charge_cap_cents::numeric*10000 then return jsonb_build_object('settled',false,'reason','charge_exceeds_cap');end if;
 charge:=ceil(required/10000)::bigint;
 perform public.icash_settle_complete_costs(p_operation,charge,review.components,review.evidence_ref);
 -- A settled retry must match exactly; the existing ledger/manifest RPC enforces
 -- this as well. Check its final result before claiming any financial success.
 select * into strict o from public.icash_operation_spend where operation_key=p_operation;
 select * into strict prior from public.icash_cost_manifests where operation_key=p_operation;
 if o.state<>'settled' or o.charged_cents<>charge or o.actual_micros<>total
  or prior.components is distinct from review.components or prior.evidence_ref is distinct from review.evidence_ref then raise exception 'Settlement result mismatch';end if;
 update public.icash_operation_spend set cost_basis=basis where operation_key=p_operation;
 return jsonb_build_object('settled',true,'chargedCents',charge,'costBasis',basis,
  'providerMarginVerified',basis='verified' and public.icash_account_margin_ok(r.account_id,0,0,false));
end $$;
revoke all on function icash_reception_private.validate_cost_review(text,jsonb,jsonb),
 icash_reception_private.guard_cost_review() from public,anon,authenticated,service_role;
revoke all on function public.icash_settle_general_reception(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.icash_settle_general_reception(text,jsonb) to service_role;
revoke all on function public.icash_get_general_reception_settlement(text) from public,anon,authenticated,service_role;
grant execute on function public.icash_get_general_reception_settlement(text) to service_role;
commit;
