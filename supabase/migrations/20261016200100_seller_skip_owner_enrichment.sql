-- First-party seller inquiries already include a phone number. Enforce this
-- at the final atomic claim as well as candidate selection and the service.
-- Keep every existing funding, consent, freshness, rate and takeover gate.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_claim_owner_enrichment(uuid,uuid,text,jsonb,uuid,integer,bigint,bigint,timestamptz)'::regprocedure);
 needle:=$old$if not found or s.state<>'complete' or s.snapshot is distinct from p_snapshot$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Owner enrichment snapshot gate changed';
 end if;
 execute replace(definition,needle,$new$if not found or s.state<>'complete' or s.snapshot ? 'sellerRequest' or s.snapshot is distinct from p_snapshot$new$);
end $patch$;
