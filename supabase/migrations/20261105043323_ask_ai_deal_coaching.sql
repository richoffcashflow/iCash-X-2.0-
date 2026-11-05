-- Allow one concise coaching answer within the existing five-cent reservation.
-- No prices, input limits, historical receipts, ACLs, or admission/settlement locks change.
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $coach$
declare d text; original_acl aclitem[];
begin
 select pg_get_functiondef(p.oid),p.proacl into strict d,original_acl from pg_proc p where p.oid='public.icash_settle_question(uuid,uuid,text,bigint,bigint,bigint)'::regprocedure;
 if md5(d)<>'7f8205d6d5ea0b113870d1de12df1844' then raise exception 'Question settlement changed; review current function';end if;
 if (length(d)-length(replace(d,'p_output not between 0 and 150','')))/length('p_output not between 0 and 150')<>1 then raise exception 'Unexpected output bound';end if;
 d:=replace(d,'p_output not between 0 and 150','p_output not between 0 and 1200');
 execute d;
 if pg_get_functiondef('public.icash_settle_question(uuid,uuid,text,bigint,bigint,bigint)'::regprocedure)<>d then raise exception 'Question settlement postcondition failed';end if;
 if (select proacl from pg_proc where oid='public.icash_settle_question(uuid,uuid,text,bigint,bigint,bigint)'::regprocedure) is distinct from original_acl then raise exception 'Question ACL changed';end if;
end $coach$;
