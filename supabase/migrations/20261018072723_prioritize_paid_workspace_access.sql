begin;
-- Filter and prioritize the current entitlement before limiting history. A paid
-- membership must remain visible after any number of later cancelled checkouts.
create index icash_membership_account_history on public.icash_memberships(account_id,mode,created_at desc) where account_id is not null;
do $$
declare definition text; previous text:='from (select state,paid_through,payer_phone,created_at from public.icash_memberships where icash_memberships.account_id=a.id and mode=p_mode order by created_at desc limit 10) m';
begin
 select pg_get_functiondef('public.icash_load_workspace_account(uuid,text)'::regprocedure) into definition;
 if position(previous in definition)=0 then raise exception 'Workspace membership lookup changed';end if;
 definition:=replace(definition,previous,'from public.icash_memberships m where m.account_id=a.id and m.mode=p_mode');
 execute definition;
end $$;
commit;
