-- Provider callbacks can arrive out of order. Learn only from confirmed delivery.
create or replace function public.icash_observe_seller_opener() returns trigger language plpgsql set search_path='' as $$
declare sent_at timestamptz;first_reply timestamptz;declined boolean;
begin
 if new.direction='outgoing' then
  update public.icash_seller_opener_assignments set message_id=new.id,
   delivered_at=case when new.state='delivered' then coalesce(delivered_at,new.last_delivery_at,now()) else delivered_at end
  where thread_id=new.thread_id and account_id=new.account_id and body=new.body and (message_id is null or message_id=new.id);
  if new.state='delivered' then
   -- The provider confirmed this send succeeded. Replies after send creation can
   -- precede the delivery webhook; keep their actual timestamps, never synthesize one.
   select min(m.created_at),coalesce(bool_or(m.body ~* '(^\s*(stop|unsubscribe|cancel|end|quit)\s*$|do not (text|contact)|don''t (text|contact)|not interested)'),false)
    into first_reply,declined from public.icash_text_messages m
    where m.thread_id=new.thread_id and m.account_id=new.account_id and m.direction='incoming' and m.state='received' and m.created_at>=new.created_at;
   update public.icash_seller_opener_assignments set first_reply_at=case when first_reply is null then first_reply_at else least(first_reply_at,first_reply) end,opted_out=opted_out or declined
    where message_id=new.id and account_id=new.account_id;
  end if;
 elsif new.direction='incoming' and new.state='received' then
  select m.created_at into sent_at from public.icash_seller_opener_assignments a join public.icash_text_messages m on m.id=a.message_id and m.account_id=a.account_id
   where a.thread_id=new.thread_id and a.account_id=new.account_id and a.delivered_at is not null;
  if sent_at is not null and new.created_at>=sent_at then
   update public.icash_seller_opener_assignments set first_reply_at=least(first_reply_at,new.created_at),opted_out=opted_out or new.body ~* '(^\s*(stop|unsubscribe|cancel|end|quit)\s*$|do not (text|contact)|don''t (text|contact)|not interested)'
    where thread_id=new.thread_id and account_id=new.account_id;
  end if;
 end if;
 return new;
end $$;
