-- Apply after estimated-settlement-fairness.sql and communication-fractional-billing.sql.
-- No backfill: existing settlements and ledger entries remain immutable.
create or replace function public.icash_settle_estimated_operation(p_operation text) returns boolean language plpgsql set search_path='' as $$
declare o public.icash_operation_spend;r public.icash_operation_rates;parts jsonb;proof boolean;charge bigint;total numeric;required numeric;evidence text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found then return false;end if;
 if o.state='settled' then return true;end if;
 if o.state<>'dispatched' then return false;end if;
 select * into strict r from public.icash_operation_rates where id=o.rate_id;
 -- A full-call quote is a reservation ceiling, never completed-call usage.
 if r.operation in ('seller_call','buyer_call','incoming_call') then return false;end if;
 proof:=exists(select 1 from public.icash_discovery_results where operation_key=o.operation_key and account_id=o.account_id)
 or exists(select 1 from public.icash_owner_contacts where operation_key=o.operation_key and account_id=o.account_id)
 or exists(select 1 from public.icash_buyer_search_receipts b join public.icash_deal_files d on d.id=b.deal_id where b.operation_key=o.operation_key and d.account_id=o.account_id)
 or exists(select 1 from public.icash_text_messages where 'text:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and state in ('accepted','delivered'))
 or exists(select 1 from public.icash_text_ai_jobs where 'sms-ai:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and usage is not null and state in ('drafted','queued','handoff','superseded'))
 or exists(select 1 from public.icash_deal_emails where 'deal-email:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and state='accepted')
 or exists(select 1 from public.icash_title_requests where 'title:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and state='sent')
 or exists(select 1 from public.icash_title_tasks where 'title-followup:'||id=o.operation_key and account_id=o.account_id and email_provider_id is not null and email_state='sent')
 or exists(select 1 from public.icash_title_qualification_jobs where 'title-qualify:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and state='sent')
 or exists(select 1 from public.icash_signing_envelopes where 'signing:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and not test_mode and state in ('awaiting_counterparty','customer_signature_needed','completed'))
 or exists(select 1 from public.icash_live_conversations where operation_key=o.operation_key and account_id=o.account_id and state='complete' and completed_at is not null);
 if not proof then return false;end if;
 evidence:='ESTIMATE: configured rate '||r.version||'; provider invoice costs not verified';
 select jsonb_object_agg(key,jsonb_build_object('amountMicros',value,'evidenceRef',evidence)),sum(value::text::numeric) into parts,total from jsonb_each(r.costs_micros);
 required:=total*o.standard_cost_multiplier-coalesce((r.costs_micros->>'elevenlabs')::numeric,0)*(o.standard_cost_multiplier-o.elevenlabs_cost_multiplier);
 charge:=ceil(required/10000);
 if charge>o.charge_cap_cents then return false;end if;
 -- The existing atomic ledger enforces reservations, fractional pricing, and margin checks.
 perform public.icash_settle_complete_costs(o.operation_key,charge,parts,evidence);
 update public.icash_operation_spend set cost_basis='estimated' where operation_key=o.operation_key;
 return true;
end $$;

-- This service-only boundary accepts a complete reviewed usage manifest, not a quote.
-- Server collector is fail-closed until reviewed supplier estimate policies are configured.
create or replace function public.icash_settle_voice_usage(p_operation text,p_components jsonb,p_evidence text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare o public.icash_operation_spend;r public.icash_operation_rates;c public.icash_live_conversations;
 cat text;part jsonb;n numeric;total numeric:=0;charge bigint;basis text:='verified';receipt numeric;duration numeric;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found then return false;end if;
 select * into strict r from public.icash_operation_rates where id=o.rate_id;
 if r.operation not in ('seller_call','buyer_call','incoming_call') then raise exception 'Voice operation required';end if;
 if o.state not in ('dispatched','settled') then return false;end if;
 select * into c from public.icash_live_conversations where operation_key=o.operation_key and account_id=o.account_id and state='complete' and completed_at is not null;
 if not found then return false;end if;
 if jsonb_typeof(c.result->'durationSeconds')='number' then duration:=(c.result->>'durationSeconds')::numeric;end if;
 if duration is null or duration<0 or duration<>trunc(duration) then
  select amount into duration from public.icash_cost_observations where provider='elevenlabs_duration' and event_key=c.conversation_id and source_ref=o.operation_key and units='seconds';
 end if;
 if duration is null or duration<0 or duration<>trunc(duration) or duration>9007199254740991 then return false;end if;
 if jsonb_typeof(p_components) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_components))<>16 then raise exception 'Complete voice costs required';end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  part:=p_components->cat;
  if jsonb_typeof(part->'amountMicros') is distinct from 'number' or (part->>'basis') is null or (part->>'basis') not in ('verified','estimated') then raise exception 'Explicit component cost basis required';end if;
  n:=(part->>'amountMicros')::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid voice cost';end if;
  if part->>'basis'='estimated' then basis:='estimated';end if;
  total:=total+n;
 end loop;
 if total>9007199254740991 then raise exception 'Voice cost total out of range';end if;
 -- Bind the inclusive ElevenLabs receipt to THIS operation and conversation.
 select amount into receipt from public.icash_cost_observations where provider='elevenlabs' and event_key=c.conversation_id and source_ref=o.operation_key and lower(units)='usd' and amount is not null;
 if not found then return false;end if;
 if p_components->'elevenlabs'->>'basis'<>'verified' or (p_components->'elevenlabs'->>'amountMicros')::numeric<>ceil(receipt*1000000) or (p_components->'llm'->>'amountMicros')::numeric<>0 then raise exception 'Inclusive ElevenLabs receipt mismatch';end if;
 charge:=ceil((total*o.standard_cost_multiplier-(p_components->'elevenlabs'->>'amountMicros')::numeric*(o.standard_cost_multiplier-o.elevenlabs_cost_multiplier))/10000);
 if charge>o.charge_cap_cents then return false;end if;
 -- Existing manifest/ledger enforces exact retry identity, reserves and account margin.
 perform public.icash_settle_complete_costs(o.operation_key,charge,p_components,p_evidence);
 update public.icash_operation_spend set cost_basis=basis where operation_key=o.operation_key;
 return true;
end $$;
revoke all on function public.icash_settle_voice_usage(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.icash_settle_voice_usage(text,jsonb,text) to service_role;
