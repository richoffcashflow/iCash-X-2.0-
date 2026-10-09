-- An explicit owner-requested test hold. It never expires or enables itself.
-- Discovery/package preparation and seller communication remain available.
begin;
create table public.icash_buyer_outreach_holds (
 account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),
 requested_by uuid not null references auth.users(id),
 reason text not null check(length(trim(reason)) between 1 and 500),
 held_at timestamptz not null default now(),
 released_at timestamptz,
 primary key(account_id,deal_id)
);
alter table public.icash_buyer_outreach_holds enable row level security;
revoke all on public.icash_buyer_outreach_holds from public,anon,authenticated,service_role;
grant select on public.icash_buyer_outreach_holds to service_role;

create function public.icash_buyer_outreach_held(p_account uuid,p_deal uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_buyer_outreach_holds h
 join public.icash_deal_files d on d.id=h.deal_id and d.account_id=h.account_id
 where h.account_id=p_account and h.deal_id=p_deal and h.released_at is null)
$$;

create function public.icash_set_buyer_outreach_hold(p_account uuid,p_deal uuid,p_actor uuid,p_held boolean,p_reason text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 -- Same first lock as the final send claims. A hold cannot race a new claim.
 perform 1 from public.icash_operating_budget where id=1 for update;
 if p_held is null or p_reason is null or length(trim(p_reason)) not between 1 and 500
 or not exists(select 1 from public.icash_accounts a join public.icash_deal_files d on d.account_id=a.id
 where a.id=p_account and a.owner_user_id=p_actor and d.id=p_deal) then
  raise exception 'Owned deal and hold reason required';
 end if;
 if p_held then
  insert into public.icash_buyer_outreach_holds(account_id,deal_id,requested_by,reason)
  values(p_account,p_deal,p_actor,trim(p_reason))
  on conflict(account_id,deal_id) do update set requested_by=excluded.requested_by,reason=excluded.reason,
   held_at=case when icash_buyer_outreach_holds.released_at is null then icash_buyer_outreach_holds.held_at else now() end,released_at=null;
 else
  update public.icash_buyer_outreach_holds set released_at=coalesce(released_at,now()),requested_by=p_actor,reason=trim(p_reason)
  where account_id=p_account and deal_id=p_deal;
 end if;
 return public.icash_buyer_outreach_held(p_account,p_deal);
end $$;

-- Check all buyer texts, including replies and already queued package messages.
alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_buyer_hold;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
 where m.id=p_message and m.account_id=p_account and t.party='buyer' and public.icash_buyer_outreach_held(p_account,t.deal_id)) then return null;end if;
 return public.icash_claim_text_before_buyer_hold(p_account,p_message,p_sender);
end $$;
alter function public.icash_claim_customer_text(uuid,uuid,text) rename to icash_claim_customer_text_before_buyer_hold;
create function public.icash_claim_customer_text(p_account uuid,p_message uuid,p_sender text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
 where m.id=p_message and m.account_id=p_account and t.party='buyer' and public.icash_buyer_outreach_held(p_account,t.deal_id)) then return null;end if;
 return public.icash_claim_customer_text_before_buyer_hold(p_account,p_message,p_sender);
end $$;

-- Keep automatic package senders idle instead of accumulating unsent messages.
alter function public.icash_buyer_package_text_targets(uuid,uuid) rename to icash_buyer_package_text_targets_before_hold;
create function public.icash_buyer_package_text_targets(p_account uuid,p_deal uuid) returns table(id uuid)
language sql stable security invoker set search_path='' as $$
 select t.id from public.icash_buyer_package_text_targets_before_hold(p_account,p_deal) t
 where not public.icash_buyer_outreach_held(p_account,p_deal)
$$;
alter function public.icash_queue_buyer_package_text(uuid,uuid,text) rename to icash_queue_buyer_package_text_before_hold;
create function public.icash_queue_buyer_package_text(p_account uuid,p_thread uuid,p_body text) returns uuid
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from public.icash_text_threads t where t.id=p_thread and t.account_id=p_account
 and public.icash_buyer_outreach_held(p_account,t.deal_id)) then return null;end if;
 return public.icash_queue_buyer_package_text_before_hold(p_account,p_thread,p_body);
end $$;

alter function public.icash_deal_email_contacts(uuid,uuid) rename to icash_deal_email_contacts_before_buyer_hold;
create function public.icash_deal_email_contacts(p_account uuid,p_deal uuid)
returns table(contact_key text,email text,display_name text,party text,verified_until timestamptz)
language sql stable security invoker set search_path='' as $$
 select c.* from public.icash_deal_email_contacts_before_buyer_hold(p_account,p_deal) c
 where c.party<>'buyer' or not public.icash_buyer_outreach_held(p_account,p_deal)
$$;
alter function public.icash_claim_deal_email(uuid,uuid) rename to icash_claim_deal_email_before_buyer_hold;
create function public.icash_claim_deal_email(p_account uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_deal_emails;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_deal_emails where id=p_id and account_id=p_account;
 if found and public.icash_buyer_outreach_held(p_account,m.deal_id) and (
  m.contact_key like 'buyer-request:%'
  or exists(select 1 from public.icash_signing_envelopes e where e.id::text=split_part(m.contact_key,':',2)
   and m.contact_key like 'signer:%' and e.account_id=p_account and e.deal_id=m.deal_id and e.kind='assignment')
  or exists(select 1 from public.icash_deal_email_contacts_before_buyer_hold(p_account,m.deal_id) c where c.contact_key=m.contact_key and c.party='buyer')
 ) then return null;end if;
 return public.icash_claim_deal_email_before_buyer_hold(p_account,p_id);
end $$;

revoke all on function public.icash_buyer_outreach_held(uuid,uuid),public.icash_set_buyer_outreach_hold(uuid,uuid,uuid,boolean,text),
 public.icash_claim_text(uuid,uuid,text),public.icash_claim_customer_text(uuid,uuid,text),public.icash_buyer_package_text_targets(uuid,uuid),
 public.icash_queue_buyer_package_text(uuid,uuid,text),public.icash_deal_email_contacts(uuid,uuid),public.icash_claim_deal_email(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_buyer_outreach_held(uuid,uuid),public.icash_set_buyer_outreach_hold(uuid,uuid,uuid,boolean,text),
 public.icash_claim_text(uuid,uuid,text),public.icash_claim_customer_text(uuid,uuid,text),public.icash_buyer_package_text_targets(uuid,uuid),
 public.icash_queue_buyer_package_text(uuid,uuid,text),public.icash_deal_email_contacts(uuid,uuid),public.icash_claim_deal_email(uuid,uuid) to service_role;
commit;
