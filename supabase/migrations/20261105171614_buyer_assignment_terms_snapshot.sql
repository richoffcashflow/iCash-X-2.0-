-- Bind automatic buyer signing to the exact document validated by its claim.
-- Additive result field only: existing locks, checks, states and ACLs are unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $patch$
declare target regprocedure:='public.icash_claim_journey_assignment_before_completion(uuid)'::regprocedure;
 definition text;old_text text;new_text text;metadata jsonb;
begin
 definition:=pg_get_functiondef(target);
 if md5(definition)<>'4dcbb00b25643248c6cffe3648dc5e48' then
  raise exception 'Buyer assignment claim prerequisite changed';
 end if;
 select jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'security',prosecdef,'volatility',provolatile)
 into metadata from pg_proc where oid=target;
 for old_text,new_text in select * from (values
  ($old$updated_at=now() where id=d.id;$old$,
   $new$updated_at=now() where id=d.id returning * into d;$new$),
  ($old$'email',j.buyer_details->>'email','phone',t.recipient);$old$,
   $new$'email',j.buyer_details->>'email','phone',t.recipient,'expectedTerms',d.terms);$new$)
 ) replacements(old_value,new_value) loop
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
   raise exception 'Buyer assignment snapshot replacement is not unique';
  end if;
  definition:=replace(definition,old_text,new_text);
 end loop;
 execute definition;
 if pg_get_functiondef(target) is distinct from definition or metadata is distinct from
  (select jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'security',prosecdef,'volatility',provolatile) from pg_proc where oid=target) then
  raise exception 'Buyer assignment snapshot postcondition failed';
 end if;
end $patch$;
commit;
