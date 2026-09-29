alter table public.icash_title_tasks add column email_state text not null default 'waiting' check(email_state in ('waiting','issued','dispatching','sent','needs_review'));
alter table public.icash_title_tasks add column email_provider_id text;
alter table public.icash_title_tasks add column email_retry_at timestamptz not null default now();
create index icash_title_tasks_email_due on public.icash_title_tasks(email_retry_at,due_date) where kind='follow_up' and state='scheduled' and email_state in ('waiting','issued');
create table public.icash_title_followup_settings(id integer primary key check(id=1),enabled boolean not null default false);
insert into public.icash_title_followup_settings values(1,false);
alter table public.icash_title_followup_settings enable row level security;
revoke all on public.icash_title_followup_settings from public,anon,authenticated;
grant all on public.icash_title_followup_settings to service_role;
alter table public.icash_automation_tickets drop constraint icash_automation_tickets_kind_check;
alter table public.icash_automation_tickets add constraint icash_automation_tickets_kind_check check(kind in ('discovery','contacts','voice_result','signing_result','voice_dispatch','fulfillment','title_followup'));
alter table public.icash_automation_tickets add column title_task_id uuid references public.icash_title_tasks(id);
alter function public.icash_next_automation() rename to icash_next_before_title_followup;
create function public.icash_next_automation() returns jsonb language plpgsql set search_path='' as $$
declare j public.icash_title_tasks;t public.icash_automation_tickets;
begin
 perform pg_advisory_xact_lock(726341927);
 if exists(select 1 from public.icash_title_followup_settings where id=1 and enabled)
 and not exists(select 1 from public.icash_automation_tickets where kind='title_followup' and created_at>now()-interval '1 minute') then
 select f.* into j from public.icash_title_tasks f
 join public.icash_accounts a on a.id=f.account_id and not a.bot_paused
 join public.icash_deal_files d on d.id=f.deal_id and d.account_id=f.account_id and d.stage in ('under_contract','buyer_selected','title_open','closing')
 where f.kind='follow_up' and f.state='scheduled' and f.due_date<=(now() at time zone 'America/Chicago')::date and f.email_retry_at<=now()
 and (f.email_state='waiting' or (f.email_state='issued' and f.updated_at<now()-interval '15 minutes'))
 order by f.email_retry_at,f.due_date for update of f skip locked limit 1;
 if found then
 update public.icash_title_tasks set email_state='issued',updated_at=now() where id=j.id;
 insert into public.icash_automation_tickets(account_id,kind,title_task_id) values(j.account_id,'title_followup',j.id) returning * into t;
 return jsonb_build_object('token',t.token);
 end if;end if;
 return public.icash_next_before_title_followup();
end $$;
create or replace function public.icash_consume_automation(p_token text) returns jsonb language plpgsql set search_path='' as $$
declare t public.icash_automation_tickets;
begin
 update public.icash_automation_tickets set state='consumed' where token=p_token and state='issued' and expires_at>now() returning * into t;
 if not found then return null;end if;
 return jsonb_build_object('id',t.id,'accountId',t.account_id,'kind',t.kind,'screeningId',t.screening_id,'liveCallId',t.live_call_id,'signingId',t.signing_id,'voiceJobId',t.voice_job_id,'fulfillmentJobId',t.fulfillment_job_id,'titleTaskId',t.title_task_id);
end $$;
create function public.icash_claim_title_followup(p_account uuid,p_task uuid) returns jsonb language plpgsql set search_path='' as $$
declare t public.icash_title_tasks;j public.icash_title_requests;d public.icash_deal_files;prop text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into t from public.icash_title_tasks where id=p_task and account_id=p_account for update;
 if not found or t.kind<>'follow_up' or t.state<>'scheduled' or t.email_state<>'issued' or t.due_date>(now() at time zone 'America/Chicago')::date then return null;end if;
 if not exists(select 1 from public.icash_title_followup_settings where id=1 and enabled) then return null;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;if not found then return null;end if;
 select * into j from public.icash_title_requests where id=t.request_id and account_id=p_account and deal_id=t.deal_id for share;
 if not found or j.state<>'sent' then return null;end if;
 if exists(select 1 from public.icash_title_replies where request_id=j.id and sender_verified) then
 update public.icash_title_tasks set state='cancelled',updated_at=now() where id=t.id;return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account for share;
 if not found or d.stage not in ('under_contract','buyer_selected','title_open','closing') or lower(d.terms->>'titleEmail') is distinct from lower(j.recipient) then return null;end if;
 if j.verified_until<=now() or not exists(select 1 from public.icash_title_contacts where deal_id=d.id and account_id=p_account and email=j.recipient and rate_id=j.rate_id and enabled and verified_until>now()) then return null;end if;
 if not exists(select 1 from public.icash_signing_envelopes where id=j.purchase_envelope_id and account_id=p_account and deal_id=d.id and state='completed' and not test_mode) then return null;end if;
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=d.screening_id and account_id=p_account;
 if prop is null or exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=prop and manual) then return null;end if;
 if not exists(select 1 from public.icash_operation_rates where id=j.rate_id and operation='title_email' and enabled and expires_at>now()) then return null;end if;
 -- Reserve and claim together: a failed admission cannot strand a new reservation.
 perform public.icash_reserve_operation(p_account,'title-followup:'||t.id,j.rate_id,j.verified_until);
 if not public.icash_claim_operation('title-followup:'||t.id) then raise exception 'Follow-up operation already claimed';end if;
 update public.icash_title_tasks set email_state='dispatching',updated_at=now() where id=t.id;
 return jsonb_build_object('requestId',j.id,'recipient',j.recipient,'address',j.property_address);
end $$;
revoke all on function public.icash_next_automation(),public.icash_claim_title_followup(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_next_automation(),public.icash_claim_title_followup(uuid,uuid) to service_role;
