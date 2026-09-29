create table public.icash_text_ai_settings(id integer primary key check(id=1),enabled boolean not null default true,model text not null default 'gpt-4.1-mini',rate_id uuid references public.icash_operation_rates(id));
insert into public.icash_text_ai_settings(id) values(1);
alter table public.icash_text_threads add column ai_mode text not null default 'auto' check(ai_mode in ('off','review','auto'));
create table public.icash_text_ai_jobs(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),thread_id uuid not null references public.icash_text_threads(id),message_id uuid not null unique references public.icash_text_messages(id),
 state text not null default 'pending' check(state in ('pending','issued','analyzing','drafted','needs_review','handoff','superseded','queued')),
 analysis jsonb,reply text,provider_id text,usage jsonb,outgoing_id uuid references public.icash_text_messages(id),
 next_attempt_at timestamptz not null default now(),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index icash_text_ai_jobs_pending on public.icash_text_ai_jobs(next_attempt_at,created_at) where state in ('pending','issued');
alter table public.icash_text_ai_settings enable row level security;
alter table public.icash_text_ai_jobs enable row level security;
revoke all on public.icash_text_ai_settings,public.icash_text_ai_jobs from public,anon,authenticated;
grant all on public.icash_text_ai_settings,public.icash_text_ai_jobs to service_role;
create function public.icash_enqueue_text_ai() returns trigger language plpgsql set search_path='' as $$
begin
 if new.direction<>'incoming' or new.account_id is null or new.thread_id is null then return new;end if;
 update public.icash_text_ai_jobs set state='superseded',updated_at=now() where thread_id=new.thread_id and state in ('pending','issued','drafted');
 if exists(select 1 from public.icash_text_threads t join public.icash_text_suppressions s on s.phone=t.recipient where t.id=new.thread_id) then return new;end if;
 if new.body ~* '\m(human|real person|speak to someone|talk to someone|call me|call back|callback)\M' then
 update public.icash_text_threads set paused=true where id=new.thread_id;
 insert into public.icash_text_ai_jobs(account_id,thread_id,message_id,state,analysis) values(new.account_id,new.thread_id,new.id,'handoff',jsonb_build_object('summary','Seller requested a person or callback. Review and confirm scheduling.','humanRequested',true,'callbackRequested',new.body ~* '\m(call me|call back|callback)\M')) on conflict(message_id) do nothing;
 elsif exists(select 1 from public.icash_text_threads where id=new.thread_id and ai_mode<>'off') then
 insert into public.icash_text_ai_jobs(account_id,thread_id,message_id) values(new.account_id,new.thread_id,new.id) on conflict(message_id) do nothing;
 end if;return new;
end $$;
create trigger icash_text_ai_incoming after insert on public.icash_text_messages for each row execute function public.icash_enqueue_text_ai();
create function public.icash_claim_text_ai(p_account uuid,p_job uuid) returns jsonb language plpgsql set search_path='' as $$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;c public.icash_text_ai_settings;d public.icash_deal_files;prop text;history jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' then return null;end if;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account;
 select * into c from public.icash_text_ai_settings where id=1;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account;
 if t.paused or t.ai_mode='off' or not c.enabled or d.id is null or d.stage in ('closed','cancelled') then return null;end if;
 if exists(select 1 from public.icash_text_suppressions where phone=t.recipient) then return null;end if;
 if not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) then return null;end if;
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=d.screening_id and account_id=p_account;
 if exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=prop and manual) then return null;end if;
 if exists(select 1 from public.icash_text_messages where thread_id=t.id and created_at>(select created_at from public.icash_text_messages where id=j.message_id)) then update public.icash_text_ai_jobs set state='superseded' where id=j.id;return null;end if;
 if (select count(*) from public.icash_text_ai_jobs where thread_id=t.id and state in ('analyzing','drafted','needs_review','queued') and created_at>now()-interval '1 day')>=20 then return null;end if;
 if not exists(select 1 from public.icash_operation_rates where id=c.rate_id and operation='sms_ai' and enabled and expires_at>now()) then return null;end if;
 perform public.icash_reserve_operation(p_account,'sms-ai:'||j.id,c.rate_id,now()+interval '5 minutes');
 if not public.icash_claim_operation('sms-ai:'||j.id) then raise exception 'AI operation already claimed';end if;
 select jsonb_agg(jsonb_build_object('direction',direction,'body',left(body,1000)) order by created_at) into history from (select direction,body,created_at from public.icash_text_messages where thread_id=t.id and account_id=p_account order by created_at desc limit 24) m;
 update public.icash_text_ai_jobs set state='analyzing',updated_at=now() where id=j.id;
 return jsonb_build_object('model',c.model,'context',jsonb_build_object('stage',d.stage,'address',left(d.terms->>'address',300),'timezone',t.timezone),'messages',coalesce(history,'[]'));
end $$;
create function public.icash_save_text_ai(p_account uuid,p_job uuid,p_analysis jsonb,p_reply text,p_provider text,p_usage jsonb) returns void language plpgsql set search_path='' as $$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;
begin
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'analyzing' then return;end if;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account;
 if coalesce((p_analysis->>'humanRequested')::boolean,false) or coalesce((p_analysis->>'callbackRequested')::boolean,false) then
 update public.icash_text_threads set paused=true where id=t.id;
 end if;
 update public.icash_text_ai_jobs set analysis=p_analysis,reply=left(p_reply,500),provider_id=p_provider,usage=p_usage,state=case
 when exists(select 1 from public.icash_text_messages where thread_id=t.id and created_at>(select created_at from public.icash_text_messages where id=j.message_id)) then 'superseded'
 when coalesce((p_analysis->>'humanRequested')::boolean,false) or coalesce((p_analysis->>'callbackRequested')::boolean,false) then 'handoff'
 else 'drafted' end,updated_at=now() where id=j.id;
end $$;
-- Workers receive short-lived single-use capabilities, using the existing Railway runner.
alter table public.icash_automation_tickets drop constraint icash_automation_tickets_kind_check;
alter table public.icash_automation_tickets add constraint icash_automation_tickets_kind_check check(kind in ('discovery','contacts','voice_result','signing_result','voice_dispatch','fulfillment','title_followup','text_ai'));
alter table public.icash_automation_tickets add column text_ai_job_id uuid references public.icash_text_ai_jobs(id);
alter function public.icash_next_automation() rename to icash_next_before_text_ai;
create function public.icash_next_automation() returns jsonb language plpgsql set search_path='' as $$
declare j public.icash_text_ai_jobs;t public.icash_automation_tickets;
begin
 perform pg_advisory_xact_lock(726341927);
 if exists(select 1 from public.icash_text_ai_settings c join public.icash_operation_rates r on r.id=c.rate_id and r.enabled and r.expires_at>now() where c.enabled)
 and exists(select 1 from public.icash_operating_budget where id=1 and enabled)
 and not exists(select 1 from public.icash_automation_tickets where kind='text_ai' and created_at>now()-interval '10 seconds') then
 select q.* into j from public.icash_text_ai_jobs q join public.icash_accounts a on a.id=q.account_id and not a.bot_paused join public.icash_text_threads th on th.id=q.thread_id and not th.paused and th.ai_mode<>'off'
 where q.next_attempt_at<=now() and (q.state='pending' or (q.state='issued' and q.updated_at<now()-interval '15 minutes')) order by q.created_at for update of q skip locked limit 1;
 if found then
 update public.icash_text_ai_jobs set state='issued',updated_at=now(),next_attempt_at=now()+interval '15 minutes' where id=j.id;
 insert into public.icash_automation_tickets(account_id,kind,text_ai_job_id) values(j.account_id,'text_ai',j.id) returning * into t;
 return jsonb_build_object('token',t.token);
 end if;end if;
 return public.icash_next_before_text_ai();
end $$;
create or replace function public.icash_consume_automation(p_token text) returns jsonb language plpgsql set search_path='' as $$
declare t public.icash_automation_tickets;
begin
 update public.icash_automation_tickets set state='consumed' where token=p_token and state='issued' and expires_at>now() returning * into t;
 if not found then return null;end if;
 return jsonb_build_object('id',t.id,'accountId',t.account_id,'kind',t.kind,'screeningId',t.screening_id,'liveCallId',t.live_call_id,'signingId',t.signing_id,'voiceJobId',t.voice_job_id,'fulfillmentJobId',t.fulfillment_job_id,'titleTaskId',t.title_task_id,'textAiJobId',t.text_ai_job_id);
end $$;
revoke all on function public.icash_enqueue_text_ai(),public.icash_claim_text_ai(uuid,uuid),public.icash_save_text_ai(uuid,uuid,jsonb,text,text,jsonb),public.icash_next_automation() from public,anon,authenticated;
grant execute on function public.icash_enqueue_text_ai(),public.icash_claim_text_ai(uuid,uuid),public.icash_save_text_ai(uuid,uuid,jsonb,text,text,jsonb),public.icash_next_automation() to service_role;
-- Only approved qualification prompts can auto-send. Free-form model prose stays a draft.
create function public.icash_queue_ai_reply(p_account uuid,p_job uuid,p_reply text) returns uuid language plpgsql set search_path='' as $$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;prop text;outgoing uuid;body text:=p_reply;
begin
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account;
 if t.id is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account for update;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account for update;
 if j.state<>'drafted' or t.ai_mode<>'auto' or t.paused or j.outgoing_id is not null then return null;end if;
 if p_reply is distinct from (case j.analysis->>'action'
 when 'ask_condition' then 'What repairs or updates does the property need?'
 when 'ask_price' then 'What price did you have in mind?'
 when 'ask_timing' then 'When would you like to sell?'
 when 'ask_owners' then 'Are all property owners on board with selling?'
 when 'ask_occupancy' then 'Is the property vacant, owner occupied, or rented?'
 when 'ask_callback' then 'What date, time, and time zone work for a callback?' end) then return null;end if;
 if p_reply is null or (j.analysis->>'action') in ('handoff','review') then return null;end if;
 if exists(select 1 from public.icash_text_suppressions where phone=t.recipient) or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) then return null;end if;
 select s.snapshot->>'propertyId' into prop from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id where d.id=t.deal_id and d.account_id=p_account and d.stage not in ('closed','cancelled');
 if prop is null or exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=prop and manual) then return null;end if;
 if exists(select 1 from public.icash_text_messages where thread_id=t.id and created_at>(select created_at from public.icash_text_messages where id=j.message_id)) then return null;end if;
 if exists(select 1 from public.icash_text_ai_jobs where thread_id=t.id and id<>j.id and outgoing_id is not null and analysis->>'action'=j.analysis->>'action') then return null;end if;
 if (select count(*) from public.icash_text_ai_jobs where thread_id=t.id and outgoing_id is not null and created_at>now()-interval '1 day')>=12 then return null;end if;
 if not exists(select 1 from public.icash_text_ai_jobs where thread_id=t.id and outgoing_id is not null) then body:='I am the AI assistant for this property inquiry. '||body;end if;
 outgoing:=public.icash_queue_text(p_account,t.id,j.id,body,'{}');
 update public.icash_text_ai_jobs set outgoing_id=outgoing,state='queued',updated_at=now() where id=j.id;
 return outgoing;
end $$;
-- Recheck automation-specific controls at the last possible point before provider dispatch.
alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_ai;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql set search_path='' as $$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;prop text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where outgoing_id=p_message and account_id=p_account;
 if found then
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account;
 if t.paused or t.ai_mode<>'auto' then return null;end if;
 select s.snapshot->>'propertyId' into prop from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id where d.id=t.deal_id and d.account_id=p_account;
 if exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=prop and manual) then return null;end if;
 if exists(select 1 from public.icash_text_messages where thread_id=t.id and id<>p_message and created_at>(select created_at from public.icash_text_messages where id=j.message_id)) then return null;end if;
 end if;
 return public.icash_claim_text_before_ai(p_account,p_message,p_sender);
end $$;
revoke all on function public.icash_queue_ai_reply(uuid,uuid,text),public.icash_claim_text(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_queue_ai_reply(uuid,uuid,text),public.icash_claim_text(uuid,uuid,text) to service_role;
-- Exact customer benchmark, independent of unknown Contiguity cost and carrier fees.
create table public.icash_sms_price_settings(id integer primary key check(id=1),base_micros_per_segment bigint not null check(base_micros_per_segment>=0),benchmark_source text not null,provider_cost_status text not null default 'unknown',provider_cost_micros bigint,carrier_fee_status text not null default 'unknown',verified_at timestamptz not null default now());
insert into public.icash_sms_price_settings(id,base_micros_per_segment,benchmark_source) values(1,20800,'Owner supplied customer-rate screenshot 2026-09-29');
alter table public.icash_sms_price_settings enable row level security;
revoke all on public.icash_sms_price_settings from public,anon,authenticated;
grant all on public.icash_sms_price_settings to service_role;

create table public.icash_communication_prices(
 operation text primary key check(operation in ('sms_segment','outbound_voice_minute','inbound_voice_minute','email')),
 customer_micros bigint not null check(customer_micros>=0),
 source text not null,updated_at timestamptz not null default now()
);
insert into public.icash_communication_prices(operation,customer_micros,source) values
 ('sms_segment',20800,'Owner screenshot: Charged to customer'),
 ('outbound_voice_minute',35000,'Owner screenshot: Charged to customer'),
 ('inbound_voice_minute',21300,'Owner screenshot: Charged to customer'),
 ('email',1000,'Owner screenshot: Charged to customer');
alter table public.icash_communication_prices enable row level security;
revoke all on public.icash_communication_prices from public,anon,authenticated;
grant all on public.icash_communication_prices to service_role;
