-- Apply after first-contact-business-hours. Install before promoting its app.
-- Existing boolean callers remain unchanged; the new explicit result prevents
-- an old/delayed generic hold request from cancelling a reissued deferred call.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare definition text;needle text;busy text;rate_check text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_meta_claim_voice(uuid,uuid)'::regprocedure);
 needle:='if not public.icash_voice_outreach_hours_current(p_account,p_job) then return false;end if;';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Meta contention requires current outreach hours';end if;
 busy:=$old$if exists(select 1 from public.icash_voice_jobs v join public.icash_voice_contact_targets t on t.id=coalesce(v.permission_id,v.operational_contact_id)
  where v.id<>j.id and (v.state='dispatching' or v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')) and (v.account_id=p_account or t.contact_key=p.contact_key))
  or exists(select 1 from public.icash_live_conversations where state in ('waiting','review') and (account_id=p_account or contact_key=p.contact_key)) then return false;end if;$old$;
 rate_check:=$old$if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id
  where o.operation_key='voice:'||j.id and o.account_id=p_account and o.rate_id=c.seller_rate_id and r.operation='seller_call' and r.voice_max_duration_seconds>=c.max_duration_seconds) then return false;end if;$old$;
 if (length(definition)-length(replace(definition,busy,'')))/length(busy)<>1
  or (length(definition)-length(replace(definition,rate_check,'')))/length(rate_check)<>1
  or position(busy||E'\n '||rate_check in definition)=0 then raise exception 'Meta contention admission boundary changed';end if;
 -- Keep exact rate admission ahead of the busy decision. Never turn another
 -- failure into a retry merely because the account happens to be occupied.
 replacement:=replace(busy,'then return false;end if;',$defer$then
  if j.callback_id is not null or j.sms_source_message_id is not null or j.cancellation_notice_id is not null
   or j.meta_offer_lead_id is not null or j.meta_followup_lead_id is not null or j.operational_contact_id is not null
   or j.operation_key is not null or j.provider_call_sid is not null or j.conversation_id is not null
   or not exists(select 1 from public.icash_meta_leads m where m.account_id=p_account and m.voice_job_id=j.id)
   or not exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='voice:'||j.id
    and o.state='reserved' and o.dispatched_at is null and o.settled_at is null
    and coalesce(o.actual_micros,0)=0 and coalesce(o.charged_cents,0)=0)
   or exists(select 1 from public.icash_call_recordings r where r.voice_job_id=j.id or r.operation_key='voice:'||j.id)
   or exists(select 1 from public.icash_live_conversations v where v.operation_key='voice:'||j.id) then return false;end if;
  declare claim_valid boolean:=false;
  begin
   -- Use the real final membership, credits, activation, consent expiry and
   -- company-budget chain. Its successful ledger transition is rolled back;
   -- no provider work occurs in any of these database functions.
   if not public.icash_claim_operation('voice:'||j.id) then return false;end if;
   claim_valid:=true;
   raise exception using errcode='P0M01',message='Meta initial call deferred solely for active-call contention';
  exception when sqlstate 'P0M01' then
   if not claim_valid then raise;end if;
   -- Budget/job/account/contact locks were acquired outside this savepoint.
   -- The SAME reserved operation and original provider evidence are retained.
   update public.icash_voice_jobs set state='ready',due_at=now()+interval '1 minute',
    outcome='Waiting for another call to finish',updated_at=now() where id=j.id and account_id=p_account;
   return 'deferred';
  end;
 end if;$defer$);
 definition:=replace(definition,busy||E'\n '||rate_check,rate_check||E'\n '||replacement);
 -- Build a separate service-only result contract. Do not change the old
 -- boolean RPC or any caller which has not adopted the explicit deferral.
 definition:=replace(definition,'public.icash_meta_claim_voice(', 'public.icash_meta_claim_or_defer_voice(');
 definition:=replace(definition,'RETURNS boolean','RETURNS text');
 needle:='if not found or j.state<>''issued'' or j.due_at>now() or public.icash_meta_voice_context(p_account,p_job) is null then return false;end if;';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Meta job ownership boundary changed';end if;
 definition:=replace(definition,needle,'if not found or j.state<>''issued'' or j.due_at>now() then return ''unavailable'';end if;'||E'\n if public.icash_meta_voice_context(p_account,p_job) is null then return false;end if;');
 -- Finish a genuine failed admission under the same ownership locks. The app
 -- must never send a later state-only hold after this RPC returns.
 definition:=replace(definition,'return false;','perform public.icash_hold_voice_job(p_account,p_job,''dispatch_permission_changed'',false); return ''held'';');
 definition:=replace(definition,'return true;','return ''claimed'';');
 if position('RETURNS text' in definition)=0 or position('return ''claimed'';' in definition)=0 then raise exception 'Meta result contract changed';end if;
 execute definition;
end $patch$;
revoke all on function public.icash_meta_claim_or_defer_voice(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_meta_claim_or_defer_voice(uuid,uuid) to service_role;
commit;
