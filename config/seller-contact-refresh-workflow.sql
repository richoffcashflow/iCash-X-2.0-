begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.icash_claim_seller_contact_refresh() returns jsonb
language plpgsql security definer set search_path='' as $$
declare item record;f icash_seller_recovery_private.contact_refreshes;bill jsonb;req uuid;stamp timestamptz;
 policy icash_seller_recovery_private.contact_refresh_policy;visited boolean:=false;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;if not found then return null;end if;
 select * into policy from icash_seller_recovery_private.contact_refresh_policy where id=1 and enabled for update;if not found then return null;end if;
 -- An ambiguous phone-check purchase stops this new workflow until its real
 -- receipt is reconciled. A failing provider cannot accumulate new holds.
 if exists(select 1 from icash_seller_recovery_private.contact_refreshes pending
  join public.icash_operation_spend spend on spend.operation_key=pending.operation_key
  where pending.response_at is null or (pending.outcome='cost_review' and spend.state<>'settled')) then return null;end if;
 -- At most one new provider request per scheduler minute. Unknown requests
 -- remain one-use holds forever; a new worker never repeats their HTTP call.
 if exists(select 1 from icash_seller_recovery_private.contact_refreshes where requested_at>clock_timestamp()-interval '1 minute') then return null;end if;
 for item in
  select g.id gap_id,g.due_at,g.account_id,t.operational_contact_id,cfg.contact_rate_id,cfg.property_credit_micros
  from public.icash_seller_gaps g
  join public.icash_text_threads t on t.id=g.thread_id and t.account_id=g.account_id
  join public.icash_discovery_configs cfg on cfg.account_id=g.account_id
  where g.state='needs_review' and g.review_reason='contact_checks_expired' and g.reason='no_response' and g.stage='draft'
   and g.outgoing_id is null and g.due_at<=now() and g.expires_at>now() and g.created_at>=policy.activated_at
   and (policy.scan_due_at is null or (g.due_at,g.id)>(policy.scan_due_at,policy.scan_gap_id))
   and not exists(select 1 from icash_seller_recovery_private.contact_refreshes prior where prior.gap_id=g.id)
  order by g.due_at,g.id limit 20
 loop
  visited:=true;
  -- Held, paused and unaffordable accounts cannot occupy every bounded scan.
  -- Advance outside the per-item subtransaction so an ordinary admission hold
  -- retains its place in the round-robin scan without changing the gap.
  update icash_seller_recovery_private.contact_refresh_policy set scan_due_at=item.due_at,scan_gap_id=item.gap_id where id=1;
  if not icash_seller_recovery_private.contact_refresh_current(item.gap_id,item.operational_contact_id)
   or not public.icash_sms_outreach_window_current(item.account_id,(select thread_id from public.icash_seller_gaps where id=item.gap_id))
   or not public.icash_dealmachine_capacity_available(1) then continue;end if;
  begin
   bill:=icash_seller_recovery_private.reserve_contact_refresh(item.account_id,item.gap_id,item.contact_rate_id,item.property_credit_micros);
   if bill is null then continue;end if;
   req:=gen_random_uuid();stamp:=clock_timestamp();
   insert into icash_seller_recovery_private.contact_refreshes(gap_id,account_id,original_contact_id,operation_key,rate_id,unit_cost_micros,request_id,requested_at,original_snapshot)
   values(item.gap_id,item.account_id,item.operational_contact_id,bill->>'operationKey',(bill->>'rateId')::uuid,(bill->>'unitCostMicros')::bigint,req,stamp,
    public.icash_seller_contact_revalidation_snapshot(item.gap_id,item.operational_contact_id)) returning * into f;
   -- Dependent mutations must be sequential: SQL may evaluate an EXISTS
   -- initplan before volatile operands in a single boolean expression.
   if not public.icash_claim_operation(f.operation_key) then raise exception 'Contact refresh admission held' using errcode='P7502';end if;
   if not public.icash_take_dealmachine_request('phone_dnc',f.account_id,f.operation_key,req) then raise exception 'Contact refresh admission held' using errcode='P7502';end if;
   if not icash_seller_recovery_private.contact_refresh_current(item.gap_id,item.operational_contact_id) then raise exception 'Contact refresh admission held' using errcode='P7502';end if;
   if not exists(select 1 from public.icash_operation_spend spend join public.icash_operation_rates rate on rate.id=spend.rate_id
      where spend.operation_key=f.operation_key and spend.state='dispatched' and spend.permission_until>clock_timestamp()
      and rate.enabled and rate.verified_at<=clock_timestamp() and rate.expires_at>clock_timestamp())
    then raise exception 'Contact refresh admission held' using errcode='P7502';end if;
   return jsonb_build_object('id',f.id,'requestId',req,'phone',(select phone from public.icash_operational_contacts where id=f.original_contact_id));
  exception when sqlstate 'P7502' then continue;
   when raise_exception then
    if sqlerrm=any(array['Account spending not activated','Activation spending cap reached','Software membership is inactive',
     'Bot paused','Insufficient credits','Daily budget reached','Prospecting budget reached','Company budget exhausted',
     'Company daily limit','Automation on hold','Verified rate required','Permission expired','Wallet missing']) then continue;end if;
    raise;
  end;
 end loop;
 if not visited then
  update icash_seller_recovery_private.contact_refresh_policy set scan_due_at=null,scan_gap_id=null where id=1;
 end if;
 return null;
end $$;

alter function public.icash_lock_operational_dnc(uuid,uuid) rename to icash_lock_operational_dnc_before_phone_refresh;
create function public.icash_lock_operational_dnc(p_account uuid,p_contact uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.icash_operational_contacts;old public.icash_operational_contacts;d public.icash_dnc_verification_receipts;
 f icash_seller_recovery_private.contact_refreshes;policy public.icash_dnc_verification_sources;stamp timestamptz;
begin
 select * into c from public.icash_operational_contacts where id=p_contact and account_id=p_account;
 select * into d from public.icash_dnc_verification_receipts where id=c.dnc_receipt_id;
 if d.evidence_kind is distinct from 'national_phone_observation' then return public.icash_lock_operational_dnc_before_phone_refresh(p_account,p_contact);end if;
 perform 1 from public.icash_dnc_verification_receipts where id=d.id for share;
 select * into policy from public.icash_dnc_verification_sources where id=d.source_id for share;
 select * into f from icash_seller_recovery_private.contact_refreshes where receipt_id=d.id and successor_contact_id=c.id and account_id=p_account for share;
 if not found then return false;end if;
 select * into old from public.icash_operational_contacts where id=f.original_contact_id for share;
 perform 1 from public.icash_operation_spend where operation_key=f.operation_key and account_id=p_account and state='settled' for share;if not found then return false;end if;
 if not icash_seller_recovery_private.original_contact_binding(p_account,old.id) then return false;end if;
 stamp:=clock_timestamp();
 return coalesce(row(old.account_id,old.screening_id,old.phone,old.contact_key,old.owner_user_id,old.source_hash,old.sending_principal,old.timezone,old.timezone_basis,old.local_start_hour,old.local_end_hour)
  is not distinct from row(c.account_id,c.screening_id,c.phone,c.contact_key,c.owner_user_id,c.source_hash,c.sending_principal,c.timezone,c.timezone_basis,c.local_start_hour,c.local_end_hour)
  and old.revoked_at is null and c.channel='sms' and (f.state='responded' or (f.state='processed' and f.outcome='revalidated')) and f.http_status between 200 and 299 and f.response_at>=f.requested_at
  and icash_seller_recovery_private.phone_response_valid(f.response,c.phone)
  and f.response#>'{data,0,matched}'='true'::jsonb and f.response#>'{data,0,do_not_call}'='false'::jsonb
  and d.receipt_hash=encode(sha256(convert_to(f.response::text,'UTF8')),'hex')
  and d.observation_provenance->>'refreshId'=f.id::text and d.observation_provenance->>'accountId'=p_account::text
  and d.observation_provenance->>'screeningId'=c.screening_id::text and d.observation_provenance->>'originalContactId'=old.id::text
  and d.observation_provenance->>'operationKey'=f.operation_key and d.observation_provenance->>'requestId'=f.request_id::text
  and d.checked_at=f.requested_at and d.observation_recorded_at=f.response_at
  and d.checked_at<=stamp and d.expires_at<=f.requested_at+interval '24 hours' and d.expires_at>stamp
  and policy.enabled and policy.expires_at>stamp and policy.evidence_kind='national_provider_observation'
  and policy.observation_provider='dealmachine' and policy.observation_scope='national_only'
  and f.requested_at+make_interval(secs=>policy.max_observation_age_seconds)>stamp
  and exists(select 1 from public.icash_dnc_verification_receipts original where original.id=old.dnc_receipt_id and original.source_id=d.source_id and original.clear and original.revoked_at is null),false);
end $$;

create function public.icash_finish_seller_contact_refresh(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f icash_seller_recovery_private.contact_refreshes;c public.icash_operational_contacts;d public.icash_dnc_verification_receipts;src public.icash_dnc_verification_sources;
 receipt uuid;fresh uuid;until_at timestamptz;snapshot jsonb;review uuid;applied boolean:=false;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into f from icash_seller_recovery_private.contact_refreshes where id=p_id for update;
 if not found or f.response_at is null then return jsonb_build_object('status','response_missing');end if;
 if f.state='processed' then return jsonb_build_object('status',f.outcome);end if;
 -- Cost reconciliation is independent of contact eligibility and Pause. The
 -- real receipt remains available even when all contact authority has expired.
 if not icash_seller_recovery_private.settle_contact_refresh(f.operation_key) then
  update icash_seller_recovery_private.contact_refreshes set state='processed',outcome='cost_review' where id=f.id;
  return jsonb_build_object('status','cost_review');
 end if;
 select * into c from public.icash_operational_contacts where id=f.original_contact_id;
 if f.response#>'{data,0,matched}' is distinct from 'true'::jsonb or f.response#>'{data,0,do_not_call}' is distinct from 'false'::jsonb then
  update icash_seller_recovery_private.contact_refreshes set state='processed',outcome='not_clear' where id=f.id;
  return jsonb_build_object('status','not_clear');
 end if;
 if f.original_snapshot is distinct from public.icash_seller_contact_revalidation_snapshot(f.gap_id,c.id)
  or not icash_seller_recovery_private.contact_refresh_current(f.gap_id,c.id) then
  update icash_seller_recovery_private.contact_refreshes set state='processed',outcome='current_controls_hold' where id=f.id;
  return jsonb_build_object('status','current_controls_hold');
 end if;
 select * into d from public.icash_dnc_verification_receipts where id=c.dnc_receipt_id for share;
 select * into src from public.icash_dnc_verification_sources where id=d.source_id for share;
 until_at:=least(f.requested_at+interval '24 hours',f.requested_at+make_interval(secs=>src.max_observation_age_seconds),src.expires_at,
  (select data_rights_until from public.icash_discovery_configs where account_id=c.account_id));
 if until_at is null or until_at<=clock_timestamp() then
  update icash_seller_recovery_private.contact_refreshes set state='processed',outcome='fresh_response_expired' where id=f.id;
  return jsonb_build_object('status','fresh_response_expired');
 end if;
 insert into public.icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear,contact_timezone,timezone_source_reference,evidence_kind,observation_provenance,observation_recorded_at)
 values(src.id,c.phone,c.contact_key,'dealmachine:phone-dnc:'||f.id,encode(sha256(convert_to(f.response::text,'UTF8')),'hex'),f.requested_at,until_at,true,
  d.contact_timezone,d.timezone_source_reference,'national_phone_observation',jsonb_build_object('provider','dealmachine','scope','national_only',
  'sourceTable','icash_seller_recovery_private.contact_refreshes','refreshId',f.id,'accountId',f.account_id,'screeningId',c.screening_id,
  'originalContactId',c.id,'operationKey',f.operation_key,'requestId',f.request_id,'freshnessBasis','saved_request_start_lower_bound',
  'providerCheckedAt',null,'registryUpdatedAt',null,'stateClearance','not_established','consentVerification','not_performed','reportedDoNotCall',false),f.response_at) returning id into receipt;
 insert into public.icash_operational_contacts(account_id,screening_id,channel,phone,contact_key,timezone,timezone_basis,local_start_hour,local_end_hour,owner_user_id,sending_principal,source_hash,dnc_receipt_id,eligibility_until)
 values(c.account_id,c.screening_id,'sms',c.phone,c.contact_key,c.timezone,c.timezone_basis,c.local_start_hour,c.local_end_hour,c.owner_user_id,c.sending_principal,c.source_hash,receipt,until_at) returning id into fresh;
 update icash_seller_recovery_private.contact_refreshes set receipt_id=receipt,successor_contact_id=fresh where id=f.id;
 snapshot:=public.icash_seller_contact_revalidation_snapshot(f.gap_id,fresh);
 review:=public.icash_review_seller_contact_revalidation(f.gap_id,fresh,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),'Automatic exact new national phone observation: '||f.id);
 if review is not null then applied:=public.icash_apply_seller_contact_revalidation(review);end if;
 update icash_seller_recovery_private.contact_refreshes set state='processed',outcome=case when applied then 'revalidated' else 'current_controls_hold' end where id=f.id;
 return jsonb_build_object('status',case when applied then 'revalidated' else 'current_controls_hold' end);
end $$;

-- Retry receipt processing only, never the provider request or an uncertain SMS.
create function public.icash_resume_seller_contact_refresh() returns jsonb
language plpgsql security definer set search_path='' as $$
declare f record;begin
 for f in select id from icash_seller_recovery_private.contact_refreshes where state='responded' order by response_at limit 5 loop
  perform public.icash_finish_seller_contact_refresh(f.id);
 end loop;
 return null;
end $$;
update icash_seller_recovery_private.contact_revalidation_policy set enabled=true where id=1;
revoke all on function public.icash_claim_seller_contact_refresh(),public.icash_finish_seller_contact_refresh(uuid),public.icash_resume_seller_contact_refresh(),
 public.icash_lock_operational_dnc_before_phone_refresh(uuid,uuid),public.icash_lock_operational_dnc(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_claim_seller_contact_refresh(),public.icash_finish_seller_contact_refresh(uuid),public.icash_resume_seller_contact_refresh(),public.icash_lock_operational_dnc(uuid,uuid) to service_role;
commit;
