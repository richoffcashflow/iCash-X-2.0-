begin;
do $$
declare u uuid:=gen_random_uuid();a uuid:=gen_random_uuid();r uuid;costs jsonb;op text;result jsonb;
begin
 select jsonb_object_agg(c,case when c='dealmachine' then 10000 else 0 end) into costs from unnest(array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other']) c;
 foreach op in array array['property_search','owner_enrichment','buyer_discovery','contract_signing'] loop
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled)
 values(op,'coverage-fixture:'||op,10,costs,'Isolated fixture only, no provider quote',now()-interval '1 minute',now()+interval '1 day',true) returning id into r;
 end loop;
 insert into public.icash_signing_templates(state_code,kind,signer_count,enabled,test_mode,provider,reviewed_until,rate_id)
 values('TX','purchase',1,true,false,'docuseal',now()+interval '1 day',r),('TX','assignment',1,true,false,'docuseal',now()+interval '1 day',r),('TX','purchase',2,true,false,'docuseal',now()+interval '1 day',r);
 if not public.icash_market_contract_ready('75217',1) then raise exception 'Current TX one-signer pair rejected';end if;
 if public.icash_market_contract_ready('75217',2) or public.icash_market_contract_ready('38118',1) or public.icash_market_contract_ready('35206',1) then raise exception 'Missing templates wrongly supported';end if;
 insert into auth.users(id,email) values(u,u||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',true,10000);
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,10000,0,'USD');
 insert into public.icash_funding_orders(mode,guest_hash,account_id,pack_code,price_cents,credit_cents,state,credited_at) values('live',repeat('e',64),a,'start',2000,2000,'paid',now());
 result:=public.icash_provision_funded_account(a);
 if (select zip from public.icash_discovery_configs where account_id=a)<>'75217' then raise exception 'Nationwide allocation selected unsupported state: %',result;end if;
 if exists(select 1 from public.icash_inventory_markets i where account_id=a and not public.icash_market_contract_ready(i.zip,1)) then raise exception 'Inventory includes unsupported state';end if;
 if not (select bot_paused from public.icash_accounts where id=a) then raise exception 'Coverage provisioner unpaused user';end if;
 update public.icash_discovery_configs set zip='38118' where account_id=a;
 result:=public.icash_provision_funded_account(a);
 if result->>'status'<>'contract_coverage_required' then raise exception 'Existing unsupported market not held: %',result;end if;
 if (select zip from public.icash_discovery_configs where account_id=a)<>'38118' then raise exception 'Existing selected market silently changed';end if;
 update public.icash_signing_templates set reviewed_until=now()-interval '1 day' where kind='assignment';
 if public.icash_market_contract_ready('75217',1) then raise exception 'Expired template allowed';end if;
 if has_function_privilege('anon','public.icash_market_contract_ready(text,integer)','execute') then raise exception 'Anonymous coverage function exposed';end if;
end $$;
rollback;
select 'PASS: TX one-signer coverage, AL/TN/multiple-owner holds, covered-only funded allocation, inventory restriction, existing market preservation, expiry, and service-only access' as result;
