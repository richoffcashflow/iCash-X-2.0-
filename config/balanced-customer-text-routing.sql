-- Balance new access/customer-update conversations; preserve saved recipients.
-- This does not enroll recipients or enable the disabled webinar reminders.
create or replace function public.icash_webinar_campaign_sender(p_recipient text)
returns text language plpgsql security invoker set search_path='' as $$
declare chosen text;
begin
 if p_recipient is null or p_recipient!~'^\+[1-9][0-9]{7,14}$' then return null;end if;
 perform pg_advisory_xact_lock(818,1);
 select a.sender into chosen from public.icash_webinar_text_assignments a where a.recipient=p_recipient;
 if chosen is not null then
  return case when exists(select 1 from public.icash_webinar_text_senders where phone=chosen and enabled)
   and not exists(select 1 from public.icash_text_threads where sender=chosen and recipient=p_recipient and retired_at is null)
   then chosen else null end;
 end if;
 select s.phone into chosen
 from public.icash_webinar_text_senders s
 left join public.icash_webinar_text_assignments a on a.sender=s.phone
 where s.enabled and not exists(select 1 from public.icash_text_threads t where t.sender=s.phone and t.recipient=p_recipient and t.retired_at is null)
 group by s.phone order by count(a.recipient),s.phone limit 1;
 if chosen is not null then insert into public.icash_webinar_text_assignments(recipient,sender) values(p_recipient,chosen);end if;
 return chosen;
end $$;
revoke all on function public.icash_webinar_campaign_sender(text) from public,anon,authenticated;
grant execute on function public.icash_webinar_campaign_sender(text) to service_role;
