-- A transaction mailbox, restricted to known contacts on the customer's own deal.
create function public.icash_deal_email_contacts(p_account uuid,p_deal uuid)
returns table(contact_key text,email text,display_name text,party text,verified_until timestamptz)
language sql stable set search_path='' as $$
 select 'title',lower(c.email),coalesce(nullif(d.terms->>'escrowAgent',''),'Closing office'),'title',c.verified_until
 from public.icash_title_contacts c join public.icash_deal_files d on d.id=c.deal_id and d.account_id=c.account_id
 where c.account_id=p_account and c.deal_id=p_deal and c.enabled and c.verified_until>now()
 union all
 select 'signer:'||e.id||':'||r.n,lower(r.value->>'email'),r.value->>'name',case e.kind when 'purchase' then 'seller' else 'buyer' end,e.updated_at+interval '90 days'
 from public.icash_signing_envelopes e join public.icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id
 cross join lateral jsonb_array_elements(e.recipients) with ordinality r(value,n)
 where e.account_id=p_account and e.deal_id=p_deal and e.state='completed' and not e.test_mode
 and e.updated_at>now()-interval '90 days' and e.kind in ('purchase','assignment')
 and r.n<jsonb_array_length(e.recipients) and length(r.value->>'email') between 3 and 320;
$$;
revoke all on function public.icash_deal_email_contacts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_deal_email_contacts(uuid,uuid) to service_role;

create table public.icash_deal_emails(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),deal_id uuid not null references public.icash_deal_files(id),
 direction text not null check(direction in ('incoming','outgoing')),contact_key text not null,
 recipient text not null check(length(recipient)<=320),subject text not null check(length(subject) between 1 and 180),body_text text not null check(length(body_text) between 1 and 20000),
 state text not null check(state in ('ready','dispatching','accepted','needs_review','received')),
 request_key uuid,provider_id uuid unique,reply_to_id uuid references public.icash_deal_emails(id),
 rate_id uuid references public.icash_operation_rates(id),permission_until timestamptz,authored_by uuid references auth.users(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(account_id,request_key),
 check((direction='outgoing' and request_key is not null and authored_by is not null and rate_id is not null and permission_until is not null and state<>'received') or (direction='incoming' and state='received' and reply_to_id is not null and provider_id is not null))
);
create index icash_deal_emails_history on public.icash_deal_emails(account_id,deal_id,created_at desc,id desc);
alter table public.icash_deal_emails enable row level security;
revoke all on public.icash_deal_emails from public,anon,authenticated;
grant select,insert,update on public.icash_deal_emails to service_role;
-- Reuse the existing, documented email baseline, including overhead and margin. No new guessed price.
insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,verified_at,expires_at,evidence_ref,enabled)
select 'manual_email','manual-email-v1:'||version,charge_cents,costs_micros,buffer_bps,verified_at,expires_at,'Transaction email; same delivery and infrastructure as '||evidence_ref,enabled
from public.icash_operation_rates where operation='title_email' and enabled and expires_at>now() order by verified_at desc limit 1;

create function public.icash_queue_deal_email(p_account uuid,p_actor uuid,p_deal uuid,p_contact text,p_key uuid,p_subject text,p_body text,p_rate uuid) returns uuid language plpgsql set search_path='' as $$
declare c record;m public.icash_deal_emails;r public.icash_operation_rates;n uuid;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Account owner required';end if;
 perform 1 from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if not found then raise exception 'Deal not available';end if;
 select * into m from public.icash_deal_emails where account_id=p_account and request_key=p_key;
 if found then
 if row(m.deal_id,m.contact_key,m.subject,m.body_text,m.rate_id) is distinct from row(p_deal,p_contact,p_subject,p_body,p_rate) then raise exception 'Email key conflict';end if;
 return m.id;
 end if;
 select * into c from public.icash_deal_email_contacts(p_account,p_deal) where contact_key=p_contact;
 if not found then raise exception 'Verified deal contact required';end if;
 if p_subject is null or length(trim(p_subject)) not between 1 and 180 or p_subject ~ '[\r\n]' or p_subject ilike '%[ICX-%' or p_body is null or length(trim(p_body)) not between 1 and 10000 or p_key is null then raise exception 'Invalid email';end if;
 select * into r from public.icash_operation_rates where id=p_rate and operation='manual_email' and enabled and verified_at<=now() and expires_at>now();
 if not found then raise exception 'Current email price required';end if;
 -- Serializes per deal; prevents a stuck client from filling the mailbox with queued sends.
 if (select count(*) from public.icash_deal_emails where account_id=p_account and deal_id=p_deal and direction='outgoing' and created_at>now()-interval '1 minute')>=5 then raise exception 'Please wait before sending another email';end if;
 insert into public.icash_deal_emails(account_id,deal_id,direction,contact_key,recipient,subject,body_text,state,request_key,rate_id,permission_until,authored_by)
 values(p_account,p_deal,'outgoing',p_contact,c.email,p_subject,p_body,'ready',p_key,p_rate,least(c.verified_until,r.expires_at),p_actor) returning id into n;
 return n;
end $$;

create function public.icash_claim_deal_email(p_account uuid,p_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare m public.icash_deal_emails;c record;principal text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_deal_emails where id=p_id and account_id=p_account for update;
 if not found or m.state<>'ready' or m.direction<>'outgoing' or m.permission_until<=now() then return null;end if;
 select * into c from public.icash_deal_email_contacts(p_account,m.deal_id) where contact_key=m.contact_key and email=m.recipient;
 if not found then return null;end if;
 if not exists(select 1 from public.icash_operation_rates where id=m.rate_id and operation='manual_email' and enabled and expires_at>now()) then return null;end if;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=p_account;
 if principal is null or length(trim(principal))=0 then return null;end if;
 perform public.icash_reserve_operation(p_account,'deal-email:'||m.id,m.rate_id,least(m.permission_until,c.verified_until));
 if not public.icash_claim_operation('deal-email:'||m.id) then raise exception 'Email held by spend or pause controls';end if;
 update public.icash_deal_emails set state='dispatching',updated_at=now() where id=m.id;
 return jsonb_build_object('id',m.id,'to',m.recipient,'subject',m.subject,'text',m.body_text,'principal',principal);
end $$;

create function public.icash_record_deal_email_reply(p_email uuid,p_reference uuid,p_sender text,p_subject text,p_text text,p_authenticated boolean) returns void language plpgsql set search_path='' as $$
declare m public.icash_deal_emails;
begin
 select * into m from public.icash_deal_emails where id=p_reference and direction='outgoing' and state in ('dispatching','accepted','needs_review');
 -- A subject reference alone is not authority to expose another customer's messages.
 if not found or p_authenticated is distinct from true or lower(p_sender)<>lower(m.recipient) then return;end if;
 insert into public.icash_deal_emails(account_id,deal_id,direction,contact_key,recipient,subject,body_text,state,provider_id,reply_to_id)
 values(m.account_id,m.deal_id,'incoming',m.contact_key,lower(p_sender),left(coalesce(nullif(p_subject,''),'Reply'),180),left(coalesce(nullif(p_text,''),'No plain-text body available.'),20000),'received',p_email,m.id)
 on conflict(provider_id) do nothing;
 -- Replies from the current title contact also enter the existing closing evidence flow.
 if m.contact_key='title' then
 insert into public.icash_title_replies(provider_email_id,account_id,deal_id,request_id,sender,subject,body_text,sender_verified)
 select p_email,m.account_id,m.deal_id,j.id,lower(p_sender),left(coalesce(p_subject,''),500),left(coalesce(p_text,''),20000),true
 from public.icash_title_requests j join public.icash_title_contacts c on c.deal_id=j.deal_id and c.account_id=j.account_id
 where j.account_id=m.account_id and j.deal_id=m.deal_id and lower(j.recipient)=lower(p_sender)
 and j.state in ('dispatching','sent','needs_review') and c.enabled and c.verified_until>now() and lower(c.email)=lower(p_sender)
 on conflict(provider_email_id) do nothing;
 end if;
end $$;
revoke all on function public.icash_queue_deal_email(uuid,uuid,uuid,text,uuid,text,text,uuid),public.icash_claim_deal_email(uuid,uuid),public.icash_record_deal_email_reply(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.icash_queue_deal_email(uuid,uuid,uuid,text,uuid,text,text,uuid),public.icash_claim_deal_email(uuid,uuid),public.icash_record_deal_email_reply(uuid,uuid,text,text,text,boolean) to service_role;
