-- Account recovery already settles original research receipts independently.
-- Do not make acquisition selection wait on a global historical billing sweep.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
do $patch$
declare d text;patched text;item record;
 needle text:=' perform public.icash_settle_pending_dealmachine();';
 replacement text:=$replacement$ -- Dedicated recovery owns account-scoped receipt settlement. A broken or
 -- busy historical receipt must not block selection for unrelated accounts.
 -- Keep the original sweep only for the compatible legacy dispatcher.
 if not exists(select 1 from icash_work_private.dispatch_policy where id=1 and enabled) then
  perform public.icash_settle_pending_dealmachine();
 end if;$replacement$;
begin
 for item in select * from (values
  ('public.icash_next_acquisition()','8979c23758071022985b11672009c868'),
  ('public.icash_issue_account_followup()','e319f29f55cda5f4f34b134895cd3d4b'),
  ('public.icash_settle_pending_estimates(uuid,integer)','c20d6d878829bc77f3e8be1b60675f5d'),
  ('public.icash_settle_estimate_before_sms_tokens(text)','d463afb80ef551b673a1f7c43710117f'),
  ('icash_work_private.enqueue_account_followup()','a82fbe26715e5aff3fb26e55538f1b92')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(item.signature::regprocedure))<>item.checksum then
   raise exception 'Acquisition settlement isolation prerequisite changed: %',item.signature;
  end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.icash_automation_tickets'::regclass
  and tgname='icash_enqueue_account_followup' and not tgisinternal and tgenabled in ('O','A')
  and tgfoid='icash_work_private.enqueue_account_followup()'::regprocedure) then
  raise exception 'Durable account recovery trigger required';
 end if;
 d:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then
  raise exception 'Acquisition settlement call changed';
 end if;
 patched:=replace(d,needle,replacement);
 execute patched;
 if pg_get_functiondef('public.icash_next_acquisition()'::regprocedure)<>patched then
  raise exception 'Acquisition settlement isolation verification failed';
 end if;
end $patch$;
commit;
