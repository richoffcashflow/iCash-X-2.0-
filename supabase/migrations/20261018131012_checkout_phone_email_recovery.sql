begin;
-- Resolve only a uniquely eligible checkout phone when the receipt email is
-- missing or different. The existing selector retains every ownership, payment,
-- review, suppression and verified-identity restriction.
create index if not exists icash_memberships_live_checkout_phone
 on public.icash_memberships(public.icash_access_phone(payer_phone)) where mode='live';

create function public.icash_resolve_phone_access_target(p_email text,p_phone text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare number text; candidate text; target jsonb; resolved jsonb;
begin
 number:=public.icash_access_phone(p_phone);if number is null then return null;end if;
 target:=public.icash_phone_access_target(p_email,number);
 if target is not null then return target;end if;
 for candidate in select distinct lower(trim(m.payer_email)) from public.icash_memberships m
  where m.mode='live' and public.icash_access_phone(m.payer_phone)=number and m.payer_email is not null
 loop
  target:=public.icash_phone_access_target(candidate,number);
  if target is not null then
   -- A shared phone never silently chooses between different purchase identities.
   if resolved is not null then return null;end if;
   resolved:=target;
  end if;
 end loop;
 return resolved;
end $$;

-- Version the send entry point so existing app deployments keep their original
-- paired-email flow until the server can verify a phone-only challenge.
create function public.icash_begin_phone_challenge_v2(p_id uuid,p_email text,p_phone text,p_secret_hash text,p_code_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare target jsonb;number text;sender_phone text;
begin
 if p_id is null or p_secret_hash is null or p_code_hash is null or p_secret_hash !~ '^[a-f0-9]{64}$' or p_code_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid challenge';end if;
 number:=public.icash_access_phone(p_phone);if number is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(number,81717));
 if exists(select 1 from public.icash_purchase_phone_challenges where phone=number and requested_at>now()-interval '60 seconds')
 or (select count(*) from public.icash_purchase_phone_challenges where phone=number and requested_at>now()-interval '10 minutes')>=3 then return null;end if;
 target:=public.icash_resolve_phone_access_target(p_email,number);if target is null then return null;end if;
 sender_phone:=public.icash_webinar_campaign_sender(number);if sender_phone is null then return null;end if;
 update public.icash_purchase_phone_challenges set expires_at=now() where phone=number and used_at is null and expires_at>now();
 insert into public.icash_purchase_phone_challenges(id,membership_id,email,phone,secret_hash,code_hash,sender)
 values(p_id,(target->>'membershipId')::uuid,target->>'email',number,p_secret_hash,p_code_hash,sender_phone);
 -- No purchase identity is disclosed before a valid SMS code is supplied.
 return jsonb_build_object('id',p_id,'phone',number,'sender',sender_phone);
end $$;
revoke all on function public.icash_resolve_phone_access_target(text,text),public.icash_begin_phone_challenge_v2(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_resolve_phone_access_target(text,text),public.icash_begin_phone_challenge_v2(uuid,text,text,text,text) to service_role;
commit;
