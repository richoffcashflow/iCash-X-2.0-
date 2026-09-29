begin;
do $$
declare u uuid:=gen_random_uuid();v uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();s uuid;t uuid;other uuid;r uuid;rev uuid;tag text:=gen_random_uuid()::text;
begin
 insert into auth.users(id,email) values(u,tag||'a@example.invalid'),(v,tag||'b@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',false,1000),(b,v,'Fixture',false,1000);
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,10000,0,'USD');
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state) values(a,tag||'a','{"propertyId":"prop_990001"}','complete') returning id into s;
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state) values(b,tag||'b','{"propertyId":"prop_990001"}','complete') returning id into t;
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state) values(b,tag||'c','{"propertyId":"prop_990002"}','complete') returning id into other;
 if not public.icash_claim_inventory(a,s,'+12125550191') then raise exception 'First claim denied';end if;
 if public.icash_claim_inventory(b,t,'+12125550192') then raise exception 'Property collision';end if;
 if public.icash_claim_inventory(b,other,'+12125550191') then raise exception 'Phone collision';end if;
 if exists(select 1 from public.icash_inventory_claims where resource_key='property:prop_990002') then raise exception 'Partial claim';end if;
 if public.icash_claim_inventory(b,s,null) then raise exception 'Tenant bypass';end if;
 update public.icash_inventory_claims set cooldown_until=now()-interval '1 day' where account_id=a;
 insert into public.icash_deal_files(account_id,screening_id,terms,stage) values(a,s,'{}','under_contract');
 if public.icash_claim_inventory(b,t,null) then raise exception 'Active contract stolen';end if;
 update public.icash_deal_files set stage='closed' where account_id=a;
 if not public.icash_claim_inventory(b,t,null) then raise exception 'Expired inactive claim not reusable';end if;
 insert into public.icash_text_suppressions(phone,reason) values('+12125550193','Fixture STOP');
 if public.icash_claim_inventory(b,other,'+12125550193') then raise exception 'STOP bypass';end if;
 select id into r from public.icash_operation_rates where operation='property_search' and enabled limit 1;
 insert into public.icash_discovery_configs(account_id,enabled,auto_enabled,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents,exhausted)
 values(a,true,true,'75001',r,10000,now()+interval '1 day',0,true);
 if public.icash_rotate_inventory_market(a) then raise exception 'Invented market';end if;
 insert into public.icash_inventory_markets(account_id,zip,eligible_until) values(a,'75002',now()+interval '1 day');
 if not public.icash_rotate_inventory_market(a) then raise exception 'Eligible rotation failed';end if;
 if not exists(select 1 from public.icash_discovery_configs where account_id=a and zip='75002' and next_page=1 and not exhausted) then raise exception 'Bad rotation state';end if;
 select revision into rev from public.icash_discovery_configs where account_id=a;
 perform public.icash_mark_inventory_empty(a,gen_random_uuid(),1);
 if (select exhausted from public.icash_discovery_configs where account_id=a) then raise exception 'Stale response changed market';end if;
 perform public.icash_mark_inventory_empty(a,rev,1);
 if not (select exhausted from public.icash_discovery_configs where account_id=a) then raise exception 'Empty market not stopped';end if;
 if public.icash_rotate_inventory_market(a) then raise exception 'Cooldown bypass';end if;
 if has_table_privilege('anon','public.icash_inventory_claims','SELECT') or has_function_privilege('authenticated','public.icash_claim_inventory(uuid,uuid,text)','EXECUTE') then raise exception 'Inventory exposure';end if;
end $$;
rollback;
