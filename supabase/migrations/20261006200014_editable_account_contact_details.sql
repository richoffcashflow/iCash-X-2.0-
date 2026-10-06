begin;
-- NULL uses the checkout phone; an explicitly saved empty string clears it.
alter table public.icash_accounts add column contact_phone text
 check(contact_phone is null or contact_phone='' or contact_phone ~ '^\+[1-9][0-9]{7,14}$');
create function public.icash_save_account_details(p_user uuid,p_first text,p_last text,p_company text,p_voice text,p_voice_name text,p_phone text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a uuid;identity jsonb;sms_paused boolean:=false;
begin
 select id into a from public.icash_accounts where owner_user_id=p_user for update;
 if a is null then raise exception 'ACCOUNT_REQUIRED';end if;
 if p_phone is null or (p_phone<>'' and p_phone !~ '^\+[1-9][0-9]{7,14}$') then raise exception 'INVALID_PHONE';end if;
 identity:=public.icash_save_customer_identity(p_user,p_first,p_last,p_company,p_voice,p_voice_name);
 update public.icash_accounts set contact_phone=p_phone where id=a;
 select coalesce(bool_or(sms_enabled),false) into sms_paused from public.icash_customer_update_preferences
 where account_id=a and phone is distinct from nullif(p_phone,'');
 -- Editing a contact number is not permission to send automated updates to a new recipient.
 update public.icash_customer_update_preferences set phone=nullif(p_phone,''),sms_enabled=false,revision=revision+1,updated_at=now()
 where account_id=a and phone is distinct from nullif(p_phone,'');
 update public.icash_customer_update_deliveries set state='canceled'
 where account_id=a and channel='sms' and state='claimed' and authorized_at is null and recipient is distinct from nullif(p_phone,'');
 return jsonb_build_object('identity',identity,'phone',p_phone,'smsUpdatesPaused',sms_paused);
end $$;
revoke all on function public.icash_save_account_details(uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_save_account_details(uuid,text,text,text,text,text,text) to service_role;
do $$declare definition text;begin
 select pg_get_functiondef('public.icash_load_workspace_account(uuid,text)'::regprocedure) into definition;
 if position('''phone'',coalesce(totals->>''phone'',membership->>''payer_phone'')' in definition)=0 then raise exception 'Unexpected account snapshot';end if;
 execute replace(definition,'''phone'',coalesce(totals->>''phone'',membership->>''payer_phone'')','''phone'',coalesce(a.contact_phone,totals->>''phone'',membership->>''payer_phone'')');
 select pg_get_functiondef('public.icash_customer_update_preferences_get(uuid,uuid)'::regprocedure) into definition;
 if position('coalesce(p.phone,checkout_phone)' in definition)=0 then raise exception 'Unexpected update preferences';end if;
 execute replace(definition,'coalesce(p.phone,checkout_phone)','nullif(coalesce(p.phone,(select contact_phone from public.icash_accounts where id=p_account),checkout_phone),'''')');
end $$;
commit;
