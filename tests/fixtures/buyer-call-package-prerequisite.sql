-- Exact read-only installed predecessor, captured 2026-11-16; no customer data.
CREATE OR REPLACE FUNCTION public.icash_claim_text(p_account uuid, p_message uuid, p_sender text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_text_ai_jobs;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where account_id=p_account and outgoing_id=p_message;
 if found and not public.icash_seller_progress_gate(p_account,j.id) then return null;end if;
 return public.icash_claim_text_before_progress(p_account,p_message,p_sender);
exception when sqlstate 'PCT01' then perform icash_sender_private.defer(p_account,p_message,p_sender,'automatic'); return null;
when sqlstate 'PCT02' then return null;
end $function$;
