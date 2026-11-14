-- A recorded call and AI conversation may be registered AFTER actual dispatch.
-- The original account-bound operation, not those registration rows, supplies
-- the acquisition exposure clock. Preserve every provider/property/query bound.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $patch$
declare d text;needle text;
 before_hash constant text:='dccbe762e4f16bb2164a88df58ae3c83';
 after_hash constant text:='1c912fbca63d0e2c22c59e58c22ecc51';
begin
 d:=pg_get_functiondef('public.icash_targeting_learning_evidence(uuid,text,uuid)'::regprocedure);
 if md5(d)=after_hash then return;end if;
 if md5(d)<>before_hash then raise exception 'Targeting call exposure prerequisite changed';end if;
 foreach needle in array array['o.dispatched_at>=c.created_at','o.dispatched_at>=r.created_at'] loop
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then
   raise exception 'Targeting call exposure boundary changed';
  end if;
  d:=replace(d,needle,'o.dispatched_at>=o.created_at');
 end loop;
 execute d;
 if md5(pg_get_functiondef('public.icash_targeting_learning_evidence(uuid,text,uuid)'::regprocedure))<>after_hash then
  raise exception 'Targeting call exposure installation mismatch';
 end if;
end $patch$;
commit;
