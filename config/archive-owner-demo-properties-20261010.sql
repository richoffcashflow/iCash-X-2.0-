-- Clear only the owner's properties that existed when the reset was requested.
-- Preserve agreement, accounting, call and message history. No provider actions.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $archive$
declare owner_id uuid:='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';account uuid;ids uuid[];item uuid;snapshot jsonb;visible integer;threads integer;package jsonb;
begin
 if exists(select 1 from public.icash_integration_checks where provider='owner_property_reset_20261010_122556') then return;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select id into account from public.icash_accounts where owner_user_id=owner_id for update;
 if account is null then raise exception 'Owner workspace required';end if;
 select array_agg(id),count(*) filter(where state='complete') into ids,visible
 from public.icash_screening_jobs where account_id=account and created_at<='2026-10-10 17:25:56+00';
 if ids is null then raise exception 'No old properties to archive';end if;
 if exists(select 1 from public.icash_screening_jobs where id=any(ids) and state in ('queued','running'))
  or exists(select 1 from icash_recorded_reception_private.sessions where account_id=account and call_ended_at is null)
  or exists(select 1 from public.icash_voice_jobs where account_id=account and state in ('issued','dispatching'))
  or exists(select 1 from public.icash_text_messages where account_id=account and state='dispatching') then
  raise exception 'Let active work finish before archiving';end if;
 select jsonb_build_object(
  'screenings',(select jsonb_agg(jsonb_build_object('id',id,'state',state)) from public.icash_screening_jobs where id=any(ids)),
  'threads',(select jsonb_agg(to_jsonb(t)) from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id where t.account_id=account and d.screening_id=any(ids)),
  'controls',(select jsonb_agg(to_jsonb(p)) from public.icash_property_controls p where p.account_id=account and p.property_id in (select sc.snapshot->>'propertyId' from public.icash_screening_jobs sc where sc.id=any(ids)))
 ) into snapshot;
 foreach item in array ids loop perform public.icash_set_work_control(owner_id,account,'takeover',item);end loop;
 update public.icash_contact_permissions set revoked_at=coalesce(revoked_at,now()) where account_id=account and screening_id=any(ids);
 update public.icash_text_threads t set paused=true,ai_mode='off',retired_at=coalesce(retired_at,now())
 from public.icash_deal_files d where t.account_id=account and d.id=t.deal_id and d.account_id=t.account_id and d.screening_id=any(ids) and t.retired_at is null;
 get diagnostics threads=row_count;
 update public.icash_text_messages m set state='cancelled' from public.icash_text_threads t,public.icash_deal_files d
 where m.account_id=account and m.thread_id=t.id and t.account_id=m.account_id and d.id=t.deal_id and d.account_id=t.account_id
 and d.screening_id=any(ids) and m.direction='outgoing' and m.state='ready';
 update public.icash_live_callbacks set state='canceled' where account_id=account and screening_id=any(ids) and state in ('pending_dispatch_review','held_for_human');
 update public.icash_voice_jobs j set state='canceled',outcome='Owner archived property for a fresh demo',updated_at=now()
 where j.account_id=account and j.state in ('ready','held') and exists(select 1 from public.icash_contact_permissions p where p.id=j.permission_id and p.account_id=j.account_id and p.screening_id=any(ids));
 update public.icash_seller_responses set state='stopped',updated_at=now() where account_id=account and screening_id=any(ids) and state<>'stopped';
 update public.icash_seller_gaps set state='suppressed',updated_at=now() where account_id=account and screening_id=any(ids) and state in ('open','queued','waiting','needs_review');
 update public.icash_seller_intakes l set state='review',next_assignment_at='infinity',hold_reason='Owner archived old demo property'
 where exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id and m.account_id=account and m.screening_id=any(ids))
 and not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id and m.account_id<>account);
 update public.icash_screening_jobs set state='archived' where account_id=account and id=any(ids) and state<>'archived';
 if exists(select 1 from public.icash_screening_jobs where account_id=account and id=any(ids) and state<>'archived') then raise exception 'Old workspace rows remain';end if;
 -- The retained signed test deal remains available to existing privacy checks.
 package:=public.icash_buyer_package_data(account,'f50f5183-9b83-4cb3-b099-76f246e7ac9b');
 if package is null or package->>'privacyPolicy'<>'buyer_price_only_v1' then raise exception 'Retained deal history must remain readable';end if;
 insert into public.icash_integration_checks(provider,checked_at,result)
 values('owner_property_reset_20261010_122556',now(),jsonb_build_object('status','archived','accountId',account,'visiblePropertiesCleared',visible,'threadsRetired',threads,'before',snapshot,'providerWrites',false,'calls',false,'agreementHistoryPreserved',true,'accountingHistoryPreserved',true));
end $archive$;
commit;
select result-'before' as result from public.icash_integration_checks where provider='owner_property_reset_20261010_122556';
