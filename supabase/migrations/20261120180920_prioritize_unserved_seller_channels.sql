-- Compare observed seller attempts inside the existing queues. The original
-- rotation owns half of each minute, and urgent calls keep their own first pass.
set local lock_timeout='2s';
create index icash_daily_observed_seller_dials on public.icash_call_recordings(account_id,provider_started_at desc)
 where party='seller' and provider_started_at is not null;
create index icash_daily_provider_text_attempts on public.icash_text_messages(account_id,created_at desc) include(thread_id)
 where direction='outgoing' and provider_id is not null;
do $patch$
declare src text:=pg_get_functiondef('public.icash_issue_ready_seller_text()'::regprocedure);
begin
 if md5(src)<>'71b15e093530a5624eb4d2f57823eb19' then raise exception 'Unexpected icash_issue_ready_seller_text predecessor';end if;
 execute replace(src,$old$ ) select * from candidates order by id$old$,$new$ ) select candidates.* from candidates
 order by case when extract(second from statement_timestamp())<30 then
   exists(select 1 from public.icash_text_messages m join public.icash_text_threads sent on sent.id=m.thread_id and sent.account_id=m.account_id
    where m.account_id=candidates.account_id and m.direction='outgoing' and m.provider_id is not null
     and m.created_at>=now()-interval '24 hours' and sent.party='seller') end asc nulls last,id$new$);
end $patch$;
do $patch$
declare src text:=pg_get_functiondef('public.icash_issue_ready_voice_ticket()'::regprocedure);
begin
 if md5(src)<>'be5503735965b3de7e627d9924162e56' then raise exception 'Unexpected icash_issue_ready_voice_ticket predecessor';end if;
 execute replace(src,$old$ order by last_ticket.created_at asc nulls first,v.due_at,v.id for update of v skip locked offset 0$old$,$new$ order by case when extract(second from statement_timestamp())<30 then
   exists(select 1 from public.icash_call_recordings r where r.account_id=v.account_id and r.party='seller'
    and r.provider_started_at>=now()-interval '24 hours') end asc nulls last,
  last_ticket.created_at asc nulls first,v.due_at,v.id for update of v skip locked offset 0$new$);
end $patch$;
