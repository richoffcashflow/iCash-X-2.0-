begin;
set local lock_timeout='3s';

-- A draft opening request may follow newly verified details only before any
-- reservation/provider attempt. Preserve attempted requests and their evidence.
create or replace function public.icash_prepare_title_request(p_account uuid,p_deal uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.icash_deal_files;c public.icash_title_contacts;e public.icash_signing_envelopes;j public.icash_title_requests;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account for share;
 select * into c from public.icash_title_contacts where deal_id=p_deal and account_id=p_account and enabled and verified_until>now() for share;
 select * into e from public.icash_signing_envelopes where deal_id=p_deal and account_id=p_account and kind='purchase' and state='completed' and not test_mode limit 1;
 if d.id is null or d.stage not in ('under_contract','buyer_selected','title_open','closing') or c.deal_id is null or e.id is null
  or not public.icash_title_contact_matches(p_account,p_deal,c.email) then raise exception 'Verified title contact and signed purchase required';end if;
 if not exists(select 1 from public.icash_operation_rates where id=c.rate_id and operation='title_email' and enabled and expires_at>now()) then raise exception 'Title rate required';end if;
 insert into public.icash_title_requests(deal_id,account_id,purchase_envelope_id,recipient,property_address,rate_id,verified_until)
 values(d.id,p_account,e.id,c.email,d.terms->>'address',c.rate_id,c.verified_until) on conflict(deal_id) do nothing;
 select * into strict j from public.icash_title_requests where deal_id=d.id and account_id=p_account for update;
 if j.state='ready' and j.provider_id is null
  and not exists(select 1 from public.icash_operation_spend where operation_key='title:'||j.id)
  and row(j.purchase_envelope_id,j.recipient,j.property_address,j.rate_id,j.verified_until)
   is distinct from row(e.id,c.email,d.terms->>'address',c.rate_id,c.verified_until) then
  update public.icash_title_requests set purchase_envelope_id=e.id,recipient=c.email,property_address=d.terms->>'address',
   rate_id=c.rate_id,verified_until=c.verified_until,updated_at=now() where id=j.id;
 end if;
 return jsonb_build_object('id',j.id,'state',j.state);
end $$;

alter function public.icash_claim_title_request(uuid) rename to icash_claim_title_request_before_snapshot;
create function public.icash_claim_title_request_snapshot(p_id uuid,p_expected jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare j public.icash_title_requests;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_title_requests where id=p_id for update;
 if not found or j.state<>'ready' or j.provider_id is not null or jsonb_typeof(p_expected) is distinct from 'object'
  or j.account_id::text is distinct from p_expected->>'accountId'
  or j.deal_id::text is distinct from p_expected->>'dealId'
  or j.purchase_envelope_id::text is distinct from p_expected->>'purchaseEnvelopeId'
  or j.recipient is distinct from p_expected->>'recipient'
  or j.property_address is distinct from p_expected->>'propertyAddress'
  or j.rate_id::text is distinct from p_expected->>'rateId'
  or j.verified_until is distinct from (p_expected->>'verifiedUntil')::timestamptz then return false;end if;
 -- Reservation and the snapshot comparison are atomic: a stale worker must not
 -- leave an old rate/permission reservation behind after the draft was corrected.
 perform public.icash_reserve_operation(j.account_id,'title:'||j.id,j.rate_id,j.verified_until);
 return public.icash_claim_title_request_before_snapshot(j.id);
end $$;

-- Old app instances cannot dispatch without binding the recipient they loaded.
create function public.icash_claim_title_request(p_id uuid) returns boolean
language sql security invoker set search_path='' as $$select false$$;

do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_save_closing_setup_before_profile(uuid,uuid,uuid,text,jsonb)'::regprocedure);
 -- Serialize draft corrections with reservation/dispatch before acquiring account
 -- and deal locks. The existing owner, signature and signed-title guards remain.
 if position(E'begin\n' in definition)=0 then raise exception 'Closing setup lock boundary changed';end if;
 definition:=regexp_replace(definition,E'begin\n',E'begin\n perform 1 from public.icash_operating_budget where id=1 for update;\n');
 needle:=$old$if exists(select 1 from public.icash_title_requests where account_id=p_account and deal_id=p_deal and state<>'ready') then raise exception 'Sent title file cannot be switched here';end if;$old$;
 replacement:=$new$if exists(select 1 from public.icash_title_requests j where j.account_id=p_account and j.deal_id=p_deal
    and (j.state<>'ready' or j.provider_id is not null or exists(select 1 from public.icash_operation_spend o where o.operation_key='title:'||j.id)))
   then raise exception 'Title delivery has been reserved or attempted. Request human review before changing the closer.';end if;$new$;
 if position(needle in definition)=0 then raise exception 'Title preference guard changed';end if;
 definition:=replace(definition,needle,replacement);
 needle:=$old$if exists(select 1 from public.icash_title_requests where deal_id=p_deal and account_id=p_account and lower(recipient)<>mail) then raise exception 'Existing request has a different closer';end if;$old$;
 replacement:=$new$if exists(select 1 from public.icash_title_requests j where j.deal_id=p_deal and j.account_id=p_account
    and ((lower(j.recipient)<>mail and (j.state<>'ready' or j.provider_id is not null))
     or (j.state='ready' and exists(select 1 from public.icash_operation_spend o where o.operation_key='title:'||j.id))))
   then raise exception 'Title delivery has been reserved or attempted. Request human review before changing the closer.';end if;$new$;
 if position(needle in definition)=0 then raise exception 'Title confirmation guard changed';end if;
 definition:=replace(definition,needle,replacement);
 needle:=$old$where icash_title_contacts.account_id=p_account;
  update public.icash_closing_setup set updated_at=now() where id=s.id;$old$;
 replacement:=$new$where icash_title_contacts.account_id=p_account;
  if exists(select 1 from public.icash_title_requests j where j.account_id=p_account and j.deal_id=p_deal and j.state='ready' and j.provider_id is null
   and not exists(select 1 from public.icash_operation_spend o where o.operation_key='title:'||j.id)) then
   perform public.icash_prepare_title_request(p_account,p_deal);
  end if;
  update public.icash_closing_setup set updated_at=now() where id=s.id;$new$;
 if position(needle in definition)=0 then raise exception 'Verified title update boundary changed';end if;
 execute replace(definition,needle,replacement);
end $patch$;

revoke all on function public.icash_claim_title_request(uuid),public.icash_claim_title_request_snapshot(uuid,jsonb),public.icash_claim_title_request_before_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.icash_claim_title_request(uuid),public.icash_claim_title_request_snapshot(uuid,jsonb),public.icash_claim_title_request_before_snapshot(uuid) to service_role;
commit;
