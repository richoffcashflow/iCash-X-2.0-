begin;
-- Reply visibility only. Apply after reply-signals and sms-inbound-campaign.
-- No contacts, permission evidence, releases, messages or provider work are created.
alter table public.icash_text_attention add column message_event_at numeric;
alter table public.icash_text_attention drop constraint icash_text_attention_kind_check;
alter table public.icash_text_attention add constraint icash_text_attention_kind_check check(kind in ('declined','human','callback','withdrawal','campaign_reply'));
alter table public.icash_text_attention add constraint icash_text_attention_message_event_check check(kind<>'campaign_reply' or (message_event_at is not null and message_event_at>=0));

-- Prefer the authenticated provider event time so delayed delivery cannot replace a newer reply.
create function public.icash_sms_reply_time(p_message uuid) returns numeric language sql stable security invoker set search_path='' as $$
 select case when jsonb_typeof(e.payload->'timestamp')='number' then
  case when (e.payload->>'timestamp')::numeric between 0 and extract(epoch from m.created_at)+300 then (e.payload->>'timestamp')::numeric else extract(epoch from m.created_at) end
  else extract(epoch from m.created_at) end
 from public.icash_text_messages m left join public.icash_text_events e on e.id=m.event_id where m.id=p_message;
$$;

create function public.icash_review_sms_campaign_reply(p_account uuid,p_message uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;d public.icash_deal_files;attention uuid;
begin
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and direction='incoming' and state='received';
 if not found then return null;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account and party='seller';
 if not found then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and screening_id is not null and coalesce(terms->>'practice','false')<>'true';
 if not found or not exists(select 1 from public.icash_screening_jobs where id=d.screening_id and account_id=p_account)
  or not exists(select 1 from public.icash_outreach_campaigns where account_id=p_account and mode='sms_inbound') then return null;end if;
 -- Prior sent opener establishes conversation provenance, never future sending permission.
 if not exists(select 1 from public.icash_seller_opener_assignments a join public.icash_text_messages o on o.id=a.message_id and o.thread_id=t.id and o.account_id=p_account and o.direction='outgoing' and o.state in ('accepted','delivered') and o.provider_id is not null where a.account_id=p_account and a.thread_id=t.id and m.created_at>=o.created_at)
  or public.icash_text_signal(m.body,t.party) is not null
  or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex')) then return null;end if;
 -- A successfully sent invitation already has its ordinary recorded continuation.
 if exists(select 1 from public.icash_sms_inbound_invitations i join public.icash_text_messages outgoing on outgoing.id=i.message_id and outgoing.account_id=p_account and outgoing.thread_id=t.id and outgoing.state in ('accepted','delivered') and outgoing.provider_id is not null where i.account_id=p_account and i.thread_id=t.id and i.reply_id=m.id) then return null;end if;
 insert into public.icash_text_attention(account_id,thread_id,deal_id,screening_id,message_id,kind,party,quote,timezone,message_event_at)
 values(p_account,t.id,d.id,d.screening_id,m.id,'campaign_reply',t.party,left(m.body,1000),t.timezone,public.icash_sms_reply_time(m.id))
 on conflict(thread_id,kind) do update set message_id=excluded.message_id,quote=excluded.quote,timezone=excluded.timezone,message_event_at=excluded.message_event_at,state='open',updated_at=now()
 where public.icash_text_attention.message_id<>excluded.message_id
  and (public.icash_text_attention.message_event_at,public.icash_text_attention.message_id)<(excluded.message_event_at,excluded.message_id)
 returning id into attention;
 return coalesce(attention,(select id from public.icash_text_attention where thread_id=t.id and kind='campaign_reply' and account_id=p_account));
end $$;

create function public.icash_capture_sms_campaign_reply() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.direction='incoming' and new.state='received' and new.account_id is not null
  and not exists(select 1 from public.icash_sms_inbound_invitations where reply_id=new.id and account_id=new.account_id) then
  perform public.icash_review_sms_campaign_reply(new.account_id,new.id);
 end if;
 return new;
end $$;
-- Run after the existing signal and campaign enqueue triggers have made their decisions.
create trigger icash_zz_capture_sms_campaign_reply after insert on public.icash_text_messages for each row execute function public.icash_capture_sms_campaign_reply();
revoke all on function public.icash_sms_reply_time(uuid),public.icash_review_sms_campaign_reply(uuid,uuid),public.icash_capture_sms_campaign_reply() from public,anon,authenticated;
grant execute on function public.icash_sms_reply_time(uuid),public.icash_review_sms_campaign_reply(uuid,uuid),public.icash_capture_sms_campaign_reply() to service_role;
commit;
