-- Owner instruction, 2026-10-14: repair contract delivery and its connected
-- production dependencies. Reuse the standing-calling finite expiry convention.
-- This versions provider-cost approvals only. It does not renew recipient
-- consent, opt-ins, DNC evidence, test approvals, wallet funds or subscriptions.
-- No provider calls, texts, envelopes or charges are created by this script.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $standing_delivery$
declare
 standing_until constant timestamptz := '9999-12-31T23:59:59Z';
 suffix constant text := ':standing-delivery-20261014';
 old_rate public.icash_operation_rates;
 new_rate public.icash_operation_rates;
 rate_map jsonb := '{}';
 thread public.icash_text_threads;
 mapped_rate uuid;
 old_hash text;
 new_hash text;
 old_definition text;
 new_definition text;
 signature text;
 needle constant text := $match$version='sms-ai-gpt41mini-tokens-20261007'$match$;
 replacement constant text := $match$version in ('sms-ai-gpt41mini-tokens-20261007','sms-ai-gpt41mini-tokens-20261007:standing-delivery-20261014')$match$;
begin
 -- Match dispatch/settlement lock ordering. Immutable historical rates remain
 -- attached to existing usage authorizations and provider receipts.
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then raise exception 'Operating budget prerequisite missing';end if;
 lock table public.icash_text_ai_settings, public.icash_signing_templates,
  public.icash_text_threads in share row exclusive mode;

 if not exists(select 1 from public.icash_operation_rates
  where version='sms-transport-with-separate-ai-20261007' and operation='sms_send' and enabled)
 or not exists(select 1 from public.icash_text_ai_settings s join public.icash_operation_rates r on r.id=s.rate_id
  where s.id=1 and s.enabled and s.model='gpt-4.1-mini' and r.enabled and r.operation='sms_ai'
  and r.version in ('sms-ai-gpt41mini-tokens-20261007','sms-ai-gpt41mini-tokens-20261007:standing-delivery-20261014')) then
  raise exception 'Reviewed production messaging prerequisites changed';
 end if;

 -- Exactly the split transport rate, configured token-metered AI rate, and
 -- enabled live signing template rates. Exclude old bundled transport, test,
 -- discovery, contact research, email and disabled provider configurations.
 for old_rate in
  select r.* from public.icash_operation_rates r where
   (r.operation='sms_send' and r.version='sms-transport-with-separate-ai-20261007' and r.enabled)
   or r.id in (select rate_id from public.icash_text_ai_settings where id=1 and enabled)
   or r.id in (select rate_id from public.icash_signing_templates where enabled and not test_mode and provider='docuseal')
  for share
 loop
  if not old_rate.enabled or old_rate.operation not in ('sms_send','sms_ai','contract_signing')
   or old_rate.verified_at>now() then raise exception 'Referenced delivery rate is disabled or unverified';end if;
  if old_rate.expires_at=standing_until then
   rate_map:=rate_map||jsonb_build_object(old_rate.id::text,old_rate.id);
   continue;
  end if;
  select * into new_rate from public.icash_operation_rates where version=old_rate.version||suffix for share;
  if found then
   if not new_rate.enabled or new_rate.expires_at<>standing_until
    or (to_jsonb(new_rate)-array['id','version','expires_at']) is distinct from
       (to_jsonb(old_rate)-array['id','version','expires_at']) then
    raise exception 'Standing delivery rate conflicts with historical pricing';
   end if;
  else
   new_rate:=jsonb_populate_record(null::public.icash_operation_rates,
    to_jsonb(old_rate)||jsonb_build_object('id',gen_random_uuid(),
     'version',old_rate.version||suffix,'expires_at',standing_until));
   insert into public.icash_operation_rates select (new_rate).*;
  end if;
  rate_map:=rate_map||jsonb_build_object(old_rate.id::text,new_rate.id);
 end loop;

 -- Token accounting recognizes precisely these two identical-cost rate
 -- versions. Preserve historical settlement, model binding, token bounds,
 -- fractional billing and the ban on substituting a maximum estimate.
 foreach signature in array array[
  'public.icash_claim_text_ai_before_campaign(uuid,uuid)',
  'public.icash_settle_sms_ai_tokens(uuid,uuid)',
  'public.icash_settle_estimated_operation(text)'
 ] loop
  old_definition:=pg_get_functiondef(signature::regprocedure);
  if position(replacement in old_definition)>0 and position(needle in old_definition)=0 then continue;end if;
  if (length(old_definition)-length(replace(old_definition,needle,'')))/length(needle)<>1 then
   raise exception 'SMS token-accounting prerequisite changed: %',signature;
  end if;
  new_definition:=replace(old_definition,needle,replacement);
  execute new_definition;
 end loop;

 update public.icash_text_ai_settings set rate_id=(rate_map->>rate_id::text)::uuid
 where id=1 and enabled and rate_map ? rate_id::text;
 update public.icash_signing_templates set rate_id=(rate_map->>rate_id::text)::uuid,
  reviewed_until=standing_until
 where enabled and not test_mode and provider='docuseal' and rate_map ? rate_id::text;

 -- Existing first-party / operational threads may adopt an identical-cost
 -- rate only if all their original non-rate permissions remain valid. A failed
 -- final review rolls back that thread's update; it never renews consent or
 -- changes paused/manual/retired states. Independently reviewed legacy and
 -- owner-test threads retain their immutable review/test bindings.
 for thread in select * from public.icash_text_threads
  where retired_at is null and owner_buyer_test_id is null and not paused and not manual_only and ai_mode='auto'
   and sms_review_request_id is null and (seller_intake_id is not null or operational_contact_id is not null)
   and rate_map ? sms_rate_id::text
  for update
 loop
  mapped_rate:=(rate_map->>thread.sms_rate_id::text)::uuid;
  if mapped_rate=thread.sms_rate_id then continue;end if;
  select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') into old_hash
   from public.icash_operation_rates r where r.id=thread.sms_rate_id;
  if (thread.seller_intake_id is not null and thread.seller_sms_rate_hash is distinct from old_hash)
   or (thread.operational_contact_id is not null and thread.operational_sms_rate_hash is distinct from old_hash) then continue;end if;
  select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') into new_hash
   from public.icash_operation_rates r where r.id=mapped_rate;
  begin
   update public.icash_text_threads set sms_rate_id=mapped_rate,
    seller_sms_rate_hash=case when seller_intake_id is not null then new_hash else seller_sms_rate_hash end,
    operational_sms_rate_hash=case when operational_contact_id is not null then new_hash else operational_sms_rate_hash end,
    eligibility_until=case when operational_contact_id is not null then
     (select least(c.eligibility_until,standing_until) from public.icash_operational_contacts c
      where c.id=thread.operational_contact_id and c.account_id=thread.account_id)
     else eligibility_until end
   where id=thread.id;
   if not public.icash_sms_thread_review_current(thread.account_id,thread.id,false) then
    raise exception using errcode='P2401',message='Original contact permissions are no longer current';
   end if;
  exception when sqlstate 'P2401' then
   -- Subtransaction rollback preserves the original thread exactly.
   null;
  end;
 end loop;
end $standing_delivery$;
commit;
