
begin;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000003');
do $$
declare a uuid; b uuid; contracted uuid; lead uuid; selected uuid; answer text;
begin
 a:=public.icash_create_account('00000000-0000-4000-8000-000000000003');
 b:=public.icash_create_account('00000000-0000-4000-8000-000000000003');
 if a<>b then raise exception 'Provisioning duplicated'; end if;
 update public.icash_accounts set bot_paused=false,daily_limit_cents=500 where id=a;
 perform public.icash_post_credit(a,'engine-test-payment','purchase',2000,'test-only');
 insert into public.icash_deals(account_id,address,stage,seller_signed_at)
 values(a,'Fictional contracted property','contract',now()) returning id into contracted;
 insert into public.icash_deals(account_id,address) values(a,'Fictional lead') returning id into lead;
 insert into icash_private.work_candidates(account_id,deal_id,action,due_at,estimated_charge_cents,estimated_provider_cost_usd,quality_score,evidence_ref,permission_verified_until,operation_key)
 values(a,contracted,'buyer_followup',now(),100,0.1,0.4,'test',now()+interval '1 hour','contract-work'),
 (a,lead,'prospect',now(),100,0.1,0.99,'test',now()+interval '1 hour','new-work');
 if exists(select 1 from public.icash_next_work(a)) then raise exception 'Disabled engine ran'; end if;
 update icash_private.engine_configs set enabled=true,settings=settings||'{"minimum_gross_margin":0.7}'::jsonb where engine='deal';
 update icash_private.engine_configs set enabled=true where engine='retention';
 select deal_id into selected from public.icash_next_work(a);
 if selected is distinct from contracted then raise exception 'Failed contract priority'; end if;
 update public.icash_accounts set bot_paused=true where id=a;
 if exists(select 1 from public.icash_next_work(a)) then raise exception 'Paused engine ran'; end if;
 update public.icash_accounts set bot_paused=false where id=a;
 perform public.icash_post_credit(a,'engine-test-refund','refund',-1950,'test-only');
 answer:=public.icash_retention_action(a);
 if answer<>'fund_verified_work' then raise exception 'Missing evidence-based prompt: %',answer; end if;
 update public.icash_notification_preferences set last_funding_prompt_at=now() where account_id=a;
 if public.icash_retention_action(a)<>'none' then raise exception 'Prompt frequency cap failed'; end if;
 update public.icash_deals set needs_user=true where id=contracted;
 if public.icash_retention_action(a)<>'needs_you' then raise exception 'Needs-you priority failed'; end if;
end; $$;
rollback;
select 'PASS: stable account provisioning, disabled/paused engines, active-contract priority, evidence-based funding and prompt cooldown. Fixtures rolled back.' as result;
