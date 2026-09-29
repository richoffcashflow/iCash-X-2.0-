begin;
do $$
declare s jsonb;updated jsonb;id uuid;h text:=repeat('a',64);p jsonb:='{"displayName":"Fixture Only","theme":"ink","logo":"monogram","voice":"sarah","market":"Nationwide","marketMode":"nationwide"}';
begin
 s:=public.icash_init_bot_setup(h,null);id:=(s->>'id')::uuid;
 if s ? 'guest_hash' then raise exception 'Cookie hash exposed';end if;
 if public.icash_init_bot_setup(h,null)->>'id'<>id::text then raise exception 'Duplicate draft';end if;
 updated:=public.icash_save_bot_setup(id,0,p,1);
 if (updated->>'revision')::integer is distinct from 1 then raise exception 'Save failed';end if;
 if public.icash_save_bot_setup(id,0,p,2) is not null then raise exception 'Stale tab overwrote setup';end if;
 perform public.icash_record_setup_event(id,'voice_played');perform public.icash_record_setup_event(id,'voice_played');
 if (select count(*) from public.icash_setup_events where setup_id=id and event='voice_played')<>1 then raise exception 'Duplicate event';end if;
 updated:=public.icash_save_bot_setup(id,1,p,4);
 if not exists(select 1 from public.icash_setup_events where setup_id=id and event='setup_completed') then raise exception 'Completion not saved';end if;
 if exists(select 1 from public.icash_daily_plans where guest_hash=h) then raise exception 'Setup started billing';end if;
 if has_table_privilege('anon','public.icash_bot_setups','select') or has_function_privilege('authenticated','public.icash_setup_funnel_report()','execute') then raise exception 'Private setup exposed';end if;
 update public.icash_bot_setups set created_at=now()-interval '25 hours',variant='ownership' where guest_hash=h;
 perform public.icash_init_bot_setup(repeat('b',64),null);
 update public.icash_bot_setups set created_at=now()-interval '25 hours',variant='outcome' where guest_hash=repeat('b',64);
 perform public.icash_init_bot_setup(repeat('c',64),null);
 perform public.icash_setup_funnel_report();
end $$;
rollback;
