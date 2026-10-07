begin;
create table public.icash_customer_phone_calls (
 id uuid primary key,
 account_id uuid not null references public.icash_accounts(id),actor_id uuid not null,
 screening_id uuid not null references public.icash_screening_jobs(id),
 callback_phone text not null,recipient_phone text not null,business_phone text not null,
 provider_account_sid text not null,nonce_hash text not null check(nonce_hash ~ '^[a-f0-9]{64}$'),
 operation_key text not null unique,rate_id uuid not null references public.icash_operation_rates(id),
 max_seconds integer not null default 600 check(max_seconds=600),
 state text not null default 'dispatching' check(state in ('dispatching','ringing','connecting','completed','failed','needs_review')),
 parent_sid text unique,child_sid text unique,connected_at timestamptz,ended_at timestamptz,
 parent_receipt jsonb,child_receipt jsonb,settled_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(callback_phone ~ '^\+1[2-9][0-9]{9}$' and recipient_phone ~ '^\+1[2-9][0-9]{9}$' and callback_phone<>recipient_phone and callback_phone<>business_phone and recipient_phone<>business_phone)
);
alter table public.icash_customer_phone_calls enable row level security;
revoke all on public.icash_customer_phone_calls from public,anon,authenticated;
grant select,insert,update on public.icash_customer_phone_calls to service_role;
create index icash_customer_phone_calls_account_created on public.icash_customer_phone_calls(account_id,created_at desc);
create function public.icash_begin_customer_phone_call(p_actor uuid,p_account uuid,p_screening uuid,p_recipient text,p_callback text,p_id uuid,p_sender text,p_provider_account text,p_nonce_hash text,p_quote jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.icash_customer_phone_calls;r uuid;costs jsonb;part record;total bigint:=0;hold bigint;cap bigint;reason text;manual jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor for update;
 if not found then raise exception 'Account owner required';end if;
 select * into old from public.icash_customer_phone_calls where id=p_id;
 if found then
  if old.account_id<>p_account or old.actor_id<>p_actor or old.screening_id<>p_screening or old.callback_phone<>p_callback or old.recipient_phone<>p_recipient then raise exception 'Call key conflict';end if;
  return jsonb_build_object('created',false,'call',to_jsonb(old));
 end if;
 if p_callback !~ '^\+1[2-9][0-9]{9}$' or p_callback=p_recipient or p_callback=p_sender or p_recipient=p_sender then return jsonb_build_object('error','Enter your own phone number, different from the seller and business number.');end if;
 if p_provider_account !~ '^AC[a-fA-F0-9]{32}$' or p_nonce_hash !~ '^[a-f0-9]{64}$' then raise exception 'Provider binding required';end if;
 if not exists(select 1 from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id join public.icash_text_senders s on s.phone=t.sender and s.enabled where t.account_id=p_account and d.screening_id=p_screening and t.recipient=p_recipient and t.sender=p_sender and t.retired_at is null) then return jsonb_build_object('error','Open this contact’s text conversation to connect its business number.');end if;
 if exists(select 1 from public.icash_customer_phone_calls where account_id=p_account and ended_at is null) then return jsonb_build_object('error','A previous call is still active or being checked.');end if;
 if (select count(*) from public.icash_customer_phone_calls where callback_phone=p_callback and created_at>now()-interval '1 hour')>=5 then return jsonb_build_object('error','Too many call attempts. Try again later.');end if;
 reason:=public.icash_manual_contact_reason(p_account,p_screening,p_recipient,'voice');if reason is not null then return jsonb_build_object('error',reason);end if;
 if p_quote->>'currency' is distinct from 'USD' or p_quote->>'country' is distinct from 'US' or p_quote->>'from' is distinct from p_sender or p_quote->>'callback' is distinct from p_callback or p_quote->>'recipient' is distinct from p_recipient or p_quote->>'checkedAt' is null or p_quote->>'receiptHash' is null or p_quote->>'receiptHash' !~ '^[a-f0-9]{64}$' or (p_quote->>'checkedAt')::timestamptz<now()-interval '2 minutes' or (p_quote->>'checkedAt')::timestamptz>now()+interval '5 seconds' then raise exception 'Current bound pricing required';end if;
 if jsonb_typeof(p_quote->'callbackMicrosPerMinute') is distinct from 'number' or jsonb_typeof(p_quote->'recipientMicrosPerMinute') is distinct from 'number' or (p_quote->>'callbackMicrosPerMinute')::numeric not between 1 and 100000 or (p_quote->>'recipientMicrosPerMinute')::numeric not between 1 and 100000 then raise exception 'Call price unavailable';end if;
 -- Use the existing approved platform allocations; no AI, SMS or recording is used.
 select r.costs_micros into costs from public.icash_operation_rates r join public.icash_voice_configs c on c.seller_rate_id=r.id where c.account_id=p_account and c.enabled and r.operation='seller_call' and r.enabled and r.expires_at>now() order by r.verified_at desc limit 1;
 if costs is null then raise exception 'Operating cost review required';end if;
 costs:=costs||jsonb_build_object('twilio',ceil(((p_quote->>'callbackMicrosPerMinute')::numeric+(p_quote->>'recipientMicrosPerMinute')::numeric)*10),'elevenlabs',0,'llm',0,'other',0,'messaging',0,'email',0,'dealmachine',0,'title_and_signing',0,'acquisition',0);
 select sum(value::text::bigint) into total from jsonb_each(costs);
 hold:=ceil(total::numeric*3*1.2/10000);
 if hold not between 1 and 1000 or not exists(select 1 from public.icash_operating_budget where id=1 and enabled and standard_cost_multiplier=3 and elevenlabs_cost_multiplier=3) then raise exception '3x calling pricing required';end if;
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds)
 values('customer_phone_call','customer-phone-3x-v1:'||p_id,hold,costs,2000,'Live Twilio number pricing: '||p_quote::text||'; 600s each leg; existing approved platform allocations are estimates; no AI or recording.',now(),now()+interval '15 minutes',true,600) returning id into r;
 insert into public.icash_customer_phone_calls(id,account_id,actor_id,screening_id,callback_phone,recipient_phone,business_phone,provider_account_sid,nonce_hash,operation_key,rate_id)
 values(p_id,p_account,p_actor,p_screening,p_callback,p_recipient,p_sender,p_provider_account,p_nonce_hash,'customer-phone:'||p_id,r);
 perform public.icash_reserve_operation(p_account,'customer-phone:'||p_id,r,now()+interval '2 minutes');
 if not public.icash_claim_operation('customer-phone:'||p_id) then raise exception 'Call spending not available';end if;
 manual:=public.icash_start_manual_call(p_actor,p_account,p_screening,p_recipient);
 if manual->>'error' is not null then raise exception 'Contact state changed';end if;
 select * into old from public.icash_customer_phone_calls where id=p_id;
 return jsonb_build_object('created',true,'call',to_jsonb(old),'holdCents',hold);
end $$;
create function public.icash_connect_customer_phone_call(p_id uuid,p_parent text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.icash_customer_phone_calls;
begin
 select * into c from public.icash_customer_phone_calls where id=p_id for update;
 if not found or c.parent_sid is distinct from p_parent or c.state<>'ringing' or c.connected_at is not null or c.created_at<now()-interval '2 minutes' or c.ended_at is not null then return false;end if;
 if not exists(select 1 from public.icash_manual_contacts(c.account_id,c.screening_id) where phone=c.recipient_phone and not blocked) then return false;end if;
 if not exists(select 1 from public.icash_operation_spend where operation_key=c.operation_key and account_id=c.account_id and state='dispatched') then return false;end if;
 update public.icash_customer_phone_calls set state='connecting',connected_at=now(),updated_at=now() where id=c.id;
 return true;
end $$;
create function public.icash_settle_customer_phone_call(p_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.icash_customer_phone_calls;o public.icash_operation_spend;r public.icash_operation_rates;receipt jsonb;provider_cost bigint:=0;components jsonb;charge bigint;costs jsonb;evidence text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into c from public.icash_customer_phone_calls where id=p_id for update;
 if not found or c.ended_at is null or c.parent_receipt is null or c.connected_at is not null and c.child_receipt is null then return false;end if;
 if c.settled_at is not null then return true;end if;
 for receipt in select c.parent_receipt union all select c.child_receipt where c.child_receipt is not null loop
  if jsonb_typeof(receipt->'costMicros') is distinct from 'number' or (receipt->>'costMicros')::numeric<0 or receipt->>'currency' is distinct from 'USD' or receipt->>'receiptHash' is null or receipt->>'receiptHash' !~ '^[a-f0-9]{64}$' then return false;end if;
  provider_cost:=provider_cost+(receipt->>'costMicros')::bigint;
 end loop;
 select * into o from public.icash_operation_spend where operation_key=c.operation_key and account_id=c.account_id;
 select * into r from public.icash_operation_rates where id=c.rate_id;
 if o.state<>'dispatched' or r.operation<>'customer_phone_call' then return false;end if;
 costs:=r.costs_micros||jsonb_build_object('twilio',provider_cost);
 evidence:='Customer phone call '||c.id||': exact terminal parent/child carrier receipts; platform allocations remain estimates.';
 select jsonb_object_agg(key,jsonb_build_object('amountMicros',value,'evidenceRef',case when key='twilio' then 'Canonical Twilio call USD receipts: '||c.parent_receipt::text||coalesce(c.child_receipt::text,'') else 'ESTIMATE: approved platform allocation from '||r.version end)),ceil(sum(value::text::numeric)*3/10000) into components,charge from jsonb_each(costs);
 if charge>o.charge_cap_cents then return false;end if;
 perform public.icash_settle_complete_costs(c.operation_key,charge,components,evidence);
 update public.icash_customer_phone_calls set settled_at=now() where id=c.id;
 return true;
end $$;
revoke all on function public.icash_begin_customer_phone_call(uuid,uuid,uuid,text,text,uuid,text,text,text,jsonb),public.icash_connect_customer_phone_call(uuid,text),public.icash_settle_customer_phone_call(uuid) from public,anon,authenticated;
grant execute on function public.icash_begin_customer_phone_call(uuid,uuid,uuid,text,text,uuid,text,text,text,jsonb),public.icash_connect_customer_phone_call(uuid,text),public.icash_settle_customer_phone_call(uuid) to service_role;
commit;
