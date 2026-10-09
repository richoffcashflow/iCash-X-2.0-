begin;
set local lock_timeout='3s';
-- A complete title answer may follow a question in the same buyer turn.
create or replace function public.icash_buyer_title_quote(p_turns jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare turn jsonb;answer text;previous text:='';experience text;quote text;unrelated boolean;declared_company boolean;
begin
 if jsonb_typeof(p_turns) is distinct from 'array' then return null;end if;
 for turn in select value from jsonb_array_elements(p_turns) loop
  answer:=btrim(turn->>'message');
  if turn->>'role'='user' and length(answer) between 1 and 1500 then
   unrelated:=answer ~* '^(what|when|where|how|who|can|could|would|is|are|do|does)\M' or answer ~ '[?]$'
    or answer ~* '\m(don''t know|do not know|don''t remember|do not remember|can''t remember|cannot remember|forgot|not sure|no preference)\M'
    or answer ~* '^(no|nope|none|not yet|thanks|thank you|okay|ok)[.! ]*$';
   declared_company:=answer ~* '(^|[.!?][[:space:]]+)(i|we)( have|''ve)? (closed|done|completed|worked|used)\M.*\m(title|escrow)\M'
    or answer ~* '(^|[.!?][[:space:]]+)(my|our) (local )?(title|escrow) (company|office|contact|officer|agent) (is|was)\M'
    or previous ~* '\m(have|ever|previously)\M.*\m(wholesaler|assignment deal)\M' and answer ~* '^(yes|yeah|yep)[,. ]+.*\m(with|through|at)\M.{3,}' and answer !~ '[?]$' and not unrelated;
   if answer ~* '^\s*(stop|unsubscribe|cancel|not interested|no thanks)[.! ]*$' then quote:=null;experience:=null;
   elsif answer ~* '\m(don''t|do not|no longer|not) (use|recommend|have|want)\M' and answer ~* '\m(title|escrow|company|closer)\M' then quote:=null;
   else
    if previous ~* '\m(have|ever|previously)\M.*\m(wholesaler|assignment deal)\M' and answer ~* '^(yes|yeah|yep|no|nope|i have|we have|i haven''t|i have not|this is my first)\M' then experience:=answer;end if;
    if declared_company or not unrelated and (
     answer ~* '\m(my|our|use|used|prefer|recommend|work with|worked with)\M.*\m(title|escrow)\M'
     or answer ~* '\m(title|escrow)\M.*\m(used|prefer|recommend|worked with)\M'
     or previous ~* '\m(which|what|name|who|share)\M.*\m(title company|title office|escrow company)\M' and answer !~* '\m(property|view|viewing|visit|deposit|payment|agreement|price|closing date)\M'
    ) then quote:=left(case when experience=answer then answer else concat_ws(E'\n',experience,answer) end,4000);
    elsif quote is not null and not unrelated and answer !~* '\m(property|view|viewing|visit|deposit|payment|agreement|price)\M'
     and previous ~* '\m(contact|closer|escrow officer|phone|email)\M' then quote:=left(quote||E'\n'||answer,4000);
    end if;
   end if;
  end if;
  if turn->>'role'='agent' then previous:=answer;end if;
 end loop;
 return quote;
end $$;
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
