CREATE OR REPLACE FUNCTION public.icash_closing_reply_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare reason text;body text;screen uuid;prop text;
begin
 if not new.sender_verified or new.account_id is null or new.deal_id is null then return new;end if;
 body:=split_part(replace(new.body_text,E'\r',''),E'\n>',1);
 body:=split_part(body,E'\nFrom:',1);body:=split_part(body,E'\nOn ',1);
 if body ~* '(new|changed|updated|replace|different).{0,70}(wire|bank|routing|account|payee)|(wire|bank|routing|account|payee).{0,70}(changed|updated|change|replace)' then reason:='payment_change';
 elsif body ~* '(cannot|can''t|do not|don''t|unable|decline).{0,80}(assignment|handle|accept|close|file)' then reason:='title_declined';
 elsif body ~* '\m(dispute|lien|probate|lawsuit|legal review|attorney review|human|real person)\M' then reason:='title_issue';
 else return new;end if;
 select d.screening_id,j.snapshot->>'propertyId' into screen,prop from public.icash_deal_files d join public.icash_screening_jobs j on j.id=d.screening_id and j.account_id=d.account_id where d.id=new.deal_id and d.account_id=new.account_id;
 if screen is null then return new;end if;
 insert into public.icash_closing_setup(account_id,deal_id,screening_id,state,review_reason,reply_id)
 values(new.account_id,new.deal_id,screen,'needs_review',reason,new.id)
 on conflict(deal_id) do update set state='needs_review',review_reason=excluded.review_reason,reply_id=excluded.reply_id,updated_at=now()
 where icash_closing_setup.account_id=excluded.account_id;
 if prop is not null then
  insert into public.icash_property_controls(account_id,property_id,manual) values(new.account_id,prop,true)
  on conflict(account_id,property_id) do update set manual=true,updated_at=now();
 end if;
 return new;
end $function$
