begin;
-- Direct source words only; retain quoted/negated speech and price conditions.
set local lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.icash_seller_response_disposition(p_body text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare b text:=trim(regexp_replace(lower(replace(replace(replace(replace(coalesce(p_body,''),'’',chr(39)),'‘',chr(39)),'“','"'),'”','"')),'[[:space:]]+',' ','g'));decline_body text;
begin
 if public.icash_seller_direct_response_match(b,$pattern$(?:^|[.!?;] +)(?:please )?stop(?: please)?[.! ,]*$|\y(?:stop|quit) (?:asking|bothering|harassing) (?:me|us)\y|\yplease unsubscribe(?: me)?\y|(?:^|[,;.!] +)(?:please )?(?:unsubscribe|dnc)(?: me)?[.! ,]*$|^(?:please )?(?:stop|stopall|unsubscribe|cancel|end|quit|revoke|opt out|dnc)(?: please)?(?:[.! ,]*$|\s*[,;.!]\s*(?:please\y|call\y|text\y|but\y))|\y(?:(?:do not|don't|dont) want (?:you|your (?:company|business)) to (?:ever )?(?:call|text|email|contact)\y|(?:do not|don't|dont|never) (?:ever )?(?:call|text|email|message|contact)(?:ing)?(?: (?:me|us))?\y(?! (?:it|that|the house|the property)\y)|(?:stop|quit) (?:(?:calling|texting|emailing|messaging|contacting)\y|(?:call|text|email|message|contact)\y(?! (?:it|that|the house|the property)\y))|(?:unsubscribe|remove|delete) (?:me|my number)\y|take (?:me|my number) off\y|leave (?:me|us) alone\y|(?:put|add|place) (?:me|my number) (?:on|in) (?:your |the )?(?:dnc|do not call)(?: list)?\y|(?:i am|i'm) (?:already )?on (?:the |your )?(?:dnc|do not call) list\y)$pattern$) then return 'opt_out';end if;
 decline_body:=case when b ~ '\y(call|talk)\y' then regexp_replace(b,$pattern$\ynot (?:(?:super|very|really|that|at all) )?interested in (?:texting|emailing|emails|texts)\y$pattern$,'','g') else b end;
 if public.icash_seller_direct_response_match(decline_body,$pattern$\y(?:i|we)(?:'ve)? (?:(?:have|already) ){0,2}told (?:you|yall|y'all|you all) no\y|\y(?:i|we) (?:will not|won't|wont) (?:ever )?sell\y|\y(?:no thanks|no thank you|wrong number|not (?:(?:super|very|really|that|at all) )?interested|(?:do not|don't|dont) want to sell|not selling(?: (?:my|our|the) (?:house|home|property))?|no quiero vender|no me interesa vender)\y$pattern$) then
  return case when b ~ '\y(unless|if|but)\y|[$]|\yprice\y' then 'review' else 'declined' end;
 end if;
 if public.icash_seller_direct_response_match(b,$pattern$\y(?:tired|sick) of (?:these|your|the) (?:texts|messages|calls)\y|\y(?:scam|scammer|scammers|fraud|fraudulent|suspicious|(?:i am|i'm|we are|we're) not (?:comfortable|ready)|need to think|never agreed|hold off|not for me|no interest|not looking to sell|(?:do not|don't|dont) trust|not now|not sure (?:about|i want)|stop bothering|waste of (?:my )?time)\y|^(?:not comfortable|not ready)[.! ,]*$$pattern$) then
  if strpos(b,'?')=0 and b ~ $pattern$\y(?:not|isn't|is not|wasn't|was not) (?:a )?(?:scam|fraud)\y$pattern$
   and not public.icash_seller_direct_response_match(b,$pattern$\y(?:tired|sick) of (?:these|your|the) (?:texts|messages|calls)\y|\y(?:suspicious|(?:i am|i'm|we are|we're) not (?:comfortable|ready)|need to think|never agreed|hold off|not for me|no interest|not looking to sell|(?:do not|don't|dont) trust|not now|not sure (?:about|i want)|stop bothering|waste of (?:my )?time)\y|^(?:not comfortable|not ready)[.! ,]*$$pattern$) then return null;end if;
  return 'review';
 end if;
 return null;
end $function$
;

-- Recipient-wide cold seller cadence. These guards only deny; original
-- contact, money, sender, account and receipt rules remain the send authority.
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

-- Owner-only receipt summary; no provider probes, messages or invented complaint data.
set local lock_timeout='5s';
create function public.icash_owner_text_health(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $function$
declare start_at timestamptz:=now()-interval '24 hours';
 today_at timestamptz:=date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago';
 result jsonb;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required' using errcode='42501';end if;
 with lines as materialized (
  select phone,enabled from public.icash_text_senders
 ), outgoing as materialized (
  select m.id,m.state,m.provider_id,t.sender,t.recipient,o.dispatched_at at
  from public.icash_operation_spend o join public.icash_text_messages m on o.operation_key='text:'||m.id and o.account_id=m.account_id
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  where o.dispatched_at between least(start_at,today_at) and now() and m.direction='outgoing'
 ), incoming as materialized (
  select distinct on (event_key) * from (
   select coalesce(m.event_id,m.provider_id,m.id::text) event_key,t.sender line,t.recipient phone,m.body,m.created_at at,t.account_id,t.id thread_id
   from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
   where m.direction='incoming' and m.state='received' and (m.event_id is not null or m.provider_id is not null) and m.created_at between start_at and now()
   union all
   select event_id,recipient,sender,body,created_at,null::uuid,null::uuid from public.icash_lifecycle_text_inbox where created_at between start_at and now()
  ) source order by event_key,thread_id nulls last
 ), human as materialized (
  select *,public.icash_seller_response_disposition(body) disposition
  from incoming where body ~ '[[:alnum:]]' and body !~* '(^Free Msg:|Message Blocking is active|verification code|one.time (password|code))'
 ), stats as (
  select l.phone,l.enabled,
   (select count(distinct provider_id) from outgoing where sender=l.phone and at>=today_at and state in ('accepted','delivered') and provider_id is not null) accepted_today,
   (select count(distinct provider_id) from outgoing where sender=l.phone and at>=start_at and state in ('accepted','delivered') and provider_id is not null) accepted,
   (select count(distinct recipient) from outgoing where sender=l.phone and at>=start_at and state in ('accepted','delivered') and provider_id is not null) recipients,
   (select count(distinct provider_id) from outgoing where sender=l.phone and at>=start_at and state='delivered' and provider_id is not null) delivered,
   (select count(*) from outgoing where sender=l.phone and at>=start_at and state='needs_review') review,
   (select count(*) from incoming where line=l.phone and body ~* '(^Free Msg:|Message Blocking is active)') blocked,
   (select count(distinct phone) from human where line=l.phone) replies,
   (select count(distinct phone) from human where line=l.phone and disposition='opt_out') opt_outs,
   (select count(distinct phone) from human where line=l.phone and disposition in ('declined','review')) refusals,
   (select count(distinct phone) from human where line=l.phone and public.icash_seller_direct_response_match(lower(body),'\y(spam|reported|reporting|harassing|harassment|tired of these texts|stop bothering)\y')) complaints,
   (select count(distinct phone) from human where line=l.phone and thread_id is not null and disposition is null and public.icash_seller_sms_interest_at(account_id,thread_id,start_at,now()) is not null) interested,
   (select count(distinct provider_id) from public.icash_customer_update_deliveries u where u.sender=l.phone and u.channel='sms' and u.provider_id is not null and u.authorized_at between today_at and now()) customer_today,
   (select max(at) from (
    select m.created_at at from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
     where t.sender=l.phone and m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)
      and m.body ~ '[[:alnum:]]' and m.body !~* '(^Free Msg:|Message Blocking is active|verification code|one.time (password|code))'
    union all
    select created_at from public.icash_lifecycle_text_inbox where recipient=l.phone
     and body ~ '[[:alnum:]]' and body !~* '(^Free Msg:|Message Blocking is active|verification code|one.time (password|code))'
   ) seen where at<=now()) last_incoming
  from lines l
 )
 select jsonb_build_object('checkedAt',now(),'startAt',start_at,'todayAt',today_at,'timezone','America/Chicago','providerComplaintReports',null,
  'lines',coalesce(jsonb_agg(jsonb_build_object(
   'phone',phone,'enabled',enabled,'propertyAcceptedToday',accepted_today,'propertyAccepted24h',accepted,'propertyRecipients24h',recipients,
   'propertyDelivered24h',delivered,'propertyReview24h',review,'blockedNotices24h',blocked,'replyRecipients24h',replies,
   'optOutRecipients24h',opt_outs,'refusalRecipients24h',refusals,'complaintWordingRecipients24h',complaints,'interestedRecipients24h',interested,
   'customerUpdatesToday',customer_today,'lastIncomingAt',last_incoming,
   'incomingStatus',case when not enabled then 'paused' when blocked>0 then 'blocking_reported' when last_incoming>=start_at then 'observed' else 'unverified' end
  ) order by phone),'[]'::jsonb)) into result from stats;
 return result;
end $function$;
revoke all on function public.icash_owner_text_health(uuid) from public,anon,authenticated;
grant execute on function public.icash_owner_text_health(uuid) to service_role;
commit;
