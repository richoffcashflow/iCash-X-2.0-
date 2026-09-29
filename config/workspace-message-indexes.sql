-- Bound account-local history queries even when other tenants have large volumes.
create index if not exists icash_text_messages_account_thread_cursor on public.icash_text_messages(account_id,thread_id,created_at desc,id desc);
create index if not exists icash_text_threads_account_deal_cursor on public.icash_text_threads(account_id,deal_id,id desc);
create index if not exists icash_text_ai_jobs_account_thread_recent on public.icash_text_ai_jobs(account_id,thread_id,created_at desc) where state in ('drafted','handoff','needs_review');
create index if not exists icash_live_conversations_account_screening_recent on public.icash_live_conversations(account_id,screening_id,completed_at desc) where state='complete';
