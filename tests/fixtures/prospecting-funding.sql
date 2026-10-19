CREATE OR REPLACE FUNCTION public.icash_post_credit(p_account uuid, p_event text, p_kind text, p_amount bigint, p_evidence text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare w public.icash_wallets; e public.icash_credit_ledger; result uuid;
begin
 if p_event is null or trim(p_event)='' or p_evidence is null or trim(p_evidence)='' or p_amount is null or p_amount=0
 or p_kind is null or p_kind not in ('purchase','grant','refund') then raise exception 'Invalid credit posting'; end if;
 if (p_kind in ('purchase','grant') and p_amount<0) or (p_kind='refund' and p_amount>0) then raise exception 'Invalid credit direction'; end if;
 select * into w from public.icash_wallets where account_id=p_account for update;
 if not found then raise exception 'Wallet missing'; end if;
 select * into e from public.icash_credit_ledger where event_key=p_event;
 if found then
  if e.account_id<>p_account or e.kind<>p_kind or e.delta_cents<>p_amount or e.evidence_ref<>p_evidence then raise exception 'Idempotency conflict'; end if;
  return e.id;
 end if;
 if w.balance_cents+p_amount<w.reserved_cents then raise exception 'Insufficient unreserved credits'; end if;
 insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref)
 values(p_account,p_event,p_kind,p_amount,p_evidence) returning id into result;
 update public.icash_wallets set balance_cents=balance_cents+p_amount where account_id=p_account;
 return result;
end; $function$
