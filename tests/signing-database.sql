begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); s uuid; d uuid; t uuid; e public.icash_signing_envelopes; terms jsonb; p uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(u,u||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name) values(a,u,'Fixture');
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state) values(a,u::text,'{"propertyId":"prop_123"}','complete') returning id into s;
 terms:='{"state":"TX","priceCents":100000,"seller":"Fixture seller","buyer":"Fixture customer","legalDescription":"Lot 1"}';
 insert into public.icash_deal_files(account_id,screening_id,terms) values(a,s,terms) returning id into d;
 insert into public.icash_signing_templates(state_code,kind,signer_count,provider_template_id,placeholder_names,field_map,reviewed_until,review_reference,test_mode,enabled)
 values('TX','purchase',1,p,'["Seller","Customer"]','{}',now()+interval '1 day','rollback fixture',true,true) returning id into t;
 e:=public.icash_begin_signing(u,a,d,'purchase',t,repeat('a',64),'[{"id":"1","email":"seller@example.invalid"},{"id":"2","email":"customer@example.invalid"}]');
 begin
  perform public.icash_begin_signing(u,a,d,'purchase',t,repeat('a',64),'[{"id":"1"},{"id":"2"}]');
  raise exception 'Duplicate envelope accepted';
 exception when unique_violation then null;end;
 update public.icash_signing_envelopes set provider_id=p,state='awaiting_counterparty' where id=e.id;
 update public.icash_signing_templates set provider='docuseal',automated_signing_reviewed=true,customer_signature_field='Signature' where id=t;
 update public.icash_signing_envelopes set state='customer_signature_needed' where id=e.id;
 insert into public.icash_signature_authorizations(envelope_id,account_id,actor_user_id,terms_hash,signature_text,expires_at) values(e.id,a,u,repeat('a',64),'Fixture Name',now()+interval '1 hour');
 update public.icash_accounts set bot_paused=true where id=a;
 if public.icash_claim_auto_signature(a,e.id,repeat('a',64)) is not null then raise exception 'Paused bot signed';end if;
 update public.icash_accounts set bot_paused=false where id=a;
 if public.icash_claim_auto_signature(a,e.id,repeat('b',64)) is not null then raise exception 'Wrong terms signed';end if;
 if public.icash_claim_auto_signature(a,e.id,repeat('a',64)) is distinct from 'Fixture Name' then raise exception 'Authorized signing claim failed';end if;
 if public.icash_claim_auto_signature(a,e.id,repeat('a',64)) is not null then raise exception 'Duplicate auto-sign';end if;
 perform public.icash_save_signing_status(e.id,'test_completed',jsonb_build_object('id',p,'status','Completed','test_mode',true));
 if (select stage from public.icash_deal_files where id=d)<>'draft' then raise exception 'Test signed a real contract';end if;
 if has_table_privilege('anon','public.icash_signing_envelopes','SELECT') or has_function_privilege('authenticated','public.icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb)','EXECUTE') then raise exception 'Signing exposed';end if;
 if public.icash_claim_signing_poll(a,e.id) is not true then raise exception 'Initial poll failed';end if;
 if public.icash_claim_signing_poll(a,e.id) is true then raise exception 'Polling unbounded';end if;
end $$;
rollback;
