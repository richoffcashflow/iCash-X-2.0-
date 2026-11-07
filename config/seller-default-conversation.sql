-- Prefer actual recorded messages over an empty contact thread.
-- Read-only selection only: no receipts, unread markers or customer data change.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text;before_acl aclitem[];
begin
 select pg_get_functiondef(p.oid),p.proacl into strict d,before_acl from pg_proc p
 where p.oid='public.icash_latest_seller_text_thread(uuid,uuid)'::regprocedure;
 if md5(d)<>'abe0b978f8ae0015509a8826d6c62bb6' then raise exception 'Seller conversation selector prerequisite changed';end if;
 needle:=' where t.account_id=p_account and t.deal_id=p_deal and t.party=''seller'' and t.retired_at is null';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Seller conversation account boundary changed';end if;
 d:=replace(d,needle,$replacement$
 left join lateral(select m.created_at,m.id from public.icash_text_messages m
  where m.account_id=p_account and m.thread_id=t.id
  order by m.created_at desc,m.id desc limit 1) activity on true
 where t.account_id=p_account and t.deal_id=p_deal and t.party='seller' and t.retired_at is null$replacement$);
 needle:='order by last.unread desc nulls last,last.created_at desc nulls last,last.id desc nulls last,t.id desc limit 1;';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Seller reply priority changed';end if;
 d:=replace(d,needle,'order by last.unread desc nulls last,last.created_at desc nulls last,last.id desc nulls last,activity.created_at desc nulls last,activity.id desc nulls last,t.id desc limit 1;');
 execute d;
 if not exists(select 1 from pg_proc where oid='public.icash_latest_seller_text_thread(uuid,uuid)'::regprocedure
  and not prosecdef and provolatile='s' and proacl is not distinct from before_acl
  and md5(pg_get_functiondef(oid))=md5(d)) then raise exception 'Seller conversation selector postcondition failed';end if;
end $patch$;
commit;
