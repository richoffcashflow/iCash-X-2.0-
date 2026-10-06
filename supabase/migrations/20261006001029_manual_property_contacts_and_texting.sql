-- Human contact is a separate, owner-authorized path. This never creates bot consent.
alter table public.icash_text_threads add column if not exists manual_only boolean not null default false;
create table public.icash_manual_call_attempts (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.icash_accounts(id),
 screening_id uuid not null references public.icash_screening_jobs(id), phone text not null check(phone ~ '^\+1[2-9][0-9]{9}$'),
 actor_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
alter table public.icash_manual_call_attempts enable row level security;
revoke all on public.icash_manual_call_attempts from public,anon,authenticated;
grant all on public.icash_manual_call_attempts to service_role;
create index icash_manual_call_phone_time on public.icash_manual_call_attempts(phone,created_at desc);

create or replace function public.icash_manual_contacts(p_account uuid,p_screening uuid)
returns table(phone text,name text,phone_type text,blocked boolean) language sql stable security invoker set search_path='' as $$
 with raw as (
  select n->>'number' number,c->>'name' name,lower(n->>'type') kind,coalesce((n->>'doNotCall')::boolean,false) blocked
  from public.icash_owner_contacts o cross join lateral jsonb_array_elements(coalesce(o.result->'contacts','[]')) c
  cross join lateral jsonb_array_elements(coalesce(c->'phones','[]')) n where o.account_id=p_account and o.screening_id=p_screening
  union all select t.recipient,null,'unknown',false from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id where t.account_id=p_account and d.screening_id=p_screening
  union all select i.phone,i.name,'unknown',false from public.icash_seller_intakes i where (i.assigned_account=p_account and i.screening_id=p_screening) or exists(select 1 from public.icash_seller_matches m where m.lead_id=i.id and m.account_id=p_account and m.screening_id=p_screening)
 ), normalized as (
  select case when length(regexp_replace(number,'\D','','g'))=10 then '+1'||regexp_replace(number,'\D','','g') else '+'||regexp_replace(number,'\D','','g') end phone,name,kind,blocked from raw
 ), grouped as (
  select phone,string_agg(distinct name,' / ' order by name) name,case when bool_or(kind in ('wireless','mobile')) then 'wireless' when bool_or(kind='landline') then 'landline' else 'unknown' end kind,bool_or(blocked) blocked from normalized where phone ~ '^\+1[2-9][0-9]{9}$' group by phone
 ) select g.phone,coalesce(g.name,'Saved contact'),g.kind,g.blocked
 or exists(select 1 from public.icash_text_suppressions s where s.phone=g.phone)
 or exists(select 1 from public.icash_contact_suppressions s where s.contact_key=encode(extensions.digest(g.phone,'sha256'),'hex'))
 or exists(select 1 from public.icash_contact_permissions p where p.account_id=p_account and p.phone=g.phone and p.revoked_at is not null)
 from grouped g where exists(select 1 from public.icash_screening_jobs s where s.id=p_screening and s.account_id=p_account and s.state='complete' and s.snapshot->>'propertyId' not like 'practice_%') order by g.blocked,g.name,g.phone;
$$;

-- Limit repeated unanswered contact across accounts. A dialer launch is not a completed call.
create or replace function public.icash_manual_contact_reason(p_account uuid,p_screening uuid,p_phone text,p_channel text,p_exclude uuid default null)
returns text language plpgsql stable security invoker set search_path='' as $$
declare c record;incoming timestamptz;last_attempt timestamptz;n integer;weekly integer;
begin
 if p_channel not in ('voice','sms') then return 'Contact unavailable.';end if;
 select * into c from public.icash_manual_contacts(p_account,p_screening) where phone=p_phone;
 if not found then return 'No saved number for this contact.';end if;
 if c.blocked then return 'Do not contact. This number is blocked.';end if;
 if p_channel='sms' and c.phone_type='landline' then return 'Call this landline instead.';end if;
 select max(m.created_at) into incoming from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id where t.recipient=p_phone and m.direction='incoming' and m.account_id=p_account;
 if p_channel='voice' then
  select count(*) filter(where created_at>now()-interval '24 hours'),max(created_at) into n,last_attempt from public.icash_manual_call_attempts where phone=p_phone and created_at>now()-interval '24 hours';
  if n>=3 or last_attempt>now()-interval '30 minutes' then return 'Give this contact time. Try calling later.';end if;
 else
  select count(*) filter(where m.created_at>now()-interval '24 hours' and m.created_at>coalesce(incoming,'-infinity')),count(*) filter(where m.created_at>coalesce(incoming,'-infinity')),max(m.created_at) into n,weekly,last_attempt
  from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id where t.recipient=p_phone and m.direction='outgoing' and m.state in ('dispatching','accepted','sent','delivered','needs_review') and m.id is distinct from p_exclude and m.created_at>now()-interval '7 days';
  if incoming is null or incoming<now()-interval '24 hours' then
   if n>=2 or weekly>=5 or last_attempt>now()-interval '30 minutes' then return 'Waiting for a reply. Try again later.';end if;
  elsif (select count(*) from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id where t.recipient=p_phone and m.direction='outgoing' and m.state in ('dispatching','accepted','sent','delivered','needs_review') and m.id is distinct from p_exclude and m.created_at>now()-interval '1 hour')>=20 then return 'Too many texts. Try again later.';
  end if;
 end if;
 return null;
end $$;

create or replace function public.icash_start_manual_call(p_actor uuid,p_account uuid,p_screening uuid,p_phone text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare reason text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor for update;
 if not found then raise exception 'Account owner required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_phone,74));
 reason:=public.icash_manual_contact_reason(p_account,p_screening,p_phone,'voice');
 if reason is not null then return jsonb_build_object('error',reason);end if;
 perform public.icash_set_work_control(p_actor,p_account,'takeover',p_screening);
 insert into public.icash_manual_call_attempts(account_id,screening_id,phone,actor_id) values(p_account,p_screening,p_phone,p_actor);
 return jsonb_build_object('manual',true,'dialUrl','tel:'||p_phone);
end $$;

create or replace function public.icash_prepare_manual_text(p_actor uuid,p_account uuid,p_screening uuid,p_phone text,p_terms jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.icash_deal_files;t public.icash_text_threads;sender_phone text;rate uuid;reason text;
begin
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor for update;
 if not found then raise exception 'Account owner required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_phone,74));
 if not exists(select 1 from public.icash_manual_contacts(p_account,p_screening) where phone=p_phone and not blocked and phone_type<>'landline') then return jsonb_build_object('error','This number is unavailable for texting.');end if;
 select * into d from public.icash_deal_files where account_id=p_account and screening_id=p_screening;
 if d.id is null then
  insert into public.icash_deal_files(account_id,screening_id,terms) values(p_account,p_screening,p_terms) on conflict(account_id,screening_id) do nothing;
  select * into d from public.icash_deal_files where account_id=p_account and screening_id=p_screening;
 end if;
 select * into t from public.icash_text_threads where account_id=p_account and deal_id=d.id and recipient=p_phone order by id limit 1;
 if t.id is not null then return jsonb_build_object('dealId',d.id,'threadId',t.id);end if;
 -- Existing conversations retain their sender. New conversations use one configured business sender.
 select phone into sender_phone from public.icash_text_senders where enabled order by phone limit 1;
 if sender_phone is null then return jsonb_build_object('error','Business texting number is not configured.');end if;
 if exists(select 1 from public.icash_text_threads where sender=sender_phone and recipient=p_phone) then return jsonb_build_object('error','This number already has a conversation on another property. Open that conversation.');end if;
 select id into rate from public.icash_operation_rates where operation='sms_send' and enabled and expires_at>now() order by verified_at desc,id limit 1;
 insert into public.icash_text_threads(account_id,deal_id,sender,recipient,sms_rate_id,paused,ai_mode,manual_only) values(p_account,d.id,sender_phone,p_phone,rate,true,'off',true) returning * into t;
 return jsonb_build_object('dealId',d.id,'threadId',t.id);
end $$;

create or replace function public.icash_manual_text_reason(p_account uuid,p_thread uuid,p_exclude uuid default null)
returns text language plpgsql stable security invoker set search_path='' as $$
declare t public.icash_text_threads;screening uuid;reason text;charge bigint;available bigint;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found then return 'Conversation unavailable.';end if;
 select screening_id into screening from public.icash_deal_files where id=t.deal_id and account_id=p_account;
 reason:=public.icash_manual_contact_reason(p_account,screening,t.recipient,'sms',p_exclude);
 if reason is not null then return reason;end if;
 if not exists(select 1 from public.icash_text_senders where phone=t.sender and enabled) then return 'Business texting number is unavailable.';end if;
 select greatest(r.charge_cents,ceil(p.customer_micros::numeric/10000)::bigint) into charge from public.icash_operation_rates r cross join public.icash_communication_prices p where r.id=t.sms_rate_id and r.enabled and r.expires_at>now() and r.operation='sms_send' and p.operation='sms_segment';
 if charge is null then return 'Texting setup needs a rate refresh. Your draft is saved.';end if;
 if not public.icash_membership_work_allowed(p_account) then return 'Update your subscription to send texts.';end if;
 select balance_cents-reserved_cents into available from public.icash_wallets where account_id=p_account;
 if coalesce(available,0)<charge then return 'Add credits to send. Your draft is saved.';end if;
 if (select coalesce(sum(-delta_cents),0) from public.icash_credit_ledger where account_id=p_account and kind='usage' and created_at>now()-interval '24 hours')+(select reserved_cents from public.icash_wallets where account_id=p_account)+charge>(select daily_limit_cents from public.icash_accounts where id=p_account) then return 'Daily budget reached. Your draft is saved.';end if;
 return null;
end $$;

-- Only an exact, owner-authored message can use credits while the bot is paused.
create or replace function public.icash_customer_text_operation(p_account uuid,p_operation text)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_text_messages m join public.icash_accounts a on a.id=m.account_id
 where m.account_id=p_account and 'text:'||m.id=p_operation and m.customer_author_id=a.owner_user_id and m.direction='outgoing' and m.state in ('ready','dispatching')
 and not exists(select 1 from public.icash_text_ai_jobs j where j.outgoing_id=m.id));
$$;

create or replace function public.icash_claim_customer_text(p_account uuid,p_message uuid,p_sender text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;reason text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_text_messages where account_id=p_account and id=p_message;
 select * into t from public.icash_text_threads where account_id=p_account and id=m.thread_id;
 if t.id is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 select * into m from public.icash_text_messages where account_id=p_account and id=p_message for update;
 if not public.icash_customer_text_operation(p_account,'text:'||m.id) or m.state<>'ready' or t.sender<>p_sender or cardinality(m.asset_ids)>0 then return null;end if;
 reason:=public.icash_manual_text_reason(p_account,t.id,m.id);if reason is not null then return null;end if;
 -- Expiry authorizes this exact manual dispatch; no recipient or AI consent is written.
 perform public.icash_reserve_operation(p_account,'text:'||m.id,t.sms_rate_id,now()+interval '2 minutes');
 if not public.icash_claim_operation('text:'||m.id) then raise exception 'Text already dispatched';end if;
 update public.icash_text_messages set state='dispatching',updated_at=now() where id=m.id;
 return jsonb_build_object('from',t.sender,'to',t.recipient,'message',m.body,'attachments',m.attachments);
end $$;
CREATE OR REPLACE FUNCTION public.icash_claim_before_activation(p_operation text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.icash_operating_budget; o public.icash_operation_spend; r public.icash_operation_rates; a public.icash_accounts;
begin
 select * into b from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.state<>'reserved' or not b.enabled or (b.require_company_reserve and b.funded_micros::numeric-b.spent_micros-b.protected_micros<b.reserved_micros) then return false; end if;
 select * into a from public.icash_accounts where id=o.account_id for update;
 select * into r from public.icash_operation_rates where id=o.rate_id for share;
 if (a.bot_paused and not public.icash_general_reception_pause_exempt(o.account_id,p_operation,o.charge_cap_cents) and not public.icash_customer_text_operation(o.account_id,p_operation)) or not r.enabled or r.expires_at<=now() or o.permission_until<=now() then return false; end if;
 if r.operation='seller_call' and (o.financial_checked_at is null or o.financial_checked_at<now()-interval '24 hours') then return false; end if;
 update public.icash_operation_spend set state='dispatched',dispatched_at=now() where operation_key=p_operation;
 return true;
end $function$;
CREATE OR REPLACE FUNCTION public.icash_enqueue_text_ai()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if exists(select 1 from public.icash_text_threads where id=new.thread_id and (manual_only or ai_mode='off')) then return new;end if;
 if new.direction<>'incoming' or new.account_id is null or new.thread_id is null then return new;end if;
 update public.icash_text_ai_jobs set state='superseded',updated_at=now() where thread_id=new.thread_id and state in ('pending','issued','drafted'); if public.icash_outreach_sms_current(new.account_id) then perform public.icash_prepare_sms_inbound_reply(new.account_id,new.thread_id,new.id);return new;end if;
 if exists(select 1 from public.icash_text_threads where id=new.thread_id and account_id=new.account_id and paused) then return new;end if;
 update public.icash_text_ai_jobs set state='superseded',updated_at=now() where thread_id=new.thread_id and state in ('pending','issued','drafted');
 if exists(select 1 from public.icash_text_threads t join public.icash_text_suppressions s on s.phone=t.recipient where t.id=new.thread_id) then return new;end if;
 if new.body ~* '\m(human|real person|speak to someone|talk to someone|call me|call back|callback)\M' then
 update public.icash_text_threads set paused=true where id=new.thread_id;
 insert into public.icash_text_ai_jobs(account_id,thread_id,message_id,state,analysis) values(new.account_id,new.thread_id,new.id,'handoff',jsonb_build_object('summary','Seller requested a person or callback. Review and confirm scheduling.','humanRequested',true,'callbackRequested',new.body ~* '\m(call me|call back|callback)\M')) on conflict(message_id) do nothing;
 elsif exists(select 1 from public.icash_text_threads where id=new.thread_id and ai_mode<>'off') then
 insert into public.icash_text_ai_jobs(account_id,thread_id,message_id) values(new.account_id,new.thread_id,new.id) on conflict(message_id) do nothing;
 end if;return new;
end $function$;
CREATE OR REPLACE FUNCTION public.icash_queue_customer_text(p_actor uuid, p_account uuid, p_thread uuid, p_key uuid, p_body text, p_assets uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare screening uuid;message uuid;prior public.icash_text_messages;reason text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor for update;
 if not found then raise exception 'Account owner required';end if;
 select d.screening_id into screening from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 where t.id=p_thread and t.account_id=p_account and d.stage not in ('closed','cancelled');
 if screening is null then raise exception 'Lead conversation unavailable';end if;
 select * into prior from public.icash_text_messages where request_key=p_key;
 if found and (prior.account_id<>p_account or prior.customer_author_id is distinct from p_actor) then raise exception 'Message key conflict';end if;
 if prior.id is null then
 reason:=public.icash_manual_text_reason(p_account,p_thread);if reason is not null then return jsonb_build_object('error',reason);end if;
 end if;
 message:=public.icash_queue_text(p_account,p_thread,p_key,p_body,p_assets);
 if prior.id is null then
  update public.icash_text_messages set customer_author_id=p_actor where id=message and account_id=p_account;
  perform public.icash_set_work_control(p_actor,p_account,'takeover',screening);
 end if;
 return jsonb_build_object('id',message,'manual',exists(select 1 from public.icash_property_controls c join public.icash_screening_jobs s on s.account_id=c.account_id and s.snapshot->>'propertyId'=c.property_id where s.id=screening and s.account_id=p_account and c.manual));
end $function$;
CREATE OR REPLACE FUNCTION public.icash_reserve_credit(p_account uuid, p_operation text, p_amount bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare w public.icash_wallets; r public.icash_credit_reservations; a public.icash_accounts; used bigint; result uuid;
begin
 if p_operation is null or trim(p_operation)='' or p_amount is null or p_amount<=0 then raise exception 'Invalid reservation'; end if;
 select * into a from public.icash_accounts where id=p_account for update;
 if not found then raise exception 'Account missing'; end if;
 if not public.icash_membership_work_allowed(p_account) then raise exception 'Software membership is inactive';end if;
 select * into w from public.icash_wallets where account_id=p_account for update;
 if not found then raise exception 'Wallet missing'; end if;
 select * into r from public.icash_credit_reservations where operation_key=p_operation;
 if found then
  if r.account_id<>p_account or r.amount_cents<>p_amount then raise exception 'Idempotency conflict'; end if;
  if r.status<>'reserved' then raise exception 'Operation already resolved'; end if;
  if a.bot_paused and not public.icash_general_reception_pause_exempt(p_account,p_operation,p_amount) and not public.icash_customer_text_operation(p_account,p_operation) then raise exception 'Bot paused'; end if;
  return r.id;
 end if;
 if a.bot_paused and not public.icash_general_reception_pause_exempt(p_account,p_operation,p_amount) and not public.icash_customer_text_operation(p_account,p_operation) then raise exception 'Bot paused'; end if;
 if w.balance_cents-w.reserved_cents<p_amount then raise exception 'Insufficient credits'; end if;
 -- Rolling 24-hour consumption plus ALL outstanding reservations, including older work.
 select coalesce(sum(-delta_cents),0) into used from public.icash_credit_ledger
 where account_id=p_account and kind='usage' and created_at>now()-interval '24 hours';
 if used+w.reserved_cents+p_amount>a.daily_limit_cents then raise exception 'Daily budget reached'; end if;
 insert into public.icash_credit_reservations(account_id,operation_key,amount_cents)
 values(p_account,p_operation,p_amount) returning id into result;
 update public.icash_wallets set reserved_cents=reserved_cents+p_amount where account_id=p_account;
 return result;
end; $function$;
CREATE OR REPLACE FUNCTION public.icash_claim_text(p_account uuid, p_message uuid, p_sender text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare opening public.icash_sms_seller_openings;reply public.icash_text_messages;
begin
 -- Human drafts dispatch only from the explicit manual-send endpoint, never a worker retry.
 if exists(select 1 from public.icash_text_messages where id=p_message and account_id=p_account and customer_author_id is not null) then return null;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into opening from public.icash_sms_seller_openings where interest_message_id=p_message and account_id=p_account;
 if found then
  perform 1 from public.icash_text_threads where id=opening.thread_id and account_id=p_account for update;
  select * into reply from public.icash_text_messages where id=opening.owner_reply_id and thread_id=opening.thread_id and account_id=p_account and direction='incoming' and state='received';
  if reply.id is null or lower(trim(reply.body)) !~ '^(yes|yeah|yep|yes i am|i am|i am the owner|i''m the owner|yes i am the owner|yes that is me|yes that''s me)[.! ,]*$'
   or not exists(select 1 from public.icash_text_messages where id=opening.owner_question_id and thread_id=opening.thread_id and account_id=p_account and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null)
   or exists(select 1 from public.icash_text_messages where thread_id=opening.thread_id and account_id=p_account and direction='incoming' and id<>reply.id and created_at>=reply.created_at)
   or not exists(select 1 from public.icash_text_messages where id=p_message and account_id=p_account and thread_id=opening.thread_id and body='Would you be interested in selling your property for all cash? Reply STOP to opt out.') then return null;end if;
 end if;
 return public.icash_claim_text_before_owner_question(p_account,p_message,p_sender);
end $function$;


revoke all on function public.icash_manual_contacts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_manual_contacts(uuid,uuid) to service_role;

revoke all on function public.icash_manual_contact_reason(uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.icash_manual_contact_reason(uuid,uuid,text,text,uuid) to service_role;

revoke all on function public.icash_start_manual_call(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_start_manual_call(uuid,uuid,uuid,text) to service_role;

revoke all on function public.icash_prepare_manual_text(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_prepare_manual_text(uuid,uuid,uuid,text,jsonb) to service_role;

revoke all on function public.icash_manual_text_reason(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_manual_text_reason(uuid,uuid,uuid) to service_role;

revoke all on function public.icash_customer_text_operation(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_customer_text_operation(uuid,text) to service_role;

revoke all on function public.icash_claim_customer_text(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_claim_customer_text(uuid,uuid,text) to service_role;

revoke all on function public.icash_claim_before_activation(text) from public,anon,authenticated;
grant execute on function public.icash_claim_before_activation(text) to service_role;

revoke all on function public.icash_enqueue_text_ai() from public,anon,authenticated;
grant execute on function public.icash_enqueue_text_ai() to service_role;

revoke all on function public.icash_queue_customer_text(uuid,uuid,uuid,uuid,text,uuid[]) from public,anon,authenticated;
grant execute on function public.icash_queue_customer_text(uuid,uuid,uuid,uuid,text,uuid[]) to service_role;

revoke all on function public.icash_reserve_credit(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.icash_reserve_credit(uuid,text,bigint) to service_role;

revoke all on function public.icash_claim_text(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_claim_text(uuid,uuid,text) to service_role;
