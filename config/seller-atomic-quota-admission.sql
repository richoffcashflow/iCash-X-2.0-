begin;
set local lock_timeout='5s';

-- Prospective-only admission: clone the current guarded bodies, preserving their
-- original locks and eligibility. Existing RPCs remain unchanged for the narrow owner-demo exception.
-- Meta receives its own versioned wrapper retaining all original source gates.
-- Historical quota, request receipts, balances and reservations are untouched.
do $patch$
declare d text; source_signature text; old_name text; new_name text; needle text; expected text;
begin
 for source_signature,old_name,new_name,needle,expected in values
 ('public.icash_claim_seller_lookup_for(uuid)', 'icash_claim_seller_lookup_for', 'icash_claim_seller_lookup_admitted_for',
  'update public.icash_seller_controls set lookup_reserved_micros=lookup_reserved_micros+cap where id=1;', 'fe64dcb72c3e017086989350b7b81e90'),
 ('public.icash_claim_seller_research_refresh()', 'icash_claim_seller_research_refresh', 'icash_claim_seller_research_refresh_admitted',
  'insert into public.icash_seller_research_refreshes(lead_id,source_fetched_at,source_property,source_result,claim_token,lookup_costs,lookup_cap_micros,lookup_cost_basis,data_rights_until)', 'e0936ab5520deeb5d525de54699731a5')
 loop
  d:=pg_get_functiondef(source_signature::regprocedure);
  if md5(d)<>expected or (length(d)-length(replace(d,needle,'')))/length(needle)<>1
   or strpos(d,'icash_take_dealmachine_request')>0
   or strpos(d,'for update skip locked')=0 then
   raise exception 'Seller atomic admission prerequisite changed: %',source_signature;
  end if;
  -- The quota row is locked only after the existing operating/seller/source
  -- locks and all gates. Never wait on quota after reading source/account
  -- gates: contention is distinct from quota denial and cannot invoke the demo
  -- exception. Denial keeps old unknown-outcome maintenance, but
  -- creates no new funded claim. Any subsequent error rolls quota back too.
  d:=replace(d,'FUNCTION public.'||old_name||'(', 'FUNCTION public.'||new_name||'(');
  if strpos(d,'FUNCTION public.'||new_name||'(')=0 then raise exception 'Seller function signature changed';end if;
  d:=replace(d,needle,E'begin\n  lock table public.icash_dealmachine_request_budget in row exclusive mode nowait;\n  perform 1 from public.icash_dealmachine_request_budget where id=1 for update nowait;\n  if not found then return jsonb_build_object(''status'',''admission_busy'');end if;\n exception when lock_not_available then\n  return jsonb_build_object(''status'',''admission_busy'');\n end;\n if public.icash_take_dealmachine_request() is distinct from true then
  return jsonb_build_object(''status'',''rate_limited'');
 end if;
 '||needle);
  execute d;
 end loop;
end $patch$;
-- Meta owns additional operating/source/account locks before seller selection.
-- Clone its current wrapper and replace only the nested claim, retaining the
-- transaction-local source binding and all existing account/contact gates.
do $patch$
declare d text;needle text:='claim:=public.icash_claim_seller_lookup_for(p_id);';
begin
 d:=pg_get_functiondef('public.icash_meta_claim_lookup(uuid)'::regprocedure);
 if md5(d)<>'3fd10ac99e20c81adaa752bc4527aa54' or (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Meta atomic admission prerequisite changed';end if;
 d:=replace(d,'FUNCTION public.icash_meta_claim_lookup(', 'FUNCTION public.icash_meta_claim_lookup_admitted(');
 if strpos(d,'FUNCTION public.icash_meta_claim_lookup_admitted(')=0 then raise exception 'Meta function signature changed';end if;
 execute replace(d,needle,'claim:=public.icash_claim_seller_lookup_admitted_for(p_id);');
end $patch$;
create function public.icash_claim_seller_lookup_admitted() returns jsonb
language sql volatile security invoker set search_path='' as $$
 select public.icash_claim_seller_lookup_admitted_for(null)
$$;
revoke all on function public.icash_meta_claim_lookup_admitted(uuid),public.icash_claim_seller_lookup_admitted_for(uuid),public.icash_claim_seller_lookup_admitted(),public.icash_claim_seller_research_refresh_admitted() from public,anon,authenticated;
grant execute on function public.icash_meta_claim_lookup_admitted(uuid),public.icash_claim_seller_lookup_admitted_for(uuid),public.icash_claim_seller_lookup_admitted(),public.icash_claim_seller_research_refresh_admitted() to service_role;
commit;
