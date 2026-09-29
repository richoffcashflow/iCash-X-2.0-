create or replace function public.icash_prioritized_work(p_account uuid,p_page integer default 0)
returns table(id uuid,state text,result jsonb,completed_at timestamptz) language sql stable set search_path='' as $$
 select s.id,s.state,s.result,s.completed_at from public.icash_screening_jobs s
 where s.account_id=p_account and s.state='complete' and p_page between 0 and 10000
 order by case
 when exists(select 1 from public.icash_handoffs h where h.account_id=p_account and h.screening_id=s.id and h.state<>'resolved')
 or exists(select 1 from public.icash_sms_call_requests r where r.account_id=p_account and r.screening_id=s.id and r.state='needs_review')
 or exists(select 1 from public.icash_deal_files d join public.icash_signing_envelopes e on e.deal_id=d.id and e.account_id=d.account_id where d.account_id=p_account and d.screening_id=s.id and e.state='customer_signature_needed' and not e.test_mode) then 0
 when exists(select 1 from public.icash_deal_files d where d.account_id=p_account and d.screening_id=s.id and d.stage in ('under_contract','buyer_selected','title_open','closing')) then 1
 when exists(select 1 from public.icash_live_callbacks b where b.account_id=p_account and b.screening_id=s.id and b.state in ('pending_dispatch_review','held_for_human','missed')) then 2
 when s.result->'financialCheck'->>'status'='eligible' then 3 else 4 end,
 s.completed_at desc,s.id limit 7 offset (greatest(0,least(10000,p_page))*6);
$$;
