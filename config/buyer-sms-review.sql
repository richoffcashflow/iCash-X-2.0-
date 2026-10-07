begin;
-- Admit actual reviewed buyer SMS contacts through the same channel evidence,
-- rate, suppression and tenant checks as sellers. Voice consent is not SMS consent.
do $patch$
declare def text;needle text;
begin
 def:=pg_get_functiondef('public.icash_submit_authority_review(uuid,uuid,uuid,jsonb)'::regprocedure);
 needle:=$n$if p_payload->>'party' is distinct from 'seller' or p_payload->>'buyerId' is not null then raise exception 'Seller SMS scope required';end if;$n$;
 if position(needle in def)=0 then raise exception 'SMS intake definition changed';end if;
 def:=replace(def,needle,$n$if coalesce(p_payload->>'party','') not in ('seller','buyer') then raise exception 'SMS party required';end if;
 if p_payload->>'party'='buyer' and not exists(select 1 from public.icash_buyer_profiles where id=(p_payload->>'buyerId')::uuid and account_id=p_account) then raise exception 'Owned buyer required';end if;
 if p_payload->>'party'='seller' and p_payload->>'buyerId' is not null then raise exception 'Seller scope mismatch';end if;$n$);
 execute def;
 def:=pg_get_functiondef('public.icash_decide_authority_review(uuid,uuid,text,text,jsonb)'::regprocedure);
 needle:=$n$sms_thread.party<>'seller'$n$;
 if position(needle in def)=0 then raise exception 'SMS binding definition changed';end if;
 def:=replace(def,needle,$n$sms_thread.party is distinct from p->>'party'$n$);
 needle:=$n$sms_rate.id,true,'seller','auto',r.id,true$n$;
 if position(needle in def)=0 then raise exception 'SMS insert definition changed';end if;
 execute replace(def,needle,$n$sms_rate.id,true,p->>'party','auto',r.id,true$n$);
 def:=pg_get_functiondef('public.icash_sms_thread_review_before_operational(uuid,uuid,boolean)'::regprocedure);
 needle:=$n$t.party<>'seller'$n$;
 if position(needle in def)=0 then raise exception 'SMS review definition changed';end if;
 def:=replace(def,needle,$n$t.party not in ('seller','buyer')$n$);
 needle:=$n$p:=r.payload;v:=r.verification;$n$;
 if position(needle in def)=0 then raise exception 'SMS payload definition changed';end if;
 execute replace(def,needle,needle||$n$
 if t.party is distinct from p->>'party' then return false;end if;
 if t.party='buyer' and (public.icash_buyer_package_data(p_account,t.deal_id) is null
  or not exists(select 1 from public.icash_buyer_profiles where id=(p->>'buyerId')::uuid and account_id=p_account)) then return false;end if;
$n$);
 -- The seller's 24-hour acquisition screen is not buyer marketing evidence.
 -- A buyer instead needs the still-valid executed deal, plus every SMS check.
 def:=pg_get_functiondef('public.icash_claim_text_before_owner_question(uuid,uuid,text)'::regprocedure);
 needle:=$n$if not found or s.result->'financialCheck'->>'status' is distinct from 'eligible' or s.completed_at is null or s.completed_at>now() or s.completed_at<now()-interval '24 hours' then return null;end if;$n$;
 if position(needle in def)>0 then
  execute replace(def,needle,$n$if not found then return null;end if;
 if t.party='buyer' then
  if public.icash_buyer_package_data(p_account,d.id) is null then return null;end if;
 elsif s.result->'financialCheck'->>'status' is distinct from 'eligible' or s.completed_at is null or s.completed_at>now() or s.completed_at<now()-interval '24 hours' then return null;end if;$n$);
 else
  needle:=$n$if not public.icash_customer_authored_text(p_account,p_message) and (s.result->'financialCheck'->>'status' is distinct from 'eligible' or s.completed_at is null or s.completed_at>now() or s.completed_at<now()-interval '24 hours') then return null;end if;$n$;
  if position(needle in def)=0 then raise exception 'SMS financial boundary changed';end if;
  execute replace(def,needle,$n$if t.party='buyer' then
  if public.icash_buyer_package_data(p_account,d.id) is null then return null;end if;
 else $n$||needle||$n$ end if;$n$);
 end if;
end $patch$;
commit;
