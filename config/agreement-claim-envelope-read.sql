-- Read the original eligible agreement in the claim transaction. A failed read rolls back the one-use claim.
set local lock_timeout='2s';
set local statement_timeout='8s';
do $patch$
declare target regprocedure:='public.icash_claim_agreement_delivery_recovery()'::regprocedure; source text; anchor text; patched text;
begin
 source:=pg_get_functiondef(target);
 if md5(source)<>'c40c2cc0d525f4c417ad225848da552a' or not exists(select 1 from pg_proc where oid=target
  and proowner='postgres'::regrole and proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  and prosecdef and provolatile='v' and proconfig=array['search_path=""']) then raise exception 'Unexpected public.icash_claim_agreement_delivery_recovery() predecessor or authority';end if;
 patched:=source;
 anchor:=$old$'sellerName',r.seller_name,'expectedTerms',current_terms);$old$;
 if length(patched)-length(replace(patched,anchor,''))<>length(anchor) then raise exception 'Expected unique public.icash_claim_agreement_delivery_recovery() source anchor';end if;
 patched:=replace(patched,anchor,$new$'sellerName',r.seller_name,'expectedTerms',current_terms,
  'existingEnvelopes',(select coalesce(jsonb_agg(to_jsonb(original)),'[]'::jsonb) from (
   select e.id,e.state,e.terms,e.recipients,e.provider_id from public.icash_signing_envelopes e
    where e.account_id=r.account_id and e.deal_id=r.deal_id and e.kind='purchase' and not e.test_mode order by e.id limit 2) original));$new$);
 execute patched;
 if pg_get_functiondef(target)<>patched then raise exception 'Unexpected public.icash_claim_agreement_delivery_recovery() readback';end if;
end $patch$;
