begin;
-- Existing Auth identity grants expose only id/email; session checks need only
-- these three metadata columns, never tokens or credentials.
grant select(id,user_id,not_after) on auth.sessions to service_role;
-- The browser retains its real owner login. These are inspection receipts, not
-- customer Auth sessions, and are never exposed to anon/authenticated roles.
create table icash_private.owner_account_views (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references auth.users(id),
 actor_session_id uuid not null,
 account_id uuid not null references public.icash_accounts(id),
 target_user_id uuid not null references auth.users(id),
 started_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '30 minutes',
 ended_at timestamptz,
 check(actor_id='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'),
 check(expires_at>started_at and expires_at<=started_at+interval '30 minutes')
);
alter table icash_private.owner_account_views enable row level security;
revoke all on icash_private.owner_account_views from public,anon,authenticated;
grant select,insert,update on icash_private.owner_account_views to service_role;
create index owner_account_views_account on icash_private.owner_account_views(account_id,started_at desc);
create index owner_account_views_actor on icash_private.owner_account_views(actor_id,started_at desc);
create index owner_account_views_target on icash_private.owner_account_views(target_user_id);

create function public.icash_owner_accounts(p_actor uuid,p_sort text default 'funded',p_query text default '',p_page integer default 1,p_account uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required' using errcode='42501';end if;
 if p_sort is null or p_sort not in ('funded','leads','newest') or p_query is null or length(p_query)>100 or p_page is null or p_page not between 1 and 100000 then raise exception 'Invalid account filters';end if;
 with accounts as materialized (
  select a.*,u.email,coalesce(nullif(trim(concat_ws(' ',i.first_name,i.last_name)),''),nullif(a.legal_name,''),u.email,'Customer account') name,
   coalesce(w.balance_cents-w.reserved_cents,0) available,coalesce(w.reserved_cents,0) reserved,
   coalesce(f.funded,0) funded,coalesce(l.leads,0) leads
  from public.icash_accounts a join auth.users u on u.id=a.owner_user_id
  left join public.icash_customer_identities i on i.account_id=a.id
  left join public.icash_wallets w on w.account_id=a.id
  left join lateral (select sum(o.credit_cents) funded from public.icash_funding_orders o
   where o.account_id=a.id and o.mode='live' and o.state='paid' and o.credited_at is not null) f on true
  left join lateral (select count(*) leads from public.icash_screening_jobs s where s.account_id=a.id
   and s.state in ('complete','awaiting_address') and coalesce(s.snapshot->>'practice','false')<>'true'
   and coalesce(s.snapshot->>'propertyId','') not like 'practice_%') l on true
  where (p_account is null or a.id=p_account)
   and (not exists(select 1 from public.icash_funding_orders o where o.account_id=a.id and o.mode='test' and o.state='paid')
    or exists(select 1 from public.icash_funding_orders o where o.account_id=a.id and o.mode='live' and o.state='paid')
    or exists(select 1 from public.icash_memberships m where m.account_id=a.id and m.mode='live' and m.paid_through is not null)
    or a.owner_user_id=p_actor)
 ), matching as materialized (
  select * from accounts where trim(p_query)='' or position(lower(trim(p_query)) in lower(name||' '||coalesce(email,'')||' '||id::text))>0
 ), ranked as (
  select *,row_number() over(order by case when p_sort='funded' then funded end desc,
   case when p_sort='leads' then leads end desc,created_at desc,id) ordinal from matching
 ), page_rows as (
  select * from ranked order by ordinal limit 25 offset (p_page-1)*25
 )
 select jsonb_build_object('sort',p_sort,'query',trim(p_query),'page',p_page,'pageSize',25,'total',(select count(*) from matching),
  'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'email',a.email,'ownAccount',a.owner_user_id=p_actor,
   'fundedCents',a.funded,'balanceCents',a.available,'reservedCents',a.reserved,'leadCount',a.leads,
   'paused',a.bot_paused,'assistantName',a.assistant_name,'createdAt',a.created_at,'billingModel',a.billing_model,
   'vip',public.icash_vip_active(a.id),'membership',(
    select jsonb_build_object('state',m.state,'paidThrough',m.paid_through) from public.icash_memberships m
    where m.account_id=a.id and m.mode='live' order by coalesce(m.state='active' and m.paid_through>now(),false) desc,(m.state<>'cancelled') desc,m.created_at desc,m.id desc limit 1)) order by ordinal) from page_rows a),'[]'::jsonb)) into result;
 return result;
end $$;

create function public.icash_owner_account_view_start(p_actor uuid,p_session uuid,p_account uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v icash_private.owner_account_views;target uuid;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
  or not exists(select 1 from auth.sessions where id=p_session and user_id=p_actor and (not_after is null or not_after>now())) then raise exception 'Owner session required' using errcode='42501';end if;
 if jsonb_array_length(public.icash_owner_accounts(p_actor,'funded','',1,p_account)->'accounts')<>1 then raise exception 'Account unavailable';end if;
 select owner_user_id into strict target from public.icash_accounts where id=p_account;
 if target=p_actor then raise exception 'Use your own workspace';end if;
 insert into icash_private.owner_account_views(actor_id,actor_session_id,account_id,target_user_id)
 values(p_actor,p_session,p_account,target) returning * into v;
 return jsonb_build_object('id',v.id,'expiresAt',v.expires_at);
end $$;

create function public.icash_owner_account_view(p_actor uuid,p_session uuid,p_view uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v icash_private.owner_account_views;account jsonb;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
  or not exists(select 1 from auth.sessions where id=p_session and user_id=p_actor and (not_after is null or not_after>now())) then raise exception 'Owner session required' using errcode='42501';end if;
 select r.* into v from icash_private.owner_account_views r join public.icash_accounts a on a.id=r.account_id and a.owner_user_id=r.target_user_id
 where r.id=p_view and r.actor_id=p_actor and r.actor_session_id=p_session and r.ended_at is null and r.expires_at>now();
 if not found then return null;end if;
 account:=public.icash_owner_accounts(p_actor,'funded','',1,v.account_id)->'accounts'->0;
 if account is null then return null;end if;
 return jsonb_build_object('id',v.id,'expiresAt',v.expires_at,'account',account);
end $$;

create function public.icash_owner_account_view_end(p_actor uuid,p_session uuid,p_view uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required' using errcode='42501';end if;
 update icash_private.owner_account_views set ended_at=coalesce(ended_at,now()) where id=p_view and actor_id=p_actor and actor_session_id=p_session;
 return found;
end $$;

create function public.icash_owner_account_leads(p_actor uuid,p_account uuid,p_query text default '',p_page integer default 1)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required' using errcode='42501';end if;
 if p_query is null or length(p_query)>100 or p_page is null or p_page not between 1 and 100000 then raise exception 'Invalid lead filters';end if;
 with leads as materialized (
  select s.id,s.state,s.created_at,coalesce(nullif(s.result->'property'->>'address',''),nullif(s.snapshot->>'address',''),'Address pending') address,
   s.result->'financialCheck'->>'status' financial_status,coalesce(o.responded,false) responded,coalesce(o.interested,false) and not coalesce(o.opted_out,false) interested,
   coalesce(o.opted_out,false) opted_out
  from public.icash_screening_jobs s left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
  where s.account_id=p_account and s.state in ('complete','awaiting_address')
   and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.snapshot->>'propertyId','') not like 'practice_%'
 ), matching as materialized (select * from leads where trim(p_query)='' or position(lower(trim(p_query)) in lower(address))>0),
 page_rows as (select * from matching order by interested desc,responded desc,created_at desc,id limit 12 offset (p_page-1)*12)
 select jsonb_build_object('page',p_page,'pageSize',12,'query',trim(p_query),'total',(select count(*) from matching),
  'leads',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'address',p.address,'state',p.state,'financialStatus',p.financial_status,
   'responded',p.responded,'interested',p.interested,'optedOut',p.opted_out,'createdAt',p.created_at,
   'dealId',(select d.id from public.icash_deal_files d where d.account_id=p_account and d.screening_id=p.id order by d.created_at desc,d.id limit 1))
   order by p.interested desc,p.responded desc,p.created_at desc,p.id) from page_rows p),'[]'::jsonb)) into result;
 return result;
end $$;

revoke all on function public.icash_owner_accounts(uuid,text,text,integer,uuid),public.icash_owner_account_view_start(uuid,uuid,uuid),public.icash_owner_account_view(uuid,uuid,uuid),public.icash_owner_account_view_end(uuid,uuid,uuid),public.icash_owner_account_leads(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.icash_owner_accounts(uuid,text,text,integer,uuid),public.icash_owner_account_view_start(uuid,uuid,uuid),public.icash_owner_account_view(uuid,uuid,uuid),public.icash_owner_account_view_end(uuid,uuid,uuid),public.icash_owner_account_leads(uuid,uuid,text,integer) to service_role;
commit;
