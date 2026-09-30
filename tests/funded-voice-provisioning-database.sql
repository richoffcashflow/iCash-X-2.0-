-- Run only against an isolated staging/test database with the current deployed
-- schema and config/funded-voice-provisioning.sql applied. Never production.
-- All fixtures and changes (including disabled pre-existing rates) roll back.
begin;

create function pg_temp.assert_voice_hold(p_account uuid,p_status text) returns void
language plpgsql set search_path='' as $$
declare result jsonb;
begin
 result:=public.icash_provision_funded_account(p_account);
 if result->'voice'->>'status' is distinct from p_status then
  raise exception 'Expected voice status %, got %',p_status,result;
 end if;
 if exists(select 1 from public.icash_voice_configs where account_id=p_account) then
  raise exception 'A held account was provisioned';
 end if;
end $$;

do $$
declare
 u uuid:=gen_random_uuid();a uuid:=gen_random_uuid();o uuid:=gen_random_uuid();
 seller uuid;buyer uuid;bad uuid;key text:='voice-template-fixture:'||gen_random_uuid();
 costs jsonb;altered jsonb;category text;scenario text;side text;op text;result jsonb;
 rate_until timestamptz;verified timestamptz;duration integer;rate_enabled boolean;evidence text;
 account_before jsonb;wallet_before jsonb;budget_before jsonb;config_before jsonb;
 discovery_before jsonb;buyer_before jsonb;inventory_before jsonb;
 permission_before bigint;authority_before bigint;jobs_before bigint;session_id uuid;
 bounded_until timestamptz;rejected boolean;role_name text;privilege text;
begin
 -- Empty template is the deployment default; isolate fixtures from any test data.
 delete from public.icash_voice_production_template;
 update public.icash_operation_rates set enabled=false
 where operation in ('property_search','owner_enrichment','buyer_discovery');
 insert into auth.users(id,email) values(u,u||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents)
 values(a,u,'Voice template fixture',true,10000);
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency)
 values(a,10000,0,'USD');
 select to_jsonb(x) into account_before from public.icash_accounts x where id=a;
 select to_jsonb(x) into wallet_before from public.icash_wallets x where account_id=a;
 select to_jsonb(x) into budget_before from public.icash_operating_budget x where id=1;
 select count(*) into permission_before from public.icash_contact_permissions;
 select count(*) into authority_before from public.icash_offer_authorities;
 select count(*) into jobs_before from public.icash_voice_jobs;

 perform pg_temp.assert_voice_hold(a,'funding_required');
 insert into public.icash_funding_orders(mode,guest_hash,account_id,pack_code,price_cents,credit_cents,state,credited_at)
 values('test',repeat('f',64),a,'start',2000,2000,'paid',now());
 perform pg_temp.assert_voice_hold(a,'funding_required');
 insert into public.icash_funding_orders(id,mode,guest_hash,account_id,pack_code,price_cents,credit_cents)
 values(o,'live',repeat('e',64),a,'start',2000,2000);
 perform pg_temp.assert_voice_hold(a,'funding_required');
 update public.icash_funding_orders set state='paid' where id=o;
 perform pg_temp.assert_voice_hold(a,'funding_required');
 update public.icash_funding_orders set credited_at=now() where id=o;
 perform pg_temp.assert_voice_hold(a,'reviewed_template_required');

 select jsonb_object_agg(c,case when c in ('elevenlabs','twilio') then 100000 else 0 end)
 into costs from unnest(array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other']) c;
 if not public.icash_voice_template_costs_valid(costs) then raise exception 'Valid complete costs rejected';end if;
 -- Every category is required, including explicit zero allocations.
 for category in select jsonb_object_keys(costs) loop
  if public.icash_voice_template_costs_valid(costs-category) then raise exception 'Missing category accepted: %',category;end if;
 end loop;
 if public.icash_voice_template_costs_valid(null) or public.icash_voice_template_costs_valid('[]')
 or public.icash_voice_template_costs_valid(costs||'{"unexpected":0}')
 or public.icash_voice_template_costs_valid(costs||'{"elevenlabs":9007199254740991,"twilio":1}') then
  raise exception 'Malformed costs or unsafe total accepted';
 end if;
 if public.icash_voice_template_ids_valid(array['callback','callback'],2)
 or public.icash_voice_template_ids_valid(array['callback',null],2)
 or public.icash_voice_template_ids_valid(array['callback',' '],2)
 or public.icash_voice_template_ids_valid(array[array['callback','handoff']],2)
 or not public.icash_voice_template_ids_valid('{}',0) then raise exception 'Invalid identifier validation';end if;

 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds)
 values('seller_call',key||':seller',1000,costs,'Rollback test fixture, no provider quote',now()-interval '1 hour',now()+interval '3 hours',true,600)
 returning id into seller;
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds)
 values('buyer_call',key||':buyer',1000,costs,'Rollback test fixture, no provider quote',now()-interval '1 hour',now()+interval '2 hours',true,600)
 returning id into buyer;
 insert into public.icash_voice_production_template(id,agent_id,phone_number_id,agent_config_hash,required_tool_ids,approved_voice_ids,
 seller_rate_id,buyer_rate_id,max_duration_seconds,reviewed_at,reviewed_until,evidence_ref)
 values(1,'agent_templatefixture','phone_fixture',repeat('a',64),array['callback','handoff'],array['voice_fixture'],
 seller,buyer,600,now()-interval '1 minute',now()+interval '4 hours','Rollback fixture reviewed evidence only');
 perform pg_temp.assert_voice_hold(a,'reviewed_template_required');
 update public.icash_voice_production_template set enabled=true,reviewed_at=now()+interval '1 hour';
 perform pg_temp.assert_voice_hold(a,'reviewed_template_required');
 update public.icash_voice_production_template set reviewed_at=now()-interval '2 hours',reviewed_until=now()-interval '1 hour';
 perform pg_temp.assert_voice_hold(a,'reviewed_template_required');
 update public.icash_voice_production_template set reviewed_at=now()-interval '1 minute',reviewed_until=now()+interval '4 hours';
 rejected:=false;
 begin
  update public.icash_voice_production_template set reviewed_until='infinity';
 exception when check_violation then rejected:=true;end;
 if not rejected then raise exception 'Unbounded template review accepted';end if;
 rejected:=false;
 begin
  update public.icash_voice_production_template set required_tool_ids=array['callback','callback'];
 exception when check_violation then rejected:=true;end;
 if not rejected then raise exception 'Duplicate tools accepted';end if;
 rejected:=false;
 begin
  update public.icash_voice_production_template set id=2;
 exception when check_violation then rejected:=true;end;
 if not rejected then raise exception 'Multiple template slots accepted';end if;

 update public.icash_voice_test_config set agent_id='agent_templatefixture';
 perform pg_temp.assert_voice_hold(a,'practice_agent_blocked');
 update public.icash_voice_test_config set agent_id=null;
 insert into public.icash_voice_test_access(token_hash,expires_at) values(repeat('d',64),now()+interval '1 hour');
 insert into public.icash_voice_test_sessions(token_hash,agent_id) values(repeat('d',64),'agent_templatefixture') returning id into session_id;
 perform pg_temp.assert_voice_hold(a,'practice_agent_blocked');
 delete from public.icash_voice_test_sessions where id=session_id;

 -- Exercise both sides independently; rates are immutable, so each case is a new version.
 foreach side in array array['seller','buyer'] loop
  foreach scenario in array array['wrong_operation','disabled','future','expired','infinite','short_duration','null_duration','short_evidence','missing_cost','null_cost','string_cost','negative_cost','fractional_cost','unsafe_cost','unsafe_total','extra_cost','array_cost'] loop
   op:=side||'_call';rate_enabled:=true;verified:=now()-interval '1 hour';rate_until:=now()+interval '2 hours';duration:=600;
   evidence:='Rollback invalid rate fixture';altered:=costs;
   case scenario
    when 'wrong_operation' then op:='incoming_call';
    when 'disabled' then rate_enabled:=false;
    when 'future' then verified:=now()+interval '1 hour';
    when 'expired' then rate_until:=now();
    when 'infinite' then rate_until:='infinity';
    when 'short_duration' then duration:=599;
    when 'null_duration' then duration:=null;
    when 'short_evidence' then evidence:='short';
    when 'missing_cost' then altered:=costs-'twilio';
    when 'null_cost' then altered:=costs||'{"twilio":null}';
    when 'string_cost' then altered:=costs||'{"twilio":"1"}';
    when 'negative_cost' then altered:=costs||'{"twilio":-1}';
    when 'fractional_cost' then altered:=costs||'{"twilio":0.5}';
    when 'unsafe_cost' then altered:=costs||'{"twilio":9007199254740992}';
    when 'unsafe_total' then altered:=costs||'{"twilio":9007199254740991}';
    when 'extra_cost' then altered:=costs||'{"unexpected":0}';
    when 'array_cost' then altered:='[]';
   end case;
   insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds)
   values(op,key||':'||side||':'||scenario,1000,altered,evidence,verified,rate_until,rate_enabled,duration) returning id into bad;
   update public.icash_voice_production_template set seller_rate_id=case when side='seller' then bad else seller end,
    buyer_rate_id=case when side='buyer' then bad else buyer end;
   perform pg_temp.assert_voice_hold(a,'full_call_rates_required');
  end loop;
 end loop;
 update public.icash_voice_production_template set seller_rate_id=seller,buyer_rate_id=buyer;

 -- Voice can be provisioned while discovery waits for its separate rates.
 result:=public.icash_provision_funded_account(a);
 if result->>'status' is distinct from 'data_rates_required' or result->'voice'->>'status' is distinct from 'configured' then
  raise exception 'Voice/discovery statuses coupled: %',result;
 end if;
 bounded_until:=(select expires_at from public.icash_operation_rates where id=buyer);
 if not exists(select 1 from public.icash_voice_configs where account_id=a and enabled
  and agent_id='agent_templatefixture' and phone_number_id='phone_fixture' and agent_config_hash=repeat('a',64)
  and seller_rate_id=seller and buyer_rate_id=buyer and max_duration_seconds=600
  and required_tool_ids=array['callback','handoff'] and approved_voice_ids=array['voice_fixture']
  and reviewed_until=bounded_until) then raise exception 'Template fields or rate-bounded expiry not copied';end if;
 select to_jsonb(c) into config_before from public.icash_voice_configs c where account_id=a;
 result:=public.icash_provision_funded_account(a);
 if result->'voice'->>'status' is distinct from 'existing_configuration_preserved'
 or (select to_jsonb(c) from public.icash_voice_configs c where account_id=a) is distinct from config_before
 or (select count(*) from public.icash_voice_configs where account_id=a)<>1 then raise exception 'Retry changed configuration';end if;

 -- Manual disable/expiry survives template changes, missing review and refreshes.
 update public.icash_voice_configs set enabled=false,reviewed_until=now()-interval '1 minute',phone_number_id='manual_fixture' where account_id=a;
 select to_jsonb(c) into config_before from public.icash_voice_configs c where account_id=a;
 update public.icash_voice_production_template set agent_config_hash=repeat('b',64),approved_voice_ids=array['different_voice'],enabled=false;
 perform public.icash_provision_funded_account(a);
 delete from public.icash_voice_production_template;
 perform public.icash_provision_funded_account(a);
 if (select to_jsonb(c) from public.icash_voice_configs c where account_id=a) is distinct from config_before then
  raise exception 'Manual disabled/expired configuration overwritten';end if;

 -- A missing template does not interrupt existing data provisioning.
 delete from public.icash_voice_configs where account_id=a;
 foreach op in array array['property_search','owner_enrichment','buyer_discovery'] loop
  insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled)
  values(op,key||':data:'||op,1000,costs||'{"dealmachine":250000}','Rollback data provisioning fixture',now()-interval '1 minute',now()+interval '1 hour',true);
 end loop;
 result:=public.icash_provision_funded_account(a);
 if result->>'status' is distinct from 'configured' or result->'voice'->>'status' is distinct from 'reviewed_template_required'
 or not exists(select 1 from public.icash_discovery_configs where account_id=a)
 or not exists(select 1 from public.icash_buyer_search_configs where account_id=a)
 or not exists(select 1 from public.icash_inventory_markets where account_id=a) then
  raise exception 'Original discovery provisioning changed: %',result;
 end if;
 update public.icash_discovery_configs set enabled=false,auto_enabled=false,contacts_enabled=false where account_id=a;
 update public.icash_buyer_search_configs set enabled=false where account_id=a;
 select to_jsonb(c) into discovery_before from public.icash_discovery_configs c where account_id=a;
 select to_jsonb(c) into buyer_before from public.icash_buyer_search_configs c where account_id=a;
 select jsonb_agg(to_jsonb(c) order by zip) into inventory_before from public.icash_inventory_markets c where account_id=a;
 insert into public.icash_voice_production_template(id,enabled,agent_id,phone_number_id,agent_config_hash,required_tool_ids,
 seller_rate_id,buyer_rate_id,max_duration_seconds,reviewed_at,reviewed_until,evidence_ref)
 values(1,true,'agent_templatefixture','phone_fixture',repeat('a',64),array['callback','handoff'],seller,buyer,
 600,now()-interval '1 minute',now()+interval '30 minutes','Rollback template expiry fixture');
 -- The existing funding trigger must resolve the new wrapper, without a new hook.
 update public.icash_funding_orders set credited_at=credited_at where id=o;
 if (select reviewed_until from public.icash_voice_configs where account_id=a) is distinct from
 (select reviewed_until from public.icash_voice_production_template where id=1) then raise exception 'Template expiry not preserved';end if;
 if (select to_jsonb(c) from public.icash_discovery_configs c where account_id=a) is distinct from discovery_before
 or (select to_jsonb(c) from public.icash_buyer_search_configs c where account_id=a) is distinct from buyer_before
 or (select jsonb_agg(to_jsonb(c) order by zip) from public.icash_inventory_markets c where account_id=a) is distinct from inventory_before then
  raise exception 'Discovery manual settings or inventory changed';end if;

 if (select to_jsonb(x) from public.icash_accounts x where id=a) is distinct from account_before
 or (select to_jsonb(x) from public.icash_wallets x where account_id=a) is distinct from wallet_before
 or (select to_jsonb(x) from public.icash_operating_budget x where id=1) is distinct from budget_before
 or (select count(*) from public.icash_contact_permissions)<>permission_before
 or (select count(*) from public.icash_offer_authorities)<>authority_before
 or (select count(*) from public.icash_voice_jobs)<>jobs_before then
  raise exception 'Provisioning changed pause, spending, consent, offer authority or dispatch';end if;

 if not (select relrowsecurity from pg_class where oid='public.icash_voice_production_template'::regclass) then
  raise exception 'Template RLS missing';end if;
 foreach role_name in array array['anon','authenticated'] loop
  foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   if has_table_privilege(role_name,'public.icash_voice_production_template',privilege) then raise exception 'Template exposed to % (%)',role_name,privilege;end if;
  end loop;
  if has_function_privilege(role_name,'public.icash_provision_funded_account(uuid)','EXECUTE')
  or has_function_privilege(role_name,'public.icash_provision_before_voice_template(uuid)','EXECUTE')
  or has_function_privilege(role_name,'public.icash_voice_template_ids_valid(text[],integer)','EXECUTE')
  or has_function_privilege(role_name,'public.icash_voice_template_costs_valid(jsonb)','EXECUTE') then raise exception 'Service function exposed';end if;
 end loop;
 if not has_function_privilege('service_role','public.icash_provision_funded_account(uuid)','EXECUTE')
 or not has_table_privilege('service_role','public.icash_voice_production_template','INSERT')
 or (select prosecdef from pg_proc where oid='public.icash_provision_funded_account(uuid)'::regprocedure) then
  raise exception 'Service invoker permissions invalid';end if;
end $$;

-- Check real role execution as well as catalog privileges. The missing account
-- is intentional: service_role must reach the funding hold without doing work.
set local role service_role;
do $$
begin
 if public.icash_provision_funded_account(null)->'voice'->>'status' is distinct from 'funding_required' then
  raise exception 'Service role could not execute the funded provisioning wrapper';end if;
end $$;
reset role;
set local role authenticated;
do $$
declare rejected boolean;
begin
 rejected:=false;
 begin perform public.icash_provision_funded_account(null);exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'Customer could invoke provisioning';end if;
 rejected:=false;
 begin perform 1 from public.icash_voice_production_template;exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'Customer could read production template';end if;
end $$;
reset role;

select 'PASS: funding gate, template review, practice isolation, both complete full-duration rates, bounded expiry, idempotency, manual holds, discovery continuity, no authority or spending changes, service-only access' as result;
rollback;
