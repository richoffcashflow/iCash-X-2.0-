-- Existing, provably unstarted SMS introductions must not starve behind new work.
-- Unknown send outcomes remain held; they do not freeze unrelated research.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $patch$
declare d text;needle text;
begin
 -- Fail closed if a concurrent deployment changed any complete source function.
 if md5(pg_get_functiondef('public.icash_next_automation()'::regprocedure))<>'d02fa6e293a199f0505ccdf00ca64056'
  or md5(pg_get_functiondef('public.icash_next_before_owner_question()'::regprocedure))<>'6a3b95df6555660d38512b12ae1ccf13'
  or md5(pg_get_functiondef('public.icash_research_waiting_on_outreach(uuid)'::regprocedure))<>'1a6b50847deed2a3fdbcbe0fa803e9cd'
  or to_regprocedure('public.icash_recover_unstarted_seller_opener()') is not null
 then raise exception 'SMS liveness source snapshot changed; reconcile before applying';end if;

 -- Extract the existing retry lane without changing any eligibility predicate.
 -- The helper returns only a recovered token or NULL, never unrelated work.
 d:=pg_get_functiondef('public.icash_next_before_owner_question()'::regprocedure);
 needle:=E' prior:=public.icash_next_before_unstarted_sms_recovery();\n if prior->>''token'' is not null then return prior;end if;\n';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Original SMS recovery delegation changed';end if;
 d:=replace(d,needle,'');
 needle:='return prior;';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>2 then raise exception 'Original SMS recovery fallback changed';end if;
 d:=replace(d,needle,'return null;');
 needle:='CREATE OR REPLACE FUNCTION public.icash_next_before_owner_question()';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Original SMS recovery signature changed';end if;
 execute replace(d,needle,'CREATE OR REPLACE FUNCTION public.icash_recover_unstarted_seller_opener()');

 -- Root budget-resume and outer work lanes can always return a token. Poll the
 -- bounded recovery lane first, after the existing nonblocking scheduler lock.
 d:=pg_get_functiondef('public.icash_next_automation()'::regprocedure);
 needle:=' retry:=public.icash_resume_prospecting_ticket();';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Root scheduler resume delegation changed';end if;
 execute replace(d,needle,$new$ retry:=public.icash_recover_unstarted_seller_opener();
 if retry->>'token' is not null then return retry;end if;
$new$||needle);

 -- A capability held for reconciliation is deliberately not eligible for the
 -- recovery lane. Preserve that hold and every spending/provider record, while
 -- allowing other eligible research through the unchanged allowance checks.
 d:=pg_get_functiondef('public.icash_research_waiting_on_outreach(uuid)'::regprocedure);
 needle:='   and m.customer_author_id is null and m.provider_id is null and m.last_delivery_at is null';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Research SMS priority changed';end if;
 execute replace(d,needle,needle||$new$
   and not exists(select 1 from public.icash_automation_tickets held
    where held.account_id=m.account_id and held.opener_message_id=m.id
     and held.state='held' and held.outcome='held_for_reconciliation')$new$);
end $patch$;

-- Preserve the old delegation boundary for all callers without duplicating the
-- retry query. The helper retains the original invoker security and empty path.
create or replace function public.icash_next_before_owner_question() returns jsonb
language plpgsql set search_path='' as $$
declare recovered jsonb;
begin
 recovered:=public.icash_recover_unstarted_seller_opener();
 if recovered->>'token' is not null then return recovered;end if;
 return public.icash_next_before_unstarted_sms_recovery();
end $$;
revoke all on function public.icash_recover_unstarted_seller_opener() from public,anon,authenticated;
grant execute on function public.icash_recover_unstarted_seller_opener() to service_role;
commit;
