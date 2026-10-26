-- Sort the cheap eligible rows before evaluating full contact/source preflight.
-- The outer LIMIT remains after every gate, so one held row cannot starve work.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;
do $patch$
declare d text;needle text;replacement text;item record;
begin
 for item in select * from (values
  ('icash_next_before_sms_inbound_campaign()','8404aea27f108cb236f3451c70d23291'),
  ('icash_next_before_unstarted_sms_recovery()','faf8a5970359f35057a5c912d138d0bb'),
  ('icash_seller_opener_candidate_body(uuid,uuid)','cf913953af73d5eeb0488034203f07d4')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(('public.'||item.signature)::regprocedure))<>item.checksum then raise exception 'Seller scan prerequisite changed: %',item.signature;end if;
 end loop;
 d:=pg_get_functiondef('public.icash_next_before_unstarted_sms_recovery()'::regprocedure);
 needle:='(not exists(select 1 from public.icash_text_messages where thread_id=th.id) and public.icash_seller_opener_candidate_body(th.account_id,th.id) is not null)';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>2 then raise exception 'Seller recovery preflight changed';end if;
 d:=replace(d,needle,'not exists(select 1 from public.icash_text_messages where thread_id=th.id)');
 needle:='select th.* into t from candidates candidate';
 if position(needle in d)=0 then raise exception 'Seller recovery candidate entry changed';end if;
 d:=replace(d,needle,'select ordered.* into t from (select th.* from candidates candidate');
 needle:='order by th.id for update of th skip locked limit 1;';
 replacement:=$new$order by th.id for update of th skip locked offset 0) ordered
 where public.icash_seller_opener_candidate_body(ordered.account_id,ordered.id) is not null
 or exists(select 1 from public.icash_sms_inbound_invitations i
  join public.icash_text_messages msg on msg.id=i.message_id and msg.thread_id=ordered.id and msg.account_id=ordered.account_id and msg.state='ready'
  where i.thread_id=ordered.id and i.expires_at>now()
   and not exists(select 1 from public.icash_automation_tickets old where old.opener_message_id=msg.id))
 limit 1;$new$;
 if position(needle in d)=0 then raise exception 'Seller recovery candidate limit changed';end if;
 execute replace(d,needle,replacement);

 d:=pg_get_functiondef('public.icash_next_before_sms_inbound_campaign()'::regprocedure);
 needle:=' and public.icash_seller_opener_candidate_body(t.account_id,t.id) is not null';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>2 then raise exception 'Seller new preflight changed';end if;
 d:=replace(d,needle,'');
 needle:='select t.* into thread from candidates candidate';
 if position(needle in d)=0 then raise exception 'Seller new candidate entry changed';end if;
 d:=replace(d,needle,'select ordered.* into thread from (select t.* from candidates candidate');
 needle:='order by t.id for update of t skip locked limit 1;';
 replacement:=$new$order by t.id for update of t skip locked offset 0) ordered
 where public.icash_seller_opener_candidate_body(ordered.account_id,ordered.id) is not null
 limit 1;$new$;
 if position(needle in d)=0 then raise exception 'Seller new candidate limit changed';end if;
 execute replace(d,needle,replacement);
end $patch$;
commit;

