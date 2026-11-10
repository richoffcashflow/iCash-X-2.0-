-- Reject only provably unusable candidates before expensive validation.
-- Final source/contact/recipient locks and admission predicates stay unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Private-table access is deliberately confined to this service-only read.
-- This is a conservative selection hint, never proof of sending eligibility.
create function public.icash_owner_sms_quality_candidate(p_account uuid,p_screening uuid,p_phone text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare source jsonb;person jsonb;chosen text;matching boolean:=false;
begin
 if not exists(select 1 from icash_research_private.list_quality_settings where id=1 and enabled) then return true;end if;
 select result into source from public.icash_owner_contacts where account_id=p_account and screening_id=p_screening;
 -- Unknown/malformed evidence is left to the original validator and diagnostics.
 if not found or jsonb_typeof(source->'contacts') is distinct from 'array' then return true;end if;
 for person in select c from jsonb_array_elements(source->'contacts') c
  where c->'likelyOwner'='true'::jsonb and source->'requestedPersonIds' ? (c->>'personId')
 loop
  if jsonb_typeof(person->'phones') is distinct from 'array' then return true;end if;
  if not exists(select 1 from jsonb_array_elements(person->'phones') ph
   where public.icash_operational_phone(ph->>'number')=p_phone
    and lower(ph->>'type') in ('wireless','mobile') and ph->'doNotCall'='false'::jsonb) then continue;end if;
  matching:=true;
  select phone into chosen from icash_research_private.owner_sms_choices where person_id=person->>'personId';
  -- The original locked validator owns all new choices and historical attempts.
  if not found or chosen=p_phone then return true;end if;
 end loop;
 if not matching then return false;end if;
 -- Preserve the original source-backed human-conversation exception verbatim.
 return exists(select 1 from public.icash_text_threads t join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
  where t.account_id=p_account and t.recipient=p_phone and t.party='seller' and m.direction='incoming' and m.state='received'
   and (m.provider_id is not null or m.event_id is not null));
end $$;
revoke all on function public.icash_owner_sms_quality_candidate(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_owner_sms_quality_candidate(uuid,uuid,text) to service_role;

do $patch$
declare d text;original text;replacement text;
begin
 if md5(pg_get_functiondef('public.icash_owner_sms_quality_current(uuid,uuid,text)'::regprocedure))<>'fdd9fc323e73d4907da72580dd8b4012' then
  raise exception 'Scheduler quality prerequisite changed';
 end if;
 d:=pg_get_functiondef('public.icash_project_operational_sms_contacts(uuid)'::regprocedure);
 if md5(d)<>'c85f310222debb4c5f5fe9c8b5de1f2e' then raise exception 'Scheduler projection prerequisite changed';end if;
 original:=$old$ ) select oc.* from candidates oc
 where (not exists$old$;
 replacement:=$new$ ), quality_candidates as materialized (
 select oc.* from candidates oc
 where not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=oc.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
  or public.icash_owner_sms_quality_candidate(oc.account_id,oc.screening_id,oc.phone)
 ) select oc.* from quality_candidates oc
 where (not exists$new$;
 if length(d)-length(replace(d,original,''))<>length(original) then raise exception 'Scheduler projection boundary changed';end if;
 execute replace(d,original,replacement);

 d:=pg_get_functiondef('public.icash_prepare_operational_contacts_before_dm_observations(uuid)'::regprocedure);
 if md5(d)<>'e0c4ee531548593a2cf9d82b17125db5' then raise exception 'Scheduler preparation prerequisite changed';end if;
 original:=$old$), candidates as materialized ($old$;
 replacement:=$new$  -- Both exact channels already exist: the unchanged downstream selector
  -- cannot produce a candidate. Retain rows missing either channel.
  and not (
   exists(select 1 from public.icash_operational_contacts prior
    where prior.account_id=oc.account_id and prior.screening_id=oc.screening_id
     and prior.channel='sms' and prior.phone=receipt.phone and prior.dnc_receipt_id=receipt.id
     and prior.source_hash=receipt.observation_provenance->>'savedResultHash')
   and exists(select 1 from public.icash_operational_contacts prior
    where prior.account_id=oc.account_id and prior.screening_id=oc.screening_id
     and prior.channel='voice' and prior.phone=receipt.phone and prior.dnc_receipt_id=receipt.id
     and prior.source_hash=receipt.observation_provenance->>'savedResultHash')
  )
), candidates as materialized ($new$;
 if length(d)-length(replace(d,original,''))<>length(original) then raise exception 'Scheduler preparation boundary changed';end if;
 execute replace(d,original,replacement);
end $patch$;
commit;
