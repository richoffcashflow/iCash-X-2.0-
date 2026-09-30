-- Separate title-reported disbursement from a completed closing or bank receipt.
alter table public.icash_closing_updates drop constraint icash_closing_updates_kind_check;
alter table public.icash_closing_updates add constraint icash_closing_updates_kind_check check(kind in ('title_opened','deposit_received','closing_scheduled','closed','funds_disbursed'));
alter table public.icash_closing_updates alter column confirmed_by drop not null;
alter table public.icash_closing_updates add column confirmation_source text not null default 'user_review' check(confirmation_source in ('user_review','verified_title_format'));
grant update(confirmed_by,confirmation_source) on public.icash_closing_updates to service_role;
alter function public.icash_confirm_closing_update(uuid,uuid,uuid,uuid,text,date,bigint,text) rename to icash_confirm_closing_before_disbursement;
create function public.icash_confirm_closing_update(p_account uuid,p_actor uuid,p_deal uuid,p_reply uuid,p_kind text,p_date date default null,p_amount bigint default null,p_file text default '') returns uuid language plpgsql set search_path='' as $$
declare r public.icash_title_replies;old public.icash_closing_updates;n uuid;
begin
 if p_kind<>'funds_disbursed' then return public.icash_confirm_closing_before_disbursement(p_account,p_actor,p_deal,p_reply,p_kind,p_date,p_amount,p_file);end if;
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Owner required';end if;
 perform 1 from public.icash_deal_files where id=p_deal and account_id=p_account and stage='closed' for update;if not found then raise exception 'Confirmed closing required';end if;
 select * into r from public.icash_title_replies where id=p_reply and account_id=p_account and deal_id=p_deal and sender_verified;
 if not found or not exists(select 1 from public.icash_title_contacts where deal_id=p_deal and account_id=p_account and enabled and verified_until>now() and lower(email)=lower(r.sender)) then raise exception 'Verified closer reply required';end if;
 if p_amount is null or p_amount<=0 or p_amount>9007199254740991 or p_date is null or p_date>(now() at time zone 'America/Chicago')::date or p_date<(now() at time zone 'America/Chicago')::date-730 or coalesce(length(p_file),0) not between 1 and 120 then raise exception 'Actual disbursement amount, past date and reference required';end if;
 select * into old from public.icash_closing_updates where account_id=p_account and deal_id=p_deal and reply_id=p_reply and kind=p_kind;
 if found then
 if row(old.effective_date,old.amount_cents,old.file_reference) is distinct from row(p_date,p_amount,p_file) then raise exception 'Conflicting confirmation';end if;
 return old.id;end if;
 insert into public.icash_closing_updates(account_id,deal_id,reply_id,kind,effective_date,amount_cents,file_reference,confirmed_by) values(p_account,p_deal,p_reply,p_kind,p_date,p_amount,p_file,p_actor) returning id into n;
 return n;
end $$;
revoke all on function public.icash_confirm_closing_update(uuid,uuid,uuid,uuid,text,date,bigint,text),public.icash_confirm_closing_before_disbursement(uuid,uuid,uuid,uuid,text,date,bigint,text) from public,anon,authenticated;
grant execute on function public.icash_confirm_closing_update(uuid,uuid,uuid,uuid,text,date,bigint,text) to service_role;
-- Exact standalone confirmation only. Quoted emails and free-form guesses require user review.
create function public.icash_auto_title_confirmation() returns trigger language plpgsql set search_path='' as $$
declare fields text[];owner_id uuid;result_id uuid;
begin
 if not new.sender_verified or new.deal_id is null then return new;end if;
 fields:=regexp_match(replace(trim(new.body_text),E'\r',''),E'^ICASH CONFIRMATION\nStatus: (title_opened|deposit_received|closing_scheduled|closed|funds_disbursed)\nDate: ([0-9]{4}-[0-9]{2}-[0-9]{2}|none)\nAmount cents: ([0-9]{1,15}|none)\nFile: ([^\n]{1,120})\nEND ICASH CONFIRMATION$');
 if fields is null then return new;end if;
 select owner_user_id into owner_id from public.icash_accounts where id=new.account_id;
 begin
 result_id:=public.icash_confirm_closing_update(new.account_id,owner_id,new.deal_id,new.id,fields[1],nullif(fields[2],'none')::date,nullif(fields[3],'none')::bigint,fields[4]);
 update public.icash_closing_updates set confirmed_by=null,confirmation_source='verified_title_format' where id=result_id;
 exception when others then
 -- Keep the original reply available for review; never invent a missing prior milestone.
 null;
 end;
 return new;
end $$;
revoke all on function public.icash_auto_title_confirmation() from public,anon,authenticated;
create trigger icash_auto_title_confirmation after insert on public.icash_title_replies for each row execute function public.icash_auto_title_confirmation();
