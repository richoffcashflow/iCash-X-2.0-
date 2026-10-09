begin;
set local lock_timeout='3s';
-- Internal acquisition/fee arithmetic stays in the existing authority checks.
-- The outer buyer projection contains only buyer-visible facts.
alter function public.icash_buyer_package_data(uuid,uuid) rename to icash_buyer_package_before_price_privacy;
create function public.icash_buyer_package_data(p_account uuid,p_deal uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare p jsonb;result jsonb:='{}';key text;
begin
 p:=public.icash_buyer_package_before_price_privacy(p_account,p_deal);
 if p is null then return null;end if;
 foreach key in array array['address','principal','askingPriceCents','repairsCents','arvCents','fetchedAt','closingDate','businessPhone','propertyImages','latitude','longitude','sellerPhotos','depositCents','viewingSlots','viewingOptional','reserved','titleSelectionStatus'] loop
  if p?key then result:=result||jsonb_build_object(key,p->key);end if;
 end loop;
 return result||jsonb_build_object('privacyPolicy','buyer_price_only_v1');
end $$;

alter function public.icash_buyer_factual_text(uuid,uuid,text) rename to icash_buyer_reply_before_price_privacy;
create function public.icash_buyer_factual_text(p_account uuid,p_thread uuid,p_incoming text) returns text
language plpgsql stable security invoker set search_path='' as $$
declare p jsonb;deal uuid;b text;
begin
 select deal_id into deal from public.icash_text_threads where account_id=p_account and id=p_thread and party='buyer';
 if not found or p_incoming is null or length(p_incoming)>1500 then return null;end if;
 p:=public.icash_buyer_package_data(p_account,deal);if p is null then return null;end if;
 b:=lower(btrim(p_incoming));
 if b ~ '\m(stop|unsubscribe|not interested|no thanks|human|real person)\M' then return null;end if;
 if b ~ '\m(spread|margin|markup|mark.up|profit|assignment fee|acquisition|underlying purchase|purchase price|under contract for|seller price|seller gets|seller getting|seller receive)\M'
  or b ~ '\m(what|how much)\M.*\m(did|do|are|will|would) you (pay|paid|make|profit|get|buy|earn|charge)\M'
  or b ~ '\m(how much)\M.*\m(your fee|you paid|you pay|you bought|you got it for)\M'
  or b ~ '\m(deposit)\M.*\m(percentage|percent|formula|calculate|calculation|cap)\M'
  or b ~ '\m(percentage|percent|formula|calculate|calculation|cap)\M.*\m(deposit|fee|spread|margin)\M'
  then
   if p->'reserved'='true'::jsonb then return 'Internal acquisition pricing and margins are private. This property is reserved; contact the team about an existing agreement.';end if;
   return 'The buyer price is $'||to_char((p->>'askingPriceCents')::numeric/100,'FM999,999,999,990.00')||', including our fee, plus buyer closing costs. Internal acquisition pricing and margins are private.';
 end if;
 return public.icash_buyer_reply_before_price_privacy(p_account,p_thread,p_incoming);
end $$;

-- Old queued package emails must not send the former price breakdown.
alter function public.icash_claim_deal_email(uuid,uuid) rename to icash_claim_deal_email_before_price_privacy;
create function public.icash_claim_deal_email(p_account uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_deal_emails;
begin
 select * into m from public.icash_deal_emails where id=p_id and account_id=p_account;
 if m.contact_key like 'buyer-request:%' and m.body_text ~* '(underlying purchase price|assignment fee)\s*:' then return null;end if;
 return public.icash_claim_deal_email_before_price_privacy(p_account,p_id);
end $$;

revoke all on function public.icash_buyer_package_data(uuid,uuid),public.icash_buyer_package_before_price_privacy(uuid,uuid),public.icash_buyer_factual_text(uuid,uuid,text),public.icash_buyer_reply_before_price_privacy(uuid,uuid,text),public.icash_claim_deal_email(uuid,uuid),public.icash_claim_deal_email_before_price_privacy(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_buyer_package_data(uuid,uuid),public.icash_buyer_package_before_price_privacy(uuid,uuid),public.icash_buyer_factual_text(uuid,uuid,text),public.icash_buyer_reply_before_price_privacy(uuid,uuid,text),public.icash_claim_deal_email(uuid,uuid),public.icash_claim_deal_email_before_price_privacy(uuid,uuid) to service_role;
commit;
