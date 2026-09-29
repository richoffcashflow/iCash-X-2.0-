begin;
do $$
declare u uuid:=gen_random_uuid();a uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();a2 uuid:=gen_random_uuid();key text:='mailbox-rollback:'||gen_random_uuid();s uuid;d uuid;t uuid;e uuid;ae uuid;r uuid;er uuid;tr uuid;reply uuid;mark uuid;mail uuid;rk uuid:=gen_random_uuid();n integer;body text;
begin
 insert into auth.users(id,email) values(u,key||'@example.invalid'),(u2,key||'-other@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',true,1000),(a2,u2,'Other fixture',true,1000);
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state) values(a,key,'{"propertyId":"prop_123"}','complete') returning id into s;
 insert into public.icash_deal_files(account_id,screening_id,terms,stage) values(a,s,'{"state":"TX","priceCents":100000,"seller":"Fixture","buyer":"Fixture","address":"Fixture","titleEmail":"escrow@example.invalid","assignmentFeeCents":10000,"assignmentDepositCents":5000}','under_contract') returning id into d;
 select id into t from public.icash_signing_templates where state_code='TX' and kind='purchase' and signer_count=1 and test_mode limit 1;
 if t is null then raise exception 'Test fixture template required';end if;
 insert into public.icash_signing_envelopes(account_id,deal_id,kind,template_id,terms,terms_hash,recipients,test_mode,consent_version,requested_by,state)
 values(a,d,'purchase',t,'{}',repeat('a',64),'[{"email":"seller@example.invalid","name":"Seller"},{"email":"owner@example.invalid","name":"Owner"}]',true,'fixture-only',u,'completed') returning id into e;
 select id into r from public.icash_operation_rates where operation='title_email' and enabled limit 1;
 select id into er from public.icash_operation_rates where operation='manual_email' and enabled limit 1;
 if er is null then raise exception 'Manual email baseline missing';end if;
 insert into public.icash_title_contacts(account_id,deal_id,email,verified_until,evidence_ref,rate_id,enabled) values(a,d,'escrow@example.invalid',now()+interval '1 day','rollback-only verified contact',r,true);
 insert into public.icash_title_requests(account_id,deal_id,purchase_envelope_id,recipient,property_address,rate_id,verified_until,state) values(a,d,e,'escrow@example.invalid','Fixture',r,now()+interval '1 day','sent') returning id into tr;
 insert into public.icash_title_replies(provider_email_id,account_id,deal_id,request_id,sender,subject,body_text,sender_verified) values(gen_random_uuid(),a,d,tr,'escrow@example.invalid','Fixture','Title opened; deposit confirmed; closing scheduled.',true) returning id into reply;
 begin perform public.icash_confirm_closing_update(a,u,d,reply,'title_opened');raise exception 'Test signature accepted';exception when others then if sqlerrm='Test signature accepted' then raise;end if;end;
 update public.icash_signing_envelopes set test_mode=false where id=e;
 begin perform public.icash_confirm_closing_update(a2,u2,d,reply,'title_opened');raise exception 'Cross-tenant closing accepted';exception when others then if sqlerrm='Cross-tenant closing accepted' then raise;end if;end;
 update public.icash_title_replies set sender_verified=false where id=reply;
 begin perform public.icash_confirm_closing_update(a,u,d,reply,'title_opened');raise exception 'Unverified reply accepted';exception when others then if sqlerrm='Unverified reply accepted' then raise;end if;end;
 update public.icash_title_replies set sender_verified=true where id=reply;
 mark:=public.icash_confirm_closing_update(a,u,d,reply,'title_opened');
 if public.icash_confirm_closing_update(a,u,d,reply,'title_opened')<>mark then raise exception 'Closing replay not idempotent';end if;
 begin perform public.icash_confirm_closing_update(a,u,d,reply,'title_opened',null,null,'conflict');raise exception 'Closing replay changed evidence';exception when others then if sqlerrm='Closing replay changed evidence' then raise;end if;end;
 begin perform public.icash_confirm_closing_update(a,u,d,reply,'closed',current_date);raise exception 'Missing buyer agreement accepted';exception when others then if sqlerrm='Missing buyer agreement accepted' then raise;end if;end;
 insert into public.icash_signing_envelopes(account_id,deal_id,kind,template_id,terms,terms_hash,recipients,test_mode,consent_version,requested_by,state)
 values(a,d,'assignment',t,'{}',repeat('b',64),'[{"email":"buyer@example.invalid","name":"Buyer"},{"email":"owner@example.invalid","name":"Owner"}]',false,'fixture-only',u,'completed') returning id into ae;
 begin perform public.icash_confirm_closing_update(a,u,d,reply,'closed',current_date);raise exception 'Missing deposit accepted';exception when others then if sqlerrm='Missing deposit accepted' then raise;end if;end;
 perform public.icash_confirm_closing_update(a,u,d,reply,'deposit_received',null,5000);
 begin perform public.icash_confirm_closing_update(a,u,d,reply,'closed',current_date+1);raise exception 'Future closing accepted';exception when others then if sqlerrm='Future closing accepted' then raise;end if;end;
 perform public.icash_confirm_closing_update(a,u,d,reply,'closing_scheduled',current_date);
 perform public.icash_confirm_closing_update(a,u,d,reply,'closed',current_date);
 if (select stage from public.icash_deal_files where id=d)<>'closed' then raise exception 'Verified closing not saved';end if;
 if (select count(*) from public.icash_deal_email_contacts(a2,d))<>0 then raise exception 'Cross-tenant contacts leaked';end if;
 if exists(select 1 from public.icash_deal_email_contacts(a,d) where email='owner@example.invalid') then raise exception 'Customer included as counterparty';end if;
 select count(*) into n from public.icash_deal_email_contacts(a,d);if n<>3 then raise exception 'Expected seller, buyer and title contacts, got %',n;end if;
 begin perform public.icash_queue_deal_email(a2,u2,d,'title',rk,'Hi','Fixture',er);raise exception 'Cross-tenant email queued';exception when others then if sqlerrm='Cross-tenant email queued' then raise;end if;end;
 begin perform public.icash_queue_deal_email(a,u,d,'unknown',rk,'Hi','Fixture',er);raise exception 'Unknown contact accepted';exception when others then if sqlerrm='Unknown contact accepted' then raise;end if;end;
 mail:=public.icash_queue_deal_email(a,u,d,'title',rk,'Hi','Fixture',er);
 if public.icash_queue_deal_email(a,u,d,'title',rk,'Hi','Fixture',er)<>mail then raise exception 'Email replay not idempotent';end if;
 begin perform public.icash_queue_deal_email(a,u,d,'title',rk,'Hi','Changed',er);raise exception 'Email replay altered body';exception when others then if sqlerrm='Email replay altered body' then raise;end if;end;
 if public.icash_claim_deal_email(a2,mail) is not null then raise exception 'Cross-tenant email claim accepted';end if;
 -- Inbound routing tests use a simulated provider state, never an external request.
 update public.icash_deal_emails set state='accepted',provider_id=gen_random_uuid() where id=mail;
 perform public.icash_record_deal_email_reply(gen_random_uuid(),mail,'attacker@example.invalid','Reply','Not ours',true);
 perform public.icash_record_deal_email_reply(gen_random_uuid(),mail,'escrow@example.invalid','Reply','Unauthenticated',false);
 if exists(select 1 from public.icash_deal_emails where direction='incoming' and account_id=a) then raise exception 'Unverified inbound exposed';end if;
 rk:=gen_random_uuid();perform public.icash_record_deal_email_reply(rk,mail,'escrow@example.invalid','Reply','Confirmed',true);
 perform public.icash_record_deal_email_reply(rk,mail,'escrow@example.invalid','Reply','Confirmed',true);
 if (select count(*) from public.icash_deal_emails where direction='incoming' and account_id=a)<>1 then raise exception 'Inbound duplicate or lost reply';end if;
 if not exists(select 1 from public.icash_title_replies where provider_email_id=rk and account_id=a and deal_id=d and sender_verified) then raise exception 'Manual title email not linked to closing evidence';end if;
end $$;
rollback;
