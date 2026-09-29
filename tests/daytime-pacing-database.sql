begin;
do $$
declare u uuid:=gen_random_uuid();a uuid:=gen_random_uuid();s uuid;p uuid;tag text:=gen_random_uuid()::text;morning bigint;afternoon bigint;evening bigint;result jsonb;
begin
 insert into auth.users(id,email) values(u,tag||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',false,11000);
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state) values(a,tag,'{}','complete') returning id into s;
 insert into public.icash_contact_permissions(account_id,screening_id,party,phone,contact_key,timezone,permission_evidence,permission_until,dnc_checked_at,dnc_clear)
 values(a,s,'seller','+12125550196',repeat('d',64),'America/Chicago','Rollback-only consent fixture',now()+interval '1 day',now(),true) returning id into p;
 result:=public.icash_voice_daytime_allowance(a,p,'2026-09-29T13:59:00Z');
 if (result->>'allowedCents')::bigint<>0 then raise exception 'Before local 9am';end if;
 morning:=(public.icash_voice_daytime_allowance(a,p,'2026-09-29T14:00:00Z')->>'allowedCents')::bigint;
 afternoon:=(public.icash_voice_daytime_allowance(a,p,'2026-09-29T19:00:00Z')->>'allowedCents')::bigint;
 evening:=(public.icash_voice_daytime_allowance(a,p,'2026-09-30T00:00:00Z')->>'allowedCents')::bigint;
 if morning<>1000 or afternoon<=morning or evening<>11000 then raise exception 'Budget not spread through local day';end if;
 if (public.icash_voice_daytime_allowance(a,p,'2026-09-30T01:00:00Z')->>'allowedCents')::bigint<>0 then raise exception 'After local 8pm';end if;
 if (public.icash_voice_daytime_allowance(a,p,'2026-12-01T14:59:00Z')->>'allowedCents')::bigint<>0 then raise exception 'DST failed';end if;
 insert into public.icash_deal_files(account_id,screening_id,terms,stage) values(a,s,'{}','under_contract');
 if (public.icash_voice_daytime_allowance(a,p,'2026-09-30T00:00:00Z')->>'allowedCents')::bigint<>8800 then raise exception 'Active deal reserve missing';end if;
 if (public.icash_voice_daytime_allowance(gen_random_uuid(),p,'2026-09-29T19:00:00Z')->>'allowedCents')::bigint<>0 then raise exception 'Tenant bypass';end if;
 if has_function_privilege('authenticated','public.icash_reserve_paced_voice(uuid,uuid,uuid,timestamptz,timestamptz,boolean)','EXECUTE') then raise exception 'Public pacing access';end if;
end $$;
rollback;
