begin;
set local lock_timeout='3s';
select 1 from public.icash_operating_budget where id=1 for update;
create or replace function public.icash_signature_confirmation_body(p_kind text,p_address text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare body text;street text:=public.icash_conversation_street(p_address);
begin
 if p_kind='seller_signed' then
  body:='Congratulations, your signature for '||street||' is in! We will contact you about available viewing times once everyone has signed.';
  if not public.icash_sms_single_segment(body) then body:='Congratulations, your signature is in! We will contact you about available viewing times once everyone has signed.';end if;
 elsif p_kind='fully_signed' then
  body:='Congratulations, the agreement for '||street||' is signed! What days and times are usually good for viewing the property?';
  if not public.icash_sms_single_segment(body) then body:='Congratulations, the agreement is signed! What days and times are usually good for viewing the property?';end if;
 end if;
 return body;
end $$;
-- Keep exact-body delivery validation aligned for unsubmitted notifications.
-- Never rewrite accepted/delivered messages or resend a signature receipt.
update public.icash_text_messages m
set body=public.icash_signature_confirmation_body(n.kind,e.terms->>'address'),updated_at=now()
from public.icash_signature_confirmation_texts n
join public.icash_signing_envelopes e on e.id=n.envelope_id and e.account_id=n.account_id
where m.id=n.message_id and m.account_id=n.account_id and m.state='ready'
and m.provider_id is null and m.last_delivery_at is null;
commit;
