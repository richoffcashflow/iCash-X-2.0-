begin;
-- Preserve the existing claim rules while removing repeated network round trips.
-- This server-only RPC never changes contact permissions or grants work authority.
create function public.icash_load_workspace_account(p_user uuid,p_mode text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare account_id uuid; a public.icash_accounts; wallet public.icash_wallets; totals jsonb; membership jsonb; result jsonb;
begin
 account_id:=public.icash_claim_funding(p_user,p_mode);
 if p_mode='live' then perform public.icash_apply_funding_pacing(account_id);end if;
 perform public.icash_daily_claim(account_id);
 perform public.icash_claim_bot_setup(account_id);
 select * into strict a from public.icash_accounts where id=account_id and owner_user_id=p_user;
 select * into strict wallet from public.icash_wallets w where w.account_id=a.id;
 totals:=public.icash_funding_account_totals(a.id,p_mode);
 if a.billing_model='membership_credits' then
  select jsonb_build_object('state',m.state,'paid_through',m.paid_through,'payer_phone',m.payer_phone) into membership
  from (select state,paid_through,payer_phone,created_at from public.icash_memberships where icash_memberships.account_id=a.id and mode=p_mode order by created_at desc limit 10) m
  order by coalesce(m.state='active' and m.paid_through>now(),false) desc,(m.state<>'cancelled') desc,m.created_at desc limit 1;
 end if;
 select jsonb_build_object(
  'billingModel',a.billing_model,'membership',membership,
  'botSetup',(select jsonb_build_object('profile',s.profile,'stage',s.stage) from public.icash_bot_setups s where s.account_id=a.id),
  'identity',(select jsonb_build_object('first_name',i.first_name,'last_name',i.last_name,'company_name',i.company_name,'principal',i.principal,'voice_id',i.voice_id,'voice_name',i.voice_name) from public.icash_customer_identities i where i.account_id=a.id),
  'phone',coalesce(totals->>'phone',membership->>'payer_phone'),
  'balanceCents',case when p_mode='test' then (totals->>'creditCents')::bigint else wallet.balance_cents-wallet.reserved_cents end,
  'reservedCents',case when p_mode='test' then 0 else wallet.reserved_cents end,
  'assistantName',a.assistant_name,'paused',a.bot_paused,'dailyLimitCents',a.daily_limit_cents,
  'billingActive',exists(select 1 from public.icash_daily_plans p where p.account_id=a.id and p.mode=p_mode and p.state<>'stopped'),
  'billingReview',exists(select 1 from public.icash_billing_reviews r where r.account_id=a.id and r.resolved_at is null),
  'activeWork',exists(select 1 from public.icash_live_conversations c where c.account_id=a.id and c.state='waiting' and c.created_at>=now()-interval '15 minutes') or exists(select 1 from public.icash_screening_jobs j where j.account_id=a.id and j.state in ('queued','running'))
 ) into result;
 return jsonb_build_object('accountId',a.id,'account',result);
end $$;
revoke all on function public.icash_load_workspace_account(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_load_workspace_account(uuid,text) to service_role;
commit;
