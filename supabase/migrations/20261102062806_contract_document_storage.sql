begin;
set local lock_timeout='3s';
set local statement_timeout='15s';

-- The approved original forms contain immutable embedded page images. Their
-- rendered HTML is 331–442 KB before filled fields, above the old 100 KB cap.
-- Keep a finite byte limit and retain the smaller limit for text-only packets.
alter table public.icash_deal_documents
 drop constraint icash_deal_documents_html_check,
 add constraint icash_deal_documents_html_check check (
  octet_length(html)<case when kind in ('purchase','assignment') then 1048576 else 100000 end
 );

commit;
