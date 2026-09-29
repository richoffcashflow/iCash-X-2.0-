alter table public.icash_operation_rates add column voice_max_duration_seconds integer check(voice_max_duration_seconds between 60 and 900);
-- Production voice is opt-in; these records cannot be written by customers or the LLM.
create table public.icash_voice_configs (
 account_id uuid primary key references public.icash_accounts(id),enabled boolean not null default false,
 agent_id text not null check(agent_id ~ '^agent_[A-Za-z0-9]+$'),phone_number_id text not null,
 agent_config_hash text not null check(agent_config_hash ~ '^[a-f0-9]{64}$'),reviewed_until timestamptz not null,
 seller_rate_id uuid not null references public.icash_operation_rates(id),buyer_rate_id uuid references public.icash_operation_rates(id),
 max_duration_seconds integer not null default 600 check(max_duration_seconds between 60 and 900),
 required_tool_ids text[] not null check(cardinality(required_tool_ids)>=2)
);
create table public.icash_contact_permissions (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),screening_id uuid not null references public.icash_screening_jobs(id),
 party text not null check(party in ('seller','buyer')),phone text not null check(phone ~ '^\+1[2-9][0-9]{9}$'),contact_key text not null check(contact_key ~ '^[a-f0-9]{64}$'),
 timezone text not null,local_start_hour integer not null default 9 check(local_start_hour between 9 and 19),local_end_hour integer not null default 20 check(local_end_hour between 10 and 20),
 permission_evidence text not null check(length(permission_evidence)>10),permission_until timestamptz not null,
 dnc_checked_at timestamptz not null,dnc_clear boolean not null default false,revoked_at timestamptz,
 unique(account_id,screening_id,party,contact_key),check(local_start_hour<local_end_hour)
);
create table public.icash_voice_jobs (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),permission_id uuid not null references public.icash_contact_permissions(id),
 callback_id uuid unique references public.icash_live_callbacks(id),due_at timestamptz not null default now(),
 state text not null default 'ready' check(state in ('ready','issued','dispatching','dispatched','held','canceled')),
 outcome text,operation_key text unique,conversation_id text,provider_call_sid text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index icash_voice_first_once on public.icash_voice_jobs(permission_id) where callback_id is null;
create index icash_voice_due on public.icash_voice_jobs(due_at) where state='ready';
create table public.icash_offer_authorities (
 account_id uuid not null references public.icash_accounts(id),screening_id uuid not null references public.icash_screening_jobs(id),
 max_offer_cents bigint not null check(max_offer_cents>0),reviewed_evidence text not null check(length(reviewed_evidence)>10),expires_at timestamptz not null,
 primary key(account_id,screening_id)
);
alter table public.icash_voice_configs enable row level security;
alter table public.icash_contact_permissions enable row level security;
alter table public.icash_voice_jobs enable row level security;
alter table public.icash_offer_authorities enable row level security;
revoke all on public.icash_voice_configs,public.icash_contact_permissions,public.icash_voice_jobs,public.icash_offer_authorities from public,anon,authenticated;
grant all on public.icash_voice_configs,public.icash_contact_permissions,public.icash_voice_jobs,public.icash_offer_authorities to service_role;
create function public.icash_queue_voice_jobs() returns void language plpgsql set search_path='' as $$
begin
 insert into public.icash_voice_jobs(account_id,permission_id)
 select p.account_id,p.id from public.icash_contact_permissions p join public.icash_voice_configs c on c.account_id=p.account_id and c.enabled join public.icash_accounts a on a.id=p.account_id and not a.bot_paused join public.icash_screening_jobs s on s.id=p.screening_id and s.account_id=p.account_id and s.state='complete'
 where p.revoked_at is null and p.permission_until>now() and p.dnc_clear and s.result->'financialCheck'->>'status'='eligible' and p.party='seller'
 and not exists(select 1 from public.icash_voice_jobs v where v.permission_id=p.id and v.callback_id is null) limit 100
 on conflict do nothing;
 insert into public.icash_voice_jobs(account_id,permission_id,callback_id,due_at)
 select b.account_id,p.id,b.id,b.due_at from public.icash_live_callbacks b join public.icash_live_conversations c on c.id=b.conversation_id join public.icash_contact_permissions p on p.account_id=b.account_id and p.screening_id=b.screening_id and p.contact_key=c.contact_key and p.party=c.party
 where c.state='complete' and (c.result->>'callbackDueAt')::timestamptz=b.due_at and b.state='pending_dispatch_review' and b.due_at>now()-interval '15 minutes' and p.revoked_at is null and p.permission_until>b.due_at and not exists(select 1 from public.icash_voice_jobs v where v.callback_id=b.id) limit 100 on conflict do nothing;
 update public.icash_voice_jobs set state='held',outcome='Callback time passed; review required' where state='ready' and callback_id is not null and due_at<now()-interval '15 minutes';
 update public.icash_live_callbacks b set state='missed' where state='pending_dispatch_review' and due_at<now()-interval '15 minutes';
 -- An expired one-use ticket may be issued again only before provider dispatch was claimed.
 update public.icash_voice_jobs set state='ready' where state='issued' and updated_at<now()-interval '5 minutes';
end $$;
create function public.icash_claim_voice_job(p_job uuid) returns boolean language plpgsql set search_path='' as $$
declare j public.icash_voice_jobs;p public.icash_contact_permissions;c public.icash_voice_configs;prop text;h integer;
begin
 -- Match the ledger lock order so Stop and spending claims serialize.
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job for update;
 if not found or j.state<>'issued' or j.due_at>now() then return false;end if;
 select * into p from public.icash_contact_permissions where id=j.permission_id and account_id=j.account_id for share;
 select * into c from public.icash_voice_configs where account_id=j.account_id for share;
 if p.id is null or not c.enabled or c.reviewed_until<=now() or p.revoked_at is not null or p.permission_until<=now() or not p.dnc_clear or p.dnc_checked_at>now() or p.dnc_checked_at<now()-interval '30 days' then return false;end if;
 if not exists(select 1 from pg_timezone_names where name=p.timezone) then return false;end if;
 h:=extract(hour from now() at time zone p.timezone);
 if h<p.local_start_hour or h>=p.local_end_hour then return false;end if;
 perform 1 from public.icash_accounts where id=j.account_id and not bot_paused for update;if not found then return false;end if;
 if not exists(select 1 from public.icash_wallets where account_id=j.account_id and balance_cents>=reserved_cents and reserved_cents>0) then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(p.contact_key,17));
 if exists(select 1 from public.icash_contact_suppressions where contact_key=p.contact_key) then return false;end if;
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=p.screening_id and account_id=j.account_id and state='complete';
 if prop is null or exists(select 1 from public.icash_property_controls where account_id=j.account_id and property_id=prop and manual) then return false;end if;
 if j.callback_id is not null and not exists(select 1 from public.icash_live_callbacks where id=j.callback_id and account_id=j.account_id and state='pending_dispatch_review' and due_at between now()-interval '15 minutes' and now()) then return false;end if;
 -- Serialize per account and contact. Uncertain dispatches remain held, never auto-retried.
 if exists(select 1 from public.icash_voice_jobs v join public.icash_contact_permissions x on x.id=v.permission_id where v.id<>j.id and (v.state='dispatching' or (v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))) and (v.account_id=j.account_id or x.contact_key=p.contact_key)) then return false;end if;
 if exists(select 1 from public.icash_live_conversations where state in ('waiting','review') and (account_id=j.account_id or contact_key=p.contact_key)) then return false;end if;
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id where o.operation_key='voice:'||j.id and o.account_id=j.account_id and o.rate_id=c.seller_rate_id and r.operation='seller_call' and r.voice_max_duration_seconds>=c.max_duration_seconds) then return false;end if;
 if not public.icash_claim_operation('voice:'||j.id) then return false;end if;
 update public.icash_voice_jobs set state='dispatching',updated_at=now(),operation_key='voice:'||id where id=j.id;
 return true;
end $$;
create function public.icash_live_callback_tool(p_hash text,p_conversation text,p_due timestamptz,p_timezone text,p_readback text,p_confirmation text) returns jsonb language plpgsql set search_path='' as $$
declare c public.icash_live_conversations;result uuid;
begin
 select * into c from public.icash_live_conversations where tool_token_hash=p_hash and conversation_id=p_conversation and tool_expires_at>now() and state='waiting' for update;
 if not found or p_due<=now() or p_due>now()+interval '90 days' or not exists(select 1 from pg_timezone_names where name=p_timezone) or length(p_readback)<10 or length(p_confirmation)<2 then raise exception 'Callback not confirmed';end if;
 if exists(select 1 from public.icash_contact_suppressions where account_id=c.account_id and contact_key=c.contact_key) or exists(select 1 from public.icash_handoffs where conversation_id=c.id and state<>'resolved') then raise exception 'Contact held';end if;
 insert into public.icash_live_callbacks(conversation_id,account_id,screening_id,due_at,timezone,evidence)
 values(c.id,c.account_id,c.screening_id,p_due,p_timezone,jsonb_build_object('readback',p_readback,'confirmation',p_confirmation,'source','live_tool_pending_transcript_verification'))
 on conflict(conversation_id) do update set due_at=excluded.due_at,timezone=excluded.timezone,evidence=excluded.evidence,state='pending_dispatch_review' where icash_live_callbacks.state in ('pending_dispatch_review','held_for_human') returning id into result;
 if result is null then raise exception 'Callback already handled';end if;
 return jsonb_build_object('saved',true,'callbackId',result,'dueAt',p_due,'timezone',p_timezone,'instruction','Callback request saved; it remains subject to contact permission and operating availability.');
end $$;
create table public.icash_voice_scheduler(id integer primary key check(id=1),last_dispatch_at timestamptz);
insert into public.icash_voice_scheduler(id) values(1);
alter table public.icash_voice_scheduler enable row level security;
revoke all on public.icash_voice_scheduler from public,anon,authenticated;
grant all on public.icash_voice_scheduler to service_role;
alter function public.icash_next_automation() rename to icash_next_before_voice_dispatch;
alter table public.icash_automation_tickets drop constraint icash_automation_tickets_kind_check;
alter table public.icash_automation_tickets add constraint icash_automation_tickets_kind_check check(kind in ('discovery','contacts','voice_result','signing_result','voice_dispatch'));
alter table public.icash_automation_tickets add column voice_job_id uuid references public.icash_voice_jobs(id);
create function public.icash_next_automation() returns jsonb language plpgsql set search_path='' as $$
declare j public.icash_voice_jobs;t public.icash_automation_tickets;last_voice timestamptz;
begin
 perform public.icash_queue_voice_jobs();
 select last_dispatch_at into last_voice from public.icash_voice_scheduler where id=1 for update;
 if (last_voice is null or last_voice<now()-interval '30 seconds') and exists(select 1 from public.icash_operating_budget where id=1 and enabled) then
 select v.* into j from public.icash_voice_jobs v join public.icash_accounts a on a.id=v.account_id and not a.bot_paused join public.icash_voice_configs c on c.account_id=a.id and c.enabled
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
 where v.state='ready' and v.due_at<=now() order by v.due_at for update of v skip locked limit 1;
 if found then
 update public.icash_voice_scheduler set last_dispatch_at=now() where id=1;
 update public.icash_voice_jobs set state='issued',updated_at=now() where id=j.id;
 insert into public.icash_automation_tickets(account_id,kind,voice_job_id) values(j.account_id,'voice_dispatch',j.id) returning * into t;return jsonb_build_object('token',t.token);
 end if;end if;
 return public.icash_next_before_voice_dispatch();
end $$;
create or replace function public.icash_consume_automation(p_token text) returns jsonb language plpgsql set search_path='' as $$
declare t public.icash_automation_tickets;
begin
 update public.icash_automation_tickets set state='consumed' where token=p_token and state='issued' and expires_at>now() returning * into t;
 if not found then return null;end if;
 return jsonb_build_object('id',t.id,'accountId',t.account_id,'kind',t.kind,'screeningId',t.screening_id,'liveCallId',t.live_call_id,'signingId',t.signing_id,'voiceJobId',t.voice_job_id);
end $$;
revoke all on function public.icash_queue_voice_jobs(),public.icash_claim_voice_job(uuid),public.icash_live_callback_tool(text,text,timestamptz,text,text,text),public.icash_next_automation() from public,anon,authenticated;
grant execute on function public.icash_queue_voice_jobs(),public.icash_claim_voice_job(uuid),public.icash_live_callback_tool(text,text,timestamptz,text,text,text),public.icash_next_automation() to service_role;
