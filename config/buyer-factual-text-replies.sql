begin;
-- Deterministic factual replies only. Never send model-authored prose or create consent.
create function public.icash_buyer_factual_text(p_account uuid,p_thread uuid,p_incoming text)
returns text language plpgsql stable security invoker set search_path='' as $$
declare t public.icash_text_threads;p jsonb;question text;answer text;amount numeric;link text;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='buyer';
 if not found or length(p_incoming)>400 or p_incoming is null then return null;end if;
 p:=public.icash_buyer_package_data(p_account,t.deal_id);
 if p is null then return null;end if;
 -- Anchor the WHOLE message: mixed questions, counteroffers, instructions, access,
 -- funds, deposits, legal questions and unknown phrasing remain human review.
 question:=lower(btrim(regexp_replace(p_incoming,'[?!\.]+\s*$','','g')));
 if question ~ '^(what is|what''s|whats) (the )?(asking |buyer |total )?price$|^(asking |buyer |total )?price$|^how much( is it| is the property)?$' then
  amount:=(p->>'askingPriceCents')::numeric;
  if amount is null or amount<=0 or amount<>trunc(amount) or amount>9007199254740991 then return null;end if;
  answer:='The buyer price is $'||to_char(amount/100,'FM999,999,999,999,990.00')||', including the assignment fee, plus closing costs allocated to Buyer in the agreement.';
 elsif question ~ '^(what is|what''s|whats) (the )?assignment fee$|^assignment fee$' then
  amount:=(p->>'assignmentFeeCents')::numeric;
  if amount is null or amount<0 or amount<>trunc(amount) or amount>9007199254740991 then return null;end if;
  answer:='The assignment fee is $'||to_char(amount/100,'FM999,999,999,999,990.00')||'. It is already included in the buyer price.';
 elsif question ~ '^(what is|what''s|whats) (the )?(estimated )?(repair estimate|repair cost|repairs)$|^(repair estimate|estimated repairs|repair cost)$' then
  amount:=(p->>'repairsCents')::numeric;
  if amount is null or amount<0 or amount<>trunc(amount) or amount>9007199254740991 then return null;end if;
  answer:='Estimated repairs are $'||to_char(amount/100,'FM999,999,999,999,990.00')||'. This is a research estimate, not an inspection. Please verify independently.';
 elsif question ~ '^(what is|what''s|whats) (the )?(estimated )?arv$|^(estimated )?arv$' then
  amount:=(p->>'arvCents')::numeric;
  if amount is null or amount<=0 or amount<>trunc(amount) or amount>9007199254740991 then return null;end if;
  answer:='Estimated ARV is $'||to_char(amount/100,'FM999,999,999,999,990.00')||'. This is a research estimate, not an appraisal or guaranteed resale value.';
 elsif question ~ '^(who pays( the)? closing costs|are closing costs included)$' then
  answer:='Buyer pays closing costs allocated to Buyer in the signed agreements, in addition to the buyer price.';
 elsif question ~ '^(what is|what''s|whats) (the )?closing date$|^when is closing$|^closing date$' then
  if coalesce(p->>'closingDate','')!~ '^\d{4}-\d{2}-\d{2}$' or (p->>'closingDate')::date<current_date then return null;end if;
  answer:='The package lists closing as '||(p->>'closingDate')||'. The signed terms and title review control; this is not confirmation that closing is scheduled.';
 elsif question ~ '^(what is an assignment|what does assignment mean)$' then
  answer:='An assignment transfers the right to buy under the purchase contract. The opportunity is a contract interest; it does not mean we own the property.';
 elsif question ~ '^(please )?(send( me)?|can you send( me)?|could you send( me)?) (the )?(deal |buyer )?package$|^(deal |buyer )?package$' then
  select 'https://www.geticashx.com/d/'||l.token into link from public.icash_buyer_package_links l
  join public.icash_disposition_authorities a on a.deal_id=l.deal_id and a.account_id=l.account_id and a.purchase_envelope_id=l.purchase_envelope_id
  where l.account_id=p_account and l.deal_id=t.deal_id and l.revoked_at is null and a.expires_at>now()
  and l.asking_price_cents=(p->>'askingPriceCents')::bigint and l.token ~ '^[a-f0-9]{32}$';
  if link is null then return null;end if;
  answer:='Here is the approved deal summary: '||link;
 else return null;
 end if;
 return 'AI assistant: '||answer;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then return null;
end $$;

create function public.icash_queue_buyer_factual_reply(p_account uuid,p_job uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;m public.icash_text_messages;reply_body text;outgoing uuid;prop text;
begin
 -- Same budget-first lock order as incoming STOP, queue and spend claims.
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account;
 if t.id is null or t.party<>'buyer' then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account for update;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account for update;
 if j.state<>'drafted' or j.outgoing_id is not null or t.paused or t.ai_mode<>'auto' or t.retired_at is not null then return null;end if;
 if j.analysis->>'action' is distinct from 'review' or
 coalesce((j.analysis->>'humanRequested')::boolean,false) or coalesce((j.analysis->>'callbackRequested')::boolean,false) or
 coalesce((j.analysis->>'optedOut')::boolean,false) or coalesce((j.analysis->>'declined')::boolean,false) then return null;end if;
 if not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) or
 exists(select 1 from public.icash_text_suppressions where phone=t.recipient) or
 public.icash_sms_thread_review_current(p_account,t.id,false) is distinct from true then return null;end if;
 select s.snapshot->>'propertyId' into prop from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id where d.id=t.deal_id and d.account_id=p_account;
 if prop is null or exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=prop and manual) then return null;end if;
 select * into m from public.icash_text_messages where id=j.message_id and account_id=p_account and thread_id=t.id and direction='incoming' and state='received';
 if not found or exists(select 1 from public.icash_text_messages x where x.thread_id=t.id and x.id<>m.id and x.created_at>=m.created_at) then return null;end if;
 reply_body:=public.icash_buyer_factual_text(p_account,t.id,m.body);
 if reply_body is null or length(reply_body)>500 then return null;end if;
 if exists(select 1 from public.icash_text_messages x where x.thread_id=t.id and x.direction='outgoing' and x.body=reply_body) then return null;end if;
 if (select count(*) from public.icash_text_ai_jobs where thread_id=t.id and outgoing_id is not null and created_at>now()-interval '1 day')>=12 then return null;end if;
 outgoing:=public.icash_queue_text(p_account,t.id,j.id,reply_body,'{}');
 if outgoing is null then return null;end if;
 update public.icash_text_ai_jobs set outgoing_id=outgoing,state='queued',analysis=analysis||jsonb_build_object('action','buyer_factual','factualPolicy','approved-package-v1'),updated_at=now() where id=j.id;
 return outgoing;
end $$;

-- Seller acquisition mode must not suppress the separate signed-deal buyer lane.
-- Change only the two verified guards; all existing policy/payment delegates stay.
do $buyer_lane$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_claim_text_ai(uuid,uuid)'::regprocedure);
 needle:=$old$if exists(select 1 from public.icash_outreach_campaigns where account_id=p_account and mode='sms_inbound') then return null;end if;$old$;
 replacement:=$new$if exists(select 1 from public.icash_outreach_campaigns where account_id=p_account and mode='sms_inbound')
 and not exists(select 1 from public.icash_text_ai_jobs j join public.icash_text_threads t on t.id=j.thread_id and t.account_id=j.account_id
 where j.id=p_job and j.account_id=p_account and t.party='buyer' and not t.paused and t.ai_mode='auto' and t.retired_at is null
 and public.icash_buyer_package_data(p_account,t.deal_id) is not null) then return null;end if;$new$;
 if position(needle in definition)=0 or position('icash_claim_text_ai_before_campaign' in definition)=0 then raise exception 'Buyer analysis wrapper changed';end if;
 execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('public.icash_claim_text_before_owner_question(uuid,uuid,text)'::regprocedure);
 needle:=$old$ if exists(select 1 from public.icash_text_ai_jobs where outgoing_id=p_message and account_id=p_account) then return null;end if;$old$;
 replacement:=$new$ if exists(select 1 from public.icash_text_ai_jobs where outgoing_id=p_message and account_id=p_account)
 and not exists(select 1 from public.icash_text_ai_jobs j join public.icash_text_messages incoming on incoming.id=j.message_id and incoming.account_id=j.account_id and incoming.thread_id=j.thread_id
 where j.account_id=p_account and j.thread_id=t.id and j.outgoing_id=p_message and j.state='queued'
 and t.party='buyer' and t.ai_mode='auto' and not t.paused and t.retired_at is null
 and j.analysis->>'action'='buyer_factual' and j.analysis->>'factualPolicy'='approved-package-v1'
 and incoming.direction='incoming' and incoming.state='received'
 and m.body=public.icash_buyer_factual_text(p_account,t.id,incoming.body)) then return null;end if;$new$;
 if position(needle in definition)=0 or position('return public.icash_claim_text_before_campaign' in definition)=0 then raise exception 'Buyer dispatch wrapper changed';end if;
 execute replace(definition,needle,replacement);
end $buyer_lane$;

-- Current signatures, package content and latest-message checks are re-evaluated
-- immediately before the existing dispatch chain checks consent, STOP and spend.
alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_buyer_factual;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;incoming public.icash_text_messages;outgoing public.icash_text_messages;expected text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where account_id=p_account and outgoing_id=p_message;
 if found and j.analysis->>'action'='buyer_factual' then
  select * into t from public.icash_text_threads where account_id=p_account and id=j.thread_id;
  if t.id is null then return null;end if;
  perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
  select * into t from public.icash_text_threads where account_id=p_account and id=j.thread_id for update;
  perform 1 from public.icash_deal_files where account_id=p_account and id=t.deal_id for share;
  select * into incoming from public.icash_text_messages where account_id=p_account and id=j.message_id and thread_id=t.id and direction='incoming' and state='received';
  select * into outgoing from public.icash_text_messages where account_id=p_account and id=p_message and thread_id=t.id;
  if t.id is null or t.party<>'buyer' or t.paused or t.ai_mode<>'auto' or incoming.id is null or outgoing.id is null then return null;end if;
  if exists(select 1 from public.icash_text_messages x where x.thread_id=t.id and x.id not in (incoming.id,outgoing.id) and x.created_at>=incoming.created_at) then return null;end if;
  expected:=public.icash_buyer_factual_text(p_account,t.id,incoming.body);
  if expected is null or outgoing.body is distinct from expected then return null;end if;
 end if;
 return public.icash_claim_text_before_buyer_factual(p_account,p_message,p_sender);
end $$;
revoke all on function public.icash_buyer_factual_text(uuid,uuid,text),public.icash_queue_buyer_factual_reply(uuid,uuid),public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_buyer_factual(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_buyer_factual_text(uuid,uuid,text),public.icash_queue_buyer_factual_reply(uuid,uuid),public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_buyer_factual(uuid,uuid,text) to service_role;
commit;
