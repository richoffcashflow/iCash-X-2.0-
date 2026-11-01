-- Recipient-wide cold seller cadence. These guards only deny; original
-- contact, money, sender, account and receipt rules remain the send authority.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;

create index if not exists text_threads_seller_recipient_history
 on public.icash_text_threads(recipient,id,account_id) where party='seller';

create function public.icash_seller_text_cadence_current(p_account uuid,p_thread uuid,p_message uuid default null,p_followup boolean default false)
returns boolean language plpgsql stable security invoker set search_path='' as $function$
declare t public.icash_text_threads;d public.icash_deal_files;last_body text;n integer;first_at timestamptz;original_thread uuid;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found then return false;end if;
 if t.party<>'seller' then return true;end if;
 -- Human-authored sends and verified cancellation workflows retain their own
 -- final consent/suppression gates. A draft is never an incoming response.
 if p_message is not null and exists(select 1 from public.icash_text_messages m
  where m.id=p_message and m.thread_id=t.id and m.account_id=p_account
   and (m.customer_author_id is not null or exists(select 1 from public.icash_cancellation_notices c where c.account_id=p_account and c.sms_id=m.id))) then return true;end if;
 -- Requested-contact flows keep their separately verified source-bound sequence.
 -- This field does not grant consent: their existing final evidence gate still runs.
 if t.seller_intake_id is not null and t.operational_contact_id is null then return true;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account;
 if not found then return false;end if;
 -- Natural refusals on another property cannot restart automated cold pursuit.
 select m.body into last_body from public.icash_text_threads other
 join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
 where other.recipient=t.recipient and other.party='seller' and m.direction='incoming'
  and m.state='received' and (m.provider_id is not null or m.event_id is not null)
 order by m.created_at desc,m.id desc limit 1;
 if public.icash_seller_response_disposition(last_body) is not null then return false;end if;
 -- Continue source-backed human replies and ongoing signed work normally.
 if d.stage not in ('draft','cancelled','closed') then return true;end if;
 if exists(select 1 from public.icash_text_messages m where m.thread_id=t.id and m.account_id=p_account
  and m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)
  and m.created_at between now()-interval '24 hours' and now()
  and m.body ~ '[[:alnum:]]' and m.body !~* '(^Free Msg:|Message Blocking is active|verification code|one.time (password|code))'
  and public.icash_seller_response_disposition(m.body) is null)
 or exists(select 1 from public.icash_live_conversations c where c.account_id=p_account and c.screening_id=d.screening_id
  and c.contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex') and c.state='complete'
  and c.completed_at between now()-interval '24 hours' and now() and c.conversation_id is not null
  and public.icash_call_has_seller_response(c.result)) then return true;end if;
 -- Include every business number, property and account, including retired history.
 -- Unknown or already reserved sends cannot be treated as an unused introduction.
 if exists(select 1 from public.icash_text_threads other
  join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
  left join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
  where other.recipient=t.recipient and other.party='seller' and m.direction='outgoing' and m.id is distinct from p_message
   and (m.state in ('dispatching','needs_review') or (m.provider_id is null and o.state in ('reserved','dispatched')))) then return false;end if;
 select count(*),min(sent.at) into n,first_at from (
  select m.thread_id,coalesce(o.dispatched_at,m.created_at) at
  from public.icash_text_threads other
  join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
  left join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
  where other.recipient=t.recipient and other.party='seller' and m.direction='outgoing' and m.id is distinct from p_message
   and (m.provider_id is not null or o.dispatched_at is not null)
  limit 2
 ) sent;
 if n=0 then return not p_followup;end if;
 if n<>1 or not p_followup or first_at>now()-interval '3 days' or first_at<now()-interval '5 days' then return false;end if;
 select m.thread_id into original_thread from public.icash_text_threads other
 join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
 left join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
 where other.recipient=t.recipient and other.party='seller' and m.direction='outgoing' and m.id is distinct from p_message
  and (m.provider_id is not null or o.dispatched_at is not null) limit 1;
 return original_thread=t.id;
end $function$;

-- Evaluate again under the same budget/recipient locks used by the original send.
create function public.icash_seller_text_operation_current(p_account uuid,p_operation text)
returns boolean language plpgsql security invoker set search_path='' as $function$
declare m public.icash_text_messages;t public.icash_text_threads;followup boolean;
begin
 if left(p_operation,5)<>'text:' then return true;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 if p_operation !~ '^text:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false;end if;
 select * into m from public.icash_text_messages where id=substring(p_operation from 6)::uuid and account_id=p_account;
 if not found then return false;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account;
 if not found then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 followup:=exists(select 1 from public.icash_seller_gaps g where g.account_id=p_account and g.thread_id=t.id and g.outgoing_id=m.id and g.reason='no_response');
 return public.icash_seller_text_cadence_current(p_account,t.id,m.id,followup);
end $function$;

do $patch$
declare d text;needle text;signature text;
begin
 d:=pg_get_functiondef('public.icash_claim_operation(text)'::regprocedure);
 needle:=' if a is not null and not public.icash_seller_response_operation_allowed(a,p_operation) then return false;end if;';
 if strpos(d,needle)=0 then raise exception 'Text final admission prerequisite changed';end if;
 execute replace(d,needle,needle||E'\n if a is not null and not public.icash_seller_text_operation_current(a,p_operation) then return false;end if;');
 d:=pg_get_functiondef('public.icash_claim_text_before_ai(uuid,uuid,text)'::regprocedure);
 needle:=' perform public.icash_reserve_operation(p_account,''text:''||m.id,r,public.icash_sms_thread_dispatch_until(p_account,t.id));';
 if strpos(d,needle)=0 then raise exception 'Text reservation prerequisite changed';end if;
 execute replace(d,needle,E' if not public.icash_seller_text_operation_current(p_account,''text:''||m.id) then return null;end if;\n'||needle);
 foreach signature in array array['icash_queue_seller_opener(uuid,uuid)','icash_seller_opener_candidate_body(uuid,uuid)'] loop
  d:=pg_get_functiondef(('public.'||signature)::regprocedure);
  needle:=' if not public.icash_outreach_sms_current(p_account) then return null;end if;';
  if strpos(d,needle)=0 then raise exception 'Text opener prerequisite changed: %',signature;end if;
  execute replace(d,needle,needle||E'\n if not public.icash_seller_text_cadence_current(p_account,p_thread) then return null;end if;');
 end loop;
 d:=pg_get_functiondef('public.icash_recover_unstarted_seller_opener()'::regprocedure);
 needle:=' and public.icash_sms_outreach_window_current(ordered.account_id,ordered.thread_id)';
 if strpos(d,needle)=0 then raise exception 'Text recovery selector prerequisite changed';end if;
 execute replace(d,needle,needle||E'\n and public.icash_seller_text_cadence_current(ordered.account_id,ordered.thread_id,ordered.message_id)');
 d:=pg_get_functiondef('public.icash_seller_recovery_current(uuid)'::regprocedure);
 needle:=' anchor:=g.source_at;';
 if strpos(d,needle)=0 then raise exception 'Seller recovery prerequisite changed';end if;
 execute replace(d,needle,E' if not public.icash_seller_text_cadence_current(g.account_id,t.id,g.outgoing_id,g.reason=''no_response'') then return false;end if;\n'||needle);
 d:=pg_get_functiondef('public.icash_next_seller_followup()'::regprocedure);
 needle:='  order by gap.due_at for update of gap skip locked limit 20';
 if strpos(d,needle)=0 then raise exception 'Followup selector prerequisite changed';end if;
 execute replace(d,needle,E'   and public.icash_seller_text_cadence_current(gap.account_id,t.id,gap.outgoing_id,true)\n'||needle);
 -- Queue due time follows the new cold cadence without extending contact evidence.
 d:=pg_get_functiondef('public.icash_open_seller_gap(uuid,uuid,text,uuid,text,text,timestamptz)'::regprocedure);
 needle:='due:=greatest(now(),p_at+interval ''4 hours'');';
 if strpos(d,needle)=0 then raise exception 'Cold followup due prerequisite changed';end if;
 execute replace(d,needle,'due:=greatest(now(),p_at+interval ''3 days'');');
end $patch$;

-- New introductions identify the real account principal/company; no links.
-- A new copy version must not inherit or contaminate the old copy experiment.
alter table public.icash_seller_opener_assignments drop constraint icash_seller_opener_assignments_learning_context_check;
alter table public.icash_seller_opener_assignments add constraint icash_seller_opener_assignments_learning_context_check
 check(learning_context in ('opener-v1','interest-v2','identity-v3'));
insert into public.icash_seller_opener_variants(key,body,enabled)
 values('identity-v3','Hi, contacting you for {principal} about a cash offer. Do you own {address}? Reply STOP to opt out.',true);
create or replace function public.icash_assign_seller_opener(p_account uuid,p_thread uuid) returns jsonb
language plpgsql security invoker set search_path='' as $function$
declare existing public.icash_seller_opener_assignments;chosen public.icash_seller_opener_variants;
begin
 perform 1 from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' for update;
 if not found then return null;end if;
 select * into existing from public.icash_seller_opener_assignments where thread_id=p_thread and account_id=p_account;
 if found then return jsonb_build_object('variant',existing.variant,'body',existing.body,'context',existing.learning_context);end if;
 select * into chosen from public.icash_seller_opener_variants where key='identity-v3' and enabled;
 if not found then return null;end if;
 insert into public.icash_seller_opener_assignments(thread_id,account_id,variant,body,learning_context)
 values(p_thread,p_account,chosen.key,chosen.body,'identity-v3');
 return jsonb_build_object('variant',chosen.key,'body',chosen.body,'context','identity-v3');
end $function$;
create function public.icash_seller_identity_opener(p_principal text,p_address text) returns text
language plpgsql immutable security invoker set search_path='' as $function$
declare body text;
begin
 if nullif(trim(p_principal),'') is null or nullif(trim(p_address),'') is null then return null;end if;
 body:='Hi, contacting you for '||trim(p_principal)||' about a cash offer. Do you own '||trim(p_address)||'? Reply STOP to opt out.';
 if length(body)>160 or body ~ '[^A-Za-z0-9 .,!?]' then return null;end if;
 return body;
end $function$;
do $copy$
declare d text;signature text;needle text;
begin
 foreach signature in array array['icash_queue_seller_opener(uuid,uuid)','icash_seller_opener_candidate_body(uuid,uuid)'] loop
  d:=pg_get_functiondef(('public.'||signature)::regprocedure);
  needle:=$old$message_body:='Is this '||case when seller is null then '' else seller||', ' end||'the owner of '||address||'? I am reaching out about a possible cash offer.';$old$;
  if strpos(d,needle)=0 then raise exception 'Identity copy prerequisite changed: %',signature;end if;
  d:=replace(d,needle,'message_body:=public.icash_seller_identity_opener(principal,address);');
  d:=replace(d,'select trim(i.principal),','select trim(coalesce(nullif(trim(i.company_name),''''),i.principal)),');
  -- Explicit null is important: SQL null comparisons alone do not reject a hold.
  d:=replace(d,'if length(message_body)>160','if message_body is null or length(message_body)>160');
  execute d;
 end loop;
 d:=pg_get_functiondef('public.icash_seller_recipient_opener(uuid,uuid,text,text,text)'::regprocedure);
 needle:=$old$body:=case ordinal
  when 1 then 'Is this '||case when p_seller ~ '^[A-Za-z][A-Za-z]{0,30}$' then p_seller||', ' else '' end||'the owner of '||p_address||'? I am reaching out about a possible cash offer.'
  when 2 then greeting||'do you own '||p_address||'? I wanted to ask about a possible cash offer.'
  when 3 then greeting||'is '||p_address||' your property? I am contacting you about a possible cash offer.'
 end;$old$;
 if strpos(d,needle)=0 then raise exception 'Recipient identity copy prerequisite changed';end if;
 execute replace(d,needle,'body:=public.icash_seller_identity_opener(p_principal,p_address);');
end $copy$;
revoke all on function public.icash_seller_text_cadence_current(uuid,uuid,uuid,boolean),public.icash_seller_text_operation_current(uuid,text),public.icash_seller_identity_opener(text,text) from public,anon,authenticated;
grant execute on function public.icash_seller_text_cadence_current(uuid,uuid,uuid,boolean),public.icash_seller_text_operation_current(uuid,text),public.icash_seller_identity_opener(text,text) to service_role;
commit;
