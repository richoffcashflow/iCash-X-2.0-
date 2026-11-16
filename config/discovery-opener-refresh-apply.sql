-- Inactive, separately reviewed DISCOVERY evidence renewal. Never issues a ticket
-- or sends; original messages, purchases and owner provenance remain immutable.
begin;
set local lock_timeout='2s';
set local statement_timeout='8s';
select pg_advisory_xact_lock(726341927);

create function icash_discovery_refresh_private.snapshot(p_message uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;s public.icash_screening_jobs;
 c public.icash_operational_contacts;d public.icash_deal_files;answer jsonb;
begin
 select * into m from public.icash_text_messages where id=p_message;
 if not found then return null;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=m.account_id;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=t.account_id;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=t.account_id;
 select * into c from public.icash_operational_contacts where id=t.operational_contact_id and account_id=t.account_id;
 if m.direction is distinct from 'outgoing' or m.state is distinct from 'ready'
  or m.provider_id is not null or m.last_delivery_at is not null or m.request_key is distinct from t.id
  or cardinality(m.asset_ids) is distinct from 0 or t.party is distinct from 'seller'
  or t.paused is distinct from false or t.manual_only is distinct from false or t.ai_mode is distinct from 'auto'
  or t.retired_at is not null or t.seller_intake_id is not null or t.sms_intake_pending is distinct from false
  or d.stage is distinct from 'draft' or coalesce(d.terms->>'practice','false')<>'false'
  or s.completed_at is null or s.completed_at>clock_timestamp()
  or nullif(s.snapshot->>'fetchedAt','') is null or (s.snapshot->>'fetchedAt')::timestamptz>clock_timestamp()
  or (s.completed_at>clock_timestamp()-interval '24 hours' and c.eligibility_until>clock_timestamp())
  or s.state is distinct from 'complete' or s.result#>>'{financialCheck,status}' is distinct from 'eligible'
  or length(coalesce(s.snapshot#>>'{raw,data,full_address}',''))<8
  or jsonb_typeof(s.snapshot->'assignmentFeeCents') is distinct from 'number'
  or jsonb_typeof(s.snapshot->'sellerCostReserveCents') is distinct from 'number'
  or s.snapshot ? 'sellerRequest' or coalesce(s.snapshot->>'practice','false')<>'false'
  or c.id is null or c.screening_id is distinct from s.id or c.channel is distinct from 'sms'
  or c.phone is distinct from t.recipient or c.timezone is distinct from t.timezone or c.revoked_at is not null
  or t.sender is distinct from t.operational_sms_sender
  or icash_seller_recovery_private.original_contact_binding(t.account_id,c.id) is distinct from true
  or public.icash_membership_work_allowed(t.account_id) is distinct from true
  or public.icash_outreach_sms_current(t.account_id) is distinct from true
  or exists(select 1 from public.icash_text_messages where thread_id=t.id and id<>m.id)
  or exists(select 1 from public.icash_operation_spend where operation_key='text:'||m.id)
  or exists(select 1 from public.icash_text_ai_jobs where thread_id=t.id)
  or exists(select 1 from public.icash_handoffs where account_id=t.account_id and screening_id=s.id and state<>'resolved')
  or exists(select 1 from public.icash_signing_envelopes where account_id=t.account_id and deal_id=d.id and not test_mode)
  or exists(select 1 from public.icash_call_recordings where account_id=t.account_id and screening_id=s.id)
  or exists(select 1 from public.icash_live_conversations where account_id=t.account_id and screening_id=s.id)
  or exists(select 1 from public.icash_text_threads where account_id=t.account_id and deal_id=d.id and id<>t.id)
  or exists(select 1 from public.icash_voice_jobs v left join public.icash_contact_permissions cp on cp.id=v.permission_id
    left join public.icash_operational_contacts op on op.id=v.operational_contact_id
    where v.account_id=t.account_id and (cp.screening_id=s.id or op.screening_id=s.id))
  or exists(select 1 from public.icash_sms_inbound_invitations where thread_id=t.id or message_id=m.id)
  or (select count(*) from public.icash_automation_tickets where opener_message_id=m.id) not between 1 and 2
  or exists(select 1 from public.icash_automation_tickets where opener_message_id=m.id and
    (state not in ('issued','held') or issue_attempts is null or issue_attempts not between 1 and 2 or (state='issued' and expires_at>clock_timestamp()) or account_id<>t.account_id or kind<>'seller_opener'
     or state='held' and coalesce(outcome,'') not in ('expired','message_held','messaging_configuration_required','business_number_mismatch','business_number_verification_required')))
  or exists(select 1 from public.icash_property_controls where account_id=t.account_id and property_id=s.snapshot->>'propertyId' and manual)
  or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=c.contact_key)
  or exists(select 1 from public.icash_contact_permissions where account_id=t.account_id and screening_id=s.id and phone=t.recipient and revoked_at is not null)
  or exists(select 1 from public.icash_billing_reviews where account_id=t.account_id and resolved_at is null)
 then return null;end if;
 select jsonb_build_object('qualityPolicy',(select to_jsonb(p) from icash_research_private.list_quality_settings p where p.id=1),
  'qualityChoices',(select coalesce(jsonb_agg(to_jsonb(choice) order by choice.person_id),'[]') from icash_research_private.owner_sms_choices choice where oc.result->'requestedPersonIds' ? choice.person_id),
  'renewalPolicy',(select to_jsonb(p) from icash_discovery_refresh_private.policy p where p.id=1),'message',to_jsonb(m),'thread',to_jsonb(t),'screening',to_jsonb(s),'deal',to_jsonb(d),
  'contact',to_jsonb(c),'owner',to_jsonb(oc),'receipt',to_jsonb(dr),'source',to_jsonb(src),
  'campaign',(select to_jsonb(campaign) from public.icash_outreach_campaigns campaign where campaign.account_id=t.account_id),
  'account',jsonb_build_object('id',a.id,'owner_user_id',a.owner_user_id,'bot_paused',a.bot_paused),
  'identity',to_jsonb(i),'config',to_jsonb(cfg)-array['next_run_at','next_page','exhausted','inventory_refreshed_at'],'sender',to_jsonb(sender),'route',to_jsonb(route),
  'smsRate',to_jsonb(rate),'assignment',to_jsonb(assignment),
  'tickets',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.icash_automation_tickets x where x.opener_message_id=m.id))
 into answer from public.icash_accounts a
 join public.icash_customer_identities i on i.account_id=a.id and i.principal=c.sending_principal
 join public.icash_discovery_configs cfg on cfg.account_id=a.id and cfg.enabled and cfg.auto_enabled and cfg.contacts_enabled and cfg.data_rights_until>clock_timestamp()
 join public.icash_owner_contacts oc on oc.account_id=a.id and oc.screening_id=s.id and oc.result->>'propertyId'=s.snapshot->>'propertyId'
 join public.icash_operation_spend spent on spent.operation_key=oc.operation_key and spent.account_id=a.id and spent.state='settled'
 join public.icash_dnc_verification_receipts dr on dr.id=c.dnc_receipt_id and dr.clear and dr.revoked_at is null and dr.evidence_kind='national_provider_observation'
 join public.icash_dnc_verification_sources src on src.id=dr.source_id and src.enabled and src.expires_at>clock_timestamp()
 join public.icash_text_senders sender on sender.phone=t.sender and sender.enabled
 join public.icash_sms_routes route on route.sender=t.sender and route.recipient=t.recipient and route.account_id=a.id and not route.needs_review
 join public.icash_operation_rates rate on rate.id=t.sms_rate_id and rate.enabled and rate.verified_at<=clock_timestamp() and rate.expires_at>clock_timestamp()
 join public.icash_seller_opener_assignments assignment on assignment.message_id=m.id and assignment.thread_id=t.id and assignment.account_id=a.id and assignment.body=m.body
  and assignment.learning_context='cash-question-v6'
  and assignment.variant in ('cash_sale_v6','all_cash_v6','cash_offer_v6')
  and m.body=public.icash_seller_cash_question(assignment.variant,public.icash_conversation_street(d.terms->>'address'))
  and assignment.delivered_at is null and assignment.first_reply_at is null and not assignment.opted_out
 where a.id=t.account_id and not a.bot_paused and a.owner_user_id=c.owner_user_id
  and c.source_hash=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex')
  and public.icash_operational_source_phone(oc.result,c.phone)
  -- Snapshot inspection never calls the mutating SMS-choice selector. When
  -- quality policy is active require an already saved same-phone choice.
  and (not exists(select 1 from icash_research_private.list_quality_settings where id=1 and enabled)
   or exists(select 1 from icash_research_private.owner_sms_choices choice
    cross join lateral jsonb_array_elements(oc.result->'contacts') person
    where choice.phone=c.phone and choice.person_id=person->>'personId'
     and oc.result->'requestedPersonIds' ? choice.person_id and person->'likelyOwner'='true'::jsonb
     and exists(select 1 from jsonb_array_elements(person->'phones') ph where public.icash_operational_phone(ph->>'number')=c.phone
      and lower(ph->>'type') in ('wireless','mobile') and ph->'doNotCall'='false'::jsonb)))
  and public.icash_sms_intake_rate_current(rate.id)
  and encode(sha256(convert_to(to_jsonb(rate)::text,'UTF8')),'hex')=t.operational_sms_rate_hash
  and exists(select 1 from public.icash_communication_prices where operation='sms_segment' and customer_micros=t.operational_sms_price_micros);
 return answer;
end $$;

create function icash_discovery_refresh_private.current(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare r icash_discovery_refresh_private.renewals;phone text;
begin
 if not pg_try_advisory_xact_lock(726341927) then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 and enabled for update nowait;if not found then return false;end if;
 select * into r from icash_discovery_refresh_private.renewals where id=p_id for update nowait;
 if not found or r.state not in ('prepared','researching','ready','review') then return false;end if;
 perform 1 from icash_discovery_refresh_private.policy where id=1 and enabled for share nowait;if not found then return false;end if;
 phone:=r.original_snapshot#>>'{thread,recipient}';
 if not pg_try_advisory_xact_lock(hashtextextended(phone,74))
  or not pg_try_advisory_xact_lock(hashtextextended(encode(sha256(convert_to(phone,'UTF8')),'hex'),17)) then return false;end if;
 perform 1 from public.icash_accounts where id=r.account_id for update nowait;
 perform 1 from public.icash_text_threads where id=r.thread_id for update nowait;
 perform 1 from public.icash_text_messages where id=r.message_id for update nowait;
 perform 1 from public.icash_screening_jobs where id=r.screening_id for update nowait;
 perform 1 from public.icash_deal_files where id=(r.original_snapshot#>>'{deal,id}')::uuid for update nowait;
 perform 1 from public.icash_sms_routes where sender=r.original_snapshot#>>'{thread,sender}' and recipient=phone for share nowait;
 perform 1 from public.icash_discovery_configs where account_id=r.account_id for share nowait;
 perform 1 from icash_research_private.list_quality_settings where id=1 for share nowait;
 perform 1 from icash_research_private.owner_sms_choices where r.original_snapshot#>'{owner,result,requestedPersonIds}' ? person_id order by person_id for share nowait;
 perform 1 from public.icash_customer_identities where account_id=r.account_id for share nowait;
 perform 1 from public.icash_outreach_campaigns where account_id=r.account_id for share nowait;
 perform 1 from public.icash_text_senders sender where sender.phone=r.original_snapshot#>>'{thread,sender}' for share nowait;
 return coalesce(r.original_snapshot=icash_discovery_refresh_private.snapshot(r.message_id),false);
exception when lock_not_available then return false;
end $$;

create function icash_discovery_refresh_private.contact_valid(p_account uuid,p_contact uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare r icash_discovery_refresh_private.renewals;q icash_discovery_refresh_private.requests;
 c public.icash_operational_contacts;old public.icash_operational_contacts;d public.icash_dnc_verification_receipts;src public.icash_dnc_verification_sources;stamp timestamptz;
begin
 select * into c from public.icash_operational_contacts where id=p_contact and account_id=p_account for share;
 select * into r from icash_discovery_refresh_private.renewals where successor_contact_id=c.id and account_id=p_account for share;
 if not found or r.state not in ('ready','review','applied') then return false;end if;
 perform 1 from icash_discovery_refresh_private.policy where id=1 for share;
 select * into old from public.icash_operational_contacts where id=r.original_contact_id for share;
 select * into q from icash_discovery_refresh_private.requests where renewal_id=r.id and kind='dnc' for share;
 select * into d from public.icash_dnc_verification_receipts where id=c.dnc_receipt_id and id=r.receipt_id for share;
 select * into src from public.icash_dnc_verification_sources where id=d.source_id for share;
 if icash_seller_recovery_private.original_contact_binding(p_account,old.id) is distinct from true then return false;end if;
 stamp:=clock_timestamp();
 return coalesce(exists(select 1 from icash_discovery_refresh_private.policy p where p.id=1 and p.enabled and to_jsonb(p)=r.original_snapshot->'renewalPolicy')
  and old.revoked_at is null and c.revoked_at is null and c.channel='sms'
  and row(old.account_id,old.screening_id,old.phone,old.contact_key,old.owner_user_id,old.source_hash,old.sending_principal,old.timezone,old.timezone_basis,old.local_start_hour,old.local_end_hour)
   is not distinct from row(c.account_id,c.screening_id,c.phone,c.contact_key,c.owner_user_id,c.source_hash,c.sending_principal,c.timezone,c.timezone_basis,c.local_start_hour,c.local_end_hour)
  and q.request=jsonb_build_object('phones',jsonb_build_array(jsonb_build_object('number',c.phone)))
  and q.settled and q.http_status between 200 and 299 and q.response_at>=q.requested_at
  and exists(select 1 from public.icash_operation_spend where operation_key=q.operation_key and account_id=p_account and state='settled')
  and icash_seller_recovery_private.phone_response_valid(q.response,c.phone)
  and q.response#>'{data,0,matched}'='true'::jsonb and q.response#>'{data,0,do_not_call}'='false'::jsonb
  and d.evidence_kind='national_phone_observation' and d.clear and d.revoked_at is null
  and d.phone=c.phone and d.contact_key=c.contact_key and d.checked_at=q.requested_at and d.observation_recorded_at=q.response_at
  and d.receipt_hash=encode(sha256(convert_to(q.response::text,'UTF8')),'hex')
  and d.observation_provenance->>'sourceTable'='icash_discovery_refresh_private.renewals'
  and d.observation_provenance->>'refreshId'=r.id::text and d.observation_provenance->>'requestId'=q.id::text
  and d.observation_provenance->>'operationKey'=q.operation_key and d.observation_provenance->>'originalContactId'=old.id::text
  and d.observation_provenance->>'accountId'=p_account::text and d.observation_provenance->>'screeningId'=c.screening_id::text
  and src.enabled and src.expires_at>stamp and src.evidence_kind='national_provider_observation'
  and src.observation_provider='dealmachine' and src.observation_scope='national_only'
  and d.checked_at<=stamp and d.expires_at>stamp and c.eligibility_until=d.expires_at
  and d.expires_at<=least(q.requested_at+interval '24 hours',q.requested_at+make_interval(secs=>src.max_observation_age_seconds),src.expires_at)
  and exists(select 1 from public.icash_dnc_verification_receipts where id=old.dnc_receipt_id and source_id=src.id and clear and revoked_at is null),false);
end $$;

-- Pin the entire installed predecessor chain; leave all old scopes unchanged.
do $pin$declare x record;d text;p record;begin
 for x in select * from (values
 ('public.icash_lock_operational_dnc(uuid,uuid)','994a2fd9bd7dd31c51bcfe4254d58071',true,'{postgres=X/postgres,service_role=X/postgres}'),
 ('icash_seller_recovery_private.original_contact_binding(uuid,uuid)','26fff16d3cc4c274e68d60e48b4af0e6',true,'{postgres=X/postgres}'),
 ('public.icash_operational_contact_current(uuid,uuid,text,boolean)','7d47504dc185227f4d508dafcdffc0f1',false,'{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_dealmachine_observation_immutable()','6e4a740fa7d0b585b973a58919ac37f3',false,'{postgres=X/postgres,service_role=X/postgres}')) v(signature,checksum,definer,acl)
 loop
  select md5(pg_get_functiondef(oid)) checksum,pg_get_userbyid(proowner) owner,proacl::text acl,prosecdef,provolatile,proparallel,proconfig into p
   from pg_proc where oid=to_regprocedure(x.signature);
  if p.checksum is distinct from x.checksum then raise exception 'Discovery renewal predecessor changed: %',x.signature;end if;
  if p.owner is distinct from 'postgres' or p.acl is distinct from x.acl or p.prosecdef is distinct from x.definer
   or p.provolatile is distinct from 'v' or p.proparallel is distinct from 'u' or p.proconfig is distinct from array['search_path=""'] then
   raise exception 'Discovery renewal predecessor metadata changed: %',x.signature;
  end if;
 end loop;
 select pg_get_constraintdef(oid) into d from pg_constraint where conrelid='public.icash_dnc_verification_receipts'::regclass and conname='icash_dnc_phone_observation_shape';
 if md5(d) is distinct from '36121bde6cfd0ded016c6f8f9c16fd95' then raise exception 'Discovery renewal DNC shape changed';end if;
 -- Only add a private source-table alternative. Existing observation semantics,
 -- immutable trigger and every old provenance validator remain unchanged.
 if (length(d)-length(replace(d,$boundary$(observation_provenance ->> 'sourceTable'::text) = 'icash_seller_recovery_private.contact_refreshes'::text$boundary$,'')))/length($boundary$(observation_provenance ->> 'sourceTable'::text) = 'icash_seller_recovery_private.contact_refreshes'::text$boundary$)<>1 then raise exception 'Discovery renewal DNC source boundary changed';end if;
 d:=replace(d,$boundary$(observation_provenance ->> 'sourceTable'::text) = 'icash_seller_recovery_private.contact_refreshes'::text$boundary$,
  $boundary$(observation_provenance ->> 'sourceTable'::text) = ANY (ARRAY['icash_seller_recovery_private.contact_refreshes'::text,'icash_discovery_refresh_private.renewals'::text])$boundary$);
 alter table public.icash_dnc_verification_receipts drop constraint icash_dnc_phone_observation_shape;
 execute 'alter table public.icash_dnc_verification_receipts add constraint icash_dnc_phone_observation_shape '||d;
end $pin$;
alter function public.icash_lock_operational_dnc(uuid,uuid) rename to icash_lock_operational_dnc_before_discovery_refresh;
create function public.icash_lock_operational_dnc(p_account uuid,p_contact uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.icash_operational_contacts c join public.icash_dnc_verification_receipts d on d.id=c.dnc_receipt_id
  where c.id=p_contact and c.account_id=p_account and d.observation_provenance->>'sourceTable'='icash_discovery_refresh_private.renewals')
 then return icash_discovery_refresh_private.contact_valid(p_account,p_contact);end if;
 return public.icash_lock_operational_dnc_before_discovery_refresh(p_account,p_contact);
end $$;

create function icash_discovery_refresh_private.process(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r icash_discovery_refresh_private.renewals;q icash_discovery_refresh_private.requests;p icash_discovery_refresh_private.requests;
 c public.icash_operational_contacts;d public.icash_dnc_verification_receipts;src public.icash_dnc_verification_sources;
 until_at timestamptz;receipt uuid;contact uuid;
begin
 if not icash_discovery_refresh_private.current(p_id) then return '{"status":"current_controls_hold"}';end if;
 select * into r from icash_discovery_refresh_private.renewals where id=p_id for update;
 if r.successor_contact_id is not null then return jsonb_build_object('status',r.state);end if;
 select * into q from icash_discovery_refresh_private.requests where renewal_id=r.id and kind='dnc' for share;
 select * into p from icash_discovery_refresh_private.requests where renewal_id=r.id and kind='property' for share;
 if q.settled is distinct from true or p.settled is distinct from true
  or not exists(select 1 from public.icash_operation_spend where operation_key=p.operation_key and account_id=r.account_id and state='settled')
  or not exists(select 1 from public.icash_operation_spend where operation_key=q.operation_key and account_id=r.account_id and state='settled')
  or r.new_snapshot is null or r.new_result#>>'{financialCheck,status}' is distinct from 'eligible'
  or (r.new_snapshot->>'fetchedAt')::timestamptz is distinct from p.requested_at
  or p.requested_at<=clock_timestamp()-interval '24 hours' or p.requested_at>clock_timestamp()
 then return '{"status":"evidence_required"}';end if;
 select * into c from public.icash_operational_contacts where id=r.original_contact_id for share;
 if icash_seller_recovery_private.phone_response_valid(q.response,c.phone) is distinct from true
  or q.http_status not between 200 and 299 or q.response#>'{data,0,matched}' is distinct from 'true'::jsonb
  or q.response#>'{data,0,do_not_call}' is distinct from 'false'::jsonb then return '{"status":"not_clear"}';end if;
 select * into d from public.icash_dnc_verification_receipts where id=c.dnc_receipt_id for share;
 select * into src from public.icash_dnc_verification_sources where id=d.source_id for share;
 until_at:=least(q.requested_at+interval '24 hours',q.requested_at+make_interval(secs=>src.max_observation_age_seconds),src.expires_at,
  (select data_rights_until from public.icash_discovery_configs where account_id=r.account_id));
 if until_at is null or until_at<=clock_timestamp() then return '{"status":"fresh_response_expired"}';end if;
 insert into public.icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear,contact_timezone,timezone_source_reference,evidence_kind,observation_provenance,observation_recorded_at)
 values(src.id,c.phone,c.contact_key,'dealmachine:discovery-renewal:'||r.id,encode(sha256(convert_to(q.response::text,'UTF8')),'hex'),q.requested_at,until_at,true,
 d.contact_timezone,d.timezone_source_reference,'national_phone_observation',jsonb_build_object('provider','dealmachine','scope','national_only',
 'sourceTable','icash_discovery_refresh_private.renewals','refreshId',r.id,'accountId',r.account_id,'screeningId',r.screening_id,
 'originalContactId',c.id,'operationKey',q.operation_key,'requestId',q.id,'freshnessBasis','saved_request_start_lower_bound',
 'providerCheckedAt',null,'registryUpdatedAt',null,'stateClearance','not_established','consentVerification','not_performed','reportedDoNotCall',false),q.response_at) returning id into receipt;
 insert into public.icash_operational_contacts(account_id,screening_id,channel,phone,contact_key,timezone,timezone_basis,local_start_hour,local_end_hour,owner_user_id,sending_principal,source_hash,dnc_receipt_id,eligibility_until)
 values(c.account_id,c.screening_id,'sms',c.phone,c.contact_key,c.timezone,c.timezone_basis,c.local_start_hour,c.local_end_hour,c.owner_user_id,c.sending_principal,c.source_hash,receipt,until_at) returning id into contact;
 update icash_discovery_refresh_private.renewals set receipt_id=receipt,successor_contact_id=contact,state='ready' where id=r.id;
 return jsonb_build_object('status','ready_for_review');
end $$;

create table icash_discovery_refresh_private.reviews(
 id uuid primary key default gen_random_uuid(),renewal_id uuid not null unique references icash_discovery_refresh_private.renewals(id),
 snapshot jsonb not null,note text not null check(length(trim(note))>=12),created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '15 minutes'
);
create table icash_discovery_refresh_private.applies(
 review_id uuid primary key references icash_discovery_refresh_private.reviews(id),renewal_id uuid not null unique references icash_discovery_refresh_private.renewals(id),
 after_thread jsonb not null,after_screening jsonb not null,applied_at timestamptz not null default clock_timestamp()
);
create function icash_discovery_refresh_private.review_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('original',r.original_snapshot,'newSnapshot',r.new_snapshot,'newResult',r.new_result,'contact',to_jsonb(c),'receipt',to_jsonb(d),
 'requests',(select jsonb_agg(to_jsonb(q) order by q.kind) from icash_discovery_refresh_private.requests q where q.renewal_id=r.id))
 from icash_discovery_refresh_private.renewals r join public.icash_operational_contacts c on c.id=r.successor_contact_id
 join public.icash_dnc_verification_receipts d on d.id=r.receipt_id where r.id=p_id
$$;
create function public.icash_review_discovery_opener_refresh(p_id uuid,p_hash text,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare s jsonb;answer uuid;begin
 if length(trim(p_note))<12 or p_note is null or not icash_discovery_refresh_private.current(p_id) then return null;end if;
 s:=icash_discovery_refresh_private.review_snapshot(p_id);
 if s is null or p_hash is distinct from encode(sha256(convert_to(s::text,'UTF8')),'hex') then return null;end if;
 insert into icash_discovery_refresh_private.reviews(renewal_id,snapshot,note) values(p_id,s,p_note) on conflict do nothing returning id into answer;
 if answer is not null then update icash_discovery_refresh_private.renewals set state='review' where id=p_id;end if;
 return answer;
end $$;
create function public.icash_apply_discovery_opener_refresh(p_review uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v icash_discovery_refresh_private.reviews;r icash_discovery_refresh_private.renewals;c public.icash_operational_contacts;d public.icash_dnc_verification_receipts;until_at timestamptz;
begin
 select * into v from icash_discovery_refresh_private.reviews where id=p_review;
 if not found or v.expires_at<=clock_timestamp() or not icash_discovery_refresh_private.current(v.renewal_id) then return false;end if;
 select * into r from icash_discovery_refresh_private.renewals where id=v.renewal_id for update;
 if r.state<>'review' or v.snapshot is distinct from icash_discovery_refresh_private.review_snapshot(r.id)
  or exists(select 1 from icash_discovery_refresh_private.applies where renewal_id=r.id)
  or (r.new_snapshot->>'fetchedAt')::timestamptz<=clock_timestamp()-interval '24 hours'
  or (r.new_snapshot->>'fetchedAt')::timestamptz>clock_timestamp()
  or r.new_result#>>'{financialCheck,status}' is distinct from 'eligible' then return false;end if;
 select * into c from public.icash_operational_contacts where id=r.successor_contact_id for share;
 select * into d from public.icash_dnc_verification_receipts where id=c.dnc_receipt_id for share;
 if public.icash_operational_contact_current(r.account_id,c.id,'sms',false) is distinct from true then return false;end if;
 select least(c.eligibility_until,rate.expires_at) into until_at from public.icash_operation_rates rate
 where rate.id=(r.original_snapshot#>>'{thread,sms_rate_id}')::uuid for share;
 if until_at is null or until_at<=clock_timestamp() then return false;end if;
 begin
  -- Original screening is retained byte-for-byte in the immutable journal.
  -- Only freshly acquired evidence replaces the working screening; no age edit.
  update public.icash_screening_jobs set snapshot=r.new_snapshot,result=r.new_result,completed_at=(r.new_snapshot->>'fetchedAt')::timestamptz where id=r.screening_id and account_id=r.account_id;
  update public.icash_text_threads set operational_contact_id=c.id,eligibility_until=until_at,dnc_checked_at=d.checked_at,dnc_clear=d.clear where id=r.thread_id and account_id=r.account_id;
  if public.icash_sms_thread_review_current(r.account_id,r.thread_id,false) is distinct from true
   or v.expires_at<=clock_timestamp() or until_at<=clock_timestamp() then raise exception 'Discovery renewal final authority changed' using errcode='P7501';end if;
  update icash_discovery_refresh_private.renewals set state='applied',applied_at=clock_timestamp() where id=r.id;
  insert into icash_discovery_refresh_private.applies(review_id,renewal_id,after_thread,after_screening)
   select v.id,r.id,to_jsonb(t),to_jsonb(s) from public.icash_text_threads t,public.icash_screening_jobs s where t.id=r.thread_id and s.id=r.screening_id;
 exception when sqlstate 'P7501' then return false;end;
 return true;
exception when lock_not_available then return false;
end $$;
create function icash_discovery_refresh_private.deny_history_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Discovery renewal review and apply history is immutable';end $$;
create trigger review_immutable before update or delete on icash_discovery_refresh_private.reviews for each row execute function icash_discovery_refresh_private.deny_history_change();
create trigger apply_immutable before update or delete on icash_discovery_refresh_private.applies for each row execute function icash_discovery_refresh_private.deny_history_change();
alter table icash_discovery_refresh_private.reviews enable row level security;
alter table icash_discovery_refresh_private.applies enable row level security;
revoke all on icash_discovery_refresh_private.reviews,icash_discovery_refresh_private.applies from public,anon,authenticated,service_role;
grant select on icash_discovery_refresh_private.reviews,icash_discovery_refresh_private.applies to service_role;
revoke all on all functions in schema icash_discovery_refresh_private from public,anon,authenticated,service_role;
revoke all on function public.icash_lock_operational_dnc_before_discovery_refresh(uuid,uuid),public.icash_lock_operational_dnc(uuid,uuid),public.icash_review_discovery_opener_refresh(uuid,text,text),public.icash_apply_discovery_opener_refresh(uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_lock_operational_dnc(uuid,uuid),public.icash_review_discovery_opener_refresh(uuid,text,text),public.icash_apply_discovery_opener_refresh(uuid) to service_role;
-- Verify the exact changed wrapper and private predecessor before the runner
-- may commit its receipt. Existing unrelated guards retain their full metadata.
do $result$
declare x record;p record;shape text;
begin
 for x in select * from (values
  ('public.icash_lock_operational_dnc(uuid,uuid)','5732251fb38f612876284509741be86d',true,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_lock_operational_dnc_before_discovery_refresh(uuid,uuid)','ea3ee514e8cd2af5ba96a21c3bfa78f9',true,'{postgres=X/postgres}'),
  ('icash_seller_recovery_private.original_contact_binding(uuid,uuid)','26fff16d3cc4c274e68d60e48b4af0e6',true,'{postgres=X/postgres}'),
  ('public.icash_operational_contact_current(uuid,uuid,text,boolean)','7d47504dc185227f4d508dafcdffc0f1',false,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_dealmachine_observation_immutable()','6e4a740fa7d0b585b973a58919ac37f3',false,'{postgres=X/postgres,service_role=X/postgres}')
 ) expected(signature,checksum,definer,acl) loop
  select md5(pg_get_functiondef(oid)) checksum,pg_get_userbyid(proowner) owner,proacl::text acl,prosecdef,provolatile,proparallel,proconfig into p
   from pg_proc where oid=to_regprocedure(x.signature);
  if p.checksum is distinct from x.checksum or p.owner is distinct from 'postgres' or p.acl is distinct from x.acl
   or p.prosecdef is distinct from x.definer or p.provolatile is distinct from 'v' or p.proparallel is distinct from 'u'
   or p.proconfig is distinct from array['search_path=""'] then raise exception 'Discovery renewal result or metadata changed: %',x.signature;end if;
 end loop;
 select md5(pg_get_constraintdef(oid)) into shape from pg_constraint where conrelid='public.icash_dnc_verification_receipts'::regclass and conname='icash_dnc_phone_observation_shape';
 if shape is distinct from '7a6af28f5d39273f412815b8ef1b4868' then raise exception 'Discovery renewal result DNC shape changed';end if;
end $result$;
commit;
