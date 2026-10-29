-- Export and lookup receipts have different credit contracts. Preserve both;
-- never invent lookup deduplication observations to admit an export's phones.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter function public.icash_dealmachine_credit_manifest_hash(text) rename to icash_dealmachine_credit_manifest_before_exports;
create function public.icash_dealmachine_credit_manifest_hash(p_operation text) returns text
language plpgsql stable security definer set search_path='' as $$
declare oc public.icash_owner_contacts;e icash_research_private.owner_exports;cost public.icash_cost_observations;
begin
 select * into oc from public.icash_owner_contacts where operation_key=p_operation;
 if not found or oc.result->'allocation'->>'method' is distinct from 'active-export-used-order-v1' then return public.icash_dealmachine_credit_manifest_before_exports(p_operation);end if;
 if public.icash_dealmachine_owner_source_started_at(oc.account_id,oc.screening_id) is null then return null;end if;
 select * into e from icash_research_private.owner_exports where id::text=oc.result->'allocation'->>'batchId' and completed_at is not null;
 select * into cost from public.icash_cost_observations where provider='dealmachine' and event_key=p_operation
  and source_ref='dealmachine:owners:'||p_operation and units='provider_credits' and to_jsonb(amount)=oc.result->'creditsUsed';
 if not found or e.id is null then return null;end if;
 return encode(sha256(convert_to(jsonb_build_object('contract','owner-active-export-v1','batchId',e.id,
  'requestHash',encode(sha256(convert_to(e.request::text,'UTF8')),'hex'),
  'originalReceiptHash',encode(sha256(convert_to(e.receipt::text,'UTF8')),'hex'),
  'artifactSha256',e.artifact_sha256,'reportedCredits',e.receipt->'raw'->'credits',
  'allocation',oc.result->'allocation','allocatedUsed',oc.result->'creditsUsed',
  'costObservationHash',public.icash_dealmachine_cost_observation_hash(cost))::text,'UTF8')),'hex');
end $$;
revoke all on function public.icash_dealmachine_credit_manifest_hash(text) from public,anon,authenticated;
grant execute on function public.icash_dealmachine_credit_manifest_hash(text) to service_role;

do $$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_ingest_dealmachine_dnc_observations(uuid,uuid,uuid)'::regprocedure);
 needle:='or oc.result->''providerCredits''->''used'' is distinct from oc.result->''creditsUsed''';
 if strpos(d,needle)=0 then raise exception 'DNC credit shape guard changed';end if;
 d:=replace(d,needle,'or (oc.result->''allocation''->>''method'' is distinct from ''active-export-used-order-v1'' and oc.result->''providerCredits''->''used'' is distinct from oc.result->''creditsUsed'')');
 needle:='foreach field in array array[''used'',''people'',''properties'',''deduplicated''] loop';
 if strpos(d,needle)=0 then raise exception 'DNC credit observation loop changed';end if;
 d:=replace(d,needle,'foreach field in array (case when oc.result->''allocation''->>''method''=''active-export-used-order-v1'' then array[''used''] else array[''used'',''people'',''properties'',''deduplicated''] end) loop');
 needle:='cost.amount is distinct from (oc.result->''providerCredits''->>field)::numeric';
 if strpos(d,needle)=0 then raise exception 'DNC cost comparison changed';end if;
 d:=replace(d,needle,'cost.amount is distinct from (case when oc.result->''allocation''->>''method''=''active-export-used-order-v1'' then (oc.result->>''creditsUsed'')::numeric else (oc.result->''providerCredits''->>field)::numeric end)');
 needle:='cost_hash:=public.icash_dealmachine_credit_manifest_hash(o.operation_key);';
 if strpos(d,needle)=0 then raise exception 'DNC manifest binding changed';end if;
 execute replace(d,needle,needle||E'\n if cost_hash is null then raise exception ''Matching original DealMachine credit manifest required'';end if;');
 d:=pg_get_functiondef('public.icash_prepare_operational_contacts(uuid)'::regprocedure);
 needle:='oc.result->''providerCredits''->''used''=oc.result->''creditsUsed''';
 if strpos(d,needle)=0 then raise exception 'Operational contact credit candidate changed';end if;
 execute replace(d,needle,'(oc.result->''providerCredits''->''used''=oc.result->''creditsUsed'' or (oc.result->''allocation''->>''method''=''active-export-used-order-v1'' and public.icash_dealmachine_credit_manifest_hash(oc.operation_key) is not null))');
end $$;
commit;
