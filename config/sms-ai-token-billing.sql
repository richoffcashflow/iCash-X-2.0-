begin;
-- Split the existing 9-cent SMS estimate (1-cent transport + 2-cent AI,
-- multiplied by 3) into transport and actual AI usage. No duplicate AI charge.
-- Official GPT-4.1 mini standard pricing checked 2026-10-07:
-- https://developers.openai.com/api/docs/models/gpt-4.1-mini
-- $0.40 input, $0.10 cached input, $1.60 output per million tokens.
do $rates$
declare old public.icash_operation_rates;transport uuid;analysis uuid;costs jsonb;eligible uuid[];transport_cost bigint;price bigint;definition text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into old from public.icash_operation_rates where operation='sms_send' and enabled and expires_at>now() and costs_micros->>'llm'='20000' and costs_micros->>'messaging'='10000' and buffer_bps=0 and charge_cents=9 and flat_customer_price_cents is null order by verified_at desc limit 1 for share;
 if not found then raise exception 'Reviewed bundled SMS rate prerequisite changed';end if;
 if exists(select 1 from jsonb_each(old.costs_micros) where key not in ('llm','messaging') and value<>'0'::jsonb) then raise exception 'Unexpected bundled SMS component';end if;
 if not exists(select 1 from public.icash_text_ai_settings where id=1 and model='gpt-4.1-mini' and rate_id is null) then raise exception 'AI billing setup already changed';end if;
 -- Capture currently admitted bindings before changing the shared price. Never
 -- reactivate stale, paused, revoked or otherwise inadmissible conversations.
 select array_agg(id) into eligible from public.icash_text_threads where not paused and not manual_only and ai_mode='auto' and retired_at is null and public.icash_sms_thread_review_current(account_id,id,false);
 costs:=jsonb_set(old.costs_micros,'{llm}','0');
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled)
 values('sms_send','sms-transport-with-separate-ai-20261007',3,costs,0,'Transport component carried unchanged from '||old.version||'; AI is metered separately from provider tokens',now(),old.expires_at,true) returning id into transport;
 costs:=jsonb_set(jsonb_set(old.costs_micros,'{messaging}','0'),'{llm}','20000');
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled)
 values('sms_ai','sms-ai-gpt41mini-tokens-20261007',6,costs,0,'OpenAI official gpt-4.1-mini standard tier, checked 2026-10-07: input .40/cache .10/output 1.60 USD per million. 46000 input + 800 output <= 20000 USD micros. Actual tokens settle; this is a reservation only.',now(),old.expires_at,true) returning id into analysis;
 update public.icash_text_ai_settings set rate_id=analysis where id=1 and model='gpt-4.1-mini' and rate_id is null;
 update public.icash_communication_prices set customer_micros=30000 where operation='sms_segment' and customer_micros=90000;
 if not found then raise exception 'SMS displayed-price prerequisite changed';end if;
 -- Existing delivered messages and operations retain their original rate/price.
 update public.icash_text_threads t set sms_rate_id=transport,
  seller_sms_rate_hash=case when seller_intake_id is not null then (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') from public.icash_operation_rates r where r.id=transport) else seller_sms_rate_hash end,
  seller_sms_price_micros=case when seller_intake_id is not null then 30000 else seller_sms_price_micros end,
  operational_sms_rate_hash=case when operational_contact_id is not null then (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') from public.icash_operation_rates r where r.id=transport) else operational_sms_rate_hash end,
  operational_sms_price_micros=case when operational_contact_id is not null then 30000 else operational_sms_price_micros end
 where id=any(eligible) and sms_rate_id=old.id;
 -- Only never-reserved messages adopt the lower price; no charged history changes.
 update public.icash_text_messages m set customer_price_micros=30000 from public.icash_text_threads t
 where m.thread_id=t.id and m.account_id=t.account_id and t.sms_rate_id=transport and m.direction='outgoing' and m.state='ready' and m.provider_id is null and m.last_delivery_at is null
 and not exists(select 1 from public.icash_operation_spend where operation_key='text:'||m.id);
end $rates$;

-- A future model-setting change cannot silently use this model's rate.
do $patch$
declare definition text;needle text:=' if not exists(select 1 from public.icash_operation_rates where id=c.rate_id and operation=''sms_ai'' and enabled and expires_at>now()) then return null;end if;';
begin
 definition:=pg_get_functiondef('public.icash_claim_text_ai_before_campaign(uuid,uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'SMS AI model/rate prerequisite changed';end if;
 execute replace(definition,needle,needle||E'\n if c.model<>''gpt-4.1-mini'' and exists(select 1 from public.icash_operation_rates where id=c.rate_id and version=''sms-ai-gpt41mini-tokens-20261007'') then return null;end if;');
end $patch$;

create function public.icash_settle_sms_ai_tokens(p_account uuid,p_job uuid) returns boolean language plpgsql set search_path='' as $$
declare j public.icash_text_ai_jobs;o public.icash_operation_spend;r public.icash_operation_rates;input bigint;cached bigint;output bigint;cost bigint;price bigint;components jsonb;evidence text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 select * into o from public.icash_operation_spend where operation_key='sms-ai:'||p_job and account_id=p_account for update;
 if o.operation_key is null then return false;end if;
 select * into r from public.icash_operation_rates where id=o.rate_id and operation='sms_ai' and version='sms-ai-gpt41mini-tokens-20261007';
 if not found then return false;end if;
 if o.state='settled' then return true;end if;
 if o.state<>'dispatched' or j.provider_id !~ '^chatcmpl-[A-Za-z0-9_-]+$' or j.provider_id is null or j.usage is null then return false;end if;
 if coalesce(j.usage->>'prompt_tokens','') !~ '^[0-9]+$' or coalesce(j.usage->>'completion_tokens','') !~ '^[0-9]+$'
  or coalesce(j.usage->'prompt_tokens_details'->>'cached_tokens','0') !~ '^[0-9]+$' then return false;end if;
 input:=(j.usage->>'prompt_tokens')::bigint;cached:=coalesce((j.usage->'prompt_tokens_details'->>'cached_tokens')::bigint,0);output:=(j.usage->>'completion_tokens')::bigint;
 if input not between 0 and 46000 or cached not between 0 and input or output not between 0 and 800 then return false;end if;
 cost:=ceil((input-cached)*0.4+cached*0.1+output*1.6);
 price:=ceil(cost*o.standard_cost_multiplier);
 if cost>o.reserved_micros or ceil(price::numeric/10000)>o.charge_cap_cents then return false;end if;
 evidence:='OpenAI standard token receipt '||j.provider_id||'; gpt-4.1-mini .40/.10/1.60 USD per million; 20261007';
 select jsonb_object_agg(key,jsonb_build_object('amountMicros',case when key='llm' then cost else 0 end,'evidenceRef',evidence)) into components from jsonb_each(r.costs_micros);
 update public.icash_operation_spend set customer_price_micros=price where operation_key=o.operation_key;
 perform public.icash_settle_complete_costs(o.operation_key,ceil(price::numeric/10000)::bigint,components,evidence);
 update public.icash_operation_spend set cost_basis='verified' where operation_key=o.operation_key;
 return true;
end $$;
alter function public.icash_save_text_ai(uuid,uuid,jsonb,text,text,jsonb) rename to icash_save_text_ai_before_token_billing;
create function public.icash_save_text_ai(p_account uuid,p_job uuid,p_analysis jsonb,p_reply text,p_provider text,p_usage jsonb) returns void language plpgsql set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform public.icash_save_text_ai_before_token_billing(p_account,p_job,p_analysis,p_reply,p_provider,p_usage);
 perform public.icash_settle_sms_ai_tokens(p_account,p_job);
end $$;
alter function public.icash_settle_estimated_operation(text) rename to icash_settle_estimate_before_sms_tokens;
create function public.icash_settle_estimated_operation(p_operation text) returns boolean language plpgsql set search_path='' as $$
declare j public.icash_text_ai_jobs;
begin
 select jobs.* into j from public.icash_text_ai_jobs jobs join public.icash_operation_spend o on o.operation_key='sms-ai:'||jobs.id and o.account_id=jobs.account_id join public.icash_operation_rates r on r.id=o.rate_id and r.version='sms-ai-gpt41mini-tokens-20261007' where o.operation_key=p_operation;
 if found then return public.icash_settle_sms_ai_tokens(j.account_id,j.id);end if;
 return public.icash_settle_estimate_before_sms_tokens(p_operation);
end $$;
revoke all on function public.icash_settle_sms_ai_tokens(uuid,uuid),public.icash_save_text_ai(uuid,uuid,jsonb,text,text,jsonb),public.icash_save_text_ai_before_token_billing(uuid,uuid,jsonb,text,text,jsonb),public.icash_settle_estimated_operation(text),public.icash_settle_estimate_before_sms_tokens(text) from public,anon,authenticated;
grant execute on function public.icash_settle_sms_ai_tokens(uuid,uuid),public.icash_save_text_ai(uuid,uuid,jsonb,text,text,jsonb),public.icash_save_text_ai_before_token_billing(uuid,uuid,jsonb,text,text,jsonb),public.icash_settle_estimated_operation(text),public.icash_settle_estimate_before_sms_tokens(text) to service_role;
commit;
