CREATE OR REPLACE FUNCTION public.icash_record_owner_batch_receipt(p_account uuid, p_batch uuid, p_receipt jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b icash_research_private.owner_batches;
begin
 select * into b from icash_research_private.owner_batches where id=p_batch and account_id=p_account for update;
 if not found or p_receipt is null or octet_length(p_receipt::text)>2097152 then return false;end if;
 if b.paid_receipt is not null then return b.paid_receipt=p_receipt;end if;
 update icash_research_private.owner_batches set paid_receipt=p_receipt where id=p_batch;return true;
end $function$
;
