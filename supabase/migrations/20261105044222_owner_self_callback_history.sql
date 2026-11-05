begin;

-- An explicit owner reset archives the old self demonstration, but preserves
-- its provider receipts. Those receipts must not compete with the next demo.
-- This is not a general exception for archived customers or paused threads.
create function icash_callback_private.archived_owner_self_callback(p_account uuid,p_screening uuid,p_phone text)
returns boolean language sql stable set search_path='' as $$
 select p_account='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid
  and p_phone='+12142185280'
  and exists(select 1 from public.icash_accounts a
   join public.icash_screening_jobs s on s.account_id=a.id and s.id=p_screening
   where a.id=p_account and a.owner_user_id='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
    and s.state='archived');
$$;

-- A buyer-role receipt is ignored only when the exact owner self test was
-- revoked, its thread retired, and its property explicitly archived. Ordinary
-- buyer conversations, live tests and cross-account evidence remain conflicts.
create function icash_callback_private.retired_owner_self_buyer(p_thread uuid,p_phone text)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_text_threads t
  join public.icash_owner_buyer_tests x on x.id=t.owner_buyer_test_id
   and x.thread_id=t.id and x.account_id=t.account_id and x.deal_id=t.deal_id
   and x.sender=t.sender and x.phone=t.recipient
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join public.icash_accounts a on a.id=t.account_id and a.owner_user_id=x.owner_user_id
  where t.id=p_thread and t.recipient=p_phone and t.party='buyer'
   and t.retired_at<=now() and x.revoked_at<=now()
   and icash_callback_private.archived_owner_self_callback(t.account_id,d.screening_id,p_phone));
$$;

revoke all on function icash_callback_private.archived_owner_self_callback(uuid,uuid,text),
 icash_callback_private.retired_owner_self_buyer(uuid,text) from public,anon,authenticated;
grant execute on function icash_callback_private.archived_owner_self_callback(uuid,uuid,text),
 icash_callback_private.retired_owner_self_buyer(uuid,text) to service_role;

do $routing$
declare d text;needle text;
begin
 d:=pg_get_functiondef('icash_callback_private.route(text)'::regprocedure);
 needle:='with candidates as materialized (select * from icash_callback_private.candidates(p_phone))';
 if array_length(string_to_array(d,needle),1)<>2 then raise exception 'Owner callback candidate patch drift';end if;
 d:=replace(d,needle,$new$with candidates as materialized (select * from icash_callback_private.candidates(p_phone)
  where not icash_callback_private.archived_owner_self_callback(account_id,screening_id,p_phone))$new$);
 needle:=$old$where buyer.recipient=p_phone and buyer.party<>'seller' and sent.direction='outgoing'$old$;
 if array_length(string_to_array(d,needle),1)<>2 then raise exception 'Owner callback role patch drift';end if;
 execute replace(d,needle,$new$where buyer.recipient=p_phone and buyer.party<>'seller' and sent.direction='outgoing'
    and not icash_callback_private.retired_owner_self_buyer(buyer.id,p_phone)$new$);
end $routing$;

-- The base reception account needs the same saved route and final current-
-- source checks as a customer child config. Otherwise an owner return call
-- loses its property context (and can race a reset between resolve/reserve).
-- Unknown callers still use general reception with a null callback route.
do $binding$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_reserve_direct_reception(uuid,text,text,text,text,text,text,text,text,text,text)'::regprocedure);
 needle:=$old$if c.callback_template_id is not null then
  callback_route:=icash_callback_private.route(p_from_phone);$old$;
 if array_length(string_to_array(d,needle),1)<>2 then raise exception 'Owner callback reserve patch drift';end if;
 execute replace(d,needle,$new$callback_route:=icash_callback_private.route(p_from_phone);
 if c.callback_template_id is not null or callback_route is not null then$new$);
end $binding$;

commit;
