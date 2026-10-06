begin;
create table public.icash_workspace_questions (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.icash_accounts(id),
 request_id uuid not null,
 question text not null check(length(question) between 1 and 1500),
 state text not null default 'pending' check(state in ('pending','complete','error')),
 answer jsonb,
 context_snapshot jsonb,
 model text,
 provider_id text,
 token_usage jsonb,
 estimated_cost_cents numeric,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 unique(account_id,request_id)
);
create index icash_workspace_questions_history on public.icash_workspace_questions(account_id,created_at desc,id);
alter table public.icash_workspace_questions enable row level security;
revoke all on public.icash_workspace_questions from public,anon,authenticated;
grant select,insert,update on public.icash_workspace_questions to service_role;

create function public.icash_begin_workspace_question(p_account uuid,p_user uuid,p_request uuid,p_question text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q public.icash_workspace_questions; fresh boolean;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account mismatch'; end if;
 if p_question is null or length(trim(p_question)) not between 1 and 1500 or p_request is null then raise exception 'Invalid question';end if;
 insert into public.icash_workspace_questions(account_id,request_id,question)
 values(p_account,p_request,p_question) on conflict(account_id,request_id) do nothing returning * into q;
 fresh=found;
 if not fresh then select * into q from public.icash_workspace_questions where account_id=p_account and request_id=p_request;end if;
 if q.question<>p_question then raise exception 'Request mismatch';end if;
 return jsonb_build_object('id',q.id,'fresh',fresh,'state',q.state,'answer',q.answer,'createdAt',q.created_at);
end $$;
revoke all on function public.icash_begin_workspace_question(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_begin_workspace_question(uuid,uuid,uuid,text) to service_role;
commit;
