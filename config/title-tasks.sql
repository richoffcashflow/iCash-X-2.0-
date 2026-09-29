create table public.icash_title_tasks (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),deal_id uuid not null references public.icash_deal_files(id),
 request_id uuid not null references public.icash_title_requests(id),reply_id uuid references public.icash_title_replies(id),
 source_key text not null unique,kind text not null check(kind in ('follow_up','reply_review','deadline')),
 label text not null,due_date date,state text not null check(state in ('scheduled','needs_review','done','dismissed','cancelled')),
 evidence text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index icash_title_tasks_active on public.icash_title_tasks(account_id,deal_id,state,due_date);
alter table public.icash_title_tasks enable row level security;
revoke all on public.icash_title_tasks from public,anon,authenticated;
grant all on public.icash_title_tasks to service_role;
create function public.icash_title_followup_trigger() returns trigger language plpgsql set search_path='' as $$
declare due date;days integer:=0;
begin
 if new.state<>'sent' then return new;end if;
 if exists(select 1 from public.icash_title_replies where request_id=new.id and sender_verified) then return new;end if;
 due:=(now() at time zone 'America/Chicago')::date;
 while days<2 loop due:=due+1;if extract(isodow from due)<6 then days:=days+1;end if;end loop;
 insert into public.icash_title_tasks(account_id,deal_id,request_id,source_key,kind,label,due_date,state)
 values(new.account_id,new.deal_id,new.id,'follow-up:'||new.id,'follow_up','Check with the title office',due,'scheduled') on conflict(source_key) do nothing;
 return new;
end $$;
create trigger icash_title_followup after insert or update of state on public.icash_title_requests for each row execute function public.icash_title_followup_trigger();
create function public.icash_title_reply_tasks_trigger() returns trigger language plpgsql set search_path='' as $$
declare line text;hit text[];due date;count_dates integer:=0;
begin
 if not new.sender_verified or new.account_id is null or new.deal_id is null or new.request_id is null then return new;end if;
 if not exists(select 1 from public.icash_deal_files where id=new.deal_id and account_id=new.account_id and stage in ('under_contract','buyer_selected','title_open','closing')) then return new;end if;
 update public.icash_title_tasks set state='cancelled',updated_at=now() where request_id=new.request_id and kind='follow_up' and state='scheduled';
 insert into public.icash_title_tasks(account_id,deal_id,request_id,reply_id,source_key,kind,label,state,evidence)
 values(new.account_id,new.deal_id,new.request_id,new.id,'review:'||new.id,'reply_review','Review the title office’s reply','needs_review',left(new.body_text,1000)) on conflict(source_key) do nothing;
 -- Date suggestions are review-only. Quoted history and signatures are not interpreted.
 foreach line in array regexp_split_to_array(new.body_text,E'\n') loop
 exit when line ~* '^\s*(>|On .+wrote:|From:|--\s*$|_{5,})';
 continue when line !~* '(deadline|due|closing|expires|expiration)';
 for hit in select regexp_matches(line,'\m([0-9]{4}-[0-9]{2}-[0-9]{2})\M','g') loop
 begin due:=hit[1]::date;exception when others then continue;end;
 continue when due < (now() at time zone 'America/Chicago')::date-30 or due > (now() at time zone 'America/Chicago')::date+730;
 insert into public.icash_title_tasks(account_id,deal_id,request_id,reply_id,source_key,kind,label,due_date,state,evidence)
 values(new.account_id,new.deal_id,new.request_id,new.id,'deadline:'||new.id||':'||due,'deadline','Confirm a date mentioned by title',due,'needs_review',left(line,1000)) on conflict(source_key) do nothing;
 count_dates:=count_dates+1;exit when count_dates>=5;
 end loop;
 exit when count_dates>=5;
 end loop;
 return new;
end $$;
create trigger icash_title_reply_tasks after insert on public.icash_title_replies for each row execute function public.icash_title_reply_tasks_trigger();
create function public.icash_update_title_task(p_account uuid,p_task uuid,p_action text,p_due date default null) returns boolean language plpgsql set search_path='' as $$
declare t public.icash_title_tasks;
begin
 select * into t from public.icash_title_tasks where id=p_task and account_id=p_account for update;
 if not found or t.state not in ('scheduled','needs_review') then return false;end if;
 if not exists(select 1 from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage in ('under_contract','buyer_selected','title_open','closing')) then return false;end if;
 if p_action='confirm' and t.kind='deadline' and p_due is not null and p_due between current_date-30 and current_date+730 then
 update public.icash_title_tasks set due_date=p_due,state='scheduled',updated_at=now() where id=t.id;
 elsif p_action in ('done','dismissed') then
 update public.icash_title_tasks set state=p_action,updated_at=now() where id=t.id;
 if t.kind='reply_review' then update public.icash_title_replies set needs_review=false where id=t.reply_id and account_id=p_account;end if;
 else return false;end if;
 return true;
end $$;
create function public.icash_cancel_title_tasks_trigger() returns trigger language plpgsql set search_path='' as $$
begin
 if new.stage not in ('under_contract','buyer_selected','title_open','closing') then
 update public.icash_title_tasks set state='cancelled',updated_at=now() where deal_id=new.id and account_id=new.account_id and state in ('scheduled','needs_review');
 end if;return new;
end $$;
create trigger icash_cancel_title_tasks after update of stage on public.icash_deal_files for each row execute function public.icash_cancel_title_tasks_trigger();
revoke all on function public.icash_title_followup_trigger(),public.icash_title_reply_tasks_trigger(),public.icash_cancel_title_tasks_trigger(),public.icash_update_title_task(uuid,uuid,text,date) from public,anon,authenticated;
grant execute on function public.icash_title_followup_trigger(),public.icash_title_reply_tasks_trigger(),public.icash_cancel_title_tasks_trigger(),public.icash_update_title_task(uuid,uuid,text,date) to service_role;
