-- Recorded closing updates always point to authenticated mail from the verified closer.
create table public.icash_closing_updates(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),reply_id uuid not null references public.icash_title_replies(id),
 kind text not null check(kind in ('title_opened','deposit_received','closing_scheduled','closed')),
 effective_date date,amount_cents bigint check(amount_cents>0 and amount_cents<=9007199254740991),
 file_reference text not null default '' check(length(file_reference)<=120),confirmed_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),unique(deal_id,reply_id,kind)
);
create index icash_closing_updates_account_deal on public.icash_closing_updates(account_id,deal_id,created_at desc);
alter table public.icash_closing_updates enable row level security;
revoke all on public.icash_closing_updates from public,anon,authenticated;
grant select,insert on public.icash_closing_updates to service_role;

create function public.icash_confirm_closing_update(p_account uuid,p_actor uuid,p_deal uuid,p_reply uuid,p_kind text,p_date date default null,p_amount bigint default null,p_file text default '') returns uuid language plpgsql set search_path='' as $$
declare d public.icash_deal_files;r public.icash_title_replies;old public.icash_closing_updates;n uuid;today date:=(now() at time zone 'America/Chicago')::date;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Account owner required';end if;
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if not found or d.stage='draft' then raise exception 'Signed deal required';end if;
 if p_kind is null or p_kind not in ('title_opened','deposit_received','closing_scheduled','closed') then raise exception 'Invalid milestone';end if;
 if not exists(select 1 from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='purchase' and state='completed' and not test_mode) then raise exception 'Verified purchase signatures required';end if;
 select * into r from public.icash_title_replies where id=p_reply and account_id=p_account and deal_id=p_deal and sender_verified for share;
 if not found or not exists(select 1 from public.icash_title_contacts where deal_id=p_deal and account_id=p_account and enabled and verified_until>now() and lower(email)=lower(r.sender)) then raise exception 'Reply from current verified closing contact required';end if;
 select * into old from public.icash_closing_updates where deal_id=p_deal and reply_id=p_reply and kind=p_kind;
 if found then
  if row(old.effective_date,old.amount_cents,old.file_reference) is distinct from row(p_date,p_amount,coalesce(p_file,'')) then raise exception 'This update is already recorded with different details';end if;
  return old.id;
 end if;
 if d.stage='closed' then raise exception 'Closing is already recorded';end if;
 if p_file is null or length(p_file)>120 or p_amount is not null and (p_amount<=0 or p_amount>9007199254740991) then raise exception 'Invalid update details';end if;
 if p_date is not null and (p_date<today-730 or p_date>today+730) then raise exception 'Date outside supported range';end if;
 if p_kind<>'title_opened' and not exists(select 1 from public.icash_closing_updates where deal_id=p_deal and account_id=p_account and kind='title_opened') then raise exception 'Confirm title opening first';end if;
 if p_kind in ('deposit_received','closed') and not exists(select 1 from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='assignment' and state='completed' and not test_mode) then raise exception 'Verified buyer agreement required';end if;
 if p_kind='deposit_received' and p_amount is null then raise exception 'Confirmed deposit amount required';end if;
 if p_kind in ('closing_scheduled','closed') and p_date is null then raise exception 'Confirmed date required';end if;
 if p_kind='closed' and p_date>today then raise exception 'A future closing is not completed';end if;
 if p_kind='closed' and coalesce((d.terms->>'assignmentDepositCents')::bigint,0)>0 and not exists(select 1 from public.icash_closing_updates where deal_id=p_deal and account_id=p_account and kind='deposit_received' and amount_cents>=(d.terms->>'assignmentDepositCents')::bigint) then raise exception 'Contract deposit still needs confirmation';end if;
 insert into public.icash_closing_updates(account_id,deal_id,reply_id,kind,effective_date,amount_cents,file_reference,confirmed_by) values(p_account,p_deal,p_reply,p_kind,p_date,p_amount,p_file,p_actor) returning id into n;
 update public.icash_deal_files set stage=case when p_kind='closed' then 'closed' when p_kind='closing_scheduled' then 'closing' when stage='closing' then stage else 'title_open' end,updated_at=now() where id=p_deal and account_id=p_account;
 return n;
end $$;
revoke all on function public.icash_confirm_closing_update(uuid,uuid,uuid,uuid,text,date,bigint,text) from public,anon,authenticated;
grant execute on function public.icash_confirm_closing_update(uuid,uuid,uuid,uuid,text,date,bigint,text) to service_role;
