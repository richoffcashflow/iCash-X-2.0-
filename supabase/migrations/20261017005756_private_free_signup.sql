-- Private bearer invitations grant Standard access only after verified Auth email.
-- No checkout, invoice, credit grant, consent acceptance or provider work is created.
create table public.icash_private_invites (
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 mode text not null check(mode in ('live','test')),
 label text not null,
 enabled boolean not null default true,
 expires_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.icash_private_invites enable row level security;
revoke all on public.icash_private_invites from public,anon,authenticated;
grant select,insert,update on public.icash_private_invites to service_role;

alter table public.icash_memberships add column private_invite_id uuid references public.icash_private_invites(id);
alter table public.icash_memberships drop constraint icash_memberships_price_cents_check;
alter table public.icash_memberships add constraint icash_memberships_price_cents_check check(
 (private_invite_id is null and price_cents between 100 and 100000)
 or (private_invite_id is not null and price_cents=0 and account_id is not null
     and stripe_session_id is null and stripe_subscription_id is null and stripe_customer_id is null
     and checkout_url is null and vip_until is null and vip_retained_at is null
     and retention_requested_at is null)
);
create index icash_membership_private_invite on public.icash_memberships(private_invite_id) where private_invite_id is not null;

create function public.icash_redeem_private_invite(p_hash text,p_user uuid,p_mode text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare invitation public.icash_private_invites; email_address text; a uuid; prior public.icash_memberships;
begin
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_mode is null or p_mode not in ('live','test') then raise exception 'Invalid invitation';end if;
 select * into invitation from public.icash_private_invites where token_hash=p_hash and mode=p_mode and enabled and (expires_at is null or expires_at>now()) for share;
 if invitation.id is null then raise exception 'Invitation unavailable';end if;
 select lower(trim(email)) into email_address from auth.users where id=p_user and email_confirmed_at is not null;
 if email_address is null then raise exception 'Verified email required';end if;
 -- Same owner lock as ordinary account/payment claims; retries cannot double-create.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select id into a from public.icash_accounts where owner_user_id=p_user;
 if a is not null then
  select * into prior from public.icash_memberships where account_id=a and mode=p_mode and private_invite_id=invitation.id and state='active' and paid_through>now();
  if prior.id is not null then return jsonb_build_object('granted',true);end if;
  return jsonb_build_object('granted',false,'reason','existing_account');
 end if;
 -- Do not replace a paid purchase, payment review or an in-flight checkout.
 if exists(select 1 from public.icash_memberships where lower(payer_email)=email_address and mode=p_mode and state<>'cancelled')
 or exists(select 1 from public.icash_funding_orders where lower(payer_email)=email_address and mode=p_mode) then
  return jsonb_build_object('granted',false,'reason','existing_purchase');
 end if;
 a:=public.icash_create_account(p_user);
 update public.icash_accounts set billing_model='membership_credits',bot_paused=true where id=a;
 insert into public.icash_memberships(mode,guest_hash,account_id,price_cents,offer_revision,state,payer_email,paid_through,consent_version,consent_text,private_invite_id)
 values(p_mode,encode(sha256(convert_to('private-access:'||a::text||':'||p_mode,'UTF8')),'hex'),a,0,1,'active',email_address,'9999-12-31T23:59:59Z',
  'private-invitation-v1','Owner-granted free Standard software access. No subscription or work credits. Workspace acknowledgment must be accepted separately by the user.',invitation.id);
 return jsonb_build_object('granted',true);
end $$;
revoke all on function public.icash_redeem_private_invite(text,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_redeem_private_invite(text,uuid,text) to service_role;
