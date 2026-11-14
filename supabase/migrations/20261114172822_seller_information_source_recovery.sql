-- Operator-invoked recovery for one reviewed, never-attempted original source.
-- This installs no scheduler and sends nothing. Caller owns the transaction.
set local lock_timeout='5s';
set local statement_timeout='30s';
create schema icash_seller_information_private;
revoke all on schema icash_seller_information_private from public,anon,authenticated,service_role;
create table icash_seller_information_private.recoveries(
 job_id uuid primary key,account_id uuid not null,message_id uuid not null,thread_id uuid not null,
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 prior_job jsonb not null,prior_progress jsonb,
 status text not null check(status in ('checking','recovered','rejected')),
 reason text,created_at timestamptz not null default now(),completed_at timestamptz
);
alter table icash_seller_information_private.recoveries enable row level security;
revoke all on icash_seller_information_private.recoveries from public,anon,authenticated,service_role;

create function icash_seller_information_private.recover(p_account uuid,p_message uuid,p_job uuid,p_source_sha256 text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;m public.icash_text_messages;t public.icash_text_threads;
 s public.icash_screening_jobs;r icash_seller_information_private.recoveries;source_at timestamptz;failure text;reply text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and direction='incoming' and state='received' for update;
 if not found or encode(sha256(convert_to(m.body,'UTF8')),'hex') is distinct from p_source_sha256 then raise exception 'Reviewed seller source differs';end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account and party='seller';
 if not found then raise exception 'Reviewed seller thread differs';end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account and thread_id=t.id and message_id=m.id for update;
 if not found then raise exception 'Reviewed seller job differs';end if;
 select * into r from icash_seller_information_private.recoveries where job_id=j.id;
 if found then
  if r.account_id<>p_account or r.message_id<>p_message or r.source_sha256<>p_source_sha256 then raise exception 'Recovery source differs';end if;
  return jsonb_build_object('status',r.status,'reason',r.reason,'jobId',j.id,'repeated',true);
 end if;
 select screen.* into s from public.icash_screening_jobs screen join public.icash_deal_files d on d.screening_id=screen.id and d.account_id=screen.account_id where d.id=t.deal_id and d.account_id=p_account;
 source_at:=to_timestamp(public.icash_sms_reply_time(m.id)::double precision);
 insert into icash_seller_information_private.recoveries(job_id,account_id,message_id,thread_id,source_sha256,prior_job,prior_progress,status)
 values(j.id,p_account,m.id,t.id,p_source_sha256,to_jsonb(j),(select to_jsonb(p) from public.icash_seller_reply_progress p where p.message_id=m.id and p.account_id=p_account),'checking');
 if j.state<>'needs_review' or j.updated_at is distinct from j.created_at
  or j.outgoing_id is not null or j.provider_id is not null or j.usage is not null or j.reply is not null
  or j.analysis->>'action' is distinct from 'seller_dialogue' or j.analysis->>'dialoguePolicy' is distinct from 'seller-dialogue-v1'
  or j.analysis->>'dialogueAction' is distinct from 'explain_price' or j.analysis->>'dialogueAnchor' is distinct from m.id::text
  or coalesce(j.analysis->'facts','[]'::jsonb)<>'[]'::jsonb or coalesce(j.analysis->'voiceReceiptWait','null'::jsonb)<>'null'::jsonb
 then failure:='original_failure_changed';
 elsif source_at is null or source_at not between now()-interval '24 hours' and now()
  or (m.event_id is null and m.provider_id is null) or s.completed_at is null
  or s.completed_at not between source_at-interval '25 hours' and source_at-interval '24 hours'
 then failure:='original_failure_window_changed';
 elsif exists(select 1 from public.icash_automation_tickets x where x.text_ai_job_id=j.id)
  or exists(select 1 from public.icash_operation_spend x where x.operation_key='sms-ai:'||j.id)
  or exists(select 1 from public.icash_text_messages x where x.request_key=j.id)
 then failure:='prior_operation_evidence';
 elsif exists(select 1 from public.icash_text_messages x where x.account_id=p_account and x.thread_id=t.id and x.id<>m.id
  and (x.created_at>=m.created_at or (x.direction='incoming' and public.icash_sms_reply_time(x.id)>=public.icash_sms_reply_time(m.id))))
 then failure:='newer_conversation';
 end if;
 if failure is null then
  begin
   -- Probe the ordinary admission path inside a subtransaction; a failure
   -- rolls back every temporary state change while retaining the audit row.
   update public.icash_text_ai_jobs set state='drafted' where id=j.id and account_id=p_account;
   reply:=public.icash_seller_dialogue_reply(p_account,j.id);
   if reply is null then failure:='current_dialogue_not_admitted';raise exception using errcode='PIR01',message=failure;end if;
   if public.icash_seller_progress_gate(p_account,j.id) is distinct from true then failure:='current_progress_not_admitted';raise exception using errcode='PIR01',message=failure;end if;
   update public.icash_text_ai_jobs set state='pending',next_attempt_at=now(),updated_at=now() where id=j.id and account_id=p_account and state='drafted';
   if not found then failure:='original_job_changed';raise exception using errcode='PIR01',message=failure;end if;
   perform public.icash_refresh_seller_reply_progress(p_account,m.id);
  exception when sqlstate 'PIR01' then null;
  end;
 end if;
 update icash_seller_information_private.recoveries set status=case when failure is null then 'recovered' else 'rejected' end,reason=coalesce(failure,'original_source_pending'),completed_at=now() where job_id=j.id returning * into r;
 return jsonb_build_object('status',r.status,'reason',r.reason,'jobId',j.id,'repeated',false);
end $$;
revoke all on function icash_seller_information_private.recover(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
