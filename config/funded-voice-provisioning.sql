-- Apply once, after funded-account-provisioning.sql, live-dispatch.sql and
-- setup-voice-dispatch.sql. This installs no template, rate, credential or contact.
-- An operator must review the actual production provider configuration separately.
begin;

create function public.icash_voice_template_ids_valid(p_ids text[],p_min integer)
returns boolean language sql immutable security invoker set search_path='' as $$
 select p_ids is not null and cardinality(p_ids)>=p_min
 and coalesce(array_ndims(p_ids),1)=1
 and (select count(distinct id)=cardinality(p_ids) from unnest(p_ids) id)
 and not exists(select 1 from unnest(p_ids) id where id is null or id !~ '^[A-Za-z0-9_-]{1,200}$');
$$;

-- Explicit zero is permitted; missing, fractional, negative or extra costs are not.
-- Match the JS safe-integer range for individual amounts AND the complete total.
create function public.icash_voice_template_costs_valid(p_costs jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare cat text;n numeric;total numeric:=0;
begin
 if jsonb_typeof(p_costs) is distinct from 'object' then return false;end if;
 if (select count(*) from jsonb_object_keys(p_costs))<>16 then return false;end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  if jsonb_typeof(p_costs->cat) is distinct from 'number' then return false;end if;
  n:=(p_costs->>cat)::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then return false;end if;
  total:=total+n;
 end loop;
 return total<=9007199254740991;
end $$;

-- The absence of a row is the default hold. An explicit reviewed, enabled row is
-- required. Empty approved_voice_ids means only the provider's default voice;
-- it never means arbitrary customer-selected overrides are approved.
create table public.icash_voice_production_template (
 id integer primary key check(id=1),
 enabled boolean not null default false,
 agent_id text not null check(agent_id ~ '^agent_[A-Za-z0-9]+$'),
 phone_number_id text not null check(phone_number_id ~ '^[A-Za-z0-9_-]{1,200}$'),
 agent_config_hash text not null check(agent_config_hash ~ '^[a-f0-9]{64}$'),
 required_tool_ids text[] not null check(public.icash_voice_template_ids_valid(required_tool_ids,2)),
 approved_voice_ids text[] not null default '{}' check(public.icash_voice_template_ids_valid(approved_voice_ids,0)),
 seller_rate_id uuid not null references public.icash_operation_rates(id),
 buyer_rate_id uuid not null references public.icash_operation_rates(id),
 max_duration_seconds integer not null check(max_duration_seconds between 60 and 900),
 reviewed_at timestamptz not null,
 reviewed_until timestamptz not null,
 evidence_ref text not null check(length(trim(evidence_ref))>10),
 check(isfinite(reviewed_at) and isfinite(reviewed_until) and reviewed_until>reviewed_at)
);
alter table public.icash_voice_production_template enable row level security;
revoke all on public.icash_voice_production_template from public,anon,authenticated;
grant select,insert,update,delete on public.icash_voice_production_template to service_role;
revoke all on function public.icash_voice_template_ids_valid(text[],integer),public.icash_voice_template_costs_valid(jsonb) from public,anon,authenticated;
grant execute on function public.icash_voice_template_ids_valid(text[],integer),public.icash_voice_template_costs_valid(jsonb) to service_role;

-- Keep the deployed discovery implementation and its response fields intact.
-- Calling the wrapper repeatedly never updates an existing per-account voice row.
alter function public.icash_provision_funded_account(uuid) rename to icash_provision_before_voice_template;
create function public.icash_provision_funded_account(p_account uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 result jsonb;t public.icash_voice_production_template;
 seller public.icash_operation_rates;buyer public.icash_operation_rates;r public.icash_operation_rates;
 existing public.icash_voice_configs;until_at timestamptz;checked_at timestamptz;inserted integer;
begin
 -- Same transaction/account lock as discovery, including direct RPC retries.
 perform pg_advisory_xact_lock(hashtextextended(p_account::text,7301));
 result:=public.icash_provision_before_voice_template(p_account);
 perform 1 from public.icash_funding_orders
 where account_id=p_account and mode='live' and state='paid' and credited_at is not null
 limit 1;
 if not found then return result||jsonb_build_object('voice',jsonb_build_object('status','funding_required'));end if;

 select * into existing from public.icash_voice_configs where account_id=p_account for share;
 if found then
  return result||jsonb_build_object('voice',jsonb_build_object('status','existing_configuration_preserved','enabled',existing.enabled));
 end if;
 select * into t from public.icash_voice_production_template where id=1 for share;
 if not found then return result||jsonb_build_object('voice',jsonb_build_object('status','reviewed_template_required'));end if;
 -- Hold mutable review/enablement rows until the new configuration is inserted.
 select * into seller from public.icash_operation_rates where id=t.seller_rate_id for share;
 select * into buyer from public.icash_operation_rates where id=t.buyer_rate_id for share;
 perform 1 from public.icash_voice_test_config for share;
 checked_at:=clock_timestamp();
 if not t.enabled or t.reviewed_at>checked_at or t.reviewed_until<=checked_at then
  return result||jsonb_build_object('voice',jsonb_build_object('status','reviewed_template_required'));
 end if;
 -- A retired practice agent is still a practice agent, even after config rotation.
 if exists(select 1 from public.icash_voice_test_config where agent_id=t.agent_id)
 or exists(select 1 from public.icash_voice_test_sessions where agent_id=t.agent_id) then
  return result||jsonb_build_object('voice',jsonb_build_object('status','practice_agent_blocked'));
 end if;
 if seller.operation is distinct from 'seller_call' or buyer.operation is distinct from 'buyer_call' then
  return result||jsonb_build_object('voice',jsonb_build_object('status','full_call_rates_required'));
 end if;
 foreach r in array array[seller,buyer] loop
  if r.enabled is distinct from true or r.verified_at>checked_at or r.expires_at<=checked_at
  or not isfinite(r.verified_at) or not isfinite(r.expires_at)
  or coalesce(r.voice_max_duration_seconds,0)<t.max_duration_seconds
  or length(trim(r.evidence_ref))<=10
  or not public.icash_voice_template_costs_valid(r.costs_micros) then
   return result||jsonb_build_object('voice',jsonb_build_object('status','full_call_rates_required'));
  end if;
 end loop;
 until_at:=least(t.reviewed_until,seller.expires_at,buyer.expires_at);
 insert into public.icash_voice_configs(account_id,enabled,agent_id,phone_number_id,agent_config_hash,
  reviewed_until,seller_rate_id,buyer_rate_id,max_duration_seconds,required_tool_ids,approved_voice_ids)
 values(p_account,true,t.agent_id,t.phone_number_id,t.agent_config_hash,until_at,
  t.seller_rate_id,t.buyer_rate_id,t.max_duration_seconds,t.required_tool_ids,t.approved_voice_ids)
 on conflict(account_id) do nothing;
 get diagnostics inserted=row_count;
 return result||jsonb_build_object('voice',jsonb_build_object(
  'status',case when inserted=1 then 'configured' else 'existing_configuration_preserved' end,
  'expiresAt',until_at));
end $$;
revoke all on function public.icash_provision_before_voice_template(uuid),public.icash_provision_funded_account(uuid) from public,anon,authenticated;
grant execute on function public.icash_provision_before_voice_template(uuid),public.icash_provision_funded_account(uuid) to service_role;

commit;
