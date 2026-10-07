begin;
-- Standing operator policy: executed purchase + $10,000. No invented review,
-- signature, funds, contact permission or title clearance is recorded.
alter table public.icash_disposition_authorities add column pricing_policy text not null default 'manual_review';
create table public.icash_buyer_package_links(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),purchase_envelope_id uuid not null references public.icash_signing_envelopes(id),
 token text not null unique default replace(gen_random_uuid()::text,'-','') check(token ~ '^[a-f0-9]{32}$'),
 asking_price_cents bigint not null check(asking_price_cents>0),revoked_at timestamptz,created_at timestamptz not null default now(),unique(deal_id,purchase_envelope_id)
);
create table public.icash_buyer_package_texts(
 message_id uuid primary key references public.icash_text_messages(id),link_id uuid not null references public.icash_buyer_package_links(id),
 thread_id uuid not null references public.icash_text_threads(id),unique(link_id,thread_id)
);
alter table public.icash_buyer_package_links enable row level security;
alter table public.icash_buyer_package_texts enable row level security;
revoke all on public.icash_buyer_package_links,public.icash_buyer_package_texts from public,anon,authenticated;
grant select,insert,update on public.icash_buyer_package_links,public.icash_buyer_package_texts to service_role;

create function public.icash_prepare_buyer_disposition(p_account uuid,p_deal uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare d public.icash_deal_files;e public.icash_signing_envelopes;s public.icash_screening_jobs;price bigint;repairs numeric;deadline timestamptz;market_name text;
begin
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if not found or d.stage not in ('under_contract','buyer_selected','title_open','closing') then return false;end if;
 select e0.* into e from public.icash_signing_envelopes e0 join public.icash_signing_templates t on t.id=e0.template_id
 where e0.deal_id=d.id and e0.account_id=p_account and e0.kind='purchase' and e0.state='completed' and not e0.test_mode
 and t.template_scope='standard' and t.kind='purchase' and t.provider='docuseal'
 and e0.terms->'priceCents'=d.terms->'priceCents' and e0.terms->'address'=d.terms->'address'
 and e0.terms-array['assignee','assignmentFeeCents','assignmentDepositCents','payoutMethod','payoutHandle']
 =d.terms-array['assignee','assignmentFeeCents','assignmentDepositCents','payoutMethod','payoutHandle']
 order by e0.updated_at desc limit 1;
 if not found or jsonb_typeof(e.terms->'priceCents') is distinct from 'number' then return false;end if;
 if (e.terms->>'priceCents')::numeric<>trunc((e.terms->>'priceCents')::numeric) then return false;end if;
 price:=(e.terms->>'priceCents')::bigint;
 if price<=0 or price>99999000000 then return false;end if;
 -- Purchase templates omit assignment-only terms. Fill only an absent fee;
 -- never change an existing negotiated fee or an assignment already sent.
 if d.terms->>'assignmentFeeCents' is null and not exists(select 1 from public.icash_signing_envelopes where deal_id=d.id and kind='assignment' and not test_mode) then
  update public.icash_deal_files set terms=jsonb_set(terms,'{assignmentFeeCents}','1000000'::jsonb) where id=d.id returning * into d;
 end if;
 if d.terms->>'assignmentFeeCents' is distinct from '1000000' then return false;end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account and state='complete';
 if not found or s.snapshot->>'propertyType'<>'house' or coalesce(d.terms->>'practice','false')='true' then return false;end if;
 if jsonb_typeof(s.snapshot->'raw'->'data'->'estimated_repair_cost') is distinct from 'number' then return false;end if;
 repairs:=(s.snapshot->'raw'->'data'->>'estimated_repair_cost')::numeric*100;
 if repairs<0 or repairs<>trunc(repairs) or repairs>9007199254740991 then return false;end if;
 market_name:=coalesce(nullif(s.snapshot->'raw'->'data'->>'city',''),nullif(s.snapshot->'raw'->'data'->>'zip',''));
 if market_name is null then return false;end if;
 deadline:=least(e.updated_at+interval '30 days',case when nullif(d.terms->>'closingDate','') is null then e.updated_at+interval '30 days' else ((d.terms->>'closingDate')::date+1)::timestamptz end);
 if deadline<=now() then return false;end if;
 -- Respect a separate manual release or a previously revoked standing-policy release.
 if exists(select 1 from public.icash_disposition_authorities where deal_id=d.id and (pricing_policy<>'signed_purchase_plus_10000_v1' or expires_at<=now())) then return false;end if;
 insert into public.icash_disposition_authorities(deal_id,account_id,purchase_envelope_id,market,property_type,asking_price_cents,repairs_cents,marketing_evidence,expires_at,pricing_policy,marketing_scope)
 values(d.id,p_account,e.id,market_name,'house',price+1000000,repairs::bigint,'Operator standing policy authorized 2026-10-07: executed standard purchase plus $10000; no contact consent or title clearance asserted.',deadline,'signed_purchase_plus_10000_v1','Contract-interest buyer package and eligible buyer outreach')
 on conflict(deal_id) do nothing;
 return exists(select 1 from public.icash_disposition_authorities where deal_id=d.id and purchase_envelope_id=e.id and asking_price_cents=price+1000000 and expires_at>now());
end $$;

create function public.icash_buyer_package_data(p_account uuid,p_deal uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('address',d.terms->>'address','principal',i.principal,'purchasePriceCents',(e.terms->>'priceCents')::bigint,
 'assignmentFeeCents',(d.terms->>'assignmentFeeCents')::bigint,'askingPriceCents',a.asking_price_cents,'repairsCents',a.repairs_cents,
 'arvCents',case when jsonb_typeof(s.snapshot->'raw'->'data'->'estimated_value')='number' then round((s.snapshot->'raw'->'data'->>'estimated_value')::numeric*100) end,
 'fetchedAt',s.snapshot->>'fetchedAt','closingDate',nullif(d.terms->>'closingDate',''),
 'businessPhone',(select t.sender from public.icash_text_threads t join public.icash_text_senders sender on sender.phone=t.sender and sender.enabled where t.account_id=p_account and t.deal_id=d.id and t.retired_at is null order by t.id limit 1))
 from public.icash_deal_files d join public.icash_disposition_authorities a on a.deal_id=d.id and a.account_id=d.account_id
 join public.icash_signing_envelopes e on e.id=a.purchase_envelope_id and e.account_id=d.account_id and e.deal_id=d.id
 join public.icash_customer_identities i on i.account_id=d.account_id
 join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
 where d.id=p_deal and d.account_id=p_account and d.stage in ('under_contract','buyer_selected','title_open','closing')
 and e.kind='purchase' and e.state='completed' and not e.test_mode and a.expires_at>now()
 and a.asking_price_cents=(e.terms->>'priceCents')::bigint+(d.terms->>'assignmentFeeCents')::bigint
 and d.terms->'priceCents'=e.terms->'priceCents' and d.terms->'address'=e.terms->'address'
 and e.terms-array['assignee','assignmentFeeCents','assignmentDepositCents','payoutMethod','payoutHandle']=d.terms-array['assignee','assignmentFeeCents','assignmentDepositCents','payoutMethod','payoutHandle']
 and coalesce(d.terms->>'practice','false')<>'true'
$$;
create function public.icash_ensure_buyer_package(p_account uuid,p_deal uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.icash_disposition_authorities;l public.icash_buyer_package_links;
begin
 perform 1 from public.icash_deal_files where id=p_deal and account_id=p_account for share;
 if not found or public.icash_buyer_package_data(p_account,p_deal) is null then return null;end if;
 select * into a from public.icash_disposition_authorities where deal_id=p_deal and account_id=p_account;
 insert into public.icash_buyer_package_links(account_id,deal_id,purchase_envelope_id,asking_price_cents) values(p_account,p_deal,a.purchase_envelope_id,a.asking_price_cents) on conflict(deal_id,purchase_envelope_id) do nothing;
 select * into l from public.icash_buyer_package_links where account_id=p_account and deal_id=p_deal and purchase_envelope_id=a.purchase_envelope_id and asking_price_cents=a.asking_price_cents and revoked_at is null;
 if not found then return null;end if;
 return jsonb_build_object('id',l.id,'url','https://www.geticashx.com/d/'||l.token,'askingPriceCents',a.asking_price_cents);
end $$;
create function public.icash_read_buyer_package(p_token text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.icash_buyer_package_data(account_id,deal_id) from public.icash_buyer_package_links
 where token=p_token and p_token ~ '^[a-f0-9]{32}$' and revoked_at is null and asking_price_cents=(public.icash_buyer_package_data(account_id,deal_id)->>'askingPriceCents')::bigint
 and purchase_envelope_id=(select purchase_envelope_id from public.icash_disposition_authorities where deal_id=icash_buyer_package_links.deal_id and account_id=icash_buyer_package_links.account_id)
$$;

alter function public.icash_buyer_voice_context(uuid) rename to icash_buyer_voice_context_before_package;
create function public.icash_buyer_voice_context(p_permission uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare context jsonb;package jsonb;p public.icash_voice_contact_targets;url text;
begin
 context:=public.icash_buyer_voice_context_before_package(p_permission);
 if context is null then return null;end if;
 select * into p from public.icash_voice_contact_targets where id=p_permission;
 package:=public.icash_buyer_package_data(p.account_id,(context->>'dealId')::uuid);
 if package is null then return null;end if;
 select 'https://www.geticashx.com/d/'||token into url from public.icash_buyer_package_links where account_id=p.account_id and deal_id=(context->>'dealId')::uuid and revoked_at is null and asking_price_cents=(context->>'askingPriceCents')::bigint;
 return context||jsonb_build_object('purchasePriceCents',package->'purchasePriceCents','assignmentFeeCents',package->'assignmentFeeCents','buyerPaysClosingCosts',true,'packageUrl',url);
end $$;

create function public.icash_queue_buyer_package_text(p_account uuid,p_thread uuid,p_body text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare t public.icash_text_threads;l public.icash_buyer_package_links;m uuid;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='buyer' and not paused and retired_at is null for update;
 if not found or not public.icash_sms_thread_review_current(p_account,t.id,true) then return null;end if;
 select link.* into l from public.icash_buyer_package_links link join public.icash_disposition_authorities a on a.purchase_envelope_id=link.purchase_envelope_id and a.deal_id=link.deal_id and a.account_id=link.account_id
 where link.account_id=p_account and link.deal_id=t.deal_id and link.revoked_at is null and a.expires_at>now();
 if not found or public.icash_buyer_package_data(p_account,t.deal_id) is null or position('https://www.geticashx.com/d/'||l.token in p_body)=0 then return null;end if;
 select message_id into m from public.icash_buyer_package_texts where link_id=l.id and thread_id=t.id;
 if found then return m;end if;
 m:=public.icash_queue_text(p_account,t.id,gen_random_uuid(),p_body,'{}'::uuid[]);
 insert into public.icash_buyer_package_texts(message_id,link_id,thread_id) values(m,l.id,t.id);
 return m;
end $$;
-- Re-check the signed deal and unchanged price immediately before provider dispatch.
alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_buyer_package;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item record;price bigint;expected text;
begin
 select l.*,m.body into item from public.icash_buyer_package_texts sent join public.icash_buyer_package_links l on l.id=sent.link_id
 join public.icash_text_messages m on m.id=sent.message_id where sent.message_id=p_message and l.account_id=p_account;
 if found then
  perform 1 from public.icash_deal_files where id=item.deal_id and account_id=p_account for share;
  if item.revoked_at is not null or public.icash_buyer_package_data(p_account,item.deal_id) is null then return null;end if;
  price:=(public.icash_buyer_package_data(p_account,item.deal_id)->>'askingPriceCents')::bigint;
  expected:='Under contract. Buyer price $'||to_char(price::numeric/100,'FM999,999,999,990.00')||' + closing costs. Deal package: https://www.geticashx.com/d/'||item.token;
  if item.asking_price_cents<>price or item.body<>expected then return null;end if;
 end if;
 return public.icash_claim_text_before_buyer_package(p_account,p_message,p_sender);
end $$;
-- A seller's signature is a notification, not a fabricated customer signature.
alter function public.icash_save_signing_status(uuid,text,jsonb) rename to icash_save_signing_status_before_disposition;
create function public.icash_save_signing_status(p_id uuid,p_state text,p_evidence jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare e public.icash_signing_envelopes;
begin
 perform public.icash_save_signing_status_before_disposition(p_id,p_state,p_evidence);
 select * into e from public.icash_signing_envelopes where id=p_id;
 if e.kind='purchase' and e.state='completed' and not e.test_mode then
  perform public.icash_prepare_buyer_disposition(e.account_id,e.deal_id);
  perform public.icash_queue_fulfillment();
 end if;
end $$;
revoke all on function public.icash_prepare_buyer_disposition(uuid,uuid),public.icash_buyer_package_data(uuid,uuid),public.icash_ensure_buyer_package(uuid,uuid),public.icash_read_buyer_package(text),public.icash_queue_buyer_package_text(uuid,uuid,text),public.icash_claim_text(uuid,uuid,text),public.icash_save_signing_status(uuid,text,jsonb),public.icash_buyer_voice_context(uuid) from public,anon,authenticated;
grant execute on function public.icash_prepare_buyer_disposition(uuid,uuid),public.icash_buyer_package_data(uuid,uuid),public.icash_ensure_buyer_package(uuid,uuid),public.icash_read_buyer_package(text),public.icash_queue_buyer_package_text(uuid,uuid,text),public.icash_claim_text(uuid,uuid,text),public.icash_save_signing_status(uuid,text,jsonb),public.icash_buyer_voice_context(uuid) to service_role;
create function public.icash_buyer_package_text_targets(p_account uuid,p_deal uuid) returns table(id uuid)
language sql stable security invoker set search_path='' as $$
 select t.id from public.icash_text_threads t
 join public.icash_buyer_package_links l on l.account_id=t.account_id and l.deal_id=t.deal_id and l.revoked_at is null
 where t.account_id=p_account and t.deal_id=p_deal and t.party='buyer' and not t.paused and t.retired_at is null
 and not exists(select 1 from public.icash_buyer_package_texts sent join public.icash_text_messages m on m.id=sent.message_id where sent.link_id=l.id and sent.thread_id=t.id and m.state<>'ready')
 order by t.id limit 5
$$;
revoke all on function public.icash_buyer_package_text_targets(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_buyer_package_text_targets(uuid,uuid) to service_role;
do $patch$ declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_queue_fulfillment()'::regprocedure);
 needle:=$n$j.result->'buyerDiscovery'->>'canContinue'='true'$n$;
 if position(needle in def)=0 then raise exception 'Fulfillment retry boundary changed';end if;
 execute replace(def,needle,needle||$n$ or (j.result->'buyerTexts'->>'canContinue'='true' and j.updated_at<now()-interval '5 minutes')$n$);
end $patch$;
commit;
