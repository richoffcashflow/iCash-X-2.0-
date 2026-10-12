begin;

-- Keep retained closing history out of the active workspace queue. Filtering
-- after LIMIT would let archived tasks consume slots and distort pagination.
create or replace function public.icash_closing_task_attention(p_account uuid,p_offset integer default 0,p_limit integer default 7)
returns table(id uuid,deal_id uuid,screening_id uuid,kind text,label text,due_date date,state text,evidence text,email_state text,updated_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select t.id,t.deal_id,d.screening_id,t.kind,t.label,t.due_date,t.state,t.evidence,t.email_state,t.updated_at
 from public.icash_title_tasks t
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 join public.icash_screening_jobs p on p.id=d.screening_id and p.account_id=d.account_id and p.state='complete'
 where t.account_id=p_account and d.stage in ('under_contract','buyer_selected','title_open','closing')
 and (t.state='needs_review' or (t.kind='deadline' and t.state='scheduled' and t.due_date<=(now() at time zone 'America/Chicago')::date+2))
 order by t.due_date nulls first,t.created_at,t.id limit least(greatest(p_limit,1),50) offset least(greatest(p_offset,0),60000);
$$;
revoke all on function public.icash_closing_task_attention(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.icash_closing_task_attention(uuid,integer,integer) to service_role;

commit;
