begin;
do $$
declare u uuid:=gen_random_uuid();a uuid:=gen_random_uuid();r uuid;s uuid;t uuid;old_token text;response jsonb;returned uuid;
begin
 insert into auth.users(id,email) values(u,u||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',false,10000);
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,10000,0,'USD');
 select id into r from public.icash_operation_rates where operation='owner_enrichment' limit 1;
 insert into public.icash_discovery_configs(account_id,zip,rate_id,contact_rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents,enabled,auto_enabled,contacts_enabled,max_open_prospects)
 values(a,'75217',r,r,10000,now()+interval '1 day',100000,true,true,true,1);
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at) values(a,'workflow:'||a,'{"propertyId":"prop_555555","propertyType":"house"}','complete','{"financialCheck":{"status":"eligible"}}',now()-interval '1 hour') returning id into s;
 insert into public.icash_automation_tickets(account_id,kind,screening_id,expires_at) values(a,'contacts',s,now()-interval '1 minute') returning id,token into t,old_token;
 update public.icash_operating_budget set enabled=true where id=1;
 response:=public.icash_next_acquisition();
 if response->>'token' is null or response->>'token'=old_token then raise exception 'Expired ticket not recovered';end if;
 if public.icash_consume_automation(old_token) is not null then raise exception 'Old capability still works';end if;
 if (select issue_attempts from public.icash_automation_tickets where id=t)<>2 then raise exception 'Attempt count missing';end if;
 perform public.icash_consume_automation(response->>'token');
 update public.icash_automation_tickets set state='held',outcome='held_for_reconciliation' where id=t;
 update public.icash_discovery_configs set next_run_at=now() where account_id=a;
 if public.icash_enrichment_candidate(a) is not null then raise exception 'Ambiguous consumed ticket retried';end if;
 -- The one eligible unresolved prospect meets this account's acquisition ceiling.
 if public.icash_next_acquisition() is not null then raise exception 'Backlog did not stop new acquisition';end if;
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at) values(a,'workflow2:'||a,'{"propertyId":"prop_555556"}','complete','{"financialCheck":{"status":"hold"}}',now());
 select id into returned from public.icash_prioritized_work(a,0) limit 1;
 if returned<>s then raise exception 'Eligible prospect buried by newest lookup';end if;
 if exists(select 1 from public.icash_prioritized_work(gen_random_uuid(),0)) then raise exception 'Tenant isolation failed';end if;
 update public.icash_accounts set bot_paused=true where id=a;
 update public.icash_discovery_configs set next_run_at=now(),max_open_prospects=100 where account_id=a;
 if public.icash_next_acquisition() is not null then raise exception 'Paused account acquired data';end if;
 if has_function_privilege('authenticated','public.icash_prioritized_work(uuid,integer)','execute') then raise exception 'Client can select another tenant';end if;
end $$;
rollback;
