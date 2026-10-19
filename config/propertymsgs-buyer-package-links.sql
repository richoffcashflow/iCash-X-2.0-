begin;
set local lock_timeout='5s';
select 1 from public.icash_operating_budget where id=1 for update;

-- New package links use the verified property correspondence domain. Existing
-- approved bodies remain immutable and equivalent only for these exact paths.
create or replace function public.icash_buyer_package_brand(p_text text) returns text
language sql immutable security invoker set search_path='' as $$
 select replace(replace(p_text,'https://www.geticashx.com/d/','https://propertymsgs.com/d/'),
  'https://homeoffernetwork.com/d/','https://propertymsgs.com/d/')
$$;
revoke all on function public.icash_buyer_package_brand(text) from public,anon,authenticated;
grant execute on function public.icash_buyer_package_brand(text) to service_role;

do $branding$
declare item record;definition text;changed text;needle text;producers integer:=0;queues integer:=0;email_targets integer:=0;
begin
 definition:=pg_get_functiondef('public.icash_buyer_outreach_copy(jsonb,text)'::regprocedure);
 needle:=$old$^https://(www\.geticashx\.com|homeoffernetwork\.com)/d/[a-f0-9]{32}$$old$;
 if position(needle in definition)=0 then raise exception 'Buyer package URL boundary changed';end if;
 execute replace(definition,needle,$new$^https://(www\.geticashx\.com|homeoffernetwork\.com|propertymsgs\.com)/d/[a-f0-9]{32}$$new$);

 for item in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and
  (p.proname in ('icash_ensure_buyer_package','icash_buyer_outreach_content','icash_buyer_voice_context','icash_network_inbox','icash_read_journey','icash_buyer_package_email_targets')
   or p.proname like 'icash_buyer_factual_text%'
   or p.proname like 'icash_queue_buyer_package%'
   or p.proname like 'icash_claim%email%') loop
  definition:=pg_get_functiondef(item.oid);changed:=definition;
  if item.proname in ('icash_ensure_buyer_package','icash_buyer_outreach_content','icash_buyer_voice_context','icash_network_inbox','icash_read_journey')
   or item.proname like 'icash_buyer_factual_text%' then
   if position('https://homeoffernetwork.com/d/' in definition)>0 then
    changed:=replace(changed,'https://homeoffernetwork.com/d/','https://propertymsgs.com/d/');
    if item.proname not in ('icash_network_inbox','icash_read_journey') then producers:=producers+1;end if;
   end if;
  end if;
  needle:=$old$(position('https://www.geticashx.com/d/'||l.token in p_body)=0 and position('https://homeoffernetwork.com/d/'||l.token in p_body)=0)$old$;
  if item.proname like 'icash_queue_buyer_package%' and position(needle in definition)>0 then
   changed:=replace(changed,needle,$new$(position('https://www.geticashx.com/d/'||l.token in p_body)=0 and position('https://homeoffernetwork.com/d/'||l.token in p_body)=0 and position('https://propertymsgs.com/d/'||l.token in p_body)=0)$new$);
   queues:=queues+1;
  end if;
  -- A queued email keeps its original recipient, subject, idempotency key and
  -- body. A branding change must neither strand it nor queue a duplicate.
  needle:=$old$m.body_text=public.icash_buyer_outreach_content(p_account,p_deal)->>'email'$old$;
  if item.proname='icash_buyer_package_email_targets' and position(needle in definition)>0 then
   changed:=replace(changed,needle,$new$public.icash_buyer_package_brand(m.body_text)=public.icash_buyer_package_brand(public.icash_buyer_outreach_content(p_account,p_deal)->>'email')$new$);
   email_targets:=email_targets+1;
  end if;
  if item.proname like 'icash_claim%email%' then
   changed:=replace(changed,$old$e.body_text is distinct from c->>'body'$old$,
    $new$public.icash_buyer_package_brand(e.body_text) is distinct from public.icash_buyer_package_brand(c->>'body')$new$);
   changed:=replace(changed,'row(m.recipient,m.request_key,m.rate_id,m.authored_by,m.subject,m.body_text)',
    'row(m.recipient,m.request_key,m.rate_id,m.authored_by,m.subject,public.icash_buyer_package_brand(m.body_text))');
   changed:=replace(changed,$old$row(x.email,x.id,x.email_rate_id,x.owner_user_id,content->>'subject',content->>'email')$old$,
    $new$row(x.email,x.id,x.email_rate_id,x.owner_user_id,content->>'subject',public.icash_buyer_package_brand(content->>'email'))$new$);
  end if;
  if changed<>definition then execute changed;end if;
 end loop;
 if producers<>4 or queues<>1 or email_targets<>1 then
  raise exception 'Buyer package domain prerequisites changed: producers %, queues %, email targets %',producers,queues,email_targets;
 end if;
end $branding$;
commit;
