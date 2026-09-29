create table public.icash_title_replies (
 id uuid primary key default gen_random_uuid(), provider_email_id uuid not null unique,
 account_id uuid references public.icash_accounts(id),deal_id uuid references public.icash_deal_files(id),
 request_id uuid references public.icash_title_requests(id),qualification_id uuid references public.icash_title_qualification_jobs(id),
 sender text not null,subject text not null,body_text text not null,
 sender_verified boolean not null default false,needs_review boolean not null default true,
 received_at timestamptz not null default now(),
 check(length(sender)<=320 and length(subject)<=500 and length(body_text)<=20000)
);
create index icash_title_replies_account_deal on public.icash_title_replies(account_id,deal_id,received_at desc);
alter table public.icash_title_replies enable row level security;
revoke all on public.icash_title_replies from public,anon,authenticated;
grant all on public.icash_title_replies to service_role;
create function public.icash_record_title_reply(p_email uuid,p_kind text,p_reference uuid,p_sender text,p_subject text,p_text text,p_authenticated boolean) returns void language plpgsql set search_path='' as $$
declare a uuid;d uuid;r uuid;q uuid;expected text;verified boolean:=false;
begin
 if p_kind='T' then
 select account_id,deal_id,id,recipient into a,d,r,expected from public.icash_title_requests where id=p_reference and state in ('dispatching','sent','needs_review');
 elsif p_kind='Q' then
 select j.account_id,j.id,c.public_email into a,q,expected from public.icash_title_qualification_jobs j join public.icash_title_directory c on c.id=j.company_id where j.id=p_reference and j.state in ('dispatching','sent','needs_review');
 end if;
 verified:=coalesce(p_authenticated and lower(expected)=lower(p_sender),false);
 -- Unverified mail is quarantined to operations, never exposed across tenants.
 if not verified then a:=null;d:=null;r:=null;q:=null;end if;
 insert into public.icash_title_replies(provider_email_id,account_id,deal_id,request_id,qualification_id,sender,subject,body_text,sender_verified)
 values(p_email,a,d,r,q,left(p_sender,320),left(p_subject,500),left(p_text,20000),verified) on conflict(provider_email_id) do nothing;
 -- Email text alone never approves a partner or changes a deal's financial or closing status.
end $$;
revoke all on function public.icash_record_title_reply(uuid,text,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.icash_record_title_reply(uuid,text,uuid,text,text,text,boolean) to service_role;
