-- Seller-opener scans exclude every existing message by global thread identity.
-- The account-leading conversation indexes cannot cheaply answer that lookup.
-- Keep the original global predicate, every state and all historical rows.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create index icash_text_messages_thread_lookup
 on public.icash_text_messages(thread_id);
commit;
