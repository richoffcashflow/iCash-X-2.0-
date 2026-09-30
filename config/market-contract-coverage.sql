begin;
-- Staged only: do not enable outreach or approve legal/consent evidence.
-- Restrict automatic acquisition allocation to current reviewed contract capabilities.
create or replace function public.icash_market_contract_ready(p_zip text,p_signers integer default 1)
returns boolean language sql stable set search_path='' as $$
 select p_signers between 1 and 8 and exists(
  select 1 from public.icash_market_shortlist m
  where m.zip=p_zip and not exists(
   select 1 from unnest(array['purchase','assignment']) required(kind)
   where not exists(select 1 from public.icash_signing_templates t join public.icash_operation_rates r on r.id=t.rate_id
    where t.state_code=m.state and t.kind=required.kind and t.signer_count=p_signers and t.enabled and not t.test_mode
    and t.provider='docuseal' and t.reviewed_until>now() and r.enabled and r.operation='contract_signing' and r.expires_at>now())
  )
 );
$$;
revoke all on function public.icash_market_contract_ready(text,integer) from public,anon,authenticated;
grant execute on function public.icash_market_contract_ready(text,integer) to service_role;
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef(coalesce(to_regprocedure('public.icash_provision_before_voice_template(uuid)'),to_regprocedure('public.icash_provision_funded_account(uuid)')));
 if position('icash_market_contract_ready' in definition)>0 then return;end if;
 needle:='chosen:=existing.zip;';
 if position(needle in definition)=0 then raise exception 'Unexpected funded account provisioner';end if;
 definition:=replace(definition,needle,needle||E'\n if chosen is not null and not public.icash_market_contract_ready(chosen,1) then return jsonb_build_object(''status'',''contract_coverage_required'');end if;');
 needle:='order by (select count(*) from public.icash_discovery_configs c where c.zip=m.zip),m.priority limit 1;';
 if position(needle in definition)=0 then raise exception 'Unexpected market allocation';end if;
 definition:=replace(definition,needle,'and public.icash_market_contract_ready(m.zip,1) '||needle);
 -- Parenthesize the OR so nationwide also remains subject to reviewed coverage.
 definition:=replace(definition,'where coalesce(profile->>''marketMode'',''nationwide'')=''nationwide'' or lower(trim(profile->>''market'')) in (lower(m.city),lower(m.city||'', ''||m.state),m.zip)',
 'where (coalesce(profile->>''marketMode'',''nationwide'')=''nationwide'' or lower(trim(profile->>''market'')) in (lower(m.city),lower(m.city||'', ''||m.state),m.zip))');
 needle:='where coalesce(profile->>''marketMode'',''nationwide'')=''nationwide'' or m.zip=chosen';
 if position(needle in definition)=0 then raise exception 'Unexpected inventory allocation';end if;
 definition:=replace(definition,needle,'where (coalesce(profile->>''marketMode'',''nationwide'')=''nationwide'' or m.zip=chosen) and public.icash_market_contract_ready(m.zip,1)');
 execute definition;
end $patch$;
commit;
