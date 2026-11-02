-- Production buyer queue and reply captured 2026-11-02. No customer data.
CREATE OR REPLACE FUNCTION public.icash_buyer_factual_text(p_account uuid, p_thread uuid, p_incoming text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare p jsonb;deal uuid;b text;
begin
 select deal_id into deal from public.icash_text_threads where account_id=p_account and id=p_thread and party='buyer';
 if not found or p_incoming is null or length(p_incoming)>1500 then return null;end if;
 p:=public.icash_buyer_package_data(p_account,deal);if p is null then return null;end if;
 b:=lower(btrim(p_incoming));
 if b ~ '\m(stop|unsubscribe|not interested|no thanks|human|real person)\M' then return null;end if;
 if b ~ '\m(spread|margin|markup|mark.up|profit|assignment fee|acquisition|underlying purchase|purchase price|under contract for|seller price|seller gets|seller getting|seller receive)\M'
  or b ~ '\m(what|how much)\M.*\m(did|do|are|will|would) you (pay|paid|make|profit|get|buy|earn|charge)\M'
  or b ~ '\m(how much)\M.*\m(your fee|you paid|you pay|you bought|you got it for)\M'
  or b ~ '\m(deposit)\M.*\m(percentage|percent|formula|calculate|calculation|cap)\M'
  or b ~ '\m(percentage|percent|formula|calculate|calculation|cap)\M.*\m(deposit|fee|spread|margin)\M'
  then
   if p->'reserved'='true'::jsonb then return 'Internal acquisition pricing and margins are private. This property is reserved; contact the team about an existing agreement.';end if;
   return 'The buyer price is $'||to_char((p->>'askingPriceCents')::numeric/100,'FM999,999,999,990.00')||', including our fee, plus buyer closing costs. Internal acquisition pricing and margins are private.';
 end if;
 return public.icash_buyer_reply_before_price_privacy(p_account,p_thread,p_incoming);
end $function$;

CREATE OR REPLACE FUNCTION public.icash_queue_buyer_factual_reply(p_account uuid, p_job uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;
