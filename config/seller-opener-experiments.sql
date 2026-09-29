-- Internal experiment records. Allocation alone is not delivery or a reply.
create table public.icash_seller_opener_variants(
 key text primary key,body text not null check(length(body) between 10 and 160),enabled boolean not null default true
);
insert into public.icash_seller_opener_variants(key,body) values
 ('direct','Would you consider a cash offer for your property?'),
 ('timing','Would you be open to a cash offer if the price and timing worked for you?');
create table public.icash_seller_opener_assignments(
 thread_id uuid primary key references public.icash_text_threads(id),account_id uuid not null references public.icash_accounts(id),
 variant text not null references public.icash_seller_opener_variants(key),body text not null,
 created_at timestamptz not null default now(),message_id uuid unique references public.icash_text_messages(id),
 delivered_at timestamptz,first_reply_at timestamptz,opted_out boolean not null default false
);
alter table public.icash_seller_opener_variants enable row level security;
alter table public.icash_seller_opener_assignments enable row level security;
revoke all on public.icash_seller_opener_variants,public.icash_seller_opener_assignments from public,anon,authenticated;
grant all on public.icash_seller_opener_variants,public.icash_seller_opener_assignments to service_role;
create function public.icash_assign_seller_opener(p_account uuid,p_thread uuid) returns jsonb language plpgsql set search_path='' as $$
declare existing public.icash_seller_opener_assignments;chosen public.icash_seller_opener_variants;
begin
 perform 1 from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' for update;
 if not found then return null;end if;
 select * into existing from public.icash_seller_opener_assignments where thread_id=p_thread;
 if found then return jsonb_build_object('variant',existing.variant,'body',existing.body);end if;
 -- Balanced exploration until BOTH variants have 100 delivered messages at least 72 hours old.
 -- 20% exploration thereafter. Replies are not claims of interest or successful contracts.
 if random()>=0.2 and (select count(*) from public.icash_seller_opener_variants where enabled)=2 and
 (select count(*) from (select v.key from public.icash_seller_opener_variants v join public.icash_seller_opener_assignments a on a.variant=v.key and a.account_id=p_account where v.enabled and a.delivered_at<now()-interval '72 hours' group by v.key having count(*)>=100) x)=2 then
 select v.* into chosen from public.icash_seller_opener_variants v join public.icash_seller_opener_assignments a on a.variant=v.key and a.account_id=p_account
 where v.enabled and a.delivered_at<now()-interval '72 hours'
 group by v.key order by (count(*) filter(where a.first_reply_at<=a.delivered_at+interval '72 hours' and not a.opted_out)+1.0)/(count(*)+2.0) desc,v.key limit 1;
 else
 select * into chosen from public.icash_seller_opener_variants where enabled order by random() limit 1;
 end if;
 if chosen.key is null then return null;end if;
 insert into public.icash_seller_opener_assignments(thread_id,account_id,variant,body) values(p_thread,p_account,chosen.key,chosen.body);
 return jsonb_build_object('variant',chosen.key,'body',chosen.body);
end $$;
create function public.icash_observe_seller_opener() returns trigger language plpgsql set search_path='' as $$
begin
 if new.direction='outgoing' then
 update public.icash_seller_opener_assignments set message_id=new.id,delivered_at=case when new.state='delivered' then coalesce(delivered_at,now()) else delivered_at end
 where thread_id=new.thread_id and account_id=new.account_id and body=new.body and (message_id is null or message_id=new.id);
 elsif new.direction='incoming' then
 update public.icash_seller_opener_assignments set first_reply_at=coalesce(first_reply_at,new.created_at),opted_out=opted_out or new.body ~* '(^\s*(stop|unsubscribe|cancel|end|quit)\s*$|do not (text|contact)|don''t (text|contact)|not interested)'
 where thread_id=new.thread_id and account_id=new.account_id and delivered_at is not null and new.created_at>=delivered_at;
 end if;
 return new;
end $$;
create trigger icash_seller_opener_observation after insert or update of state on public.icash_text_messages for each row execute function public.icash_observe_seller_opener();
revoke all on function public.icash_assign_seller_opener(uuid,uuid),public.icash_observe_seller_opener() from public,anon,authenticated;
grant execute on function public.icash_assign_seller_opener(uuid,uuid),public.icash_observe_seller_opener() to service_role;
create function public.icash_queue_seller_opener(p_account uuid,p_thread uuid) returns uuid language plpgsql set search_path='' as $$
declare choice jsonb;outgoing uuid;
begin
 perform 1 from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' and not paused and ai_mode='auto' and permission_until>now() for update;
 if not found or exists(select 1 from public.icash_text_messages where thread_id=p_thread) then return null;end if;
 choice:=public.icash_assign_seller_opener(p_account,p_thread);
 if choice is null then return null;end if;
 update public.icash_seller_opener_assignments set body='I am the AI assistant for this property inquiry. '||(choice->>'body') where thread_id=p_thread and message_id is null;
 outgoing:=public.icash_queue_text(p_account,p_thread,p_thread,'I am the AI assistant for this property inquiry. '||(choice->>'body'),'{}');
 return outgoing;
end $$;
revoke all on function public.icash_queue_seller_opener(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_queue_seller_opener(uuid,uuid) to service_role;
alter table public.icash_automation_tickets add column opener_message_id uuid references public.icash_text_messages(id);
alter table public.icash_automation_tickets drop constraint icash_automation_tickets_kind_check;
alter table public.icash_automation_tickets add constraint icash_automation_tickets_kind_check check(kind in ('discovery','contacts','voice_result','signing_result','voice_dispatch','fulfillment','title_followup','text_ai','market_research','seller_opener'));
alter function public.icash_next_automation() rename to icash_next_before_seller_openers;
create function public.icash_next_automation() returns jsonb language plpgsql set search_path='' as $$
declare prior jsonb;thread public.icash_text_threads;message uuid;ticket public.icash_automation_tickets;
begin
 perform pg_advisory_xact_lock(726341927);
 prior:=public.icash_next_before_seller_openers();
 if prior->>'token' is not null then return prior;end if;
 if not exists(select 1 from public.icash_operating_budget where id=1 and enabled) then return prior;end if;
 if exists(select 1 from public.icash_automation_tickets where kind='seller_opener' and created_at>now()-interval '1 minute') then return prior;end if;
 select t.* into thread from public.icash_text_threads t
 join public.icash_accounts a on a.id=t.account_id and not a.bot_paused
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true'
 join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=t.account_id and s.state='complete' and s.result->'financialCheck'->>'status'='eligible' and s.completed_at>now()-interval '24 hours'
 join pg_timezone_names zone on zone.name=t.timezone
 where t.party='seller' and not t.paused and t.ai_mode='auto' and t.permission_until>now()
 and extract(hour from now() at time zone zone.name) between 9 and 19
 and not exists(select 1 from public.icash_text_messages m where m.thread_id=t.id)
 and not exists(select 1 from public.icash_text_suppressions x where x.phone=t.recipient)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=a.id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
 order by t.id for update of t skip locked limit 1;
 if not found then return prior;end if;
 message:=public.icash_queue_seller_opener(thread.account_id,thread.id);
 if message is null then return prior;end if;
 insert into public.icash_automation_tickets(account_id,kind,opener_message_id) values(thread.account_id,'seller_opener',message) returning * into ticket;
 return jsonb_build_object('token',ticket.token);
end $$;
revoke all on function public.icash_next_automation() from public,anon,authenticated;
grant execute on function public.icash_next_automation() to service_role;
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.icash_consume_automation(text)'::regprocedure);
 if position('''marketResearchJobId'',t.market_research_job_id' in definition)=0 then raise exception 'Ticket consumer changed';end if;
 execute replace(definition,'''marketResearchJobId'',t.market_research_job_id','''marketResearchJobId'',t.market_research_job_id,''openerMessageId'',t.opener_message_id');
end $$;
