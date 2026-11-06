-- Surface the current seller action and keep historical interest distinct
-- from a contact currently available for follow-up.
begin;
set local lock_timeout='3s';
do $patch$
declare def text; part record;
begin
 def:=pg_get_functiondef('icash_work_private.value_receipt(uuid,timestamptz,timestamptz)'::regprocedure);
 for part in select * from (values
  ($old$chosen as (select * from sellers order by at desc,source_id limit 1)$old$,
   $new$chosen as (
    select e.* from sellers e where not exists(select 1 from public.icash_contact_suppressions cs where cs.contact_key=e.seller_key)
     and not exists(select 1 from public.icash_text_threads t join public.icash_text_suppressions x on x.phone=t.recipient
      where t.account_id=p_account and t.party='seller' and encode(sha256(convert_to(t.recipient,'UTF8')),'hex')=e.seller_key)
     and not exists(select 1 from public.icash_text_threads t join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
      where t.account_id=p_account and t.party='seller' and encode(sha256(convert_to(t.recipient,'UTF8')),'hex')=e.seller_key
       and m.direction='incoming' and m.state='received' and coalesce(nullif(m.provider_id,''),nullif(m.event_id,'')) is not null
       and m.created_at>e.at and m.created_at<=p_end and public.icash_seller_response_disposition(m.body) in ('opt_out','declined'))
     and not exists(select 1 from public.icash_live_conversations c where c.account_id=p_account and c.contact_key=e.seller_key and c.party='seller'
      and c.state='complete' and nullif(c.conversation_id,'') is not null and c.completed_at>e.at and c.completed_at<=p_end
      and (c.result->'optedOut'='true'::jsonb or public.icash_seller_call_disposition(c.result) in ('opt_out','declined')))
    order by exists(select 1 from public.icash_seller_reply_progress r where r.account_id=p_account and r.message_id=e.source_id
     and e.source='text' and r.state in ('pending','needs_review') and r.milestone in ('offer_review','visit_coordination','contract_preparation')) desc,
     e.at desc,e.source_id limit 1)$new$),
  ($old$r.reason in ('visit_requested','price_reconciliation','awaiting_seller_reply','awaiting_dispatch')$old$,
   $new$r.reason in ('visit_requested','price_reconciliation','awaiting_seller_reply','awaiting_dispatch','active_call_receipt_unresolved','callback_coordination')$new$),
  ($old$order by (r.reason in ('visit_requested','price_reconciliation')) desc,m.created_at desc limit 1$old$,
   $new$order by exists(select 1 from chosen e where e.screening_id=d.screening_id) desc,
   (r.reason in ('visit_requested','price_reconciliation','active_call_receipt_unresolved','callback_coordination')) desc,m.created_at desc limit 1$new$)
 ) as changes(needle,replacement) loop
  if (length(def)-length(replace(def,part.needle,'')))/length(part.needle)<>1 then raise exception 'Receipt follow-up prerequisite changed';end if;
  def:=replace(def,part.needle,part.replacement);
 end loop;
 execute def;
end $patch$;
commit;
