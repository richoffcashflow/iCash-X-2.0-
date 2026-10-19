begin;
set local lock_timeout='5s';
-- One initial email for a seller's actual, assigned email opt-in. This does not
-- turn purchased owner data into permission or enroll anybody in a campaign.
create table public.icash_seller_email_openers(
 account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),
 lead_id uuid not null references public.icash_seller_intakes(id),
 email_id uuid not null unique references public.icash_deal_emails(id),
 recipient text not null,
 created_at timestamptz not null default now(),
 primary key(account_id,deal_id)
);
alter table public.icash_seller_email_openers enable row level security;
revoke all on public.icash_seller_email_openers from public,anon,authenticated;
grant select,insert on public.icash_seller_email_openers to service_role;

create function public.icash_seller_email_opening(p_account uuid,p_deal uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.icash_deal_files;s public.icash_screening_jobs;l public.icash_seller_intakes;c record;principal text;owner_id uuid;timezone text;
begin
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account and stage='draft' and coalesce(terms->>'practice','false')<>'true';
 if not found or length(trim(coalesce(d.terms->>'address',''))) not between 1 and 300 then return null;end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account and state='complete'
  and result->'financialCheck'->>'status'='eligible' and completed_at<=now() and completed_at>now()-interval '24 hours';
 if not found then return null;end if;
 select a.owner_user_id,i.principal into owner_id,principal from public.icash_accounts a
 join public.icash_customer_identities i on i.account_id=a.id join public.icash_wallets w on w.account_id=a.id and w.balance_cents>0
 where a.id=p_account and not a.bot_paused and public.icash_membership_work_allowed(a.id);
 if owner_id is null or nullif(trim(principal),'') is null then return null;end if;
 if exists(select 1 from public.icash_property_controls p where p.account_id=p_account and p.property_id=s.snapshot->>'propertyId' and p.manual)
  or exists(select 1 from public.icash_handoffs h where h.account_id=p_account and h.screening_id=s.id and h.state<>'resolved')
  or exists(select 1 from public.icash_billing_reviews b where b.account_id=p_account and b.resolved_at is null) then return null;end if;
 select li.* into l from public.icash_seller_matches m join public.icash_seller_intakes li on li.id=m.lead_id
 where m.account_id=p_account and m.screening_id=s.id and li.id::text=s.snapshot->'sellerRequest'->>'id' and li.state='assigned';
 if not found or not l.email_consented or l.email is null or l.created_at>now()
  or public.icash_seller_contact_evidence(p_account,s.id,l.id,l.phone) is null then return null;end if;
 select * into c from public.icash_deal_email_contacts(p_account,p_deal)
 where contact_key='seller-lead:'||l.id and party='seller' and email=lower(l.email) and verified_until>now();
 if not found or exists(select 1 from public.icash_email_suppressions e where e.account_id=p_account and e.email=lower(l.email)) then return null;end if;
 timezone:=case when l.attribution->>'contactTimezoneSource' in ('seller_browser','owner_test_context') then l.attribution->>'contactTimezone' end;
 if public.icash_outreach_window_open(timezone,null,now()) is distinct from true then return null;end if;
 -- An opening must not interrupt an existing written exchange or restart an
 -- introduction after a seller has already answered by phone or text.
 if exists(select 1 from public.icash_deal_emails m where m.account_id=p_account and m.deal_id=p_deal and m.direction='incoming')
  or public.icash_outreach_active_conversation(p_account,s.id,l.phone,now()) then return null;end if;
 return jsonb_build_object('leadId',l.id,'ownerId',owner_id,'contactKey',c.contact_key,'recipient',c.email,
  'subject','Your property at '||left(regexp_replace(d.terms->>'address',E'[\\r\\n]+',' ','g'),150),
  'body','Hi, I am the assistant for '||principal||'. You asked to hear from buyers about '||(d.terms->>'address')||'. Are you the owner, and are you considering selling for an all-cash offer? Reply with the property condition and your preferred timing so we can discuss the next step. If you do not want more emails, reply unsubscribe.');
end $$;

create function public.icash_queue_seller_emails(p_limit integer default 10)
returns table(account_id uuid,email_id uuid) language plpgsql security invoker set search_path='' as $$
declare candidate record;content jsonb;rate_id uuid;existing public.icash_seller_email_openers;message public.icash_deal_emails;key_hash text;request_id uuid;new_id uuid;
begin
 perform 1 from public.icash_operating_budget b where b.id=1 for update;
 select r.id into rate_id from public.icash_operation_rates r where r.operation='manual_email' and r.enabled and r.verified_at<=now() and r.expires_at>now() order by r.verified_at desc,r.id limit 1;
 if rate_id is null then return;end if;
 for candidate in select d.account_id,d.id from public.icash_deal_files d
  left join public.icash_seller_email_openers o on o.account_id=d.account_id and o.deal_id=d.id
  left join public.icash_deal_emails e on e.id=o.email_id and e.account_id=o.account_id
  cross join lateral public.icash_seller_email_opening(d.account_id,d.id) opening(content)
  where d.stage='draft' and (o.email_id is null or e.state='ready')
  and opening.content is not null
  and (e.id is null or (e.recipient=opening.content->>'recipient' and e.subject=opening.content->>'subject' and e.body_text=opening.content->>'body'
   and e.permission_until>now() and exists(select 1 from public.icash_operation_rates saved where saved.id=e.rate_id and saved.enabled and saved.expires_at>now())))
  and not exists(select 1 from public.icash_deal_emails prior where prior.account_id=d.account_id and prior.deal_id=d.id and prior.direction='outgoing' and prior.id is distinct from o.email_id)
  order by d.created_at,d.id limit greatest(1,least(coalesce(p_limit,10),20))
 loop
  content:=public.icash_seller_email_opening(candidate.account_id,candidate.id);
  if content is null then continue;end if;
  select * into existing from public.icash_seller_email_openers o where o.account_id=candidate.account_id and o.deal_id=candidate.id;
  if found then
   select * into message from public.icash_deal_emails e where e.id=existing.email_id and e.account_id=candidate.account_id and e.state='ready';
   if not found or message.recipient is distinct from content->>'recipient' then continue;end if;
   new_id:=existing.email_id;
  else
   key_hash:=encode(sha256(convert_to('seller-email-opening:'||candidate.account_id::text||':'||candidate.id::text,'UTF8')),'hex');
   request_id:=(substr(key_hash,1,8)||'-'||substr(key_hash,9,4)||'-5'||substr(key_hash,14,3)||'-a'||substr(key_hash,18,3)||'-'||substr(key_hash,21,12))::uuid;
   new_id:=public.icash_queue_deal_email(candidate.account_id,(content->>'ownerId')::uuid,candidate.id,content->>'contactKey',request_id,content->>'subject',content->>'body',rate_id);
   insert into public.icash_seller_email_openers(account_id,deal_id,lead_id,email_id,recipient)
   values(candidate.account_id,candidate.id,(content->>'leadId')::uuid,new_id,content->>'recipient');
  end if;
  account_id:=candidate.account_id;email_id:=new_id;return next;
 end loop;
end $$;

-- A queued email is not authority to send later. Recheck current consent,
-- hours and all manual controls immediately before the existing spend claim.
alter function public.icash_claim_deal_email(uuid,uuid) rename to icash_claim_email_before_seller_opening;
create function public.icash_claim_deal_email(p_account uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.icash_seller_email_openers;content jsonb;m public.icash_deal_emails;
begin
 perform 1 from public.icash_operating_budget b where b.id=1 for update;
 select * into o from public.icash_seller_email_openers where email_id=p_id and account_id=p_account;
 if found then
  perform 1 from public.icash_accounts where id=p_account and not bot_paused for share;
  if not found then return null;end if;
  content:=public.icash_seller_email_opening(p_account,o.deal_id);
  if content is null or o.recipient is distinct from content->>'recipient' or o.lead_id::text is distinct from content->>'leadId' then return null;end if;
  select * into m from public.icash_deal_emails where id=p_id and account_id=p_account;
  if m.subject is distinct from content->>'subject' or m.body_text is distinct from content->>'body' then return null;end if;
 end if;
 return public.icash_claim_email_before_seller_opening(p_account,p_id);
end $$;

-- Honor a direct authenticated unsubscribe reply through the same signed
-- account/message identity used by the existing reply mailbox.
alter function public.icash_record_deal_email_reply(uuid,uuid,text,text,text,boolean) rename to icash_record_email_reply_before_seller_opening;
create function public.icash_record_deal_email_reply(p_email uuid,p_reference uuid,p_sender text,p_subject text,p_text text,p_authenticated boolean) returns void
language plpgsql security invoker set search_path='' as $$
declare m public.icash_deal_emails;
begin
 select e.* into m from public.icash_deal_emails e join public.icash_seller_email_openers o on o.email_id=e.id and o.account_id=e.account_id
 where e.id=p_reference and e.direction='outgoing' and e.state in ('dispatching','accepted','needs_review')
 and p_authenticated is true and lower(p_sender)=lower(e.recipient);
 if found and lower(trim(split_part(coalesce(p_text,''),E'\n',1))) ~ '^(unsubscribe|stop|remove me|please unsubscribe|please stop)[.! ]*$' then
  insert into public.icash_email_suppressions(account_id,email,reason) values(m.account_id,lower(m.recipient),'seller_requested_unsubscribe') on conflict(account_id,email) do nothing;
 end if;
 perform public.icash_record_email_reply_before_seller_opening(p_email,p_reference,p_sender,p_subject,p_text,p_authenticated);
end $$;

-- Feed authenticated email replies into the existing response-first cards and
-- outcome facts. An accepted email is an attempt, never a seller response.
do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_refresh_opportunity_outcomes(uuid)'::regprocedure);
 for needle,replacement in values
 ($old$  union select d.screening_id from public.icash_deal_files d join public.icash_signing_envelopes e$old$,
 $new$  union select d.screening_id from public.icash_deal_files d join public.icash_seller_email_openers a on a.deal_id=d.id and a.account_id=d.account_id
   join public.icash_deal_emails m on m.account_id=a.account_id and (m.id=a.email_id or m.reply_to_id=a.email_id)
   left join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='deal-email:'||m.id
   where d.account_id=p_account and (m.updated_at>=last_refresh or o.settled_at>=last_refresh)
  union select d.screening_id from public.icash_deal_files d join public.icash_signing_envelopes e$new$),
 ($old$coalesce(v.attempted,false) or coalesce(t.attempted,false),coalesce(v.responded,false) or coalesce(t.responded,false),coalesce(v.interested,false),coalesce(v.opted_out,false) or coalesce(t.opted_out,false),coalesce(sig.signed,false),greatest(v.response_at,t.response_at)$old$,
 $new$coalesce(v.attempted,false) or coalesce(t.attempted,false) or coalesce(mail.attempted,false),coalesce(v.responded,false) or coalesce(t.responded,false) or coalesce(mail.responded,false),coalesce(v.interested,false),coalesce(v.opted_out,false) or coalesce(t.opted_out,false) or coalesce(mail.opted_out,false),coalesce(sig.signed,false),greatest(v.response_at,t.response_at,mail.response_at)$new$),
 ($old$ ) t on true
 left join lateral ($old$,
 $new$ ) t on true
 left join lateral (
  select bool_or(m.id=a.email_id and m.direction='outgoing' and m.state='accepted' and m.provider_id is not null) attempted,
   bool_or(m.reply_to_id=a.email_id and m.direction='incoming' and m.state='received' and m.provider_id is not null) responded,
   bool_or(m.reply_to_id=a.email_id and m.direction='incoming' and m.state='received' and m.provider_id is not null
    and lower(trim(split_part(m.body_text,E'\n',1))) ~ '^(unsubscribe|stop|remove me|please unsubscribe|please stop)[.! ]*$') opted_out,
   max(m.created_at) filter(where m.reply_to_id=a.email_id and m.direction='incoming' and m.state='received' and m.provider_id is not null) response_at
  from public.icash_deal_files d join public.icash_seller_email_openers a on a.deal_id=d.id and a.account_id=d.account_id
  join public.icash_deal_emails m on m.account_id=a.account_id and m.deal_id=a.deal_id and lower(m.recipient)=a.recipient and (m.id=a.email_id or m.reply_to_id=a.email_id)
  where d.screening_id=s.id and d.account_id=s.account_id
 ) mail on true
 left join lateral ($new$),
 ($old$where d.account_id=s.account_id and d.screening_id=s.id))
 ) cost on true$old$,
 $new$where d.account_id=s.account_id and d.screening_id=s.id)
   or o.operation_key in (select 'deal-email:'||a.email_id from public.icash_deal_files d join public.icash_seller_email_openers a on a.deal_id=d.id and a.account_id=d.account_id where d.account_id=s.account_id and d.screening_id=s.id))
 ) cost on true$new$)
 loop
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Seller email outcome prerequisite changed';end if;
  definition:=replace(definition,needle,replacement);
 end loop;
 execute definition;
end $patch$;

revoke all on function public.icash_seller_email_opening(uuid,uuid),public.icash_queue_seller_emails(integer),public.icash_claim_deal_email(uuid,uuid),public.icash_claim_email_before_seller_opening(uuid,uuid),public.icash_record_deal_email_reply(uuid,uuid,text,text,text,boolean),public.icash_record_email_reply_before_seller_opening(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.icash_seller_email_opening(uuid,uuid),public.icash_queue_seller_emails(integer),public.icash_claim_deal_email(uuid,uuid),public.icash_record_deal_email_reply(uuid,uuid,text,text,text,boolean) to service_role;
commit;
