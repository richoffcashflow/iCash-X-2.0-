begin;
set local lock_timeout='3s';
select 1 from public.icash_operating_budget where id=1 for update;

-- Both domains already serve the same token-bound package. Normalize only
-- these exact HTTPS paths when comparing already queued, approved copy.
create or replace function public.icash_buyer_package_brand(p_text text) returns text
language sql immutable security invoker set search_path='' as $$
 select replace(p_text,'https://www.geticashx.com/d/','https://homeoffernetwork.com/d/')
$$;
revoke all on function public.icash_buyer_package_brand(text) from public,anon,authenticated;
grant execute on function public.icash_buyer_package_brand(text) to service_role;

do $branding$
declare item record;definition text;needle text;changed text;
 producers integer:=0;queues integer:=0;claims integer:=0;owners integer:=0;
begin
 -- Keep the old public origin valid; no arbitrary domains, redirects or tokens.
 definition:=pg_get_functiondef('public.icash_buyer_outreach_copy(jsonb,text)'::regprocedure);
 needle:=$old$^https://www\.geticashx\.com/d/[a-f0-9]{32}$$old$;
 if position(needle in definition)=0 then raise exception 'Buyer copy URL prerequisite changed';end if;
 execute replace(definition,needle,$new$^https://(www\.geticashx\.com|homeoffernetwork\.com)/d/[a-f0-9]{32}$$new$);

 for item in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and
  (p.proname in ('icash_ensure_buyer_package','icash_buyer_outreach_content','icash_buyer_voice_context')
   or p.proname like 'icash_buyer_factual_text%'
   or p.proname like 'icash_queue_buyer_package%'
   or p.proname like 'icash_claim_text%') loop
  definition:=pg_get_functiondef(item.oid);changed:=definition;
  if item.proname in ('icash_ensure_buyer_package','icash_buyer_outreach_content','icash_buyer_voice_context')
   or item.proname like 'icash_buyer_factual_text%' then
   if position('https://www.geticashx.com/d/' in definition)>0 then
    changed:=replace(changed,'https://www.geticashx.com/d/','https://homeoffernetwork.com/d/');
    producers:=producers+1;
   end if;
  end if;
  needle:=$old$position('https://www.geticashx.com/d/'||l.token in p_body)=0$old$;
  if item.proname like 'icash_queue_buyer_package%' and position(needle in definition)>0 then
   changed:=replace(changed,needle,$new$(position('https://www.geticashx.com/d/'||l.token in p_body)=0 and position('https://homeoffernetwork.com/d/'||l.token in p_body)=0)$new$);
   queues:=queues+1;
  end if;
  needle:=$old$if item.asking_price_cents<>price or (item.body<>expected and item.body is distinct from (public.icash_buyer_outreach_content(p_account,item.deal_id)->>'sms')) then return null;end if;$old$;
  if item.proname like 'icash_claim_text%' and position(needle in definition)>0 then
   changed:=replace(changed,needle,$new$if item.asking_price_cents<>price or
    (public.icash_buyer_package_brand(item.body) is distinct from public.icash_buyer_package_brand(expected)
     and public.icash_buyer_package_brand(item.body) is distinct from public.icash_buyer_package_brand(public.icash_buyer_outreach_content(p_account,item.deal_id)->>'sms')) then return null;end if;$new$);
   claims:=claims+1;
  end if;
  needle:=$old$if expected is not null and m.body=public.icash_buyer_outreach_content(p_account,x.deal_id)->>'sms' then expected:=m.body;end if;$old$;
  if item.proname like 'icash_claim_text%' and position(needle in definition)>0 then
   changed:=replace(changed,needle,$new$if expected is not null and public.icash_buyer_package_brand(m.body)=public.icash_buyer_package_brand(public.icash_buyer_outreach_content(p_account,x.deal_id)->>'sms') then expected:=m.body;end if;$new$);
   changed:=replace(changed,'if expected is null or m.body is distinct from expected then return null;end if;',
    'if expected is null or public.icash_buyer_package_brand(m.body) is distinct from public.icash_buyer_package_brand(expected) then return null;end if;');
   owners:=owners+1;
  end if;
  -- Existing factual replies waiting for dispatch retain their exact content.
  if item.proname like 'icash_claim_text%' and position('expected:=public.icash_buyer_factual_text(p_account,t.id,incoming.body);' in definition)>0 then
   changed:=replace(changed,'if expected is null or outgoing.body is distinct from expected then return null;end if;',
    'if expected is null or public.icash_buyer_package_brand(outgoing.body) is distinct from public.icash_buyer_package_brand(expected) then return null;end if;');
  end if;
  if changed<>definition then execute changed;end if;
 end loop;
 if producers<>4 or queues<>1 or claims<>1 or owners<>1 then
  raise exception 'Buyer package branding prerequisite changed: producers %, queues %, claims %, owners %',producers,queues,claims,owners;
 end if;
end $branding$;
commit;
