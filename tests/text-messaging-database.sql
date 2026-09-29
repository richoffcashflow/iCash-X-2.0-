begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); key text:='title-task-test:'||gen_random_uuid(); screening uuid;deal uuid;template uuid;envelope uuid;title_rate uuid;title_job uuid;email_id uuid:=gen_random_uuid(); task uuid;expected_date date:=current_date+7; th uuid;msg uuid;msg2 uuid; req uuid:=gen_random_uuid(); ev jsonb;tz text;
begin
 insert into auth.users(id,email) values(u,key||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',true,1000);
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state) values(a,key,'{"propertyId":"prop_123"}','complete') returning id into screening;
 insert into public.icash_deal_files(account_id,screening_id,terms,stage) values(a,screening,'{"state":"TX","priceCents":100000,"seller":"Fixture","buyer":"Fixture","address":"Fixture","titleEmail":"escrow@example.invalid","assignmentFeeCents":10000}','under_contract') returning id into deal;
 select id into template from public.icash_signing_templates where state_code='TX' and kind='purchase' and signer_count=1 and test_mode;
 if template is null then
 insert into public.icash_signing_templates(state_code,kind,signer_count,provider_template_id,placeholder_names,field_map,reviewed_until,review_reference,test_mode,enabled)
 values('TX','purchase',1,gen_random_uuid(),'["Seller","Customer"]','{}',now()+interval '1 day','rollback fixture',true,true) returning id into template;
 end if;
 insert into public.icash_signing_envelopes(account_id,deal_id,kind,template_id,terms,terms_hash,recipients,test_mode,consent_version,requested_by,state)
 values(a,deal,'purchase',template,'{}',repeat('a',64),'[]',true,'fixture-only',u,'completed') returning id into envelope;


 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,10000,0,'USD');
 update public.icash_operating_budget set enabled=true,funded_micros=100000000,protected_micros=0,spent_micros=0,reserved_micros=0,daily_limit_micros=null,minimum_margin_bps=8000 where id=1;
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled)
 select 'sms_send',key,charge_cents,costs_micros,'rollback fixture only',now(),now()+interval '1 hour',true from public.icash_operation_rates where operation='title_email' limit 1 returning id into title_rate;
 select name into tz from pg_timezone_names where extract(hour from now() at time zone name)=12 limit 1;
 insert into public.icash_text_threads(account_id,deal_id,sender,recipient,permission_until,permission_evidence,timezone,dnc_checked_at,dnc_clear,sms_rate_id,paused)
 values(a,deal,'+14243948384','+12125550123',now()+interval '1 hour','fixture explicit SMS permission',tz,now(),true,title_rate,false) returning id into th;
 msg:=public.icash_queue_text(a,th,req,'Hello','{}');
 if public.icash_queue_text(a,th,req,'Hello','{}')<>msg then raise exception 'Duplicate message';end if;
 begin perform public.icash_queue_text(gen_random_uuid(),th,gen_random_uuid(),'Hello','{}');raise exception 'Tenant bypass';exception when others then if sqlerrm='Tenant bypass' then raise;end if;end;
 if public.icash_claim_text(a,msg,'+14243948384') is not null then raise exception 'Pause bypassed';end if;
 update public.icash_accounts set bot_paused=false where id=a;
 if public.icash_claim_text(a,msg,'+14243948384') is null then raise exception 'Valid claim failed';end if;
 if public.icash_claim_text(a,msg,'+14243948384') is not null then raise exception 'Duplicate send claim';end if;
 ev:=jsonb_build_object('id',key||':delivered','type','text.delivery.confirmed','timestamp',extract(epoch from now()),'data',jsonb_build_object('from','+14243948384','to','+12125550123','message_id',key));
 perform public.icash_ingest_text_event(ev,false);
 perform public.icash_accept_text(a,msg,key);
 if (select state from public.icash_text_messages where id=msg)<>'delivered' then raise exception 'Early delivery receipt lost';end if;
 ev:=jsonb_set(jsonb_set(ev,'{id}',to_jsonb(key||':failed')),'{type}','"text.delivery.failed"');perform public.icash_ingest_text_event(ev,false);
 if (select state from public.icash_text_messages where id=msg)<>'delivered' then raise exception 'Delivery downgraded';end if;
 msg2:=public.icash_queue_text(a,th,gen_random_uuid(),'Second message','{}');
 ev:=jsonb_build_object('id',key||':stop','type','text.incoming.sms','timestamp',extract(epoch from now()),'data',jsonb_build_object('from','+12125550123','to','+14243948384','body','STOP'));
 perform public.icash_ingest_text_event(ev,true);perform public.icash_ingest_text_event(ev,true);
 if (select count(*) from public.icash_text_messages where event_id=key||':stop')<>1 then raise exception 'Duplicate incoming';end if;
 if (select state from public.icash_text_messages where id=msg2)<>'cancelled' then raise exception 'Pending send survived STOP';end if;
 msg2:=public.icash_queue_text(a,th,gen_random_uuid(),'Third message','{}');if public.icash_claim_text(a,msg2,'+14243948384') is not null then raise exception 'STOP bypassed';end if;
 ev:=jsonb_set(jsonb_set(ev,'{id}',to_jsonb(key||':unknown')),'{data,from}','"+12125550124"');perform public.icash_ingest_text_event(ev,false);
 if exists(select 1 from public.icash_text_messages where event_id=key||':unknown' and account_id is not null) then raise exception 'Unknown sender assigned';end if;
 if has_table_privilege('anon','public.icash_text_messages','SELECT') or has_function_privilege('authenticated','public.icash_claim_text(uuid,uuid,text)','EXECUTE') then raise exception 'Messaging exposed';end if;
end $$;
rollback;
