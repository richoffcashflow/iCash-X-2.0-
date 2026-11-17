CREATE OR REPLACE FUNCTION public.icash_auto_title_confirmation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.icash_confirm_closing_before_cancellation(p_account uuid, p_actor uuid, p_deal uuid, p_reply uuid, p_kind text, p_date date DEFAULT NULL::date, p_amount bigint DEFAULT NULL::bigint, p_file text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.icash_confirm_closing_before_disbursement(p_account uuid, p_actor uuid, p_deal uuid, p_reply uuid, p_kind text, p_date date DEFAULT NULL::date, p_amount bigint DEFAULT NULL::bigint, p_file text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.icash_confirm_closing_update(p_account uuid, p_actor uuid, p_deal uuid, p_reply uuid, p_kind text, p_date date DEFAULT NULL::date, p_amount bigint DEFAULT NULL::bigint, p_file text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d public.icash_deal_files;cutoff timestamptz;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into strict d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if d.stage in ('cancellation_pending','cancelled') then raise exception 'Resolve cancellation before closing updates';end if;
 select max(completed_at) into cutoff from public.icash_agreement_cancellations where account_id=p_account and deal_id=p_deal and kind='assignment' and state='completed';
 if cutoff is not null then
  if not exists(select 1 from public.icash_title_replies where id=p_reply and account_id=p_account and deal_id=p_deal and received_at>cutoff) then raise exception 'A new closing confirmation is required for the replacement buyer';end if;
  if p_kind='closed' and not public.icash_buyer_is_reserved(p_account,p_deal) then raise exception 'Confirm the current buyer deposit first';end if;
 end if;
 return public.icash_confirm_closing_before_cancellation(p_account,p_actor,p_deal,p_reply,p_kind,p_date,p_amount,p_file);
end $function$;

CREATE OR REPLACE FUNCTION public.icash_reserve_from_closing_deposit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.icash_signing_envelopes;
begin
 if new.kind<>'deposit_received' or new.amount_cents not between 1 and 500000 then return new;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_deal_files where id=new.deal_id and account_id=new.account_id for update;
 if exists(select 1 from public.icash_agreement_cancellations where account_id=new.account_id and deal_id=new.deal_id and kind='assignment' and state='completed') then return new;end if;
 select a.* into e from public.icash_signing_envelopes a join public.icash_deal_files d on d.id=a.deal_id and d.account_id=a.account_id and d.terms=a.terms
  where a.deal_id=new.deal_id and a.account_id=new.account_id and a.kind='assignment' and a.state='completed' and not a.test_mode and a.provider_id is not null
  and (a.terms->>'assignmentDepositCents')::bigint=new.amount_cents;
 if not found or (select count(*) from public.icash_signing_envelopes where account_id=new.account_id and deal_id=new.deal_id and kind='assignment' and state='completed' and not test_mode)<>1 then return new;end if;
 insert into public.icash_buyer_deposit_receipts(account_id,deal_id,envelope_id,terms_hash,amount_cents,method,reference,confirmed_by,request_key)
 values(new.account_id,new.deal_id,e.id,e.terms_hash,new.amount_cents,'verified_closer','Closing confirmation '||new.id,new.confirmed_by,new.id) on conflict do nothing;
 return new;
end $function$;
