-- A refusal about a different property blocks another cold introduction, while
-- source-backed active conversations keep their original property controls.
-- Permanent phone opt-outs remain enforced by the original final admission.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;
do $patch$
declare d text;block text;needle text;
begin
 d:=pg_get_functiondef('public.icash_seller_text_cadence_current(uuid,uuid,uuid,boolean)'::regprocedure);
 block:=$old$ -- Natural refusals on another property cannot restart automated cold pursuit.
 select m.body into last_body from public.icash_text_threads other
 join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
 where other.recipient=t.recipient and other.party='seller' and m.direction='incoming'
  and m.state='received' and (m.provider_id is not null or m.event_id is not null)
 order by m.created_at desc,m.id desc limit 1;
 if public.icash_seller_response_disposition(last_body) is not null then return false;end if;
$old$;
 needle:=' -- Include every business number, property and account, including retired history.';
 if (length(d)-length(replace(d,block,'')))/length(block)<>1 or strpos(d,needle)=0 then raise exception 'Active seller text prerequisite changed';end if;
 execute replace(replace(d,block,''),needle,block||needle);
end $patch$;
commit;
