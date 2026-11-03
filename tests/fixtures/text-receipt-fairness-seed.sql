-- Disposable fixtures only. Across twelve accounts with paused threads, receipt
-- reads may reconcile existing sends but cannot send or change their settlement.
create function public.fixture_receipt_id(n integer) returns uuid language sql immutable as $$
 select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function public.fixture_receipt_seed(first_id integer,total integer,checks integer default 0)
returns void language plpgsql as $$begin
 insert into icash_operation_rates values(fixture_receipt_id(2),'sms_send') on conflict do nothing;
 insert into icash_text_senders values('+17205550100',false) on conflict do nothing;
 insert into icash_accounts select fixture_receipt_id(1000000+n) from generate_series(0,11) n on conflict do nothing;
 insert into icash_text_threads(id,account_id,sender,recipient,paused)
  select fixture_receipt_id(2000000+n),fixture_receipt_id(1000000+n),'+17205550100','+12145550101',true
  from generate_series(0,11) n on conflict do nothing;
 alter table icash_text_messages disable trigger user;
 insert into icash_text_messages(id,thread_id,account_id,direction,body,state,provider_id,created_at)
  select fixture_receipt_id(n),fixture_receipt_id(2000000+n%12),fixture_receipt_id(1000000+n%12),
   'outgoing','Original fixture?','accepted','text_fixture_'||n,now()-interval '2 hours'+n*interval '1 millisecond'
  from generate_series(first_id,first_id+total-1) n;
 insert into icash_operation_spend
  select 'text:'||fixture_receipt_id(n),fixture_receipt_id(1000000+n%12),fixture_receipt_id(2),
   'settled',now()-interval '2 hours',now()-interval '119 minutes',2
  from generate_series(first_id,first_id+total-1) n;
 alter table icash_text_messages enable trigger user;
 if checks>0 then
  insert into icash_text_receipt_private.schedule
   select fixture_receipt_id(n),now()-interval '1 hour'+n*interval '1 millisecond',checks
   from generate_series(first_id,first_id+total-1) n;
 end if;
end$$;
