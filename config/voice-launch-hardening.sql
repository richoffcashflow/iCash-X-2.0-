-- Atomically hold only the dispatch state owned by this worker. Never refund an uncertain dial.
create function public.icash_hold_voice_job(p_account uuid,p_job uuid,p_reason text,p_after_claim boolean default false)
returns boolean language plpgsql set search_path='' as $$
declare j public.icash_voice_jobs;o public.icash_operation_spend;
begin
 if p_reason is null or length(p_reason) not between 1 and 200 or p_after_claim is null then raise exception 'Invalid hold';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>(case when p_after_claim then 'dispatching' else 'issued' end) then return false;end if;
 if not p_after_claim then
  select * into o from public.icash_operation_spend where operation_key='voice:'||j.id and account_id=p_account for update;
  if found then
   if o.state='reserved' then perform public.icash_settle_operation(o.operation_key,0,0,'Voice stopped before provider dispatch: '||p_reason);
   elsif o.state<>'cancelled' then return false;end if;
  end if;
 end if;
 update public.icash_voice_jobs set state='held',outcome=p_reason,updated_at=now() where id=j.id;
 return true;
end $$;
revoke all on function public.icash_hold_voice_job(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.icash_hold_voice_job(uuid,uuid,text,boolean) to service_role;

create or replace function public.icash_save_live_result(p_call uuid,p_result jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare c public.icash_live_conversations; prop text; due timestamptz; zone text;
begin
 select * into strict c from public.icash_live_conversations where id=p_call for update;
 if c.state='complete' then if c.result<>p_result then raise exception 'Conflicting result';end if;return;end if;
 if octet_length(p_result::text)>262144 or jsonb_typeof(p_result->'transcript') is distinct from 'array' or nullif(p_result->>'summary','') is null or p_result->>'party' is distinct from c.party then raise exception 'Invalid result';end if;
 select snapshot->>'propertyId' into strict prop from public.icash_screening_jobs where id=c.screening_id and account_id=c.account_id;
 if exists(select 1 from public.icash_inbound_voice_receipts where live_call_id=c.id) then
  perform public.icash_open_handoff(c.id,'Incoming caller details need verification',left(p_result->>'summary',6000),'Confirm the caller and property before using saved deal terms.');
 end if;
 if (p_result->>'humanRequested')::boolean then perform public.icash_open_handoff(c.id,'Requested a person',left(p_result->>'summary',6000),p_result->>'nextAction');end if;
 update public.icash_handoffs set summary=left(p_result->>'summary',6000) where conversation_id=c.id;
 if (p_result->>'optedOut')::boolean then
  insert into public.icash_contact_suppressions(account_id,contact_key,source_conversation) values(c.account_id,c.contact_key,c.id) on conflict do nothing;
  insert into public.icash_property_controls(account_id,property_id,manual) values(c.account_id,prop,true) on conflict(account_id,property_id) do update set manual=true,updated_at=now();
  update public.icash_live_callbacks b set state='canceled' from public.icash_live_conversations v where b.conversation_id=v.id and v.account_id=c.account_id and v.contact_key=c.contact_key and b.state in ('pending_dispatch_review','held_for_human');
 elsif p_result->>'callbackDueAt' is not null then
  due:=(p_result->>'callbackDueAt')::timestamptz;zone:=p_result->>'callbackTimezone';
  if not exists(select 1 from pg_timezone_names where name=zone) or due>now()+interval '90 days' then raise exception 'Invalid callback time';end if;
  insert into public.icash_live_callbacks(conversation_id,account_id,screening_id,due_at,timezone,evidence,state)
  values(c.id,c.account_id,c.screening_id,due,zone,jsonb_build_object('quote',p_result->'callbackQuote','readback',p_result->'callbackEvidence'),case when due<=now() then 'missed' when exists(select 1 from public.icash_property_controls where account_id=c.account_id and property_id=prop and manual) then 'held_for_human' else 'pending_dispatch_review' end) on conflict(conversation_id) do update set due_at=excluded.due_at,timezone=excluded.timezone,evidence=excluded.evidence,state=excluded.state where icash_live_callbacks.state in ('pending_dispatch_review','held_for_human');
 else
  -- A tool request is provisional until the provider transcript verifies it.
  update public.icash_live_callbacks set state='canceled' where conversation_id=c.id and state in ('pending_dispatch_review','held_for_human');
 end if;
 update public.icash_live_conversations set result=p_result,state='complete',completed_at=now(),tool_token_hash=null where id=c.id;
end $$;

