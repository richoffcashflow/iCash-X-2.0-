-- A durable, account-bound record of an explicit user action. Never pre-accept.
alter table public.icash_accounts
 add column workspace_ack_version text,
 add column workspace_ack_user_id uuid,
 add column workspace_ack_hash text;

create table public.icash_workspace_acknowledgments (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.icash_accounts(id),
 user_id uuid not null references auth.users(id),
 version text not null check(length(version) between 1 and 100),
 document text not null check(length(document) between 100 and 12000),
 document_hash text not null check(document_hash ~ '^[a-f0-9]{64}$'),
 accepted_at timestamptz not null default now(),
 context jsonb not null default '{}' check(jsonb_typeof(context)='object'),
 unique(account_id,user_id,version)
);
alter table public.icash_workspace_acknowledgments enable row level security;
revoke all on public.icash_workspace_acknowledgments from public,anon,authenticated,service_role;
grant select,insert on public.icash_workspace_acknowledgments to service_role;

create function public.icash_accept_workspace_acknowledgment(p_account uuid,p_user uuid,p_version text,p_document text,p_hash text,p_context jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare receipt public.icash_workspace_acknowledgments;
begin
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for update;
 if not found then raise exception 'Account owner required';end if;
 if p_hash is distinct from encode(sha256(convert_to(p_document,'UTF8')),'hex') then raise exception 'Document hash mismatch';end if;
 insert into public.icash_workspace_acknowledgments(account_id,user_id,version,document,document_hash,context)
 values(p_account,p_user,p_version,p_document,p_hash,coalesce(p_context,'{}'))
 on conflict(account_id,user_id,version) do nothing;
 select * into strict receipt from public.icash_workspace_acknowledgments where account_id=p_account and user_id=p_user and version=p_version;
 if receipt.document_hash is distinct from p_hash or receipt.document is distinct from p_document then raise exception 'Acknowledgment version changed';end if;
 update public.icash_accounts set workspace_ack_version=p_version,workspace_ack_user_id=p_user,workspace_ack_hash=p_hash where id=p_account;
 return jsonb_build_object('accepted',true,'acceptedAt',receipt.accepted_at,'version',receipt.version);
end $$;
revoke all on function public.icash_accept_workspace_acknowledgment(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_accept_workspace_acknowledgment(uuid,uuid,text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
