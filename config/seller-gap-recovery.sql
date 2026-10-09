begin;
set local lock_timeout='3s';
-- Persist gaps at the verified lifecycle boundary. No raw conversations enter
-- aggregate learning; each private case retains its exact source for review.
create table public.icash_seller_gaps(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),screening_id uuid not null references public.icash_screening_jobs(id),thread_id uuid not null references public.icash_text_threads(id),
 source text not null check(source in ('text','text_ai','call','inbound_call','tool','viewing')),
 source_id uuid not null,reason text not null check(reason in ('unanswered','repeated_question','no_response','owners','material_facts','callback','human','declined','contact_stop','delivery_unknown','viewing')),
 stage text not null,channel text not null check(channel in ('text','call')),
 quote text not null check(length(quote)<=1000),
 state text not null check(state in ('open','queued','waiting','needs_review','resolved','superseded','suppressed')),
 due_at timestamptz not null,expires_at timestamptz not null,source_at timestamptz not null,
 outgoing_id uuid unique references public.icash_text_messages(id),
 resolution text check(length(resolution)<=2000),resolved_by uuid references auth.users(id),resolved_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(source,source_id,reason)
);
create index seller_gaps_due on public.icash_seller_gaps(due_at) where state='open';
create index seller_gaps_account on public.icash_seller_gaps(account_id,state,updated_at desc);
create table public.icash_seller_recovery_variants(
 key text primary key,reason text not null,body text not null check(length(body) between 10 and 320),enabled boolean not null default true
);
insert into public.icash_seller_recovery_variants(key,reason,body) values
 ('unanswered-v1','unanswered','I want to get that right. Could you clarify the part you need help with?'),
 ('unanswered-v2','unanswered','Could you share a little more detail about your question so we can get you an accurate answer?'),
 ('repeat-v1','repeated_question','I have your earlier answers. What is the main question you would like us to resolve next?'),
 ('no-response-v1','no_response','Would you still like to discuss a possible cash offer? If so, what time works for a call?'),
 ('no-response-v2','no_response','Is selling still something you want to explore? Let me know if you would like to continue or pause here.'),
 ('viewing-v1','viewing','A potential buyer asked about viewing the property. What dates and times with AM or PM and timezone work for you? No visit is booked.'),
 ('viewing-v2','viewing','What viewing windows could work for a potential buyer? Please include the date, start and end times with AM or PM, and timezone. No visit is booked.');
create table public.icash_seller_recovery_attempts(
 gap_id uuid primary key references public.icash_seller_gaps(id),account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),thread_id uuid not null references public.icash_text_threads(id),
 variant text not null references public.icash_seller_recovery_variants(key),reason text not null,stage text not null,source_channel text not null,
 message_id uuid not null unique references public.icash_text_messages(id),policy_version text not null default 'seller-recovery-v1',
 assigned_at timestamptz not null default now(),delivered_at timestamptz,responded_at timestamptz,contract_at timestamptz,closed_at timestamptz,opted_out_at timestamptz
);
create index seller_recovery_cohort on public.icash_seller_recovery_attempts(account_id,reason,stage,source_channel,assigned_at);
alter table public.icash_seller_gaps enable row level security;
alter table public.icash_seller_recovery_variants enable row level security;
alter table public.icash_seller_recovery_attempts enable row level security;
revoke all on public.icash_seller_gaps,public.icash_seller_recovery_variants,public.icash_seller_recovery_attempts from public,anon,authenticated,service_role;
grant select on public.icash_seller_gaps,public.icash_seller_recovery_variants,public.icash_seller_recovery_attempts to service_role;

create function public.icash_seller_contact_stop(p_body text) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(replace(replace(btrim(p_body),'’',''''),'‘','''') ~* '^(please[[:space:]]+)?(stop|stopall|unsubscribe|cancel|end|quit|revoke|opt[[:space:]]*out)([[:space:]]+please)?([.![:space:]]*$|[[:space:]]*[,;.!][[:space:]]*(please|call|text|but)\M)|\m(do not|don''t|dont|stop)[[:space:]]+(texting|messaging|contacting|calling|text|message|contact|call)([[:space:]]+(me|us))?\M(?![[:space:]]+(it|that|the house|the property)\M)|\mleave (me|us) alone\M|\m(remove|take) (me|my number) (off|from)\M|^(please )?(unsubscribe|remove|delete) (me|my number)[.! ]*$',false)
$$;
create function public.icash_seller_gap_reason(p_turns jsonb,p_review boolean default false) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare b text;agent text;repeated boolean;
begin
 if jsonb_typeof(p_turns) is distinct from 'array' then return case when p_review then 'unanswered' end;end if;
 select value->>'message' into b from jsonb_array_elements(p_turns) with ordinality x(value,n) where value->>'role'='user' order by n desc limit 1;
 select value->>'message' into agent from jsonb_array_elements(p_turns) with ordinality x(value,n) where value->>'role'='agent' order by n desc limit 1;
 if exists(select 1 from jsonb_array_elements(p_turns) x where x->>'role'='user' and public.icash_seller_contact_stop(x->>'message')) then return 'contact_stop';end if;
 if public.icash_seller_conversation_human(b) then return 'human';end if;
 if b ~* '\m(not interested|wrong number|no thanks|no thank you|not selling)\M' then return 'declined';end if;
 if b ~* '\m(spouse|wife|husband|co-owner|other owner|another owner|decision maker)\M' then return 'owners';end if;
 if b ~* '\m(lien|liens|unpaid taxes|probate|bankruptcy|foreclosure|agent agreement|attorney|lawyer)\M' then return 'material_facts';end if;
 if b ~* '\m(call me|call back|callback|call tomorrow|call today)\M' then return 'callback';end if;
 if b ~* '\m(not ready|need to think|never agreed|wait|hold off)\M' then return 'declined';end if;
 if b is null then return 'no_response';end if;
 select exists(select 1 from jsonb_array_elements(p_turns) x where x->>'role'='agent' and x->>'message' like '%?%' group by lower(btrim(x->>'message')) having count(*)>=3) into repeated;
 if repeated then return 'repeated_question';end if;
 if p_review or agent ~* '\m(don''t know|do not know|cannot answer|can''t answer|unable to answer|needs review|need to check|temporarily unavailable)\M' then return 'unanswered';end if;
 return null;
end $$;

-- Internal capture only. Every adapter below derives these IDs from stored rows;
-- no browser or model can create a send authority by supplying a case.
create function public.icash_open_seller_gap(p_account uuid,p_thread uuid,p_source text,p_source_id uuid,p_reason text,p_quote text,p_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.icash_text_threads;d public.icash_deal_files;new_id uuid;initial text;due timestamptz;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' and retired_at is null;
 if not found or p_source_id is null or p_at is null or p_at>now() or p_at<now()-interval '7 days' then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true';
 if not found or p_reason is null then return null;end if;
 initial:=case when p_reason='contact_stop' then 'suppressed' when p_reason in ('human','declined','owners','material_facts','callback','delivery_unknown') then 'needs_review' else 'open' end;
 -- Clarify once. An unresolved reply after a recovery is a human task, not a loop.
 if p_reason in ('unanswered','repeated_question') and exists(select 1 from public.icash_seller_recovery_attempts where account_id=p_account and thread_id=t.id and reason in ('unanswered','repeated_question') and assigned_at>now()-interval '7 days') then initial:='needs_review';end if;
 due:=greatest(now(),p_at+case when p_reason='no_response' then interval '24 hours' else interval '2 minutes' end);
 insert into public.icash_seller_gaps(account_id,deal_id,screening_id,thread_id,source,source_id,reason,stage,channel,quote,state,due_at,expires_at,source_at)
 values(p_account,d.id,d.screening_id,t.id,p_source,p_source_id,p_reason,d.stage,case when p_source in ('call','inbound_call','tool') then 'call' else 'text' end,left(coalesce(p_quote,''),1000),initial,due,p_at+interval '7 days',p_at)
 on conflict(source,source_id,reason) do nothing returning icash_seller_gaps.id into new_id;
 return new_id;
end $$;

create function public.icash_capture_seller_ai_gap() returns trigger
language plpgsql security definer set search_path='' as $$
declare m public.icash_text_messages;reason text;
begin
 if new.state='queued' then
  update public.icash_seller_gaps set state='superseded',updated_at=now() where account_id=new.account_id and source='text_ai' and source_id=new.id and state='open';
  return new;
 end if;
 if new.state not in ('needs_review','handoff') and not(new.state='drafted' and new.analysis->>'action'='review') then return new;end if;
 select * into m from public.icash_text_messages where id=new.message_id and account_id=new.account_id and thread_id=new.thread_id and direction='incoming' and state='received';
 if not found then return new;end if;
 reason:=case when new.state='needs_review' and new.analysis is null then 'delivery_unknown' else public.icash_seller_gap_reason(jsonb_build_array(jsonb_build_object('role','user','message',m.body)),true) end;
 perform public.icash_open_seller_gap(new.account_id,new.thread_id,'text_ai',new.id,reason,m.body,m.created_at);
 return new;
end $$;
create trigger seller_ai_gap after insert or update of state on public.icash_text_ai_jobs for each row execute function public.icash_capture_seller_ai_gap();

create function public.icash_capture_seller_call_gap() returns trigger
language plpgsql security definer set search_path='' as $$
declare ids uuid[];turns jsonb;reason text;quote text;at_time timestamptz;source text;source_id uuid;phone text;
begin
 if tg_table_schema='icash_seller_agreement_private' then
  turns:=new.transcript;at_time:=new.completed_at;source:='inbound_call';source_id:=new.session_id;
 else
  if new.party<>'seller' or new.state<>'complete' or new.completed_at is null or new.operation_key not like 'voice:%' then return new;end if;
  if tg_op='UPDATE' and old.state='complete' then return new;end if;
  turns:=new.result->'transcript';at_time:=new.completed_at;source:='call';source_id:=new.id;
 end if;
 select array_agg(t.id) into ids from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 where t.account_id=new.account_id and t.party='seller' and t.retired_at is null and d.screening_id=new.screening_id and encode(sha256(convert_to(t.recipient,'UTF8')),'hex')=new.contact_key;
 if cardinality(ids) is distinct from 1 then return new;end if;
 reason:=public.icash_seller_gap_reason(turns,false);
 if reason='contact_stop' then
  select t.recipient into phone from public.icash_text_threads t where t.id=ids[1] and t.account_id=new.account_id;
  -- The existing suppression trigger revokes phone permissions and queued voice
  -- work too. A completed inbound call has the same STOP effect as an SMS.
  insert into public.icash_text_suppressions(phone,reason) values(phone,'Verified seller call opt-out') on conflict do nothing;
  update public.icash_text_threads set paused=true where recipient=phone;
  update public.icash_text_messages m set state='cancelled' from public.icash_text_threads t where m.thread_id=t.id and m.account_id=t.account_id and t.recipient=phone and m.direction='outgoing' and m.state='ready';
  update public.icash_seller_recovery_attempts set opted_out_at=coalesce(opted_out_at,at_time) where account_id=new.account_id and thread_id=ids[1] and delivered_at<=at_time;
  update public.icash_seller_gaps set state='suppressed',updated_at=now() where account_id=new.account_id and thread_id=ids[1] and state in ('open','queued','waiting');
 end if;
 select x->>'message' into quote from jsonb_array_elements(coalesce(turns,'[]')) with ordinality q(x,n) where x->>'role'='user' order by n desc limit 1;
 perform public.icash_open_seller_gap(new.account_id,ids[1],source,source_id,reason,quote,at_time);
 return new;
end $$;
create trigger seller_call_gap after insert or update of state on public.icash_live_conversations for each row execute function public.icash_capture_seller_call_gap();
create trigger seller_inbound_gap after insert on icash_seller_agreement_private.call_history for each row execute function public.icash_capture_seller_call_gap();

create function public.icash_record_seller_tool_gap(p_hash text,p_conversation text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare scope jsonb;thread uuid;reason text;
begin
 scope:=public.icash_seller_agreement_call_context(p_hash,p_conversation);if scope is null then return null;end if;
 reason:=case when p_reason='all_owners_required' then 'owners' when p_reason in ('updated_property_review_required','payoff_review_required','price_review_required','agreement_changed','existing_price_changed','property_binding_changed') then 'material_facts' else 'delivery_unknown' end;
 select t.id into thread from public.icash_text_threads t where t.account_id=(scope->>'accountId')::uuid and t.deal_id=(scope->>'dealId')::uuid and t.party='seller' and t.recipient=scope->>'phone' and t.retired_at is null;
 if thread is null then return null;end if;
 return public.icash_open_seller_gap((scope->>'accountId')::uuid,thread,'tool',md5(p_hash||p_conversation)::uuid,reason,p_reason,now());
end $$;

-- Learn from actual deliveries and verified downstream outcomes. Cohorts never
-- mix tenants, source channels, stages or reasons. A response alone cannot win.
create function public.icash_choose_seller_recovery(p_account uuid,p_reason text,p_stage text,p_channel text,p_bucket integer) returns text
language plpgsql stable security invoker set search_path='' as $$
declare choices text[];winner text;eligible boolean;
begin
 if p_bucket not between 0 and 9999 then raise exception 'Invalid recovery bucket';end if;
 select array_agg(v.key order by v.key) into choices from public.icash_seller_recovery_variants v where v.reason=p_reason and v.enabled
 and not exists(select 1 from public.icash_seller_recovery_attempts a where a.account_id=p_account and a.variant=v.key and a.reason=p_reason and a.stage=p_stage and a.source_channel=p_channel and a.delivered_at>now()-interval '180 days'
  group by a.variant having count(distinct a.deal_id)>=100 and count(distinct a.deal_id) filter(where a.opted_out_at is not null)::numeric/count(distinct a.deal_id)>0.05);
 if cardinality(choices) is null then return null;end if;
 with cohort as (
  select distinct on (deal_id) * from public.icash_seller_recovery_attempts
  where account_id=p_account and reason=p_reason and stage=p_stage and source_channel=p_channel
   and delivered_at between now()-interval '180 days' and now()-interval '30 days'
  order by deal_id,assigned_at,gap_id
 ), stats as (
  select v.key,count(a.gap_id) n,count(a.gap_id) filter(where a.contract_at<=a.delivered_at+interval '30 days') wins,
   count(a.gap_id) filter(where a.opted_out_at is not null) stops
  from public.icash_seller_recovery_variants v left join cohort a on a.variant=v.key
  where v.key=any(choices) group by v.key
 ) select bool_and(n>=100 and wins>=5 and stops::numeric/greatest(n,1)<=0.05),
  (array_agg(key order by (wins+1.0)/(n+2.0) desc,key))[1] into eligible,winner from stats;
 -- Shift at most 10 percentage points from a balanced two-arm baseline. Keep
 -- 80% balanced exploration and immutable per-deal assignment; no script generation,
 -- price changes, credit limits or new channels are authorized by a score.
 if eligible and cardinality(choices)=2 and p_bucket>=8000 then return winner;end if;
 return choices[1+(p_bucket%cardinality(choices))];
end $$;

create function public.icash_seller_recovery_current(p_gap uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare g public.icash_seller_gaps;t public.icash_text_threads;d public.icash_deal_files;anchor timestamptz;
begin
 select * into g from public.icash_seller_gaps where id=p_gap and state in ('open','queued') and expires_at>now();if not found then return false;end if;
 select * into t from public.icash_text_threads where id=g.thread_id and account_id=g.account_id and deal_id=g.deal_id and party='seller' and not paused and not manual_only and retired_at is null and ai_mode='auto';if not found then return false;end if;
 if not exists(select 1 from public.icash_accounts where id=g.account_id and not bot_paused) then return false;end if;
 select * into d from public.icash_deal_files where id=g.deal_id and account_id=g.account_id and stage=g.stage and coalesce(terms->>'practice','false')<>'true';if not found then return false;end if;
 -- A non-price continuation reminder does not need a new valuation purchase.
 -- It still needs the original bound seller consent and current contact controls.
 if public.icash_seller_conversation_context(g.account_id,t.id) is null and not(g.reason='no_response' and d.stage='draft' and public.icash_seller_sms_permission_current(g.account_id,t.id,false) is true) then return false;end if;
 anchor:=g.source_at;
 if g.source='text_ai' then select m.created_at into anchor from public.icash_text_ai_jobs j join public.icash_text_messages m on m.id=j.message_id and m.account_id=j.account_id where j.id=g.source_id and j.account_id=g.account_id and j.thread_id=t.id and j.outgoing_id is null and j.state in ('drafted','needs_review');if not found then return false;end if;
 elsif g.source='text' then select created_at into anchor from public.icash_text_messages where id=g.source_id and account_id=g.account_id and thread_id=t.id;if not found then return false;end if;
 end if;
 if exists(select 1 from public.icash_text_messages where account_id=g.account_id and thread_id=t.id and created_at>anchor and id is distinct from g.outgoing_id and (direction='incoming' or state in ('ready','dispatching','accepted','delivered'))) then return false;end if;
 if g.reason='no_response' and (d.stage<>'draft' or exists(select 1 from public.icash_live_callbacks where account_id=g.account_id and screening_id=d.screening_id and state in ('pending_dispatch_review','held_for_human'))) then return false;end if;
 if g.reason='viewing' and (jsonb_array_length(public.icash_current_viewing_slots(g.account_id,g.deal_id))>0 or d.stage not in ('under_contract','buyer_selected','title_open','closing')) then return false;end if;
 return not exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
  and not exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex'));
end $$;

create function public.icash_prepare_seller_recovery(p_account uuid,p_gap uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare g public.icash_seller_gaps;v public.icash_seller_recovery_variants;mid uuid;bucket integer;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into g from public.icash_seller_gaps where id=p_gap and account_id=p_account for update;
 if not found or g.state<>'open' or g.due_at>now() or g.expires_at<=now() or g.outgoing_id is not null then return null;end if;
 perform 1 from public.icash_text_threads where id=g.thread_id and account_id=p_account for update;
 if not public.icash_seller_recovery_current(g.id) then return null;end if;
 if (select count(*) from public.icash_seller_recovery_attempts where account_id=p_account and thread_id=g.thread_id and assigned_at>now()-interval '7 days')>=3
 or exists(select 1 from public.icash_seller_recovery_attempts where account_id=p_account and thread_id=g.thread_id and (assigned_at>now()-interval '24 hours' or reason=g.reason and assigned_at>now()-interval '7 days')) then
  update public.icash_seller_gaps set state='needs_review',updated_at=now() where id=g.id;return null;
 end if;
 bucket:=((('x'||substr(md5(g.id::text),1,7))::bit(28)::integer)%10000);
 select variants.* into v from public.icash_seller_recovery_variants variants where enabled and key=coalesce(
  (select variant from public.icash_seller_recovery_attempts where account_id=p_account and deal_id=g.deal_id and reason=g.reason and stage=g.stage and source_channel=g.channel order by assigned_at,gap_id limit 1),
  public.icash_choose_seller_recovery(p_account,g.reason,g.stage,g.channel,bucket));
 if not found then update public.icash_seller_gaps set state='needs_review',updated_at=now() where id=g.id;return null;end if;
 mid:=public.icash_queue_text(p_account,g.thread_id,g.id,v.body,'{}');if mid is null then return null;end if;
 update public.icash_seller_gaps set state='queued',outgoing_id=mid,updated_at=now() where id=g.id;
 insert into public.icash_seller_recovery_attempts(gap_id,account_id,deal_id,thread_id,variant,reason,stage,source_channel,message_id)
 values(g.id,p_account,g.deal_id,g.thread_id,v.key,g.reason,g.stage,g.channel,mid);
 return mid;
end $$;

create function public.icash_observe_seller_recovery_text() returns trigger
language plpgsql security definer set search_path='' as $$
declare t public.icash_text_threads;reason text;
begin
 select * into t from public.icash_text_threads where id=new.thread_id and account_id=new.account_id and party='seller';if not found then return new;end if;
 if new.direction='incoming' and new.state='received' and tg_op='INSERT' then
  update public.icash_seller_recovery_attempts set responded_at=coalesce(responded_at,new.created_at),opted_out_at=case when public.icash_seller_contact_stop(new.body) then coalesce(opted_out_at,new.created_at) else opted_out_at end
   where account_id=t.account_id and thread_id=t.id and delivered_at is not null and delivered_at<=new.created_at;
  update public.icash_seller_gaps set state=case when public.icash_seller_contact_stop(new.body) then 'suppressed' else 'superseded' end,updated_at=now()
   where account_id=t.account_id and thread_id=t.id and state in ('open','queued','waiting') and created_at<new.created_at;
  -- A response ends the old reminder. The existing intake processes its content;
  -- it is not marked as a resolved question, accepted offer or signed agreement.
 elsif new.direction='outgoing' then
  if new.state='delivered' and new.provider_id is not null then
   update public.icash_seller_recovery_attempts set delivered_at=coalesce(delivered_at,new.last_delivery_at,now()) where account_id=t.account_id and message_id=new.id;
   update public.icash_seller_gaps set state='waiting',updated_at=now() where account_id=t.account_id and outgoing_id=new.id and state='queued';
   if not exists(select 1 from public.icash_seller_recovery_attempts where message_id=new.id) and new.body like '%?%'
    and exists(select 1 from public.icash_deal_files where id=t.deal_id and account_id=t.account_id and stage='draft') then
    perform public.icash_open_seller_gap(t.account_id,t.id,'text',new.id,'no_response','No reply to delivered question',coalesce(new.last_delivery_at,now()));
   end if;
  elsif new.state='needs_review' then
   update public.icash_seller_gaps set state='needs_review',updated_at=now() where account_id=t.account_id and outgoing_id=new.id and state in ('queued','waiting');
   perform public.icash_open_seller_gap(t.account_id,t.id,'text',new.id,'delivery_unknown','Delivery needs reconciliation; do not resend',now());
  end if;
 end if;
 return new;
end $$;
create trigger seller_recovery_text after insert or update of state on public.icash_text_messages for each row execute function public.icash_observe_seller_recovery_text();

create function public.icash_observe_seller_recovery_contract() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.kind='purchase' and new.state='completed' and not new.test_mode and new.provider_id is not null then
  update public.icash_seller_recovery_attempts set contract_at=coalesce(contract_at,now()) where account_id=new.account_id and deal_id=new.deal_id and delivered_at is not null and delivered_at<=now();
  update public.icash_seller_gaps set state='resolved',resolved_at=now(),resolution='Purchase signatures verified',updated_at=now() where account_id=new.account_id and deal_id=new.deal_id and stage='draft' and state in ('open','queued','waiting');
 end if;
 return new;
end $$;
create trigger seller_recovery_contract after insert or update of state on public.icash_signing_envelopes for each row execute function public.icash_observe_seller_recovery_contract();

create function public.icash_observe_seller_recovery_closing() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.kind='closed' and (new.confirmed_by is not null or new.confirmation_source='verified_title_format') then
  update public.icash_seller_recovery_attempts set closed_at=coalesce(closed_at,new.created_at) where account_id=new.account_id and deal_id=new.deal_id and contract_at is not null and delivered_at<=new.created_at;
 end if;
 return new;
end $$;
create trigger seller_recovery_closed after insert on public.icash_closing_updates for each row execute function public.icash_observe_seller_recovery_closing();

create table public.icash_seller_viewing_followups(
 request_id uuid primary key references public.icash_buyer_viewing_requests(id),account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),seller_thread_id uuid not null references public.icash_text_threads(id),
 buyer_thread_id uuid not null references public.icash_text_threads(id),gap_id uuid references public.icash_seller_gaps(id),request_quote text not null,
 outgoing_id uuid unique references public.icash_text_messages(id),slots jsonb,created_at timestamptz not null default now()
);
alter table public.icash_seller_viewing_followups enable row level security;
revoke all on public.icash_seller_viewing_followups from public,anon,authenticated,service_role;
grant select on public.icash_seller_viewing_followups to service_role;

create function public.icash_capture_viewing_followup() returns trigger
language plpgsql security definer set search_path='' as $$
declare sellers uuid[];g uuid;
begin
 if new.kind<>'viewing' or new.state<>'needs_confirmation' then return new;end if;
 if not exists(select 1 from public.icash_text_threads where id=new.thread_id and account_id=new.account_id and deal_id=new.deal_id and party='buyer') then return new;end if;
 select array_agg(t.id) into sellers from public.icash_text_threads t where t.account_id=new.account_id and t.deal_id=new.deal_id and t.party='seller' and t.retired_at is null
  and public.icash_seller_viewing_context(new.account_id,t.id) is not null;
 if cardinality(sellers) is distinct from 1 then return new;end if;
 if jsonb_array_length(public.icash_current_viewing_slots(new.account_id,new.deal_id))=0 then
  select id into g from public.icash_seller_gaps where account_id=new.account_id and deal_id=new.deal_id and reason='viewing' and state in ('open','queued','waiting') and expires_at>now() order by created_at desc limit 1;
  if g is null then g:=public.icash_open_seller_gap(new.account_id,sellers[1],'viewing',new.id,'viewing','Buyer requested seller viewing availability',new.created_at);end if;
 end if;
 insert into public.icash_seller_viewing_followups(request_id,account_id,deal_id,seller_thread_id,buyer_thread_id,gap_id,request_quote)
 values(new.id,new.account_id,new.deal_id,sellers[1],new.thread_id,g,new.quote) on conflict do nothing;
 return new;
end $$;
create trigger seller_viewing_followup after insert on public.icash_buyer_viewing_requests for each row execute function public.icash_capture_viewing_followup();

create function public.icash_viewing_relay_body(p_request uuid) returns text
language plpgsql stable security invoker set search_path='' as $$
declare f public.icash_seller_viewing_followups;r public.icash_buyer_viewing_requests;slots jsonb;options text;package jsonb;
begin
 select * into f from public.icash_seller_viewing_followups where request_id=p_request;if not found then return null;end if;
 select * into r from public.icash_buyer_viewing_requests where id=f.request_id and account_id=f.account_id and deal_id=f.deal_id and thread_id=f.buyer_thread_id and kind='viewing' and state='needs_confirmation' and created_at>now()-interval '7 days';if not found then return null;end if;
 if r.quote is distinct from f.request_quote then return null;end if;
 if public.icash_seller_viewing_context(f.account_id,f.seller_thread_id) is null or public.icash_sms_thread_review_current(f.account_id,f.buyer_thread_id,false) is distinct from true then return null;end if;
 if not exists(select 1 from public.icash_text_threads where id=f.buyer_thread_id and account_id=f.account_id and deal_id=f.deal_id and party='buyer' and not paused and not manual_only and retired_at is null and ai_mode='auto') then return null;end if;
 if exists(select 1 from public.icash_text_messages where account_id=f.account_id and thread_id=f.buyer_thread_id and direction='incoming' and created_at>r.created_at and id<>r.source_id) then return null;end if;
 package:=public.icash_buyer_package_data(f.account_id,f.deal_id);
 if package is null or coalesce((package->>'reserved')::boolean,false) then return null;end if;
 slots:=public.icash_current_viewing_slots(f.account_id,f.deal_id);if jsonb_array_length(slots)=0 then return null;end if;
 if f.outgoing_id is not null and slots is distinct from f.slots then return null;end if;
 select string_agg(label,'; ' order by n) into options from (
  select n,to_char((slot->>'startsAt')::timestamptz at time zone (slot->>'timezone'),'Mon DD, YYYY FMHH12:MI AM')||
   case when slot->>'endsAt' is not null then ' to '||to_char((slot->>'endsAt')::timestamptz at time zone (slot->>'timezone'),'FMHH12:MI AM') else '' end||' '||replace(slot->>'timezone','America/','') label
  from jsonb_array_elements(slots) with ordinality x(slot,n) where n<=2
 ) windows;
 return 'The seller shared these viewing options: '||options||'. Which works for you? The visit still needs confirmation.';
end $$;

create function public.icash_prepare_viewing_relay(p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare f public.icash_seller_viewing_followups;body text;mid uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into f from public.icash_seller_viewing_followups where request_id=p_request and outgoing_id is null for update;if not found then return null;end if;
 body:=public.icash_viewing_relay_body(p_request);if body is null then return null;end if;
 if exists(select 1 from public.icash_seller_viewing_followups where account_id=f.account_id and buyer_thread_id=f.buyer_thread_id and outgoing_id is not null and created_at>now()-interval '24 hours') then return null;end if;
 mid:=public.icash_queue_text(f.account_id,f.buyer_thread_id,f.request_id,body,'{}');if mid is null then return null;end if;
 update public.icash_seller_viewing_followups set outgoing_id=mid,slots=public.icash_current_viewing_slots(f.account_id,f.deal_id) where request_id=f.request_id;
 -- The request stays needs_confirmation until both parties' selected window is
 -- reviewed. A delivered options text never claims a booked visit.
 update public.icash_seller_gaps set state='resolved',resolution='Seller availability saved and buyer options queued',resolved_at=now(),updated_at=now() where id=f.gap_id and state in ('open','queued','waiting');
 return mid;
end $$;

-- Existing final dispatcher still owns consent, quiet hours, wallet admission,
-- provider idempotency and completed-usage charging. Recheck case freshness too.
alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_seller_recovery;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.icash_seller_gaps;expected text;request_id uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select f.request_id into request_id from public.icash_seller_viewing_followups f where f.account_id=p_account and f.outgoing_id=p_message;
 if found then
  expected:=public.icash_viewing_relay_body(request_id);
  if expected is null or not exists(select 1 from public.icash_text_messages where id=p_message and account_id=p_account and body=expected and state='ready') then return null;end if;
 end if;
 select * into g from public.icash_seller_gaps where account_id=p_account and outgoing_id=p_message;
 if found then
  if not public.icash_seller_recovery_current(g.id) then return null;end if;
  select v.body into expected from public.icash_seller_recovery_attempts a join public.icash_seller_recovery_variants v on v.key=a.variant and v.enabled where a.account_id=p_account and a.gap_id=g.id and a.message_id=p_message;
  if expected is null or not exists(select 1 from public.icash_text_messages where id=p_message and account_id=p_account and thread_id=g.thread_id and body=expected and state='ready') then return null;end if;
 end if;
 return public.icash_claim_text_before_seller_recovery(p_account,p_message,p_sender);
end $$;

-- Reuse the existing text-dispatch capability shape; no separate dial path.
do $$ declare definition text;begin
 select pg_get_constraintdef(oid) into strict definition from pg_constraint where conrelid='public.icash_automation_tickets'::regclass and conname='icash_automation_tickets_kind_check';
 alter table public.icash_automation_tickets drop constraint icash_automation_tickets_kind_check;
 execute 'alter table public.icash_automation_tickets add constraint icash_automation_tickets_kind_check check ('||substr(definition,7)||' or kind=''seller_recovery'')';
end $$;
alter function public.icash_next_automation() rename to icash_next_before_seller_recovery;
create function public.icash_next_automation() returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior jsonb;g public.icash_seller_gaps;mid uuid;ticket public.icash_automation_tickets;f public.icash_seller_viewing_followups;
begin
 perform pg_advisory_xact_lock(726341927);
 update public.icash_seller_gaps set state='needs_review',updated_at=now() where state in ('open','queued','waiting') and expires_at<=now();
 prior:=public.icash_next_before_seller_recovery();if prior->>'token' is not null then return prior;end if;
 if not exists(select 1 from public.icash_operating_budget where id=1 and enabled) then return prior;end if;
 if exists(select 1 from public.icash_automation_tickets where kind='seller_recovery' and created_at>now()-interval '1 minute') then return prior;end if;
 for f in select followup.* from public.icash_seller_viewing_followups followup join public.icash_text_threads t on t.id=followup.buyer_thread_id and t.account_id=followup.account_id
  join public.icash_accounts a on a.id=followup.account_id and not a.bot_paused
  join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
  join pg_timezone_names tz on tz.name=t.timezone
  where followup.outgoing_id is null and followup.created_at>now()-interval '7 days' and extract(hour from now() at time zone tz.name) between 9 and 19
  order by followup.created_at for update of followup skip locked limit 20 loop
  mid:=public.icash_prepare_viewing_relay(f.request_id);
  if mid is not null then
   insert into public.icash_automation_tickets(account_id,kind,opener_message_id) values(f.account_id,'seller_recovery',mid) returning * into ticket;
   return jsonb_build_object('token',ticket.token);
  end if;
 end loop;
 for g in select gap.* from public.icash_seller_gaps gap join public.icash_text_threads t on t.id=gap.thread_id and t.account_id=gap.account_id
  join public.icash_accounts a on a.id=gap.account_id and not a.bot_paused
  join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
  join pg_timezone_names tz on tz.name=t.timezone
  where gap.state='open' and gap.due_at<=now() and gap.expires_at>now() and extract(hour from now() at time zone tz.name) between 9 and 19
  order by gap.due_at for update of gap skip locked limit 20 loop
  mid:=public.icash_prepare_seller_recovery(g.account_id,g.id);
  if mid is not null then
   insert into public.icash_automation_tickets(account_id,kind,opener_message_id) values(g.account_id,'seller_recovery',mid) returning * into ticket;
   return jsonb_build_object('token',ticket.token);
  end if;
  update public.icash_seller_gaps set due_at=now()+interval '1 hour',updated_at=now() where id=g.id and state='open';
 end loop;
 return prior;
end $$;

create function public.icash_review_seller_gap(p_account uuid,p_actor uuid,p_gap uuid,p_version timestamptz,p_resolution text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) or length(btrim(p_resolution)) not between 10 and 2000 then return false;end if;
 update public.icash_seller_gaps set state='resolved',resolution=btrim(p_resolution),resolved_by=p_actor,resolved_at=now(),updated_at=now()
  where id=p_gap and account_id=p_account and updated_at=p_version and state='needs_review';
 return found;
end $$;

-- No client writes or publicly executable privileged helpers.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('icash_capture_viewing_followup','icash_viewing_relay_body','icash_prepare_viewing_relay','icash_seller_contact_stop','icash_seller_gap_reason','icash_open_seller_gap','icash_capture_seller_ai_gap','icash_capture_seller_call_gap','icash_record_seller_tool_gap','icash_choose_seller_recovery','icash_seller_recovery_current','icash_prepare_seller_recovery','icash_observe_seller_recovery_text','icash_observe_seller_recovery_contract','icash_observe_seller_recovery_closing','icash_claim_text','icash_claim_text_before_seller_recovery','icash_next_automation','icash_next_before_seller_recovery','icash_review_seller_gap') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
