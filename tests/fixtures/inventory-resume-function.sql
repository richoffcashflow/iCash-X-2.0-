CREATE OR REPLACE FUNCTION public.icash_resume_prospecting_ticket()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_automation_tickets;op text;
begin
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return null;end if;
 for t in select x.* from public.icash_automation_tickets x join public.icash_accounts a on a.id=x.account_id
  where x.state='held' and x.outcome='prospecting_budget_held' and x.expires_at<=now() and not a.bot_paused
  and public.icash_membership_work_allowed(a.id) and public.icash_prospecting_available(a.id)>=x.prospecting_quote_cents
  and (x.kind not in ('contacts','discovery') or not public.icash_research_waiting_on_outreach(x.account_id))
  order by x.created_at limit 20 for update of x skip locked loop
  op:=null;
  if t.kind='contacts' then op:='owners:'||t.account_id||':'||t.screening_id;
  elsif t.kind='voice_dispatch' then
   op:='voice:'||t.voice_job_id;
   if not exists(select 1 from public.icash_voice_jobs where id=t.voice_job_id and account_id=t.account_id and state='held' and outcome='prospecting_budget_held' and operation_key is null and conversation_id is null and provider_call_sid is null) then continue;end if;
  elsif t.kind in ('seller_opener','seller_recovery') then
   op:='text:'||t.opener_message_id;
   if not exists(select 1 from public.icash_text_messages where id=t.opener_message_id and account_id=t.account_id and state='ready' and provider_id is null and last_delivery_at is null) then continue;end if;
  elsif t.kind='discovery' then
   -- A discovery page can move independently. Its scheduler handles the current
   -- revision; do not replay a stale page capability.
   update public.icash_automation_tickets set outcome='prospecting_budget_released' where id=t.id;
   perform public.icash_wake_funded_outreach(t.account_id);continue;
  end if;
  if op is null or exists(select 1 from public.icash_operation_spend where operation_key=op) or exists(select 1 from public.icash_live_conversations where operation_key=op) then continue;end if;
  if exists(select 1 from public.icash_automation_tickets x where x.id<>t.id and x.account_id=t.account_id and ((x.state='issued' and x.expires_at>now()) or (x.state='consumed' and x.created_at>now()-interval '5 minutes'))) then continue;end if;
  if t.kind='voice_dispatch' then update public.icash_voice_jobs set state='issued',outcome=null,updated_at=now() where id=t.voice_job_id;end if;
  update public.icash_automation_tickets set token=gen_random_uuid()::text||gen_random_uuid()::text,state='issued',outcome=null,completed_at=null,created_at=now(),expires_at=now()+interval '2 minutes' where id=t.id returning * into t;
  return jsonb_build_object('token',t.token);
 end loop;
 return null;
end $function$
