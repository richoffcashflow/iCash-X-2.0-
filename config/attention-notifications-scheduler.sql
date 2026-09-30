-- OPTIONAL STAGED integration after attention-notifications.sql and the latest
-- automation scheduler. No new cron. Existing job priorities/fairness run first.
-- The existing Railway tick already requests at most one automation at a time.
-- Verify the current constraint/scheduler definition before applying.
begin;
do $$
declare expression text;
begin
 select pg_get_constraintdef(oid) into strict expression from pg_constraint where conrelid='public.icash_automation_tickets'::regclass and conname='icash_automation_tickets_kind_check';
 if expression like '%customer_attention%' then raise exception 'Attention scheduler already installed';end if;
 -- Preserve every deployed kind instead of replacing it with a stale list.
 execute 'alter table public.icash_automation_tickets drop constraint icash_automation_tickets_kind_check';
 execute 'alter table public.icash_automation_tickets add constraint icash_automation_tickets_kind_check check (kind = ''customer_attention'' or '||substring(expression from 7)||')';
end $$;
alter function public.icash_next_automation() rename to icash_next_automation_before_attention;
create function public.icash_next_automation() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare prior jsonb;p public.icash_attention_email_preferences;t public.icash_automation_tickets;
begin
 prior:=public.icash_next_automation_before_attention();
 if prior is not null then return prior;end if;
 -- Notification faults never roll back the original scheduler's work.
 begin
  perform 1 from public.icash_attention_email_settings where id=1 and enabled and next_scan_at<=now() for update skip locked;
  if not found then return null;end if;
  select * into p from public.icash_attention_email_preferences x
   where x.enabled and x.suppressed_at is null and x.next_scan_at<=now()
   and not exists(select 1 from public.icash_automation_tickets j where j.account_id=x.account_id and j.kind='customer_attention' and ((j.state='issued' and j.expires_at>now()) or (j.state='consumed' and j.created_at>now()-interval '5 minutes')))
   order by x.next_scan_at,x.account_id for update skip locked limit 1;
  if not found then return null;end if;
  update public.icash_attention_email_settings set next_scan_at=now()+interval '1 minute' where id=1;
  update public.icash_attention_email_preferences set next_scan_at=now()+interval '15 minutes' where account_id=p.account_id;
  insert into public.icash_automation_tickets(account_id,kind) values(p.account_id,'customer_attention') returning * into t;
  return jsonb_build_object('token',t.token);
 exception when others then return null;
 end;
end $$;
revoke all on function public.icash_next_automation(),public.icash_next_automation_before_attention() from public,anon,authenticated;
grant execute on function public.icash_next_automation(),public.icash_next_automation_before_attention() to service_role;
commit;
