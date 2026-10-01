create or replace function public.icash_apply_email_delivery(p_provider text) returns void language plpgsql set search_path='' as $$
declare m public.icash_deal_emails;e public.icash_email_delivery_events;
begin
 select * into m from public.icash_deal_emails where provider_id=p_provider::uuid and direction='outgoing' for update;if not found then return;end if;
 select * into e from public.icash_email_delivery_events where provider_id=p_provider order by case kind when 'complained' then 3 when 'bounced' then 2 else 1 end desc,occurred_at desc,event_id desc limit 1;if not found then return;end if;
 update public.icash_deal_emails set delivery_state=e.kind,delivery_at=e.occurred_at where id=m.id;
 if e.kind in ('bounced','complained') then insert into public.icash_email_suppressions(account_id,email,reason) values(m.account_id,lower(m.recipient),e.kind) on conflict(account_id,email) do nothing;end if;
end $$;
create or replace function public.icash_reconcile_email_delivery() returns trigger language plpgsql set search_path='' as $$ begin if new.direction='outgoing' and new.provider_id is not null then perform public.icash_apply_email_delivery(new.provider_id::text);end if;return new;end $$;
