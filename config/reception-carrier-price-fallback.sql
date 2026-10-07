-- Explicit owner-approved tariff estimate fallback. No unknown cost is labeled verified.
-- Independent immutable approval; service_role can read through bounded RPC only.
create table icash_recorded_reception_private.carrier_estimate_policies (
 cost_policy_id uuid primary key references icash_recorded_reception_private.cost_policies(id),
 tariff_version text not null check(tariff_version='us-local-inbound-20261007'),
 micros_per_minute bigint not null check(micros_per_minute=8500),
 called_number text not null check(called_number='+17816093521'),
 evidence_ref text not null check(length(evidence_ref) between 20 and 2000),
 approval_reference text not null check(length(approval_reference) between 20 and 2000),
 approved_at timestamptz not null default now()
);
alter table icash_recorded_reception_private.carrier_estimate_policies enable row level security;
revoke all on icash_recorded_reception_private.carrier_estimate_policies from public,anon,authenticated,service_role;
create trigger reception_carrier_estimate_immutable before update or delete on icash_recorded_reception_private.carrier_estimate_policies for each row execute function icash_recorded_reception_private.immutable();
create trigger reception_carrier_estimate_no_truncate before truncate on icash_recorded_reception_private.carrier_estimate_policies for each statement execute function icash_recorded_reception_private.immutable();
create function icash_recorded_reception_private.carrier_estimate_allowed(r icash_recorded_reception_private.sessions,part jsonb,seconds numeric) returns boolean language sql stable set search_path='' as $$
 select coalesce(r.call_ended_at is not null and r.call_terminal_status='completed'
 and seconds>=0 and seconds<=r.max_total_seconds and trunc(seconds)=seconds
 and icash_recorded_reception_private.keys(part,array['amountMicros','currency','receiptHash','basis','tariffVersion','pricePending'])
 and part->>'currency'='USD' and part->>'basis'='estimated' and part->'pricePending'='true'::jsonb
 and part->>'receiptHash' ~ '^[a-f0-9]{64}$'
 and exists(select 1 from icash_recorded_reception_private.carrier_estimate_policies x
 join icash_recorded_reception_private.cost_policies p on p.id=x.cost_policy_id
 where x.cost_policy_id=r.cost_policy_id and p.account_id=r.account_id and p.rate_id=r.rate_id
 and to_jsonb(p)-'enabled'=r.cost_policy_snapshot and p.rate_snapshot=r.rate_snapshot
 and r.to_phone=x.called_number and part->>'tariffVersion'=x.tariff_version
 and part->'amountMicros'=to_jsonb(greatest(1,ceil(seconds/60))*x.micros_per_minute)
 and (r.rate_snapshot->'costs_micros'->>'twilio')::numeric>=ceil(r.max_total_seconds::numeric/60)*x.micros_per_minute),false)
$$;
revoke all on function icash_recorded_reception_private.carrier_estimate_allowed(icash_recorded_reception_private.sessions,jsonb,numeric) from public,anon,authenticated,service_role;
create function public.icash_get_reception_carrier_estimate(p_id uuid,p_account uuid,p_operation text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('tariffVersion',x.tariff_version,'microsPerMinute',x.micros_per_minute)
 from icash_recorded_reception_private.sessions r join icash_recorded_reception_private.carrier_estimate_policies x on x.cost_policy_id=r.cost_policy_id
 where r.id=p_id and r.account_id=p_account and r.operation_key=p_operation and r.to_phone=x.called_number
 and r.call_ended_at is not null and r.call_terminal_status='completed'
$$;
revoke all on function public.icash_get_reception_carrier_estimate(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.icash_get_reception_carrier_estimate(uuid,uuid,text) to service_role;
create or replace function icash_recorded_reception_private.validate_cost_review(p_id uuid,p_attestation jsonb,p_components jsonb) returns text language plpgsql set search_path='' as $$
declare r icash_recorded_reception_private.sessions;b jsonb;part jsonb;cat text;total numeric:=0;n numeric;basis text:='verified';gate boolean;minutes numeric;rec numeric;storage numeric;speech numeric;stream numeric;
begin
 select * into r from icash_recorded_reception_private.sessions where id=p_id;
 if not found or r.call_ended_at is null then raise exception 'Terminal bound carrier required';end if;
 if r.setup_confirmed_at is not null and r.call_terminal_status='completed' and r.call_started_at is null then raise exception 'Bound answered call clock required';end if;
 b:=jsonb_build_object('sessionId',r.id,'configId',r.config_id,'accountId',r.account_id,'operationKey',r.operation_key,'providerAccountSid',r.provider_account_sid,'callSid',r.call_sid,'fromPhone',r.from_phone,'toPhone',r.to_phone,'direction','inbound','agentId',r.agent_id,'branchId',r.branch_id,'versionId',r.version_id,'rateId',r.rate_id,'chargeCapCents',r.charge_cap_cents,'maxTotalSeconds',r.max_total_seconds,'conversationId',r.conversation_id,'recordingSid',r.recording_sid);
 if not icash_recorded_reception_private.keys(p_attestation,array['schemaVersion','mode','binding','durationSeconds','providers','recording']) or p_attestation->'schemaVersion' is distinct from '1'::jsonb or p_attestation->'binding' is distinct from b
  or not icash_recorded_reception_private.micros(p_attestation->'durationSeconds') or (p_attestation->>'durationSeconds')::numeric>r.max_total_seconds then raise exception 'Exact provider binding and duration required';end if;
 gate:=p_attestation->>'mode'='gate_only';
 if p_attestation->>'mode' not in ('gate_only','recorded') or p_attestation->>'mode' is null then raise exception 'Invalid settlement mode';end if;
 if gate then
  if r.start_claimed_at is not null or r.register_claimed_at is not null or r.recording_sid is not null or r.conversation_id is not null then raise exception 'Gate-only requires no recording or AI start claim';end if;
  if not icash_recorded_reception_private.keys(p_attestation->'providers',array['twilio']) then raise exception 'Gate-only cannot fabricate AI receipt';end if;
 else
  if r.recording_sid is null or r.conversation_id is null or r.consent_at is null or r.duration_seconds is null or r.ended_at is null or r.state not in ('available','expired','deletion_pending','deleted') then raise exception 'Complete recording and conversation required';end if;
  if not icash_recorded_reception_private.keys(p_attestation->'providers',array['twilio','elevenlabs']) then raise exception 'Both real provider receipts required';end if;
 end if;
 for cat,part in select key,value from jsonb_each(p_attestation->'providers') loop
  if cat='twilio' and part->>'basis'='estimated' then
   if not icash_recorded_reception_private.carrier_estimate_allowed(r,part,(p_attestation->>'durationSeconds')::numeric) then raise exception 'Approved exact carrier tariff estimate required';end if;
  elsif not icash_recorded_reception_private.keys(part,array['amountMicros','currency','receiptHash']) or part->>'currency' is distinct from 'USD'
   or not icash_recorded_reception_private.micros(part->'amountMicros') or coalesce(part->>'receiptHash','') !~ '^[a-f0-9]{64}$' then raise exception 'Exact USD provider receipt required';end if;
 end loop;
 speech:=case when r.setup_confirmed_at is null then 0 else 20000 end;
 if gate then rec:=0;storage:=0;stream:=0;
 else minutes:=ceil(r.duration_seconds::numeric/60);rec:=coalesce(r.provider_recording_price_micros,minutes*2500);storage:=ceil(minutes*500*30/28);stream:=ceil((p_attestation->>'durationSeconds')::numeric/60)*4400;end if;
 if p_attestation->'recording' is distinct from jsonb_build_object('policyVersion','recorded-reception-30d-speech-v1','speechGatherMicros',speech,'recordingMicros',rec,'storageMicros',storage,'streamMicros',stream,'recordingEstimated',not gate and r.provider_recording_price_micros is null) then raise exception 'Immutable recording, stream, storage and Gather policy required';end if;
 if not icash_recorded_reception_private.keys(p_components,array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other']) then raise exception 'All 16 reviewed cost categories required';end if;
 for cat,part in select key,value from jsonb_each(p_components) loop
  if not icash_recorded_reception_private.keys(part,array['amountMicros','evidenceRef','basis']) or not icash_recorded_reception_private.micros(part->'amountMicros')
   or jsonb_typeof(part->'evidenceRef') is distinct from 'string' or length(btrim(part->>'evidenceRef')) not between 10 and 2000
   or coalesce(part->>'basis','') not in ('verified','estimated') then raise exception 'Reviewed amount and evidence required: %',cat;end if;
  total:=total+(part->>'amountMicros')::numeric;if part->>'basis'='estimated' then basis:='estimated';end if;
 end loop;
 if total>9007199254740991 then raise exception 'Cost total out of range';end if;
 if p_components->'twilio'->'amountMicros' is distinct from p_attestation->'providers'->'twilio'->'amountMicros' or p_components->'twilio'->>'basis' is distinct from (case when p_attestation->'providers'->'twilio'->>'basis'='estimated' then 'estimated' else 'verified' end)
  or p_components->'elevenlabs'->'amountMicros' is distinct from (case when gate then '0'::jsonb else p_attestation->'providers'->'elevenlabs'->'amountMicros' end)
  or p_components->'elevenlabs'->>'basis' is distinct from 'verified' then raise exception 'Provider receipt cost mismatch';end if;
 if p_components->'llm'->'amountMicros' is distinct from '0'::jsonb or p_components->'llm'->>'basis' is distinct from 'verified' then raise exception 'Inclusive model cost required';end if;
 if (p_components->'other'->>'amountMicros')::numeric<>speech+rec+storage+stream or (speech+rec+storage+stream>0 and p_components->'other'->>'basis' is distinct from 'estimated') then raise exception 'Complete recording add-ons must remain estimated';end if;
 return basis;
end $$;
create or replace function icash_recorded_reception_private.automatic_components(r icash_recorded_reception_private.sessions,a jsonb) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb:='{}';cat text;rule jsonb;n numeric;basis text;evidence text;p jsonb:=r.cost_policy_snapshot;
begin
 -- Frozen dispatch authority is intentional: later pause/disable/review expiry
 -- cannot strand a previously admitted call's truthful debit or media deletion.
 if r.cost_policy_id is null or p->>'id' is distinct from r.cost_policy_id::text or p->>'account_id' is distinct from r.account_id::text
  or p->>'rate_id' is distinct from r.rate_id::text or p->'rate_snapshot' is distinct from r.rate_snapshot
  or (p->>'standard_cost_multiplier')::numeric is distinct from r.standard_cost_multiplier
  or (p->>'elevenlabs_cost_multiplier')::numeric is distinct from r.elevenlabs_cost_multiplier
  or p->'components'->'other'->'pricingPolicy' is distinct from r.pricing_policy then raise exception 'Frozen standing policy binding required';end if;
 for cat,rule in select key,value from jsonb_each(p->'components') loop
  evidence:=rule->>'evidenceRef';basis:='verified';
  if cat='twilio' or (cat='elevenlabs' and a->>'mode'='recorded') then
   if rule->>'source' is distinct from 'provider_receipt' or not icash_recorded_reception_private.micros(a->'providers'->cat->'amountMicros') then raise exception 'Real provider cost required';end if;
   if cat='twilio' and a->'providers'->cat->>'basis'='estimated' then
    if not icash_recorded_reception_private.carrier_estimate_allowed(r,a->'providers'->cat,(a->>'durationSeconds')::numeric) then raise exception 'Approved exact carrier tariff estimate required';end if;
    basis:='estimated';
   end if;
   n:=(a->'providers'->cat->>'amountMicros')::numeric;evidence:=cat||':receipt-sha256:'||coalesce(a->'providers'->cat->>'receiptHash','')||case when basis='estimated' then ':tariff:us-local-inbound-20261007; final carrier price pending' else '' end;
  elsif cat='elevenlabs' then
   if a->>'mode' is distinct from 'gate_only' or r.start_claimed_at is not null or r.register_claimed_at is not null then raise exception 'No fabricated AI zero';end if;
   n:=0;evidence:='not-started:'||r.id::text;
  elsif cat='llm' then
   if rule->>'source' is distinct from 'inclusive_zero' then raise exception 'Inclusive model rule required';end if;n:=0;
  elsif cat='other' then
   if rule->>'source' is distinct from 'recorded_reception_addons' then raise exception 'Add-on policy required';end if;
   n:=(a->'recording'->>'speechGatherMicros')::numeric+(a->'recording'->>'recordingMicros')::numeric+(a->'recording'->>'storageMicros')::numeric+(a->'recording'->>'streamMicros')::numeric;basis:='estimated';
  else
   if rule->>'source' is distinct from 'fixed_estimate' or not icash_recorded_reception_private.micros(rule->'amountMicros') then raise exception 'Approved fixed estimate required';end if;
   n:=(rule->>'amountMicros')::numeric;basis:='estimated';
  end if;
  result:=result||jsonb_build_object(cat,jsonb_build_object('amountMicros',n,'basis',basis,'evidenceRef',evidence));
 end loop;
 -- Same exact provider binding and independent16-category validation as the
 -- historical owner-reviewed path; an LLM cannot supply category prices here.
 perform icash_recorded_reception_private.validate_cost_review(r.id,a,result);
 return result;
end $$;
