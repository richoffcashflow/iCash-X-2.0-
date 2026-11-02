begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.icash_seller_progress_settings add column offer_enabled boolean not null default false,add column offer_enabled_at timestamptz;
-- Deliberate private-ledger access: these RPCs are service-only, never browser APIs.
-- The same offer/version ledger is used by calls and texts so channel changes do
-- not create a second price or lose an acceptance. Every write locks the deal.
create function public.icash_seller_text_offer_context(p_account uuid,p_message uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;d public.icash_deal_files;s public.icash_screening_jobs;
 j public.icash_text_ai_jobs;o icash_call_offer_private.offers;dialogue jsonb;messages jsonb;c jsonb;source_at numeric;principal text;owner_id uuid;mail text;
begin
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and direction='incoming' and state='received';
 if not found or (m.event_id is null and m.provider_id is null) then return null;end if;
 source_at:=public.icash_sms_reply_time(m.id);
 if not exists(select 1 from public.icash_seller_progress_settings where enabled and offer_enabled and offer_enabled_at is not null and source_at>=extract(epoch from offer_enabled_at))
  or source_at not between extract(epoch from now()-interval '24 hours') and extract(epoch from now()) then return null;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account and party='seller' and not paused and not manual_only and ai_mode='auto' and retired_at is null;
 if not found or public.icash_sms_thread_review_current(p_account,t.id,false) is distinct from true or not public.icash_outreach_sms_current(p_account) then return null;end if;
 select a.owner_user_id,u.email into owner_id,mail from public.icash_accounts a join auth.users u on u.id=a.owner_user_id where a.id=p_account and not a.bot_paused and u.email_confirmed_at is not null;
 if not found then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage='draft' and coalesce(terms->>'practice','false')<>'true';if not found then return null;end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account and state='complete' and completed_at between now()-interval '24 hours' and now();
 if not found or public.icash_automatic_cash_offer_price(s.snapshot) is null or s.snapshot->'raw'->'data'->>'full_address' is distinct from d.terms->>'address' then return null;end if;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=p_account;
 if principal is null or principal is distinct from d.terms->>'buyer' then return null;end if;
 if exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=s.snapshot->>'propertyId' and manual)
  or exists(select 1 from public.icash_conversations where account_id=p_account and deal_id=d.id and human_takeover)
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=s.id and state<>'resolved')
  or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
  or exists(select 1 from public.icash_signing_envelopes where account_id=p_account and deal_id=d.id and kind='purchase' and not test_mode)
  or not exists(select 1 from public.icash_sms_routes where account_id=p_account and sender=t.sender and recipient=t.recipient and not needs_review and revision=m.route_revision) then return null;end if;
 select * into j from public.icash_text_ai_jobs where message_id=m.id and account_id=p_account and thread_id=t.id;
 if j.id is not null and (j.state not in ('pending','issued','drafted','queued') or j.provider_id is not null or j.usage is not null) then return null;end if;
 if exists(select 1 from public.icash_text_messages x where x.account_id=p_account and x.thread_id=t.id and x.direction='incoming' and x.state='received' and (public.icash_sms_reply_time(x.id),x.id)>(source_at,m.id))
  or exists(select 1 from public.icash_text_messages x where x.account_id=p_account and x.thread_id=t.id and x.direction='outgoing' and x.id is distinct from j.outgoing_id and extract(epoch from x.created_at)>source_at) then return null;end if;
 if public.icash_seller_response_disposition(m.body) is not null or public.icash_seller_contact_stop(m.body) or public.icash_seller_conversation_human(m.body)
  or m.body ~* '\m(call me|callback|call back|phone call|ignore (previous|all)|system prompt|wire|bank account|lawsuit)\M' then return null;end if;
 dialogue:=public.icash_seller_dialogue_context(p_account,m.id);
 if dialogue->>'conditionState' is not null and dialogue->>'conditionState'<>'resolved' or dialogue->>'visitRequest' is not null then return null;end if;
 select * into o from icash_call_offer_private.offers where account_id=p_account and deal_id=d.id;
 if o.state->>'textThreadId' is distinct from t.id::text and m.body !~* '(\$[0-9]|[0-9][0-9,]* ?k\M|how much|what.*offer|what.*pay|asking price|send.*(contract|agreement))' then return null;end if;
 -- Do not truncate away a refusal, correction or price. Oversize histories get
 -- the existing explicit review path, never a partial conversation.
 if (select count(*) from public.icash_text_messages where account_id=p_account and thread_id=t.id)>200 then return null;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'direction',x.direction,'body',x.body,'state',x.state,'providerId',x.provider_id,'updatedAt',x.updated_at,
  'customerAuthored',x.customer_author_id is not null,'action',a.analysis->>'offerAction','quoteRevision',a.analysis->'offerState'->>'quoteRevision','priceCents',a.analysis->'offerState'->'quotedPriceCents') order by case when x.direction='incoming' then public.icash_sms_reply_time(x.id) else extract(epoch from x.created_at) end,x.id),'[]') into messages
 from public.icash_text_messages x left join public.icash_text_ai_jobs a on a.account_id=x.account_id and a.thread_id=x.thread_id and a.outgoing_id=x.id
 where x.account_id=p_account and x.thread_id=t.id and x.id is distinct from j.outgoing_id
 and (case when x.direction='incoming' then public.icash_sms_reply_time(x.id) else extract(epoch from x.created_at) end)<=source_at;
 c:=jsonb_build_object('accountId',p_account,'jobId',j.id,'threadId',t.id,'sourceId',m.id,'dealId',d.id,'screeningId',s.id,'phone',t.recipient,'ownerUserId',owner_id,'ownerEmail',mail,'principal',principal,'address',d.terms->>'address','snapshot',s.snapshot,'terms',d.terms,'messages',messages,
  'activeCallSince',(select min(dial_claimed_at) from public.icash_call_recordings where account_id=p_account and screening_id=s.id and party='seller' and dial_claimed_at is not null and call_ended_at is null));
 return c||jsonb_build_object('fingerprint',md5(c::text),'offerState',case when o.snapshot=s.snapshot then o.state else coalesce(o.state,'{}')||'{"acceptedPriceCents":null,"quoteRevision":null,"contractBlocked":true}'::jsonb end,'offerVersion',coalesce(o.version,0));
end $$;

-- Reuse the current progress ledger. A fresh supported calculation replaces only
-- routine offer holds; all other blockers, delivery receipts and stops remain.
do $patch$declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.icash_refresh_seller_reply_progress(uuid,uuid,text)'::regprocedure);
 old:='dialogue_auto boolean:=false;';replacement:=old||'offer_context jsonb;';
 if position(old in definition)=0 then raise exception 'Progress declaration changed';end if;definition:=replace(definition,old,replacement);
 old:='dialogue_auto:=dialogue->>''action''';replacement:='offer_context:=public.icash_seller_text_offer_context(p_account,p_message);'||E'\n '||old;
 if position(old in definition)=0 then raise exception 'Progress context changed';end if;definition:=replace(definition,old,replacement);
 old:='elsif dialogue->>''reason'' is not null';
 replacement:=$r$elsif j.analysis->>'offerPolicy'='seller-text-offer-v1' and j.analysis->'offerPlan'->>'kind'='review' then
  status:='needs_review';why:=j.analysis->'offerPlan'->>'reason';step:=j.analysis->'offerPlan'->>'nextStep';due:=null;
 elsif j.analysis->>'offerPolicy'='seller-text-offer-v1' and j.analysis->>'agreementClaim' is not null then
  milestone:='signature_followup';status:='waiting';why:='agreement_receipt_pending';step:='Reconcile the existing agreement and its original delivery; never create a second envelope.';wake:='original agreement delivery/signature receipt';due:=now()+interval '5 minutes';
  if e.state='completed' and e.provider_id is not null then milestone:='title_handoff';why:='agreement_completed';step:='Continue verified signing fulfillment, buyer matching and title coordination.';due:=null;
  elsif e.state='customer_signature_needed' and e.provider_id is not null then why:='customer_signature_required';step:='The seller signed. The customer must sign through the existing envelope.';due:=null;
  elsif j.analysis->>'agreementReceiptState'='unresolved' or (e.id is null and j.updated_at<now()-interval '15 minutes') then status:='needs_review';why:='agreement_receipt_unresolved';step:='Reconcile the original signing attempt; a retry must not create another contract.';due:=null;
  end if;
 elsif offer_context is not null and o.id is null and p_failure is null then
  status:='pending';why:='automatic_offer_progress';step:='Continue qualification, supported counteroffer or the remaining agreement confirmations.';milestone:='negotiation';
 $r$||old;
 if position(old in definition)=0 then raise exception 'Progress dialogue gate changed';end if;definition:=replace(definition,old,replacement);
 -- Receipts for numeric messages must reach the existing receipt branches even
 -- though the source/history necessarily contains prices.
 old:='and not dialogue_auto and not viewing_current then';
 replacement:='and not dialogue_auto and offer_context is null and not viewing_current then';
 if position(old in definition)=0 then raise exception 'Progress price gate changed';end if;definition:=replace(definition,old,replacement);
 execute definition;
end $patch$;

create function public.icash_prepare_seller_text_offer() returns trigger language plpgsql security invoker set search_path='' as $$
declare c jsonb;
begin
 if new.direction<>'incoming' or new.state<>'received' then return new;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 c:=public.icash_seller_text_offer_context(new.account_id,new.id);if c is null then return new;end if;
 insert into public.icash_text_ai_jobs(account_id,thread_id,message_id) values(new.account_id,new.thread_id,new.id) on conflict(message_id) do nothing;
 perform public.icash_refresh_seller_reply_progress(new.account_id,new.id);
 return new;
end $$;
create trigger zzzz_seller_text_offer after insert on public.icash_text_messages for each row execute function public.icash_prepare_seller_text_offer();

alter function public.icash_resume_seller_text_ai(uuid,uuid) rename to icash_resume_seller_text_before_offer;
create function public.icash_resume_seller_text_ai(p_account uuid,p_job uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;c jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where account_id=p_account and id=p_job;
 if j.state in ('pending','issued','drafted','queued') and j.provider_id is null and j.usage is null then
  c:=public.icash_seller_text_offer_context(p_account,j.message_id);
  if c is not null then
   if j.outgoing_id is null then return jsonb_build_object('mode','seller_offer','context',c);end if;
   if j.analysis->>'offerPolicy'='seller-text-offer-v1' then
    if exists(select 1 from public.icash_text_messages where account_id=p_account and id=j.outgoing_id and state='ready' and provider_id is null) then return jsonb_build_object('mode','dispatch','messageId',j.outgoing_id);end if;
    return jsonb_build_object('mode','held');
   end if;
  end if;
 end if;
 return public.icash_resume_seller_text_before_offer(p_account,p_job);
end $$;

create function public.icash_save_seller_text_offer(p_account uuid,p_job uuid,p_fingerprint text,p_version bigint,p_plan jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.icash_text_ai_jobs;c jsonb;d public.icash_deal_files;o icash_call_offer_private.offers;st jsonb;mid uuid;ceiling bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where account_id=p_account and id=p_job;
 if not found then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended((select recipient from public.icash_text_threads where id=j.thread_id and account_id=p_account),74));
 select df.* into d from public.icash_deal_files df join public.icash_text_threads t on t.deal_id=df.id and t.account_id=df.account_id where t.id=j.thread_id and t.account_id=p_account for update of df;
 c:=public.icash_seller_text_offer_context(p_account,j.message_id);
 if c is null or c->>'fingerprint' is distinct from p_fingerprint or (c->>'offerVersion')::bigint<>p_version then return null;end if;
 select * into j from public.icash_text_ai_jobs where account_id=p_account and id=p_job for update;
 if j.outgoing_id is not null then return jsonb_build_object('messageId',j.outgoing_id);end if;
 if jsonb_typeof(p_plan) is distinct from 'object' or length(p_plan::text)>12000 or p_plan->>'kind' not in ('message','review','wait','agreement') then return null;end if;
 if p_plan->>'kind'='wait' then
  update public.icash_text_ai_jobs set state='pending',next_attempt_at=now()+interval '1 minute',updated_at=now() where id=j.id;
  update public.icash_seller_reply_progress set state='waiting',reason=left(p_plan->>'reason',100),next_step=left(p_plan->>'nextStep',1000),wait_trigger='original call/message completion receipt or 15-minute reconciliation boundary',next_check_at=now()+interval '1 minute' where account_id=p_account and message_id=j.message_id;
  return jsonb_build_object('waiting',true);
 end if;
 st:=p_plan->'state';ceiling:=public.icash_automatic_cash_offer_price(c->'snapshot');
 if jsonb_typeof(st) is distinct from 'object' or (p_plan->>'kind'<>'review' and (st->>'processedSource' is distinct from j.message_id::text or st->>'textThreadId' is distinct from j.thread_id::text)) then return null;end if;
 if st->>'quotedPriceCents' is not null and (st->>'quotedPriceCents' !~ '^[1-9][0-9]{0,11}$' or (st->>'quotedPriceCents')::bigint>ceiling) then return null;end if;
 if st->>'acceptedPriceCents' is not null and st->'acceptedPriceCents' is distinct from st->'quotedPriceCents' then return null;end if;
 insert into icash_call_offer_private.offers(deal_id,account_id,state,snapshot) values(d.id,p_account,st,c->'snapshot')
 on conflict(deal_id) do update set state=excluded.state,snapshot=excluded.snapshot,version=icash_call_offer_private.offers.version+1,updated_at=now();
 insert into icash_call_offer_private.events(deal_id,account_id,call_key,action,state) values(d.id,p_account,'sms:'||j.message_id,p_plan->>'action',st);
 update public.icash_text_ai_jobs set state='drafted',analysis=jsonb_build_object('action','seller_offer','facts','[]'::jsonb,'offerPolicy','seller-text-offer-v1','offerAction',p_plan->>'action','offerFingerprint',p_fingerprint,'offerState',st,'offerPlan',p_plan),reply=p_plan->>'body',updated_at=now() where id=j.id;
 if p_plan->>'kind'='review' then
  perform public.icash_finish_seller_text_progress(p_account,j.id,'action_not_admitted');
  update public.icash_seller_reply_progress set state='needs_review',reason=left(p_plan->>'reason',100),next_step=left(p_plan->>'nextStep',1000),next_check_at=null where message_id=j.message_id and account_id=p_account;
  update public.icash_text_attention set progress_reason=left(p_plan->>'reason',100),next_step=left(p_plan->>'nextStep',1000) where message_id=j.message_id and account_id=p_account and state='open';
  return jsonb_build_object('review',true);
 end if;
 update public.icash_text_attention set state='acknowledged',updated_at=now() where account_id=p_account and thread_id=j.thread_id and message_id=j.message_id and state='open' and kind in ('seller_progress','campaign_reply');
 if p_plan->>'kind'='agreement' then return jsonb_build_object('agreement',true);end if;
 if (select count(*) from public.icash_text_ai_jobs where account_id=p_account and thread_id=j.thread_id and outgoing_id is not null and created_at>now()-interval '1 day')>=24 then
  perform public.icash_finish_seller_text_progress(p_account,j.id,'conversation_limit_reached');return null;
 end if;
 mid:=public.icash_queue_text(p_account,j.thread_id,j.id,p_plan->>'body','{}');
 if mid is null then return null;end if;
 update public.icash_text_ai_jobs set outgoing_id=mid,state='queued',updated_at=now() where id=j.id;
 return jsonb_build_object('messageId',mid);
end $$;

alter function public.icash_seller_conversation_message_current(uuid,uuid) rename to icash_seller_message_before_offer;
create function public.icash_seller_conversation_message_current(p_account uuid,p_message uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;c jsonb;m public.icash_text_messages;
begin
 select * into j from public.icash_text_ai_jobs where account_id=p_account and outgoing_id=p_message and state='queued' and analysis->>'offerPolicy'='seller-text-offer-v1';
 if not found then return public.icash_seller_message_before_offer(p_account,p_message);end if;
 c:=public.icash_seller_text_offer_context(p_account,j.message_id);
 select * into m from public.icash_text_messages where account_id=p_account and thread_id=j.thread_id and id=p_message and direction='outgoing' and state='ready' and provider_id is null;
 return c is not null and m.id is not null and public.icash_sms_message_route_current(p_account,m.id)
  and c->>'fingerprint'=j.analysis->>'offerFingerprint' and c->'offerState'=j.analysis->'offerState' and m.body=j.reply;
end $$;

-- Conditional price discussion uses the same supported calculation as a call.
-- Final payment/recipient admission is unchanged, and the context still requires
-- current research. This exception never applies to an arbitrary AI draft.
do $patch$declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.icash_claim_text_before_owner_question(uuid,uuid,text)'::regprocedure);
 old:='if not public.icash_customer_authored_text(p_account,p_message) and not public.icash_seller_recovery_nonprice_current(p_account,p_message)';
 replacement:=old||' and not (exists(select 1 from public.icash_text_ai_jobs where account_id=p_account and outgoing_id=p_message and analysis->>''offerPolicy''=''seller-text-offer-v1'') and public.icash_seller_conversation_message_current(p_account,p_message))';
 if position(old in definition)=0 then raise exception 'Final financial admission changed';end if;execute replace(definition,old,replacement);
end $patch$;

-- Share the existing durable confirmation/receipt ledger. No synthetic call or
-- voice capability is created. A claim is consumed before provider preparation.
create function public.icash_claim_seller_text_agreement(p_account uuid,p_job uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.icash_text_ai_jobs;c jsonb;d public.icash_deal_files;p jsonb;st jsonb;terms jsonb;confirmation jsonb;new_id uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where account_id=p_account and id=p_job and state='drafted' and analysis->>'offerPolicy'='seller-text-offer-v1' and analysis->'offerPlan'->>'kind'='agreement';
 if not found then return null;end if;
 select df.* into d from public.icash_deal_files df join public.icash_text_threads t on t.deal_id=df.id and t.account_id=df.account_id where t.id=j.thread_id and t.account_id=p_account for update of df;
 c:=public.icash_seller_text_offer_context(p_account,j.message_id);st:=c->'offerState';p:=j.analysis->'offerPlan';terms:=p->'terms';confirmation:=p->'confirmation';
 if c is null or c->>'fingerprint' is distinct from j.analysis->>'offerFingerprint' or st is distinct from j.analysis->'offerState'
  or st->'contractBlocked' is distinct from 'false'::jsonb or st->'acceptanceConditional' is distinct from 'false'::jsonb
  or st->>'acceptedPriceCents' is null or st->'acceptedPriceCents' is distinct from terms->'priceCents'
  or terms->'priceCents' is distinct from confirmation->'agreedPriceCents'
  or terms->>'seller' is distinct from confirmation->>'sellerLegalName' or terms->>'closingDate' is distinct from confirmation->>'closingDate'
  or confirmation->'soleOwner' is distinct from 'true'::jsonb or confirmation->'allDecisionMakersAgree' is distinct from 'true'::jsonb
  or confirmation->'priceAndDateConfirmed' is distinct from 'true'::jsonb or confirmation->'termsConfirmed' is distinct from 'true'::jsonb
  or confirmation->'sendTextRequested' is distinct from 'true'::jsonb or confirmation->'materialFactsChanged' is distinct from 'false'::jsonb
  or row(terms->'address',terms->'buyer',terms->'state') is distinct from row(d.terms->'address',d.terms->'buyer',d.terms->'state')
  or public.icash_sms_thread_review_current(p_account,j.thread_id,true) is distinct from true then return null;end if;
 if exists(select 1 from icash_seller_agreement_private.confirmations where call_key='sms:'||j.message_id)
  or exists(select 1 from public.icash_signing_envelopes where account_id=p_account and deal_id=d.id and kind='purchase' and not test_mode) then return null;end if;
 update public.icash_deal_files df set terms=p->'terms',updated_at=now() where df.id=d.id and df.account_id=p_account;
 insert into icash_seller_agreement_private.confirmations(call_key,account_id,deal_id,confirmation,terms,state)
 values('sms:'||j.message_id,p_account,d.id,confirmation,terms,'preparing') returning id into new_id;
 update public.icash_text_ai_jobs set state='handoff',analysis=analysis||jsonb_build_object('agreementClaim',new_id),updated_at=now() where id=j.id;
 update public.icash_seller_reply_progress set state='waiting',milestone='contract_preparation',reason='agreement_preparing',wait_trigger='original signing provider receipt',next_step='Prepare the confirmed agreement once and reconcile its original delivery.',next_check_at=now()+interval '15 minutes' where message_id=j.message_id and account_id=p_account;
 return c||jsonb_build_object('claimId',new_id,'sellerName',terms->>'seller');
end $$;

create function public.icash_finish_seller_text_agreement(p_account uuid,p_job uuid,p_envelope uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;e public.icash_signing_envelopes;
begin
 select * into j from public.icash_text_ai_jobs where account_id=p_account and id=p_job and analysis->>'offerPolicy'='seller-text-offer-v1' and analysis->>'agreementClaim' is not null for update;
 if not found then return false;end if;
 if p_envelope is not null then
  select env.* into e from public.icash_signing_envelopes env join public.icash_text_threads t on t.account_id=env.account_id and t.deal_id=env.deal_id
  where env.id=p_envelope and env.account_id=p_account and t.id=j.thread_id and env.kind='purchase' and not env.test_mode and env.recipients->0->>'phone'=t.recipient and env.terms=j.analysis->'offerPlan'->'terms';
  if not found then return false;end if;
 end if;
 update public.icash_text_ai_jobs set analysis=analysis||jsonb_build_object('agreementEnvelopeId',p_envelope,'agreementReceiptState',case when p_envelope is null then 'unresolved' else 'recorded' end),updated_at=now() where id=j.id;
 return true;
end $$;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('icash_seller_text_offer_context','icash_prepare_seller_text_offer','icash_resume_seller_text_ai','icash_resume_seller_text_before_offer','icash_save_seller_text_offer','icash_seller_conversation_message_current','icash_seller_message_before_offer','icash_claim_seller_text_agreement','icash_finish_seller_text_agreement') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
