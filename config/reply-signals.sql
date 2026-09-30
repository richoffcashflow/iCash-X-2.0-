-- Service-only, event-backed requests. No signature, deposit or appointment is inferred.
create table public.icash_text_attention (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.icash_accounts(id),
 thread_id uuid not null references public.icash_text_threads(id), deal_id uuid not null references public.icash_deal_files(id),
 screening_id uuid not null references public.icash_screening_jobs(id), message_id uuid not null references public.icash_text_messages(id),
 kind text not null check(kind in ('declined','human','callback','withdrawal')), party text not null,
 quote text not null, timezone text not null, state text not null default 'open' check(state in ('open','acknowledged')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(thread_id,kind)
);
create index icash_text_attention_queue on public.icash_text_attention(account_id,state,created_at);
alter table public.icash_text_attention enable row level security;
revoke all on public.icash_text_attention from public,anon,authenticated;
grant all on public.icash_text_attention to service_role;
create function public.icash_text_signal(p_body text,p_party text) returns text language sql immutable set search_path='' as $$
 select case
 when lower(p_body) ~ '(backing out|back out|withdraw from|cancel (the |my |our )?(deal|contract|purchase|agreement)|can(''|’)t (close|buy)|cannot (close|buy)|not (going to|able to) (close|buy))' then 'withdrawal'
 when lower(p_body) ~ '(real person|speak to someone|talk to someone|speak to a person|talk to a person|\mhuman\M)' then 'human'
 when lower(p_body) ~ '(call me|call back|callback|call tomorrow|call today|can you call|could you call)' and lower(p_body) !~ '(don(''|’)t|do not|never|cancel|stop)' then 'callback'
 when lower(trim(p_body)) ~ '^(no thanks|no thank you|not interested|i(''|’)m not interested|i am not interested|not selling|i(''|’)m not selling|i am not selling|wrong number)([.! ,]|$)' then 'declined'
 else null end;
$$;
create function public.icash_capture_text_signal() returns trigger language plpgsql set search_path='' as $$
declare t public.icash_text_threads;d public.icash_deal_files;k text;prop text;
begin
 if new.direction<>'incoming' or new.state<>'received' or new.thread_id is null or new.account_id is null then return new;end if;
 select * into t from public.icash_text_threads where id=new.thread_id and account_id=new.account_id for update;
 if not found or t.party not in ('seller','buyer') then return new;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=t.account_id;
 if not found or d.screening_id is null or coalesce(d.terms->>'practice','false')='true' then return new;end if;
 k:=public.icash_text_signal(new.body,t.party);
 if k is null then return new;end if;
 update public.icash_text_threads set paused=true where id=t.id;
 update public.icash_text_messages set state='cancelled',updated_at=now() where thread_id=t.id and direction='outgoing' and state='ready';
 update public.icash_text_ai_jobs set state='superseded',updated_at=now() where thread_id=t.id and state in ('pending','issued','drafted');
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=d.screening_id and account_id=t.account_id;
 if prop is not null then
 insert into public.icash_property_controls(account_id,property_id,manual) values(t.account_id,prop,true)
 on conflict(account_id,property_id) do update set manual=true,updated_at=now();
 end if;
 insert into public.icash_text_attention(account_id,thread_id,deal_id,screening_id,message_id,kind,party,quote,timezone)
 values(t.account_id,t.id,d.id,d.screening_id,new.id,k,t.party,left(new.body,1000),t.timezone)
 on conflict(thread_id,kind) do update set message_id=excluded.message_id,quote=excluded.quote,timezone=excluded.timezone,state='open',updated_at=now();
 return new;
end $$;
-- Runs before the existing enqueue trigger, within the same transaction.
create trigger icash_00_capture_text_signal after insert on public.icash_text_messages for each row execute function public.icash_capture_text_signal();
revoke all on function public.icash_text_signal(text,text),public.icash_capture_text_signal() from public,anon,authenticated;
grant execute on function public.icash_text_signal(text,text),public.icash_capture_text_signal() to service_role;
-- Preserve deployed functions, and fail rather than silently patch an unknown version.
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_enqueue_text_ai()'::regprocedure);
 needle:=' if new.direction<>''incoming'' or new.account_id is null or new.thread_id is null then return new;end if;';
 if position(needle in d)=0 then raise exception 'Unexpected text enqueue definition';end if;
 d:=replace(d,needle,needle||E'\n if exists(select 1 from public.icash_text_threads where id=new.thread_id and account_id=new.account_id and paused) then return new;end if;');execute d;
 d:=pg_get_functiondef('public.icash_ingest_text_event(jsonb,boolean)'::regprocedure);
 needle:='body,attachments,state,event_id) values(t.id,t.account_id,''incoming'',coalesce(v->>''body'',''''),coalesce(v->''attachments'',''[]''),''received'',p_event->>''id'') on conflict(event_id) do nothing';
 if position(needle in d)=0 then raise exception 'Unexpected incoming dedup definition';end if;
 d:=replace(d,needle,'body,attachments,state,event_id,provider_id) values(t.id,t.account_id,''incoming'',coalesce(v->>''body'',''''),coalesce(v->''attachments'',''[]''),''received'',p_event->>''id'',nullif(v->>''message_id'','''')) on conflict do nothing');execute d;
 d:=pg_get_functiondef('public.icash_prioritized_work(uuid,integer)'::regprocedure);
 needle:='order by case';
 if position(needle in d)=0 then raise exception 'Unexpected priority definition';end if;
 d:=replace(d,needle,needle||E'\n when exists(select 1 from public.icash_text_attention a where a.account_id=p_account and a.screening_id=s.id and a.state=''open'') then 0');execute d;
end $patch$;
