-- Rollback-only integration against installed functions. No provider requests.
-- Synthetic account, consent, credits and receipt never become visible to workers.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $$
declare u uuid:=gen_random_uuid();a uuid:=gen_random_uuid();lead uuid:=gen_random_uuid();s uuid;d uuid;t uuid;
 r public.icash_operation_rates;cr uuid;g uuid;m uuid;permission jsonb;payload jsonb;tz text;mutation text;
 key text:='seller-recovery-production-rollback:'||gen_random_uuid();
 sender text:='+12025550100';recipient text:='+12025550101';
begin
 select name into strict tz from pg_timezone_names where extract(hour from now() at time zone name)=12 limit 1;
 select * into strict r from public.icash_operation_rates where operation='sms_send' and public.icash_sms_intake_rate_current(id) order by verified_at desc,id limit 1;
 insert into auth.users(id,email) values(u,key||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,billing_model) values(a,u,'Rollback Fixture',false,'membership_credits');
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,10000,0,'USD');
 insert into public.icash_spend_activations(account_id,enabled,customer_cap_cents) values(a,true,10000);
 insert into public.icash_funding_orders(account_id,mode,guest_hash,pack_code,price_cents,credit_cents,state,credited_at)
 values(a,'live',encode(sha256(convert_to(key||':funding','UTF8')),'hex'),'start',10000,10000,'paid',now());
 insert into public.icash_memberships(mode,guest_hash,account_id,price_cents,offer_revision,state,paid_through,consent_version,consent_text)
 values('live',encode(sha256(convert_to(key,'UTF8')),'hex'),a,100,1,'active',now()+interval '1 day','rollback-fixture','Synthetic rollback only');
 insert into public.icash_customer_identities(account_id,first_name,last_name,company_name,voice_id,voice_name)
 values(a,'Rollback','Fixture','Rollback fixture business','fixture_voice','Fixture');
 perform public.icash_record_outreach_campaign(a,u,'sms_inbound','outreach-channels-2026-10-03.1',true);
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at)
 values(a,key,jsonb_build_object('propertyId','prop_'||replace(lead::text,'-',''),'sellerRequest',jsonb_build_object('id',lead)),'complete','{"financialCheck":{"status":"eligible"}}',now()) returning id into s;
 insert into public.icash_deal_files(account_id,screening_id,terms,stage)
 values(a,s,'{"state":"TX","address":"ROLLBACK FIXTURE ONLY","practice":false}','draft') returning id into d;
 insert into public.icash_seller_intakes(id,request_id,guest_hash,duplicate_key,name,address,phone,ai_consented,consent_version,consent_text,sharing_text,agent_hash,attribution,state,data_rights_until,contact_consent_scope)
 values(lead,gen_random_uuid(),repeat('a',64),encode(sha256(convert_to(key,'UTF8')),'hex'),'Rollback Fixture','ROLLBACK FIXTURE ONLY',recipient,true,
 'homeoffer-seller-contact-2026-10-05.4','I agree to marketing calls, texts and emails about my property from HomeOffer Network and its matched buyers, including automated texts and AI-generated voice calls. Consent is not a condition of buying or selling. Message/data rates may apply. Reply STOP to texts or unsubscribe from emails.',
 'Synthetic rollback only',repeat('b',64),jsonb_build_object('contactTimezone',tz,'contactTimezoneSource','owner_test_context'),'assigned',now()+interval '1 day','homeoffer_network_and_matched_buyers');
 insert into public.icash_credit_reservations(account_id,operation_key,amount_cents,status,settled_cents)
 values(a,key,1,'settled',1) returning id into cr;
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until,charged_cents,actual_micros,settled_at)
 values(key,a,r.id,cr,1,0,'settled',now()+interval '1 day',1,0,now());
 insert into public.icash_seller_matches(lead_id,account_id,screening_id,operation_key,charge_cents) values(lead,a,s,key,1);
 permission:=public.icash_seller_contact_evidence(a,s,lead,recipient);
 if permission is null then raise exception 'Fixture contact evidence missing';end if;
 insert into public.icash_text_senders(phone,enabled) values(sender,true);
 insert into public.icash_text_threads(account_id,deal_id,sender,recipient,permission_until,permission_evidence,timezone,dnc_checked_at,dnc_clear,sms_rate_id,paused,ai_mode,party,seller_intake_id,seller_sms_rate_hash,seller_sms_price_micros)
 values(a,d,sender,recipient,(permission->>'until')::timestamptz,permission->>'evidence',tz,null,false,r.id,false,'auto','seller',lead,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),(select customer_micros from public.icash_communication_prices where operation='sms_segment')) returning id into t;
 if not public.icash_seller_sms_permission_current(a,t,true) then raise exception 'Fixture contact permission missing';end if;
 if public.icash_seller_conversation_context(a,t) is null then raise exception 'Fixture conversation context missing';end if;
 -- Enabling templates here is isolated by this uncommitted transaction.
 update public.icash_seller_recovery_variants set enabled=true;
 g:=public.icash_open_seller_gap(a,t,'call',gen_random_uuid(),'no_response','Rollback-only unanswered call',now()-interval '25 hours');
 if g is null then raise exception 'Recovery gap not captured';end if;
 m:=public.icash_prepare_seller_recovery(a,g);
 if m is null then raise exception 'Recovery not queued';end if;
 -- The source is old enough for the cadence. Its financial screen expires too.
 update public.icash_screening_jobs set completed_at=now()-interval '25 hours' where id=s;
 if not public.icash_seller_recovery_current(g) then raise exception 'Recovery source unexpectedly stale';end if;
 -- Each negative case restores itself using a PL/pgSQL subtransaction.
 foreach mutation in array array[
  format('update public.icash_accounts set bot_paused=true where id=%L',a),
  'update public.icash_seller_recovery_variants set enabled=false',
  format('update public.icash_text_messages set body=%L where id=%L','I can offer $250,000',m),
  format('update public.icash_text_threads set permission_until=now()-interval ''1 hour'' where id=%L',t),
  format('update public.icash_screening_jobs set result=%L::jsonb where id=%L','{"financialCheck":{"status":"ineligible"}}',s),
  format('insert into public.icash_text_suppressions(phone,reason) values(%L,%L)',recipient,'Rollback-only opt-out')
 ] loop
  begin
   execute mutation;
   if public.icash_claim_text(a,m,sender) is not null then raise exception 'Recovery ignored a changed dispatch control';end if;
   raise exception using errcode='ZX001',message='Restore negative fixture';
  exception when sqlstate 'ZX001' then null;end;
 end loop;
 begin
  update public.icash_wallets set balance_cents=0 where account_id=a;
  perform public.icash_claim_text(a,m,sender);
  raise exception 'Zero-balance recovery accepted';
 exception when others then if sqlerrm<>'Insufficient credits' then raise;end if;end;
 begin
  update public.icash_memberships set state='cancelled',paid_through=now()-interval '1 day' where account_id=a;
  perform public.icash_claim_text(a,m,sender);
  raise exception 'Inactive membership accepted';
 exception when others then if sqlerrm<>'Software membership is inactive' then raise;end if;end;
 -- An arbitrary price-bearing text cannot reuse the non-price exception.
 begin
  payload:=public.icash_claim_text(a,public.icash_queue_text(a,t,gen_random_uuid(),'I can offer $250,000','{}'),sender);
  if payload is not null then raise exception 'Ordinary price text bypassed valuation freshness';end if;
  raise exception using errcode='ZX001',message='Restore arbitrary message fixture';
 exception when sqlstate 'ZX001' then null;end;
 payload:=public.icash_claim_text(a,m,sender);
 if payload is null then raise exception 'Approved non-price recovery is blocked by expired valuation';end if;
 if public.icash_claim_text(a,m,sender) is not null then raise exception 'Recovery claimed twice';end if;
 if (select balance_cents from public.icash_wallets where account_id=a)<>10000 then raise exception 'Claim charged uncompleted usage';end if;
 -- Simulated receipt reconciliation only: there is no carrier send.
 perform public.icash_accept_text(a,m,key||':receipt');
 perform public.icash_ingest_text_event(jsonb_build_object('id',key||':delivered','type','text.delivery.confirmed','timestamp',extract(epoch from now()),'data',jsonb_build_object('from',sender,'to',recipient,'message_id',key||':receipt')),false);
 if (select state from public.icash_text_messages where id=m)<>'delivered' then raise exception 'Recovery receipt missing';end if;
 if (select delivered_at from public.icash_seller_recovery_attempts where gap_id=g) is null then raise exception 'Recovery outcome missing';end if;
end $$;
rollback;
select 'Seller recovery dispatch integration passed; fixtures rolled back; no provider calls.' as result;
