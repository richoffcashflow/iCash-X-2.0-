CREATE OR REPLACE FUNCTION public.icash_record_title_reply(p_email uuid, p_kind text, p_reference uuid, p_sender text, p_subject text, p_text text, p_authenticated boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a uuid;d uuid;r uuid;q uuid;expected text;verified boolean:=false;
begin
 if p_kind='T' then
 select account_id,deal_id,id,recipient into a,d,r,expected from public.icash_title_requests where id=p_reference and state in ('dispatching','sent','needs_review');
 elsif p_kind='Q' then
 select j.account_id,j.id,c.public_email into a,q,expected from public.icash_title_qualification_jobs j join public.icash_title_directory c on c.id=j.company_id where j.id=p_reference and j.state in ('dispatching','sent','needs_review');
 end if;
 verified:=coalesce(p_authenticated and lower(expected)=lower(p_sender),false);
 -- Unverified mail is quarantined to operations, never exposed across tenants.
 if not verified then a:=null;d:=null;r:=null;q:=null;end if;
 insert into public.icash_title_replies(provider_email_id,account_id,deal_id,request_id,qualification_id,sender,subject,body_text,sender_verified)
 values(p_email,a,d,r,q,left(p_sender,320),left(p_subject,500),left(p_text,20000),verified) on conflict(provider_email_id) do nothing;
 -- Email text alone never approves a partner or changes a deal's financial or closing status.
end $function$;
