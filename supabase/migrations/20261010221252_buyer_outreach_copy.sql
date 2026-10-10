begin;
set local lock_timeout='3s';
select 1 from public.icash_operating_budget where id=1 for update;

-- Compact exact contract amounts. Never round an already published price or EMD.
create or replace function public.icash_buyer_outreach_money(p_cents numeric) returns text
language sql immutable security invoker set search_path='' as $$
 select case when p_cents between 0 and 100000000000 and p_cents=trunc(p_cents) then
  case when p_cents=0 then '$0'
   when p_cents%100000=0 and p_cents<100000000 then '$'||(p_cents/100000)::bigint::text||'k'
   when p_cents%100=0 then '$'||to_char(p_cents/100,'FM999,999,999,990')
   else '$'||to_char(p_cents/100,'FM999,999,999,990.00') end end
$$;

-- A whitelist of public package facts; no acquisition price, fee amount or spread.
create or replace function public.icash_buyer_outreach_copy(p_data jsonb,p_url text) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare address text;principal text;market text;question text;candidate text;price text;deposit text;arv text;repairs text;closing text;photo_label text:='Property details';sms text;body text;
begin
 if p_url is null or p_url !~ '^https://www\.geticashx\.com/d/[a-f0-9]{32}$'
 or p_data->'reserved'='true'::jsonb or jsonb_typeof(p_data->'askingPriceCents') is distinct from 'number' then return null;end if;
 address:=btrim(regexp_replace(p_data->>'address','[[:space:][:cntrl:]]+',' ','g'));
 principal:=btrim(regexp_replace(p_data->>'principal','[[:space:][:cntrl:]]+',' ','g'));
 market:=nullif(btrim(regexp_replace(p_data->>'market','[[:space:][:cntrl:]]+',' ','g')),'');
 if length(market)>80 then market:=null;end if;
 if market ~ '^[0-9]{5}$' then market:='ZIP '||market;
 elsif market=upper(market) then market:=initcap(market);end if;
 question:=case when market is not null then 'Buying in '||market||'?' else 'Buying properties right now?' end;
 price:=public.icash_buyer_outreach_money((p_data->>'askingPriceCents')::numeric);
 if address is null or length(address) not between 1 and 300 or principal is null or length(principal) not between 1 and 200
 or price is null or (p_data->>'askingPriceCents')::numeric<=0 then return null;end if;
 if jsonb_typeof(p_data->'arvCents')='number' and (p_data->>'arvCents')::numeric>=100000 then
  arv:=public.icash_buyer_outreach_money(floor((p_data->>'arvCents')::numeric/100000)*100000);end if;
 if jsonb_typeof(p_data->'repairsCents')='number' and (p_data->>'repairsCents')::numeric>=0 then
  repairs:=public.icash_buyer_outreach_money(ceil((p_data->>'repairsCents')::numeric/100000)*100000);end if;
 if jsonb_typeof(p_data->'depositCents')='number' and (p_data->>'depositCents')::numeric between 1 and 500000 then
  deposit:=public.icash_buyer_outreach_money((p_data->>'depositCents')::numeric);end if;
 if coalesce(p_data->>'closingDate','') ~ '^\d{4}-\d{2}-\d{2}$' then
  begin closing:=to_char((p_data->>'closingDate')::date,'FMMonth FMDD, YYYY');
  exception when datetime_field_overflow or invalid_datetime_format then closing:=null;end;
 end if;
 -- Only promise photos when a validated coordinate or supplied image is present.
 if jsonb_typeof(p_data->'latitude')='number' and jsonb_typeof(p_data->'longitude')='number' then
  if abs((p_data->>'latitude')::numeric) between 0.000000001 and 90 and abs((p_data->>'longitude')::numeric) between 0.000000001 and 180 then photo_label:='Photos & details';end if;
 end if;
 if p_data->'propertyImages'->>'street_view' ~ '^https://img\.dealmachine\.com/sv/[^#]+$'
 or p_data->'propertyImages'->>'satellite' ~ '^https://img\.dealmachine\.com/sat/[^#]+$'
 or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_data->'sellerPhotos')='array' then p_data->'sellerPhotos' else '[]'::jsonb end) photo
  where photo->>'url' ~ '^https://api\.contiguity\.com/attachments/[^#]+$' and photo->>'mime' ~* '^image/(jpeg|png|webp|gif)$') then photo_label:='Photos & details';end if;
 -- Ask about buying and include the package immediately. Keep identity, exact
 -- price and link intact; never cause extra SMS segments or invent a locality.
 foreach candidate in array array[
  principal||': '||question||' '||price||' + closing costs. Buyer package: '||p_url,
  principal||': '||question||' '||price||' + closing costs. Package: '||p_url,
  principal||': Buying now? '||price||' + closing costs. Package: '||p_url
 ] loop
  if public.icash_sms_single_segment(candidate) then sms:=candidate;exit;end if;
 end loop;
 if sms is null then return null;end if;
 body:='Hi,'||chr(10)||chr(10)||case when market is not null then 'Are you buying in '||market||' right now?' else 'Are you buying properties right now?' end||chr(10)||chr(10)||principal||' has '||address||' under contract and available for assignment.'||chr(10)||chr(10)||
  'Buyer package ('||lower(photo_label)||'): '||p_url||chr(10)||chr(10)||
  'Buyer price: '||price||' (our fee is included)'||chr(10)||'Buyer pays closing costs.'||chr(10)||
  case when arv is not null then 'Estimated ARV: about '||arv||chr(10) else '' end||
  case when repairs is not null then 'Estimated repairs: about '||repairs||chr(10) else '' end||
  'Closing date: '||coalesce(closing,'To be confirmed')||chr(10)||
  case when deposit is not null then 'Non-refundable deposit: '||deposit||', credited toward the included fee under the assignment agreement.' else 'Deposit amount: confirm in the assignment agreement.' end||chr(10)||chr(10)||
  'Does this fit what you are buying? Reply with questions or ask to view it. We can coordinate availability with the seller. You can also move forward without a viewing - reply to request the next steps.'||chr(10)||chr(10)||
  principal||chr(10)||'Reply if you no longer want updates about this deal.';
 return jsonb_build_object('sms',sms,'subject',left(question||' '||price||' | '||address,180),'email',body);
end $$;

create or replace function public.icash_buyer_outreach_content(p_account uuid,p_deal uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.icash_buyer_outreach_copy(p.data||jsonb_build_object('market',a.market),'https://www.geticashx.com/d/'||l.token)
 from public.icash_buyer_package_links l
 join public.icash_disposition_authorities a on a.account_id=l.account_id and a.deal_id=l.deal_id and a.purchase_envelope_id=l.purchase_envelope_id
 cross join lateral(select public.icash_buyer_package_data(l.account_id,l.deal_id) data) p
 where l.account_id=p_account and l.deal_id=p_deal and l.revoked_at is null and a.expires_at>now()
 and l.asking_price_cents=(p.data->>'askingPriceCents')::bigint and a.asking_price_cents=l.asking_price_cents
$$;

-- The ordinary and explicitly approved owner delivery paths use identical copy.
do $owner$
begin
 if to_regprocedure('public.icash_owner_buyer_test_content(uuid)') is not null then
  execute $create$create or replace function public.icash_owner_buyer_test_content(p_id uuid) returns jsonb
   language sql stable security invoker set search_path='' as $body$
    select public.icash_buyer_outreach_content(x.account_id,x.deal_id)
    from public.icash_owner_buyer_tests x where x.id=p_id and public.icash_owner_buyer_test_current(x.id)
   $body$$create$;
 end if;
end $owner$;

-- Keep the signed-price, recipient, STOP, hold, reservation and atomic spend
-- checks. Recognize the new exact copy while leaving queued legacy copy valid.
do $claims$
declare item record;definition text;needle text;matched integer:=0;
begin
 for item in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'icash_claim_text%' loop
  definition:=pg_get_functiondef(item.oid);
  needle:='if item.asking_price_cents<>price or item.body<>expected then return null;end if;';
  if position(needle in definition)>0 then
   definition:=replace(definition,needle,'if item.asking_price_cents<>price or (item.body<>expected and item.body is distinct from (public.icash_buyer_outreach_content(p_account,item.deal_id)->>''sms'')) then return null;end if;');
   execute definition;matched:=matched+1;
  elsif position('icash_buyer_outreach_content(p_account,item.deal_id)' in definition)>0 then matched:=matched+1;
  end if;
  if position('Under contract. Buyer price' in definition)>0 and position('select * into j from public.icash_text_ai_jobs' in definition)>0
   and position('icash_buyer_outreach_content(p_account,x.deal_id)' in definition)=0 then
   needle:=' if expected is null then';
   if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Owner text claim prerequisite changed';end if;
   definition:=replace(definition,needle,$new$ if expected is not null and m.body=public.icash_buyer_outreach_content(p_account,x.deal_id)->>'sms' then expected:=m.body;end if;
 if expected is null then$new$);
   execute definition;
  end if;
 end loop;
 if matched<>1 then raise exception 'Expected one signed-price buyer text claim, found %',matched;end if;
end $claims$;
revoke all on function public.icash_buyer_outreach_money(numeric),public.icash_buyer_outreach_copy(jsonb,text),public.icash_buyer_outreach_content(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_buyer_outreach_money(numeric),public.icash_buyer_outreach_copy(jsonb,text),public.icash_buyer_outreach_content(uuid,uuid) to service_role;
commit;
