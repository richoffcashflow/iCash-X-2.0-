-- Reviewed direct cash questions. Install disabled; activate with a fresh cutover.
-- Existing messages, assignments, permissions and original delivery evidence stay intact.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$ declare r record;begin
 for r in select * from (values
 ('public.icash_queue_seller_opener(uuid,uuid)','ce388f2db5db722df45322660666345b'),
 ('public.icash_seller_opener_candidate_body(uuid,uuid)','36eaf52483b77700680ecd293ec2e8f6'),
 ('icash_prepare_sms_inbound_reply(uuid,uuid,uuid)','76246985c88b771d25b3c69736c8485a'),
 ('icash_prepare_sms_reply_before_owner_question(uuid,uuid,uuid)','7da3cf93937ef15fa231f99f9a1fc584'),
 ('icash_seller_dialogue_context(uuid,uuid)','12e63f1224077b26d6b0f743da59b2a4'),
 ('icash_seller_reply_before_viewings(uuid,uuid)','60696ae14ade5514aa61b541c98f987f'),
 ('public.icash_guard_seller_sms_learning_assignment()','08c770da2ee7d04d1675fb1cefd2daad')
 ) v(signature,checksum) loop
 if md5(pg_get_functiondef(to_regprocedure(r.signature))) is distinct from r.checksum then raise exception 'Seller cash question prerequisite changed: %',r.signature;end if;end loop;
end $guard$;
create table icash_learning_policy_private.cash_question_settings(id integer primary key check(id=1),enabled_at timestamptz);
insert into icash_learning_policy_private.cash_question_settings values(1,null);
alter table icash_learning_policy_private.cash_question_settings enable row level security;
revoke all on icash_learning_policy_private.cash_question_settings from public,anon,authenticated;
grant select,update on icash_learning_policy_private.cash_question_settings to service_role;
alter table public.icash_seller_opener_assignments drop constraint icash_seller_opener_assignments_learning_context_check;
alter table public.icash_seller_opener_assignments add constraint icash_seller_opener_assignments_learning_context_check
 check(learning_context in ('opener-v1','interest-v2','identity-v3','identity-v4','identity-v5','cash-question-v6'));
insert into public.icash_seller_opener_variants(key,body,enabled) values
 ('cash_sale_v6','Hi, have you considered a cash sale for {address}?',true),
 ('all_cash_v6','Hi, would you consider selling {address} for all cash?',true),
 ('cash_offer_v6','Hi, would you be open to a cash offer for {address}?',true);
create function public.icash_seller_cash_questions_enabled() returns boolean language sql stable set search_path='' as $$
 select coalesce((select enabled_at<=now() from icash_learning_policy_private.cash_question_settings where id=1),false)
$$;
create function public.icash_seller_cash_question(p_variant text,p_address text) returns text language plpgsql immutable set search_path='' as $$
declare body text;begin
 if nullif(trim(p_address),'') is null then return null;end if;
 body:=case p_variant when 'cash_sale_v6' then 'Hi, have you considered a cash sale for '||trim(p_address)||'?'
 when 'all_cash_v6' then 'Hi, would you consider selling '||trim(p_address)||' for all cash?'
 when 'cash_offer_v6' then 'Hi, would you be open to a cash offer for '||trim(p_address)||'?' end;
 if length(body)>160 or body ~ '[^A-Za-z0-9 .,!?&#/-]' then return null;end if;return body;
end $$;
-- Stable balanced allocation; do not label historical ownership questions as a
-- treatment or claim an unmeasured winner. The private report separates any
-- response from a source-bound positive selling response and opt-outs.
create function public.icash_seller_cash_question_plan(p_account uuid,p_thread uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare address text;principal text;choices text[];chosen text;unit text;bucket bigint;eligible boolean;
begin
 if not public.icash_seller_cash_questions_enabled() then return null;end if;
 select public.icash_conversation_street(d.terms->>'address'),trim(coalesce(nullif(trim(i.company_name),''),i.principal)),coalesce(nullif(j.snapshot->>'propertyId',''),t.id::text)
 into address,principal,unit from public.icash_text_threads t
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 join public.icash_screening_jobs j on j.id=d.screening_id and j.account_id=d.account_id
 join public.icash_customer_identities i on i.account_id=t.account_id
 where t.id=p_thread and t.account_id=p_account and t.party='seller';
 if nullif(principal,'') is null then return null;end if;
 eligible:=public.icash_seller_sms_learning_eligible(p_account,p_thread);
 select array_agg(v.key order by v.key) into choices from public.icash_seller_opener_variants v
 where v.enabled and v.key in ('cash_sale_v6','all_cash_v6','cash_offer_v6')
 and v.body=replace(public.icash_seller_cash_question(v.key,'ADDRESS'),'ADDRESS','{address}')
 and public.icash_seller_cash_question(v.key,address) is not null;
 if coalesce(cardinality(choices),0)=0 then return null;end if;
 bucket:=('x'||substr(md5(p_account::text||unit||':cash-question-v6'),1,8))::bit(32)::bigint;
 chosen:=case when eligible then choices[1+bucket%cardinality(choices)] when 'cash_sale_v6'=any(choices) then 'cash_sale_v6' else choices[1] end;
 return jsonb_build_object('variant',chosen,'body',public.icash_seller_cash_question(chosen,address),'context','cash-question-v6');
end $$;
create function public.icash_assign_seller_opener_v6(p_account uuid,p_thread uuid) returns jsonb language plpgsql set search_path='' as $$
declare existing public.icash_seller_opener_assignments;plan jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' for update;
 if not found then return null;end if;
 select * into existing from public.icash_seller_opener_assignments where thread_id=p_thread and account_id=p_account;
 if found then return jsonb_build_object('variant',existing.variant,'body',existing.body,'context',existing.learning_context);end if;
 if not public.icash_seller_cash_questions_enabled() then return public.icash_assign_seller_opener_v5(p_account,p_thread);end if;
 plan:=public.icash_seller_cash_question_plan(p_account,p_thread);if plan is null then return null;end if;
 insert into public.icash_seller_opener_assignments(thread_id,account_id,variant,body,learning_context)
 values(p_thread,p_account,plan->>'variant',plan->>'body','cash-question-v6');return plan;
end $$;
-- This is a question about selling interest, never evidence of ownership,
-- authorization to negotiate, permission renewal or agreement to a price.
create function public.icash_seller_cash_question_message(p_account uuid,p_thread uuid) returns uuid language sql stable set search_path='' as $$
 select m.id from public.icash_text_messages m where m.account_id=p_account and m.thread_id=p_thread and m.direction='outgoing'
 and m.state='delivered' and nullif(m.provider_id,'') is not null and m.last_delivery_at between m.created_at and now()
 and (exists(select 1 from public.icash_seller_opener_assignments a where a.account_id=p_account and a.thread_id=p_thread and a.message_id=m.id and a.body=m.body and a.learning_context='cash-question-v6')
 or exists(select 1 from public.icash_text_ai_jobs j where j.account_id=p_account and j.thread_id=p_thread and j.outgoing_id=m.id and j.analysis->>'dialogueAction'='cash_identity_v6' and m.body like '% Have you considered a cash sale?'))
 and not exists(select 1 from public.icash_text_messages newer where newer.account_id=p_account and newer.thread_id=p_thread and newer.direction='outgoing' and newer.id<>m.id
  and (newer.created_at,newer.id)>(m.created_at,m.id) and newer.state in ('ready','dispatching','accepted','delivered','needs_review'))
 order by m.created_at desc,m.id desc limit 1
$$;
create function public.icash_seller_has_cash_question(p_account uuid,p_thread uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_seller_opener_assignments a where a.account_id=p_account and a.thread_id=p_thread and a.learning_context='cash-question-v6') or public.icash_seller_cash_question_message(p_account,p_thread) is not null
$$;
create function public.icash_seller_cash_identity_reply(p_question text,p_address text) returns text language plpgsql immutable set search_path='' as $$
declare b text;reply text;begin
 b:=lower(trim(regexp_replace(replace(p_question,'’',chr(39)),'[[:space:]]+',' ','g')));
 if b ~ '^(hi[,! ]+|hello[,! ]+|hey[,! ]+)?(who is this|who are you|who''s this|whos this|who called)[?! .]*$' then
  if nullif(trim(p_address),'') is null then return null;end if;
  reply:='I am a cash buyer reaching out about '||trim(p_address)||'. Have you considered a cash sale?';
 elsif b ~ '^(are you|is this) (a |an )?(human|real person|bot|ai|robot|automated (bot|assistant))[?! .]*$' then
  reply:='I am an AI assistant working with a cash buyer. I can help with questions about a possible cash sale.';
 end if;
 if length(reply)>160 or reply ~ '[^A-Za-z0-9 .,!?&#/-]' then return null;end if;return reply;
end $$;
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure);
 old:=$old$ -- Retain the existing one-segment rate.$old$;replacement:=$new$ if public.icash_seller_cash_questions_enabled() then
  choice:=public.icash_seller_cash_question_plan(p_account,t.id);message_body:=choice->>'body';
 end if;
 -- Retain the existing one-segment rate.$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Cash question boundary changed: icash_queue_seller_opener(uuid,uuid)';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_seller_opener_candidate_body(uuid,uuid)'::regprocedure);
 old:=$old$ -- Retain the existing one-segment rate.$old$;replacement:=$new$ if public.icash_seller_cash_questions_enabled() then
  choice:=public.icash_seller_cash_question_plan(p_account,t.id);message_body:=choice->>'body';
 end if;
 -- Retain the existing one-segment rate.$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Cash question boundary changed: icash_seller_opener_candidate_body(uuid,uuid)';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure);
 old:=$old$choice:=public.icash_assign_seller_opener_v5(p_account,t.id);$old$;replacement:=$new$choice:=public.icash_assign_seller_opener_v6(p_account,t.id);$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Cash question boundary changed: icash_queue_seller_opener(uuid,uuid)';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure);
 old:=$old$if choice->>'context'='identity-v5' then$old$;replacement:=$new$if choice->>'context' in ('identity-v5','cash-question-v6') then$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Cash question boundary changed: icash_queue_seller_opener(uuid,uuid)';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_guard_seller_sms_learning_assignment()'::regprocedure);
 old:=$old$(old.learning_context='identity-v5' or new.learning_context='identity-v5')$old$;replacement:=$new$(old.learning_context in ('identity-v5','cash-question-v6') or new.learning_context in ('identity-v5','cash-question-v6'))$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Cash question boundary changed: icash_guard_seller_sms_learning_assignment()';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_prepare_sms_inbound_reply(uuid,uuid,uuid)'::regprocedure);
 old:=$old$ if opening.owner_reply_id=p_reply then$old$;replacement:=$new$ if public.icash_seller_has_cash_question(p_account,t.id) then return public.icash_prepare_sms_reply_before_owner_question(p_account,p_thread,p_reply);end if;
 if opening.owner_reply_id=p_reply then$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Cash question boundary changed: icash_prepare_sms_inbound_reply(uuid,uuid,uuid)';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_prepare_sms_reply_before_owner_question(uuid,uuid,uuid)'::regprocedure);
 old:=$old$case when opening.thread_id is null then a.message_id else opening.interest_message_id end$old$;replacement:=$new$case when opening.thread_id is null or a.learning_context='cash-question-v6' then a.message_id else opening.interest_message_id end$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Cash question boundary changed: icash_prepare_sms_reply_before_owner_question(uuid,uuid,uuid)';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_seller_dialogue_context(uuid,uuid)'::regprocedure);
 old:=$old$owner_unknown:=exists(select 1 from public.icash_sms_seller_openings o where o.account_id=p_account and o.thread_id=t.id and o.owner_reply_id is null);$old$;replacement:=$new$owner_unknown:=not public.icash_seller_has_cash_question(p_account,t.id) and exists(select 1 from public.icash_sms_seller_openings o where o.account_id=p_account and o.thread_id=t.id and o.owner_reply_id is null);$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Cash question boundary changed: icash_seller_dialogue_context(uuid,uuid)';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_seller_reply_before_viewings(uuid,uuid)'::regprocedure);
 old:=$old$reply text;kind text;$old$;replacement:=$new$reply text;cash_identity boolean:=false;kind text;$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Cash question boundary changed: icash_seller_reply_before_viewings(uuid,uuid)';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_seller_reply_before_viewings(uuid,uuid)'::regprocedure);
 old:=$old$  if b ~ '(are you|is this).*(human|real person|bot|ai|robot|automated)' then$old$;replacement:=$new$  if exists(select 1 from icash_learning_policy_private.cash_question_settings where id=1 and enabled_at<=m.created_at and enabled_at<=now()) then
   reply:=public.icash_seller_cash_identity_reply(m.body,public.icash_conversation_street(ctx->>'address'));
   cash_identity:=reply is not null;
  end if;
  if cash_identity then null;
  elsif b ~ '(are you|is this).*(human|real person|bot|ai|robot|automated)' then$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Cash question boundary changed: icash_seller_reply_before_viewings(uuid,uuid)';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_seller_reply_before_viewings(uuid,uuid)'::regprocedure);
 old:=$old$if length(reply)>160 or (reply ~ '[^A-Za-z0-9 .,!?]' and length(reply)>35) then$old$;replacement:=$new$if length(reply)>160 or (case when cash_identity then reply ~ '[^A-Za-z0-9 .,!?&#/-]' else reply ~ '[^A-Za-z0-9 .,!?]' and length(reply)>35 end) then$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Cash question boundary changed: icash_seller_reply_before_viewings(uuid,uuid)';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_prepare_sms_reply_before_owner_question(uuid,uuid,uuid)'::regprocedure);
 old:=$old$ positive:=lower(trim(m.body))$old$;replacement:=$new$ if public.icash_seller_cash_question_message(p_account,t.id) is not null then select * into opener from public.icash_text_messages where id=public.icash_seller_cash_question_message(p_account,t.id) and account_id=p_account and thread_id=t.id;end if;
 positive:=lower(trim(m.body))$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Cash question boundary changed: icash_prepare_sms_reply_before_owner_question(uuid,uuid,uuid)';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_seller_dialogue_context(uuid,uuid)'::regprocedure);
 old:=$old$ elsif public.icash_seller_post_call_identity_reply(p_account,m.id) is not null then$old$;replacement:=$new$ elsif exists(select 1 from icash_learning_policy_private.cash_question_settings where id=1 and enabled_at<=m.created_at and enabled_at<=now())
  and public.icash_seller_cash_identity_reply(m.body,(select public.icash_conversation_street(d.terms->>'address') from public.icash_deal_files d where d.id=t.deal_id and d.account_id=p_account)) is not null then
  action:='cash_identity_v6';reply:=public.icash_seller_cash_identity_reply(m.body,(select public.icash_conversation_street(d.terms->>'address') from public.icash_deal_files d where d.id=t.deal_id and d.account_id=p_account));
 elsif public.icash_seller_post_call_identity_reply(p_account,m.id) is not null then$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Cash question boundary changed: icash_seller_dialogue_context(uuid,uuid)';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_seller_dialogue_context(uuid,uuid)'::regprocedure);
 old:=$old$'ownershipUnconfirmed',owner_unknown,$old$;replacement:=$new$'ownershipUnconfirmed',owner_unknown or public.icash_seller_has_cash_question(p_account,t.id),'initialQuestionKind',case when public.icash_seller_has_cash_question(p_account,t.id) then 'cash_interest' else 'ownership' end,$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Cash question boundary changed: icash_seller_dialogue_context(uuid,uuid)';end if;
 execute replace(d,old,replacement);
end $patch$;
-- Descriptive comparison of mature, originally delivered first exposures.
-- A response is not automatically selling interest. No historical reassignment.
create function public.icash_seller_cash_question_report() returns jsonb language sql stable set search_path='' as $$
 with variants as (select unnest(array['cash_sale_v6','all_cash_v6','cash_offer_v6']) variant),
 exposures as (
  select a.*,j.snapshot->>'propertyId' property_key,o.dispatched_at started_at
  from public.icash_seller_opener_assignments a
  join public.icash_text_messages m on m.id=a.message_id and m.account_id=a.account_id and m.thread_id=a.thread_id and m.body=a.body
  join public.icash_operation_spend o on o.account_id=a.account_id and o.operation_key='text:'||m.id
  join public.icash_text_threads t on t.id=a.thread_id and t.account_id=a.account_id
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join public.icash_screening_jobs j on j.id=d.screening_id and j.account_id=d.account_id
  where a.learning_context='cash-question-v6' and public.icash_seller_sms_learning_eligible(a.account_id,a.thread_id)
   and m.direction='outgoing' and m.state='delivered' and nullif(m.provider_id,'') is not null
   and o.dispatched_at>=greatest(a.created_at,m.created_at) and o.dispatched_at<=now()
   and m.last_delivery_at between o.dispatched_at and now() and a.delivered_at between o.dispatched_at and now()
   and nullif(j.snapshot->>'propertyId','') is not null
 ), first_exposures as (
  select distinct on(account_id,property_key) * from exposures order by account_id,property_key,started_at,thread_id
 ), outcomes as (
  select e.*,now()>=e.started_at+interval '72 hours' mature,
   exists(select 1 from public.icash_text_messages r where r.account_id=e.account_id and r.thread_id=e.thread_id
    and r.direction='incoming' and r.state='received' and (nullif(r.provider_id,'') is not null or nullif(r.event_id,'') is not null)
    and r.created_at>e.started_at and r.created_at<=e.started_at+interval '72 hours') replied,
   exists(select 1 from public.icash_text_messages r where r.account_id=e.account_id and r.thread_id=e.thread_id
    and r.direction='incoming' and r.state='received' and (nullif(r.provider_id,'') is not null or nullif(r.event_id,'') is not null)
    and r.created_at>e.started_at and r.created_at<=e.started_at+interval '72 hours'
    and lower(trim(r.body)) ~ '^(yes|yeah|yep|sure|interested|i am interested|i''m interested|yes please|yes i am interested)[.! ]*$'
    and not exists(select 1 from public.icash_text_messages between_message where between_message.account_id=e.account_id and between_message.thread_id=e.thread_id
     and between_message.id not in (e.message_id,r.id) and between_message.created_at between e.started_at and r.created_at
     and (between_message.direction='incoming' and between_message.state='received' or between_message.direction='outgoing' and between_message.state in ('accepted','delivered') and between_message.provider_id is not null))) positive,
   exists(select 1 from public.icash_text_messages r where r.account_id=e.account_id and r.thread_id=e.thread_id and r.direction='incoming' and r.state='received'
    and (nullif(r.provider_id,'') is not null or nullif(r.event_id,'') is not null) and r.created_at>e.started_at and r.created_at<=e.started_at+interval '72 hours'
    and public.icash_seller_response_disposition(r.body)='opt_out') contact_opted_out
  from first_exposures e
 ), counts as (
  select v.variant,count(o.thread_id) delivered,count(distinct o.account_id) accounts,
   count(*) filter(where o.mature) mature,count(*) filter(where o.mature and o.replied) replies,
   count(*) filter(where o.mature and o.positive and not o.contact_opted_out) positive,
   count(*) filter(where o.mature and o.contact_opted_out) opted_out
  from variants v left join outcomes o using(variant) group by v.variant
 ) select jsonb_build_object('context','cash-question-v6','windowHours',72,'allocation','balanced','winner',null,
  'variants',jsonb_agg(to_jsonb(c)||jsonb_build_object('replyRate',replies::numeric/nullif(mature,0),'positiveRate',positive::numeric/nullif(mature,0)) order by variant)) from counts c
$$;
do $acl$ declare r record;begin
 for r in select p.oid::regprocedure signature from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
 ('icash_seller_cash_questions_enabled','icash_seller_cash_question','icash_seller_cash_question_plan','icash_assign_seller_opener_v6','icash_seller_has_cash_question','icash_seller_cash_question_message','icash_seller_cash_identity_reply','icash_seller_cash_question_report') loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);execute format('grant execute on function %s to service_role',r.signature);end loop;
end $acl$;
commit;
