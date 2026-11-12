-- A funded starter's contact work depends on shared export capacity. Permit
-- the existing three FREE recovery reads to use that account's bounded reserve.
-- Original export evidence, paid holds and capacity verification are unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function icash_research_private.starter_export_dependency_current(p_account uuid)
returns boolean language plpgsql stable security invoker set search_path='' as $$
begin
 if not public.icash_new_user_request_reserve_eligible(p_account) then return false;end if;
 if not exists(select 1 from public.icash_discovery_configs c where c.account_id=p_account
  and c.enabled and c.auto_enabled and c.contacts_enabled and c.data_rights_until>now()) then return false;end if;
 return public.icash_enrichment_before_provider_quota(p_account) is not null;
end $$;
revoke all on function icash_research_private.starter_export_dependency_current(uuid) from public,anon,authenticated,service_role;

do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_claim_automatic_export_capacity(text)'::regprocedure);
 if md5(d)<>'a91947b2e93211001982a09860241378' then raise exception 'Starter export claim prerequisite changed';end if;
 d:=replace(d,'source_policy text;','source_policy text;beneficiary uuid;candidate record;');
 needle:=' or not public.icash_dealmachine_capacity_available(3)';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter export capacity boundary changed';end if;
 d:=replace(d,needle,'');
 needle:=' insert into icash_research_private.owner_export_capacity_reviews(export_id';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter export review boundary changed';end if;
 d:=replace(d,needle,$new$
 -- Ordinary capacity remains first. Visit only eligible starters in due order
 -- and stop at the first real dependency; empty accounts cannot hide later work.
 if not public.icash_dealmachine_capacity_available(3) then
  for candidate in select c.account_id from public.icash_discovery_configs c
   where c.enabled and c.auto_enabled and c.contacts_enabled and c.data_rights_until>now()
    and public.icash_new_user_request_reserve_eligible(c.account_id)
    and public.icash_dealmachine_capacity_available(3,c.account_id)
   order by c.next_run_at,c.account_id loop
   if icash_research_private.starter_export_dependency_current(candidate.account_id) then beneficiary:=candidate.account_id;exit;end if;
  end loop;
  if beneficiary is null then return null;end if;
 end if;
 insert into icash_research_private.owner_export_capacity_reviews(export_id$new$);
 needle:='public.icash_take_dealmachine_request(''owner_preview'',null,''export-capacity-auto:''';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter export inventory admission changed';end if;
 execute replace(d,needle,'public.icash_take_dealmachine_request(''owner_preview'',beneficiary,''export-capacity-auto:''');

 d:=pg_get_functiondef('public.icash_claim_export_capacity_probe(uuid,text)'::regprocedure);
 if md5(d)<>'c14bbb16b5d0783cb68bbb9420339944' then raise exception 'Starter export probe prerequisite changed';end if;
 d:=replace(d,'request uuid:=gen_random_uuid();','request uuid:=gen_random_uuid();beneficiary uuid;');
 needle:=' if not found or coalesce(r.auto_policy';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter export probe binding changed';end if;
 d:=replace(d,needle,$new$
 if not found then return null;end if;
 -- The first admitted request is immutable attribution for all later probes.
 select q.account_id into beneficiary from icash_research_private.requests q
  where q.id=r.request_id and q.admitted and q.kind='owner_preview'
   and q.operation_key='export-capacity-auto:'||r.id||':inventory';
 if not found or (beneficiary is not null and not icash_research_private.starter_export_dependency_current(beneficiary)) then return null;end if;
 if coalesce(r.auto_policy$new$);
 needle:='public.icash_take_dealmachine_request(''owner_preview'',null,''export-capacity-auto:''';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter export probe admission changed';end if;
 execute replace(d,needle,'public.icash_take_dealmachine_request(''owner_preview'',beneficiary,''export-capacity-auto:''');

 d:=pg_get_functiondef('public.icash_finish_automatic_export_capacity(uuid)'::regprocedure);
 if md5(d)<>'992adf5fbde6276b064b957e27d6cf72' then raise exception 'Starter export final evidence prerequisite changed';end if;
 needle:='q.id=p.request_id and q.admitted and q.kind=''owner_preview''';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter export final request binding changed';end if;
 execute replace(d,needle,needle||' and q.account_id is not distinct from (select original.account_id from icash_research_private.requests original where original.id=r.request_id)');
end $patch$;
commit;
