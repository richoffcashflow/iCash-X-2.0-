-- A durable request is not an appointment and never grants calling permission.
create table public.icash_sms_call_requests(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 thread_id uuid not null references public.icash_text_threads(id),deal_id uuid not null references public.icash_deal_files(id),
 screening_id uuid not null references public.icash_screening_jobs(id),message_id uuid not null unique references public.icash_text_messages(id),
 state text not null default 'needs_review' check(state in ('needs_review','canceled','resolved')),
 requested_at timestamptz not null,updated_at timestamptz not null default now()
);
create unique index icash_one_open_sms_call_request on public.icash_sms_call_requests(thread_id) where state='needs_review';
create index icash_sms_call_requests_account on public.icash_sms_call_requests(account_id,screening_id,requested_at desc);
alter table public.icash_sms_call_requests enable row level security;
revoke all on public.icash_sms_call_requests from public,anon,authenticated;
grant all on public.icash_sms_call_requests to service_role;
create function public.icash_capture_sms_call_request() returns trigger language plpgsql set search_path='' as $$
declare t public.icash_text_threads;d public.icash_deal_files;
begin
 if new.direction<>'incoming' or new.state<>'received' or new.thread_id is null then return new;end if;
 select * into t from public.icash_text_threads where id=new.thread_id and account_id=new.account_id for update;
 if not found or t.party<>'seller' then return new;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=t.account_id;
 if not found or d.screening_id is null or d.stage in ('closed','cancelled') or coalesce(d.terms->>'practice','false')='true' then return new;end if;
 if new.body ~* '(^\s*(stop|unsubscribe|cancel|end|quit)\s*$|don''t call|do not call|cancel (the |my )?call)' then
  update public.icash_sms_call_requests set state='canceled',updated_at=now() where thread_id=t.id and account_id=t.account_id and state='needs_review';
  return new;
 end if;
 if new.body !~* '\m(call me|call back|callback)\M' or new.body ~* '\m(no|not|never|don''t|do not)\M' then return new;end if;
 insert into public.icash_sms_call_requests(account_id,thread_id,deal_id,screening_id,message_id,requested_at)
 values(t.account_id,t.id,d.id,d.screening_id,new.id,new.created_at)
 on conflict(thread_id) where state='needs_review' do update set message_id=excluded.message_id,requested_at=excluded.requested_at,updated_at=now();
 return new;
end $$;
create trigger icash_capture_sms_call_request after insert on public.icash_text_messages for each row execute function public.icash_capture_sms_call_request();
revoke all on function public.icash_capture_sms_call_request() from public,anon,authenticated;
grant execute on function public.icash_capture_sms_call_request() to service_role;
