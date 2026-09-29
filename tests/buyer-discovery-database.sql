begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); rate uuid; costs jsonb; n bigint; msg text; key text:='cost-test:'||gen_random_uuid(); parts jsonb; screening uuid; deal uuid; template uuid; envelope uuid; job uuid; ticket jsonb; consumed jsonb;buyer_rate uuid;rev uuid;buyer_key text;receipt jsonb;
begin
 insert into auth.users(id,email) values(u,'cost-test-'||u||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',false,10000);
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,10000,0,'USD');
 select jsonb_object_agg(c,case when c='elevenlabs' then 100000 else 0 end) into costs from unnest(array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other']) c;
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) values('seller_call',key,100,costs,'fixture:rollback-only',now()-interval '1 minute',now()+interval '1 hour',true) returning id into rate;
 update public.icash_operating_budget set enabled=true,funded_micros=10000000,protected_micros=1000000,reserved_micros=0,spent_micros=0,daily_limit_micros=5000000 where id=1;

 select jsonb_object_agg(c,jsonb_build_object('amountMicros',case when c='elevenlabs' then 100000 else 0 end,'evidenceRef','fixture:reviewed-component')) into parts from jsonb_object_keys(costs) c;
 perform public.icash_reserve_operation(a,key,rate,now()+interval '1 hour',now(),true);
 perform public.icash_claim_operation(key);
 begin
  perform public.icash_settle_complete_costs(key,100,parts-'twilio','fixture:complete-costs');
  raise exception 'Missing component accepted';
 exception when others then if sqlerrm<>'All cost categories required' then raise;end if;end;
 perform public.icash_settle_complete_costs(key,100,parts,'fixture:complete-costs');
 perform public.icash_settle_complete_costs(key,100,parts,'fixture:complete-costs');
 if (select balance_cents from public.icash_wallets where account_id=a)<>9900 then raise exception 'Double wallet debit';end if;
 if (select spent_micros from public.icash_operating_budget where id=1)<>100000 then raise exception 'Double provider cost';end if;
 begin
  perform public.icash_settle_complete_costs(key,99,parts,'fixture:complete-costs');
  raise exception 'Changed settlement accepted';
 exception when others then if sqlerrm<>'Cost manifest conflict' then raise;end if;end;

 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state) values(a,key,'{"propertyId":"prop_123"}','complete') returning id into screening;
 insert into public.icash_deal_files(account_id,screening_id,terms,stage) values(a,screening,'{"state":"TX","priceCents":100000,"seller":"Fixture","buyer":"Fixture"}','under_contract') returning id into deal;
 select id into template from public.icash_signing_templates where state_code='TX' and kind='purchase' and signer_count=1 and test_mode;
 if template is null then
 insert into public.icash_signing_templates(state_code,kind,signer_count,provider_template_id,placeholder_names,field_map,reviewed_until,review_reference,test_mode,enabled)
 values('TX','purchase',1,gen_random_uuid(),'["Seller","Customer"]','{}',now()+interval '1 day','rollback fixture',true,true) returning id into template;
 end if;
 insert into public.icash_signing_envelopes(account_id,deal_id,kind,template_id,terms,terms_hash,recipients,test_mode,consent_version,requested_by,state)
 values(a,deal,'purchase',template,'{}',repeat('a',64),'[]',true,'fixture-only',u,'completed') returning id into envelope;
 perform public.icash_queue_fulfillment();
 if exists(select 1 from public.icash_fulfillment_jobs where deal_id=deal) then raise exception 'Test signature queued live preparation';end if;
 update public.icash_signing_envelopes set test_mode=false where id=envelope;
 perform public.icash_queue_fulfillment();perform public.icash_queue_fulfillment();
 if (select count(*) from public.icash_fulfillment_jobs where deal_id=deal)<>1 then raise exception 'Duplicate preparation';end if;
 ticket:=public.icash_next_automation();consumed:=public.icash_consume_automation(ticket->>'token');
 if consumed->>'kind'<>'fulfillment' then raise exception 'Preparation ticket missing';end if;
 if public.icash_consume_automation(ticket->>'token') is not null then raise exception 'Ticket replay';end if;
 job:=(consumed->>'fulfillmentJobId')::uuid;
 update public.icash_accounts set bot_paused=true where id=a;
 begin
  perform public.icash_save_fulfillment(job,'{}','[{"kind":"title_packet","html":"Fixture draft"}]','[]');
  raise exception 'Stop ignored';
 exception when others then if sqlerrm<>'Work paused' then raise;end if;end;
 update public.icash_accounts set bot_paused=false where id=a;
 perform public.icash_save_fulfillment(job,'{"sent":false}','[{"kind":"title_packet","html":"Fixture draft"}]','[]');
 perform public.icash_save_fulfillment(job,'{"sent":false}','[{"kind":"title_packet","html":"Fixture draft"}]','[]');
 if (select count(*) from public.icash_deal_documents where fulfillment_job_id=job)<>1 then raise exception 'Duplicate document';end if;

 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled)
 values('buyer_discovery',key||':buyer-rate',100,costs,'fixture:buyer-rate',now()-interval '1 minute',now()+interval '1 hour',true) returning id into buyer_rate;
 insert into public.icash_buyer_search_configs(account_id,enabled,rate_id,unit_cost_micros,rights_until,zip,since) values(a,true,buyer_rate,10000,now()+interval '1 hour','75201',current_date-365) returning revision into rev;
 begin
 update public.icash_buyer_search_configs set zip='75202' where account_id=a;
 raise exception 'Changed search reused revision';
 exception when others then if sqlerrm<>'New buyer search revision required' then raise;end if;end;
 buyer_key:='buyers:'||deal||':'||rev||':1';
 perform public.icash_reserve_operation(a,buyer_key,buyer_rate,now()+interval '1 hour');
 update public.icash_accounts set bot_paused=true where id=a;
 if public.icash_claim_buyer_search(a,deal,rev,buyer_key) then raise exception 'Paused buyer search claimed';end if;
 update public.icash_accounts set bot_paused=false where id=a;
 if not public.icash_claim_buyer_search(a,deal,rev,buyer_key) then raise exception 'Buyer claim failed';end if;
 if public.icash_claim_buyer_search(a,deal,rev,buyer_key) then raise exception 'Duplicate paid buyer search';end if;
 receipt:='{"creditsUsed":1,"peopleCredits":1,"propertyCredits":0,"estimatedCredits":1,"hasNextPage":false,"fetchedAt":"2026-09-29T00:00:00Z","candidates":[{"personId":"per_fixture","propertyId":"prop_123","name":"Fixture potential buyer","phones":[],"emails":[]}]}';
 perform public.icash_save_buyer_search(a,deal,rev,1,buyer_key,receipt);
 perform public.icash_save_buyer_search(a,deal,rev,1,buyer_key,receipt);
 if (select count(*) from public.icash_buyer_candidates where deal_id=deal)<>1 then raise exception 'Duplicate buyer';end if;
 if exists(select 1 from public.icash_buyer_profiles where account_id=a and criteria<>'{}') then raise exception 'Discovery invented buying criteria';end if;
 if (select count(*) from public.icash_buyer_search_receipts where deal_id=deal)<>1 then raise exception 'Duplicate receipt';end if;
 if has_function_privilege('authenticated','public.icash_claim_buyer_search(uuid,uuid,uuid,text)','EXECUTE') or has_table_privilege('anon','public.icash_buyer_candidates','SELECT') then raise exception 'Buyer data exposed';end if;
 if has_table_privilege('anon','public.icash_cost_manifests','SELECT') or has_table_privilege('authenticated','public.icash_buyer_profiles','SELECT') or has_function_privilege('authenticated','public.icash_settle_complete_costs(text,bigint,jsonb,text)','EXECUTE') then raise exception 'Service records exposed';end if;
end $$;
rollback;
