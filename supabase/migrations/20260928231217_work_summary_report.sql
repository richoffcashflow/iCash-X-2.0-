create function public.icash_work_summary(p_account uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'generatedAt',now(),'scope','All recorded account activity',
 'balanceCents',w.balance_cents,'reservedCents',w.reserved_cents,
 'fundedCents',(select coalesce(sum(credit_cents),0) from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null),
 'spentCents',(select coalesce(sum(charged_cents),0) from public.icash_operation_spend where account_id=p_account and state='settled'),
 'analyzed',(select count(*) from public.icash_screening_jobs where account_id=p_account and state='complete'),
 'screeningCandidates',(select count(*) from public.icash_screening_jobs where account_id=p_account and state='complete' and result->'financialCheck'->>'status'='eligible'),
 'ownerRecords',(select count(*) from public.icash_owner_contacts where account_id=p_account),
 'contracts',(select count(*) from public.icash_deal_files where account_id=p_account and seller_signed_at is not null),
 'activeContracts',(select count(*) from public.icash_deal_files where account_id=p_account and seller_signed_at is not null and stage<>'closed'),
 'closed',(select count(*) from public.icash_deal_files where account_id=p_account and stage='closed' and funded_at is not null),
 'pending',(select count(*) from public.icash_operation_spend where account_id=p_account and state in ('reserved','dispatched')),
 'reasons',coalesce((select jsonb_agg(r) from (select left(result->'financialCheck'->>'reason',300) as reason,count(*) as count from public.icash_screening_jobs where account_id=p_account and state='complete' and result->'financialCheck'->>'status'<>'eligible' group by 1 order by count(*) desc limit 5) r),'[]'::jsonb),
 'lastPack',(select pack_code from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null order by created_at desc limit 1)
 ) from public.icash_wallets w where w.account_id=p_account;
$$;
revoke all on function public.icash_work_summary(uuid) from public,anon,authenticated;
grant execute on function public.icash_work_summary(uuid) to service_role;
