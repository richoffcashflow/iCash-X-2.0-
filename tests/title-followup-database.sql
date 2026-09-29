begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); key text:='title-task-test:'||gen_random_uuid(); screening uuid;deal uuid;template uuid;envelope uuid;title_rate uuid;title_job uuid;email_id uuid:=gen_random_uuid(); task uuid;expected_date date:=current_date+7;
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

 select id into title_rate from public.icash_operation_rates where operation='title_email' limit 1;
 if title_rate is null then raise exception 'Missing title fixture rate';end if;
 insert into public.icash_title_requests(account_id,deal_id,purchase_envelope_id,recipient,property_address,rate_id,verified_until,state)
 values(a,deal,envelope,'escrow@example.invalid','Fixture',title_rate,now()+interval '1 day','sent') returning id into title_job;

 update public.icash_title_followup_settings set enabled=true where id=1;
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,10000,0,'USD');
 update public.icash_operating_budget set enabled=true,funded_micros=100000000,protected_micros=0,spent_micros=0,reserved_micros=0,daily_limit_micros=null,minimum_margin_bps=8000 where id=1;
 insert into public.icash_title_contacts(account_id,deal_id,email,verified_until,evidence_ref,rate_id,enabled) values(a,deal,'escrow@example.invalid',now()+interval '1 day','fixture-only contact verification',title_rate,true);
 select id into task from public.icash_title_tasks where request_id=title_job and kind='follow_up';
 update public.icash_title_tasks set email_state='issued',due_date=current_date-1 where id=task;
 if public.icash_claim_title_followup(a,task) is not null then raise exception 'Pause bypassed';end if;
 if public.icash_claim_title_followup(gen_random_uuid(),task) is not null then raise exception 'Tenant isolation failed';end if;
 update public.icash_accounts set bot_paused=false where id=a;
 if public.icash_claim_title_followup(a,task) is not null then raise exception 'Test contract accepted';end if;
 update public.icash_signing_envelopes set test_mode=false where id=envelope;
 update public.icash_operating_budget set funded_micros=0 where id=1;
 begin
 perform public.icash_claim_title_followup(a,task);raise exception 'Zero operating funds accepted';
 exception when others then if sqlerrm='Zero operating funds accepted' then raise;end if;end;
 if exists(select 1 from public.icash_operation_spend where operation_key='title-followup:'||task) then raise exception 'Failed claim stranded reservation';end if;
 update public.icash_operating_budget set funded_micros=100000000 where id=1;
 if public.icash_claim_title_followup(a,task) is null then raise exception 'Valid claim rejected';end if;
 if public.icash_claim_title_followup(a,task) is not null then raise exception 'Duplicate claim accepted';end if;
 if (select count(*) from public.icash_operation_spend where operation_key='title-followup:'||task)<>1 then raise exception 'Reservation missing or duplicated';end if;
end $$;
rollback;
