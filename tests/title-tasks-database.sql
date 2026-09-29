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
 if (select count(*) from public.icash_title_tasks where request_id=title_job and kind='follow_up')<>1 then raise exception 'Follow-up missing';end if;
 if exists(select 1 from public.icash_title_tasks where request_id=title_job and extract(isodow from due_date)>5) then raise exception 'Weekend scheduled';end if;
 update public.icash_title_requests set state='sent' where id=title_job;
 if (select count(*) from public.icash_title_tasks where request_id=title_job)<>1 then raise exception 'Duplicate follow-up';end if;
 perform public.icash_record_title_reply(gen_random_uuid(),'T',title_job,'imposter@example.invalid','Fixture','Closing due '||expected_date,true);
 if exists(select 1 from public.icash_title_tasks where request_id=title_job and kind='deadline') then raise exception 'Unverified sender created tasks';end if;
 perform public.icash_record_title_reply(email_id,'T',title_job,'escrow@example.invalid','Fixture','Closing due '||expected_date||E'
> old deadline 2026-12-31',true);
 perform public.icash_record_title_reply(email_id,'T',title_job,'escrow@example.invalid','Fixture','Closing due '||expected_date,true);
 if (select count(*) from public.icash_title_tasks where request_id=title_job and kind='deadline')<>1 then raise exception 'Duplicate or quoted deadline';end if;
 if exists(select 1 from public.icash_title_tasks where request_id=title_job and kind='follow_up' and state='scheduled') then raise exception 'Reply did not cancel reminder';end if;
 select id into task from public.icash_title_tasks where request_id=title_job and kind='deadline';
 if public.icash_update_title_task(gen_random_uuid(),task,'confirm',expected_date) then raise exception 'Cross-account access';end if;
 if not public.icash_update_title_task(a,task,'confirm',expected_date) then raise exception 'Confirm failed';end if;
 if (select stage from public.icash_deal_files where id=deal)<>'under_contract' then raise exception 'Email changed closing status';end if;
 if has_table_privilege('anon','public.icash_title_tasks','SELECT') or has_table_privilege('authenticated','public.icash_title_tasks','SELECT') then raise exception 'Tasks exposed';end if;
end $$;
rollback;
