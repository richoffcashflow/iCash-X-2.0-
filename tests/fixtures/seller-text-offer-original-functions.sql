-- Production calculation and queue definitions captured 2026-11-02; no customer data.
CREATE OR REPLACE FUNCTION public.icash_automatic_cash_offer_price(p_snapshot jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare d jsonb;fetched timestamptz;arv numeric;repairs numeric;price numeric;
begin
 if p_snapshot->>'propertyType' is distinct from 'house' then return null;end if;
 d:=p_snapshot->'raw'->'data';
 if jsonb_typeof(d) is distinct from 'object' or p_snapshot->>'propertyId' is null
 or p_snapshot->>'propertyId' !~ '^prop_[0-9]{1,20}$'
 or d->>'dm_property_id' is distinct from p_snapshot->>'propertyId'
 or length(btrim(coalesce(d->>'full_address',''))) not between 1 and 300 then return null;end if;
 fetched:=(p_snapshot->>'fetchedAt')::timestamptz;
 if fetched is null or fetched>now() or fetched<now()-interval '24 hours' then return null;end if;
 if jsonb_typeof(d->'estimated_value') is distinct from 'number'
 or jsonb_typeof(d->'estimated_repair_cost') is distinct from 'number' then return null;end if;
 arv:=(d->>'estimated_value')::numeric*100;repairs:=(d->>'estimated_repair_cost')::numeric*100;
 if arv<0 or repairs<0 or arv>9007199254740991 or repairs>9007199254740991
 or arv<>trunc(arv) or repairs<>trunc(repairs) then return null;end if;
 price:=floor(greatest(arv-repairs,0)*7000/10000)-case when arv>=30000000 then 2000000 else 1000000 end;
 if price<=0 then return null;end if;
 return price::bigint;
exception when invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return null;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_queue_text(p_account uuid, p_thread uuid, p_key uuid, p_body text, p_assets uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;m public.icash_text_messages;urls jsonb;total bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found or t.retired_at is not null or not exists(select 1 from public.icash_deal_files where id=t.deal_id and account_id=p_account) then raise exception 'Thread not available';end if;
 if length(trim(p_body))=0 and cardinality(p_assets)=0 then raise exception 'Message required';end if;
 if length(p_body)>1000 or cardinality(p_assets)>3 then raise exception 'Message too large';end if;
 -- One SMS segment per reviewed rate; MMS has its own independent rate.
 if cardinality(p_assets)=0 and not public.icash_sms_single_segment(p_body) then raise exception 'Shorten the message';end if;
 select coalesce(jsonb_agg(url order by id),'[]'),coalesce(sum(bytes),0) into urls,total from public.icash_text_assets where id=any(p_assets) and account_id=p_account and deal_id=t.deal_id and verified_until>now();
 if jsonb_array_length(urls)<>cardinality(p_assets) or total>5000000 then raise exception 'Verified attachments required';end if;
 insert into public.icash_text_messages(thread_id,account_id,direction,body,asset_ids,attachments,state,request_key) values(t.id,p_account,'outgoing',p_body,p_assets,urls,'ready',p_key) on conflict(request_key) do nothing;
 select * into m from public.icash_text_messages where request_key=p_key;
 -- Insert uses the caller's idempotency key below; no cross-account lookup may return an ID.
 if m.id is null then raise exception 'Message key missing';end if;
 if m.account_id<>p_account or m.thread_id<>p_thread or m.body<>p_body or m.asset_ids<>p_assets then raise exception 'Message key conflict';end if;
 return m.id;
end $function$;
