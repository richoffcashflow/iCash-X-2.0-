-- Prospective, one-request authority. Disabled until coordinated activation.
-- Preserve global permission and held/started/unknown history. A new request may
-- hold only demonstrably untouched ordinary work which it now supersedes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Exact production-read source snapshot on main d0e6f96. Check before changing
-- any function name, schema or job constraint; changed predecessors fail closed.
do $predecessors$
declare item record;
begin
 for item in select * from (values
  ('public.icash_queue_seller_sms_call(uuid,uuid,uuid)','c0e9f82fc2728af8964a271114bba72c'),
  ('public.icash_requested_seller_call_current(uuid,uuid)','4b0cbf50788d6d015af6883fe20b8a5f'),
  ('public.icash_claim_voice_job(uuid)','0b52884370563332bf334e19b719fb63'),
  ('public.icash_reserve_paced_voice(uuid,uuid,uuid,timestamptz,timestamptz,boolean)','f43e6e2729b866f27003de285983f799'),
  ('public.icash_seller_response_operation_allowed(uuid,text)','21566bd830e09cb40a8fc31bd8c13946'),
  ('public.icash_create_direct_recorded_call(uuid,text,text,text,text,text,text,jsonb,jsonb)','ee07e65431bcbec2a0cdae076d17f618'),
  ('public.icash_transition_call_recording(uuid,uuid,text,text,text,jsonb)','4db01e123221836aa52d45ad0542eb8e'),
  ('public.icash_seller_voice_permission_current(uuid,uuid)','5ac3cdb8486737fecdfa6b377bae7979'),
  ('public.icash_seller_voice_permission_before_meta(uuid,uuid)','ccb3db835577144eb68411783a5dd76c'),
  ('public.icash_seller_sms_call_current(uuid,uuid)','5c409ee0cb8de856d7e8a01c0096c041'),
  ('public.icash_seller_call_now_intent(uuid,uuid,text,timestamptz)','032cbe58c0aac73af4dc52d9c19eeb9d'),
  ('public.icash_meta_observe_text()','ce2458f403ed120cada36652a8e53ad0'),
  ('public.icash_seller_recorded_call_finished(uuid,uuid)','d36ba963dd7b7c0ca7bbff2b8ce7ff27')
 ) expected(signature,digest) loop
  if to_regprocedure(item.signature) is null or md5(pg_get_functiondef(to_regprocedure(item.signature)))<>item.digest then
   raise exception 'Seller one-call predecessor changed: %',item.signature;
  end if;
 end loop;
end$predecessors$;
create schema icash_seller_call_private;
revoke all on schema icash_seller_call_private from public,anon,authenticated;
revoke all on schema icash_seller_call_private from service_role;
create table icash_seller_call_private.settings(
 id integer primary key check(id=1),enabled boolean not null default false,
 activated_at timestamptz,check(not enabled or (activated_at is not null and isfinite(activated_at)))
);
insert into icash_seller_call_private.settings(id) values(1);
create table icash_seller_call_private.preferences(
 message_id uuid primary key references public.icash_text_messages(id),
 account_id uuid not null,thread_id uuid not null,screening_id uuid not null,
 lead_id uuid,phone text not null,binding text not null,meta_pause_known boolean not null,
 created_at timestamptz not null default clock_timestamp()
);
create index seller_call_preferences_scope on icash_seller_call_private.preferences(account_id,screening_id,phone);
create index seller_call_preferences_lead on icash_seller_call_private.preferences(lead_id) where lead_id is not null;
create table icash_seller_call_private.requests(
 job_id uuid primary key references public.icash_voice_jobs(id),
 message_id uuid not null unique references public.icash_text_messages(id),
 preference_id uuid references icash_seller_call_private.preferences(message_id),
 account_id uuid not null,target_id uuid not null,operational boolean not null,
 request_binding text not null,target_binding text not null,
 created_at timestamptz not null default clock_timestamp()
);
create index seller_call_requests_target on icash_seller_call_private.requests(account_id,target_id,operational);
alter table icash_seller_call_private.settings enable row level security;
alter table icash_seller_call_private.preferences enable row level security;
alter table icash_seller_call_private.requests enable row level security;
revoke all on all tables in schema icash_seller_call_private from public,anon,authenticated,service_role;
grant select on all tables in schema icash_seller_call_private to service_role;
-- Only source-capture and request-queue functions may add immutable proof rows.
create function icash_seller_call_private.immutable() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'Seller call evidence is immutable';end$$;
create trigger seller_call_preferences_immutable before update or delete on icash_seller_call_private.preferences for each row execute function icash_seller_call_private.immutable();
create trigger seller_call_requests_immutable before update or delete on icash_seller_call_private.requests for each row execute function icash_seller_call_private.immutable();

-- The same conservative direct-clause grammar as seller-call-preference.ts.
-- Quotes are masked before punctuation splitting; apostrophes inside words stay.
create function icash_seller_call_private.direct_clauses(p_body text) returns setof text
language plpgsql immutable set search_path='' as $$
declare b text:=lower(replace(replace(replace(replace(coalesce(p_body,''),'’',chr(39)),'‘',chr(39)),'“','"'),'”','"'));
 quoted text:='';unquoted text:='';ch text;part text;clause text;i integer;apostrophe boolean;
begin
 for i in 1..length(b) loop
  ch:=substr(b,i,1);apostrophe:=ch=chr(39) and substr(b,i-1,1) ~ '[a-z0-9]'
   and (substr(b,i+1,1) ~ '[a-z0-9]' or quoted='' or (quoted=chr(39) and substr(b,i-1,1)='s' and substr(b,i+1) ~ '^[[:space:]]+[a-z]'
    and substr(b,i+1) !~ $rx$^[[:space:]]+(and|but|then|however|instead|please|i|we|you|it|this|that|text|just|only|no|do|don't|can|could|would|let's)\y$rx$));
  if not apostrophe and ch in ('"',chr(39),'`') then
   if quoted='' then quoted:=ch;unquoted:=unquoted||' ';continue;
   elsif ch=quoted then quoted:='';unquoted:=unquoted||';';continue;end if;
  end if;
  unquoted:=unquoted||case when quoted='' then ch else ' ' end;
 end loop;
 foreach part in array regexp_split_to_array(unquoted,E'[.!?;\\n]+') loop
  foreach clause in array regexp_split_to_array(part,'\s*,\s*|\s+but\s+|\s+and\s+(?=(i |we |it |the |this |text |just |only ))') loop
   clause:=trim(regexp_replace(clause,'[[:space:]]+',' ','g'));
   if clause ~ $rx$\y(said|says|saying|told|wrote|writes|asked|quoted|quote|example|phrase|pretend|imagine|hypothetical|ignore|system|assistant|instruction|prompt|override|classify)\y|\y(i|we) (do not|don't|did not|didn't|never) (say|mean|ask|request)\y$rx$ then exit;end if;
   clause:=regexp_replace(regexp_replace(clause,'^(please |okay[, ]+|ok[, ]+)',''),' please$','');
   if clause<>'' then return next clause;end if;
  end loop;
 end loop;
end$$;
create function icash_seller_call_private.soft_text(p_body text) returns boolean
language sql immutable set search_path='' as $$
 select public.icash_seller_response_disposition(p_body) is null and exists(
  select 1 from icash_seller_call_private.direct_clauses(p_body) c where c ~
  $rx$^(((((i|we)('d)? )?(prefer( to)?|would prefer( to)?|would rather|rather|(only )?want to) (keep )?text(ing)?)|((just |only |let's (just )?|(can|could|would) (we|you) (just |only )?|(i|we) can only )?text( me| us)?)|text(ing)? only|(keep|stay|let's keep) (it |this )?(on|over|to|in) text|(keep|prefer) texting|(i |we )?(can't|cannot) (talk|take calls)|(i |we )?(would )?rather not (talk|call)))( (for now|right now|now|at the moment|today|instead))?$rx$
 )
$$;

-- Hash only original source identity/bindings, never mutable delivery metadata.
create function icash_seller_call_private.message_binding(p_id uuid) returns text
language sql stable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_array(m.id,m.account_id,m.thread_id,m.direction,m.state,m.body,
 m.event_id,m.provider_id,m.created_at,m.route_revision,t.deal_id,t.seller_intake_id,t.operational_contact_id,
 t.sender,t.recipient,t.party,d.screening_id,
 case when t.seller_intake_id is not null then public.icash_seller_contact_evidence(t.account_id,d.screening_id,t.seller_intake_id,t.recipient)
  else (select to_jsonb(c) from public.icash_operational_contacts c where c.id=t.operational_contact_id and c.account_id=t.account_id and c.channel='sms') end)::text,'UTF8')),'hex')
 from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 where m.id=p_id and m.direction='incoming' and m.state='received' and coalesce(nullif(btrim(m.event_id),''),nullif(btrim(m.provider_id),'')) is not null
 and t.party='seller' and m.created_at<=clock_timestamp()
$$;

create function icash_seller_call_private.firm_refusal(p_id uuid,p_invitation boolean default false) returns boolean
language plpgsql stable set search_path='' as $$
declare m public.icash_text_messages;q public.icash_text_messages;b text;
begin
 select * into m from public.icash_text_messages where id=p_id and direction='incoming' and state='received'
  and coalesce(nullif(btrim(event_id),''),nullif(btrim(provider_id),'')) is not null;
 if not found then return false;end if;
 b:=lower(trim(replace(m.body,'’',chr(39))));
 if public.icash_seller_response_disposition(m.body) is not null
  or exists(select 1 from icash_seller_call_private.direct_clauses(m.body) c where c ~ $rx$^((no|never any) (more )?(calls|phone calls)|(do not|don't|never) (ever )?call( me| us)?( again)?|(do not|don't|never) ask( me| us)?( (about|for) (a )?call)?( again)?|(i |we )?(do not|don't) want (any |a |more )?(calls|phone calls))( (please|ever|again))?$rx$) then return true;end if;
 if not p_invitation or not (b ~ '^(no|nope)([.!;,]|[[:space:]]*$)'
  or (b ~ '^(no|nope)[[:space:]]+' and icash_seller_call_private.soft_text(regexp_replace(b,'^(no|nope)[[:space:]]+','')))) then return false;end if;
 select * into q from public.icash_text_messages where account_id=m.account_id and thread_id=m.thread_id
  and (created_at,id)<(m.created_at,m.id) order by created_at desc,id desc limit 1;
 return coalesce(q.direction='outgoing' and q.state='delivered' and nullif(btrim(q.provider_id),'') is not null and q.customer_author_id is null
  and q.body in ('When is a good time to talk about a cash offer?','What day and time work for a call?','Are you free for a quick call now, or would later work better?'),false);
end$$;

create function icash_seller_call_private.capture_preference() returns trigger
language plpgsql security definer set search_path='' as $$
declare t public.icash_text_threads;d public.icash_deal_files;known boolean;ml public.icash_meta_leads;stamp timestamptz:=clock_timestamp();
begin
 if new.direction<>'incoming' or new.state<>'received' or coalesce(nullif(btrim(new.event_id),''),nullif(btrim(new.provider_id),'')) is null
  or not icash_seller_call_private.soft_text(new.body) then return new;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not exists(select 1 from icash_seller_call_private.settings where id=1 and enabled and activated_at<=new.created_at and activated_at<=stamp)
  or new.created_at>stamp or new.created_at<stamp-interval '5 minutes' then return new;end if;
 select * into t from public.icash_text_threads where id=new.thread_id and account_id=new.account_id and party='seller';
 if not found then return new;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=t.account_id;
 if not found or not exists(select 1 from public.icash_sms_routes where account_id=t.account_id and sender=t.sender
  and recipient=t.recipient and revision=new.route_revision and not needs_review) then return new;end if;
 select * into ml from public.icash_meta_leads where lead_id=t.seller_intake_id;
 if not found and t.operational_contact_id is null and t.seller_intake_id is null then return new;end if;
 if ml.lead_id is not null and not ((ml.account_id=t.account_id and ml.screening_id=d.screening_id) or exists(select 1 from public.icash_seller_matches
  where lead_id=t.seller_intake_id and account_id=t.account_id and screening_id=d.screening_id)) then return new;end if;
 known:=ml.lead_id is null or not ml.voice_paused or exists(select 1 from icash_seller_call_private.preferences prior
  where prior.lead_id=ml.lead_id and prior.meta_pause_known and prior.binding=icash_seller_call_private.message_binding(prior.message_id));
 insert into icash_seller_call_private.preferences(message_id,account_id,thread_id,screening_id,lead_id,phone,binding,meta_pause_known)
 values(new.id,t.account_id,t.id,d.screening_id,t.seller_intake_id,t.recipient,icash_seller_call_private.message_binding(new.id),known) on conflict do nothing;
 return new;
end$$;
-- Run before the existing Meta observer, after source-word stop processing.
create trigger icash_001_seller_call_preference after insert or update of state,thread_id on public.icash_text_messages
 for each row execute function icash_seller_call_private.capture_preference();

-- Target validation never treats an SMS operational contact as voice evidence.
create function icash_seller_call_private.target_capable(p_account uuid,p_target uuid) returns boolean
language plpgsql set search_path='' as $$
declare p public.icash_voice_contact_targets;lead uuid;
begin
 select * into p from public.icash_voice_contact_targets where id=p_target and account_id=p_account and party='seller';
 if not found or not public.icash_outreach_voice_current(p_account) then return false;end if;
 if p.eligibility_source='operator_record' then
  if not public.icash_seller_voice_permission_before_meta(p_account,p_target) then return false;end if;
  select seller_intake_id into lead from public.icash_contact_permissions where id=p_target and account_id=p_account;
 elsif p.eligibility_source='operational_checks_only' then
  if not public.icash_operational_contact_current(p_account,p_target,'voice',false) then return false;end if;
 else return false;end if;
 return exists(select 1 from public.icash_accounts a join public.icash_voice_configs c on c.account_id=a.id
  where a.id=p_account and not a.bot_paused and c.enabled and c.reviewed_until>clock_timestamp())
 and exists(select 1 from public.icash_screening_jobs s where s.id=p.screening_id and s.account_id=p_account and s.state='complete'
  and not exists(select 1 from public.icash_property_controls pc where pc.account_id=p_account and pc.property_id=s.snapshot->>'propertyId' and pc.manual))
 and not exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=p.screening_id and state<>'resolved')
 and not exists(select 1 from public.icash_text_suppressions where phone=p.phone)
 and not exists(select 1 from public.icash_contact_suppressions where contact_key=p.contact_key)
 and not exists(select 1 from public.icash_meta_leads ml where ml.lead_id=lead and (ml.paused or ml.declined_at is not null))
 and not exists(select 1 from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  where t.account_id=p_account and d.screening_id=p.screening_id and t.recipient=p.phone and t.party='seller'
  and t.retired_at is null and (t.paused or t.manual_only or t.ai_mode<>'auto'));
end$$;

-- A call-only context for ordinary draft operational sellers. Keep the global
-- intake/viewing SMS context unchanged. Reuse the actual SMS review and source
-- admission, with the same complete/fresh/financial/property/manual gates.
create function icash_seller_call_private.context_current(p_account uuid,p_thread uuid) returns boolean
language plpgsql set search_path='' as $$
declare t public.icash_text_threads;d public.icash_deal_files;s public.icash_screening_jobs;principal text;assistant text;address text;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found or t.party<>'seller' or t.paused or t.manual_only or t.ai_mode<>'auto' or t.retired_at is not null then return false;end if;
 if t.operational_contact_id is null then return public.icash_seller_conversation_context(p_account,p_thread) is not null;end if;
 if t.seller_intake_id is not null or public.icash_sms_thread_review_current(p_account,p_thread,false) is distinct from true then return false;end if;
 select a.assistant_name into assistant from public.icash_accounts a where a.id=p_account and not a.bot_paused;
 if not found then return false;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage='draft' and coalesce(terms->>'practice','false')<>'true';
 if not found then return false;end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account and state='complete';
 if not found or s.result->'financialCheck'->>'status' is distinct from 'eligible'
  or s.completed_at is null or s.completed_at>clock_timestamp() or s.completed_at<clock_timestamp()-interval '24 hours'
  or exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=s.snapshot->>'propertyId' and manual)
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=s.id and state<>'resolved')
  or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex')) then return false;end if;
 if not exists(select 1 from public.icash_sms_routes where sender=t.sender and recipient=t.recipient and account_id=p_account and not needs_review) then return false;end if;
 select trim(i.principal) into principal from public.icash_customer_identities i where i.account_id=p_account;
 assistant:=trim(assistant);address:=trim(d.terms->>'address');
 return length(coalesce(principal,'')) between 1 and 100 and length(coalesce(assistant,'')) between 1 and 60
  and length(coalesce(address,'')) between 1 and 300 and address !~ '[[:cntrl:]]'
  and principal !~ '[[:cntrl:]]' and assistant !~ '[[:cntrl:]]';
end$$;

create function icash_seller_call_private.target_for_message(p_account uuid,p_thread uuid,p_message uuid) returns uuid
language plpgsql set search_path='' as $$
declare t public.icash_text_threads;m public.icash_text_messages;screen uuid;target uuid;targets uuid[];
begin
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and thread_id=p_thread and direction='incoming' and state='received'
  and coalesce(nullif(btrim(event_id),''),nullif(btrim(provider_id),'')) is not null and created_at<=clock_timestamp();
 if not found then return null;end if;
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller';
 if not found or not icash_seller_call_private.context_current(p_account,p_thread)
  or not exists(select 1 from public.icash_sms_routes where account_id=p_account and sender=t.sender and recipient=t.recipient and revision=m.route_revision and not needs_review)
  or exists(select 1 from public.icash_text_messages n where n.account_id=p_account and n.thread_id=p_thread and n.direction='incoming' and (n.created_at,n.id)>(m.created_at,m.id)) then return null;end if;
 select screening_id into screen from public.icash_deal_files where id=t.deal_id and account_id=p_account;
 if t.seller_intake_id is not null and t.operational_contact_id is null then
  select array_agg(id) into targets from public.icash_contact_permissions where account_id=p_account and screening_id=screen and phone=t.recipient
   and party='seller' and seller_intake_id=t.seller_intake_id and public.icash_seller_voice_permission_before_meta(p_account,id);
 elsif t.seller_intake_id is null and t.operational_contact_id is not null then
  if not public.icash_operational_contact_current(p_account,t.operational_contact_id,'sms',false) then return null;end if;
  select array_agg(v.id) into targets from public.icash_operational_contacts sms join public.icash_operational_contacts v
   on v.account_id=sms.account_id and v.screening_id=sms.screening_id and v.phone=sms.phone and v.source_hash=sms.source_hash
    and v.dnc_receipt_id=sms.dnc_receipt_id and v.owner_user_id=sms.owner_user_id and v.sending_principal=sms.sending_principal
   where sms.id=t.operational_contact_id and sms.account_id=p_account and sms.channel='sms' and sms.screening_id=screen and sms.phone=t.recipient
    and v.channel='voice' and public.icash_operational_contact_current(p_account,v.id,'voice',false);
 else return null;end if;
 if cardinality(targets)<>1 then return null;end if;target:=targets[1];
 if not icash_seller_call_private.target_capable(p_account,target) then return null;end if;
 return target;
end$$;

create function icash_seller_call_private.target_binding(p_account uuid,p_target uuid) returns text
language sql stable set search_path='' as $$
 select encode(sha256(convert_to(source::text,'UTF8')),'hex') from (
  select to_jsonb(p) source from public.icash_contact_permissions p where p.account_id=p_account and p.id=p_target
  union all select to_jsonb(c) from public.icash_operational_contacts c where c.account_id=p_account and c.id=p_target and c.channel='voice'
 ) bound
$$;

create function icash_seller_call_private.scoped_messages(p_account uuid,p_target uuid) returns setof uuid
language sql stable set search_path='' as $$
 select m.id from public.icash_voice_contact_targets p
 left join public.icash_contact_permissions cp on cp.id=p.id and cp.account_id=p.account_id
 join public.icash_text_threads t on t.party='seller' and t.recipient=p.phone
  and ((cp.seller_intake_id is not null and t.seller_intake_id=cp.seller_intake_id)
   or (cp.seller_intake_id is null and t.account_id=p.account_id and t.seller_intake_id is null))
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
 where p.id=p_target and p.account_id=p_account and p.party='seller'
  and (cp.seller_intake_id is not null or d.screening_id=p.screening_id)
  and m.direction='incoming' and m.state='received' and coalesce(nullif(btrim(m.event_id),''),nullif(btrim(m.provider_id),'')) is not null
$$;

create function icash_seller_call_private.scoped_preferences(p_account uuid,p_target uuid) returns setof uuid
language sql stable set search_path='' as $$
 select pr.message_id from public.icash_voice_contact_targets p
 left join public.icash_contact_permissions cp on cp.id=p.id and cp.account_id=p.account_id
 join icash_seller_call_private.preferences pr on pr.phone=p.phone
  and ((cp.seller_intake_id is not null and pr.lead_id=cp.seller_intake_id)
   or (cp.seller_intake_id is null and pr.lead_id is null and pr.account_id=p.account_id and pr.screening_id=p.screening_id))
 where p.id=p_target and p.account_id=p_account and p.party='seller'
$$;

create function icash_seller_call_private.preference_current(p_account uuid,p_target uuid) returns uuid
language plpgsql set search_path='' as $$
declare pref uuid;
begin
 if not exists(select 1 from icash_seller_call_private.settings where id=1 and enabled and activated_at<=clock_timestamp())
  or not icash_seller_call_private.target_capable(p_account,p_target) then return null;end if;
 select pr.message_id into pref from icash_seller_call_private.preferences pr
  join public.icash_text_messages m on m.id=pr.message_id
  where pr.message_id in (select icash_seller_call_private.scoped_preferences(p_account,p_target)) and pr.meta_pause_known
  and pr.binding=icash_seller_call_private.message_binding(pr.message_id)
  and icash_seller_call_private.soft_text(m.body) order by m.created_at desc,m.id desc limit 1;
 if exists(select 1 from icash_seller_call_private.scoped_messages(p_account,p_target) m where icash_seller_call_private.firm_refusal(m)) then return null;end if;
 return pref;
end$$;

create function public.icash_seller_call_invitation_capable(p_account uuid,p_thread uuid,p_message uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare target uuid;p public.icash_voice_contact_targets;
begin
 if not exists(select 1 from icash_seller_call_private.settings where id=1 and enabled and activated_at<=clock_timestamp()) then return false;end if;
 target:=icash_seller_call_private.target_for_message(p_account,p_thread,p_message);if target is null then return false;end if;
 select * into p from public.icash_voice_contact_targets where id=target and account_id=p_account;
 if exists(select 1 from icash_seller_call_private.scoped_messages(p_account,target) m where icash_seller_call_private.firm_refusal(m,true))
  or exists(select 1 from public.icash_voice_jobs j join public.icash_voice_contact_targets cp on cp.id=coalesce(j.permission_id,j.operational_contact_id) and cp.account_id=j.account_id
   where cp.phone=p.phone and (j.state='dispatching' or (j.state='held' and j.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))))
  or exists(select 1 from public.icash_call_recordings r where r.to_phone=p.phone and r.dial_claimed_at is not null and r.call_ended_at is null
   and not public.icash_seller_recorded_call_finished(r.account_id,r.id))
  or exists(select 1 from public.icash_live_conversations c where c.contact_key=p.contact_key and c.state in ('waiting','review')) then return false;end if;
 if (exists(select 1 from icash_seller_call_private.scoped_preferences(p_account,target))
  or exists(select 1 from icash_seller_call_private.scoped_messages(p_account,target) scoped(message_id) join public.icash_text_messages m on m.id=scoped.message_id where icash_seller_call_private.soft_text(m.body)))
  and icash_seller_call_private.preference_current(p_account,target) is null then return false;end if;
 if p.eligibility_source='operational_checks_only' then return true;end if;
 return public.icash_seller_voice_permission_current(p_account,target)
  or icash_seller_call_private.preference_current(p_account,target) is not null;
end$$;

create function icash_seller_call_private.request_current(p_account uuid,p_target uuid,p_message uuid,p_fresh boolean default true) returns boolean
language plpgsql set search_path='' as $$
declare p public.icash_voice_contact_targets;m public.icash_text_messages;t public.icash_text_threads;pref uuid;q public.icash_text_messages;
begin
 pref:=icash_seller_call_private.preference_current(p_account,p_target);
 select * into p from public.icash_voice_contact_targets where id=p_target and account_id=p_account;
 if not found or not icash_seller_call_private.target_capable(p_account,p_target)
  or not exists(select 1 from icash_seller_call_private.settings where id=1 and enabled and activated_at<=clock_timestamp()) then return false;end if;
 if pref is null and (p.eligibility_source<>'operational_checks_only'
  or exists(select 1 from icash_seller_call_private.scoped_preferences(p_account,p_target))
  or exists(select 1 from icash_seller_call_private.scoped_messages(p_account,p_target) scoped(message_id) join public.icash_text_messages sm on sm.id=scoped.message_id
   where icash_seller_call_private.soft_text(sm.body) or icash_seller_call_private.firm_refusal(sm.id))) then return false;end if;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and direction='incoming' and state='received'
  and coalesce(nullif(btrim(event_id),''),nullif(btrim(provider_id),'')) is not null;
 if not found or m.created_at>clock_timestamp() or (p_fresh and m.created_at<clock_timestamp()-interval '5 minutes')
  or not exists(select 1 from icash_seller_call_private.settings where id=1 and activated_at<=m.created_at)
  or (pref is not null and (m.created_at,m.id)<=(select created_at,id from public.icash_text_messages where id=pref)) then return false;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account and recipient=p.phone and party='seller';
 if not found or icash_seller_call_private.target_for_message(p_account,t.id,m.id) is distinct from p_target
  or not exists(select 1 from public.icash_deal_files where id=t.deal_id and account_id=p_account and screening_id=p.screening_id)
  or not icash_seller_call_private.context_current(p_account,t.id)
  or (t.operational_contact_id is null and not public.icash_seller_sms_call_before_one_call(p_account,m.id))
  or (t.operational_contact_id is not null and not public.icash_seller_call_now_intent(p_account,t.id,m.body,m.created_at)) then return false;end if;
 -- Whole-message direct requests need no prior question. Availability must bind
 -- the actual last outgoing message, with a delivered receipt (not accepted).
 if trim(both ' .!?' from lower(trim(m.body))) !~ '^(please )?((can|could|would) you |you can )?(call( me)?( back)?|give me a call)( (right )?now)?( please)?$' then
  select * into q from public.icash_text_messages where account_id=p_account and thread_id=t.id and direction='outgoing'
   and (created_at,id)<(m.created_at,m.id) order by created_at desc,id desc limit 1;
  if q.id is null or q.state<>'delivered' or nullif(btrim(q.provider_id),'') is null or q.customer_author_id is not null
   or q.body not in ('When is a good time to talk about a cash offer?','What day and time work for a call?','Are you free for a quick call now, or would later work better?') then return false;end if;
 end if;
 -- A later text-only choice from any bound pool account also cancels this call.
 if exists(select 1 from public.icash_text_messages newer
  where newer.id in (select icash_seller_call_private.scoped_messages(p_account,p_target))
  and newer.direction='incoming' and newer.state='received' and coalesce(nullif(btrim(newer.event_id),''),nullif(btrim(newer.provider_id),'')) is not null
  and (newer.created_at,newer.id)>(m.created_at,m.id)
  and (icash_seller_call_private.soft_text(newer.body) or icash_seller_call_private.firm_refusal(newer.id))) then return false;end if;
 return true;
end$$;

create function public.icash_seller_one_call_current(p_account uuid,p_job uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.icash_voice_jobs;r icash_seller_call_private.requests;target uuid;
begin
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account;
 if not found or j.state not in ('ready','issued','dispatching','dispatched')
  or j.callback_id is not null or j.cancellation_notice_id is not null or j.sms_source_message_id is null
  or j.provider_call_sid is not null or j.conversation_id is not null then return false;end if;
 target:=coalesce(j.permission_id,j.operational_contact_id);
 select * into r from icash_seller_call_private.requests where job_id=p_job and account_id=p_account and target_id=target and operational=(j.operational_contact_id is not null) and message_id=j.sms_source_message_id;
 if not found then return public.icash_requested_seller_call_before_one_call(p_account,p_job);end if;
 if not found or r.preference_id is distinct from icash_seller_call_private.preference_current(p_account,target)
  or r.request_binding is distinct from icash_seller_call_private.message_binding(j.sms_source_message_id) then return false;end if;
 if r.target_binding is distinct from icash_seller_call_private.target_binding(p_account,target) then return false;end if;
 if exists(select 1 from public.icash_call_recordings where voice_job_id=j.id and (dial_claimed_at is not null or call_sid is not null))
  or exists(select 1 from public.icash_operation_spend where operation_key='voice:'||j.id and state not in ('reserved','dispatched')) then return false;end if;
 return icash_seller_call_private.request_current(p_account,target,r.message_id,true);
end$$;

create function icash_seller_call_private.continuing(p_account uuid,p_job uuid) returns boolean
language plpgsql set search_path='' as $$
declare j public.icash_voice_jobs;r icash_seller_call_private.requests;target uuid;
begin
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account and state in ('dispatching','dispatched');
 if not found or j.operation_key is distinct from 'voice:'||j.id then return false;end if;
 target:=coalesce(j.permission_id,j.operational_contact_id);
 select * into r from icash_seller_call_private.requests where job_id=j.id and account_id=p_account and message_id=j.sms_source_message_id and target_id=target and operational=(j.operational_contact_id is not null);
 if not found or r.preference_id is distinct from icash_seller_call_private.preference_current(p_account,target)
  or r.request_binding is distinct from icash_seller_call_private.message_binding(r.message_id) then return false;end if;
 if r.target_binding is distinct from icash_seller_call_private.target_binding(p_account,target) then return false;end if;
 return exists(select 1 from public.icash_call_recordings cr join public.icash_operation_spend o on o.operation_key=cr.operation_key and o.account_id=cr.account_id
  where cr.voice_job_id=j.id and cr.account_id=p_account and cr.operation_key=j.operation_key and cr.permission_id is not distinct from j.permission_id and cr.operational_contact_id is not distinct from j.operational_contact_id
   and cr.to_phone=(select phone from public.icash_voice_contact_targets where id=target and account_id=p_account) and cr.dial_claimed_at is not null and cr.call_sid is not null and cr.call_ended_at is null
   and cr.state='consent_pending' and cr.start_claimed_at is null and cr.consent_deadline_at>clock_timestamp()
   and o.state='dispatched' and o.permission_until>clock_timestamp())
  and icash_seller_call_private.request_current(p_account,target,r.message_id,false);
end$$;

-- Preserve legacy intake detection. A new operational request must satisfy
-- complete call-only source proof before existing enqueue/event handlers see it.
alter function public.icash_seller_sms_call_current(uuid,uuid) rename to icash_seller_sms_call_before_one_call;
create function public.icash_seller_sms_call_current(p_account uuid,p_message uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare t public.icash_text_threads;target uuid;
begin
 select th.* into t from public.icash_text_messages m join public.icash_text_threads th on th.id=m.thread_id and th.account_id=m.account_id
  where m.id=p_message and m.account_id=p_account;
 if t.operational_contact_id is null then return public.icash_seller_sms_call_before_one_call(p_account,p_message);end if;
 target:=icash_seller_call_private.target_for_message(p_account,t.id,p_message);
 return target is not null and icash_seller_call_private.request_current(p_account,target,p_message,true);
end$$;

-- Source uniqueness is stricter for the new ledger: even a later pre-dial
-- cancellation never permits reusing the same new request receipt.
alter table public.icash_voice_jobs drop constraint icash_voice_sms_source;
alter table public.icash_voice_jobs add constraint icash_voice_sms_source check(sms_source_message_id is null or
 (((permission_id is null)<>(operational_contact_id is null)) and callback_id is null and sms_requested_at is not null));
drop index public.icash_voice_operational_first_once;
create unique index icash_voice_operational_first_once on public.icash_voice_jobs(operational_contact_id)
 where callback_id is null and sms_source_message_id is null;

alter function public.icash_requested_seller_call_current(uuid,uuid) rename to icash_requested_seller_call_before_one_call;
create function public.icash_requested_seller_call_current(p_account uuid,p_job uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from icash_seller_call_private.requests where job_id=p_job and account_id=p_account) then
  return exists(select 1 from public.icash_voice_jobs where id=p_job and account_id=p_account and state in ('ready','issued'))
   and public.icash_seller_one_call_current(p_account,p_job);
 end if;
 return public.icash_requested_seller_call_before_one_call(p_account,p_job);
end$$;

create function icash_seller_call_private.preference_allows_job(p_account uuid,p_job uuid,p_continue boolean default false) returns boolean
language plpgsql set search_path='' as $$
declare target uuid;
begin
 select coalesce(permission_id,operational_contact_id) into target from public.icash_voice_jobs where id=p_job and account_id=p_account;
 if target is null then return false;end if;
 if exists(select 1 from public.icash_voice_jobs j where j.id=p_job and j.account_id=p_account
  and j.sms_source_message_id is null and j.callback_id is null and j.cancellation_notice_id is null
  and j.meta_offer_lead_id is null and j.meta_followup_lead_id is null
  and exists(select 1 from icash_seller_call_private.requests request where request.account_id=p_account
   and request.target_id=target and request.operational=(j.operational_contact_id is not null))) then return false;end if;
 if exists(select 1 from icash_seller_call_private.requests where job_id=p_job) then
  return case when p_continue then icash_seller_call_private.continuing(p_account,p_job) else public.icash_seller_one_call_current(p_account,p_job) end;
 end if;
 -- Captured choices remain stops even when a feature is disabled or provenance
 -- later changes. Missing proof cannot restore a campaign.
 return not exists(select 1 from icash_seller_call_private.preferences pr
   where pr.message_id in (select icash_seller_call_private.scoped_preferences(p_account,target)))
  and not exists(select 1 from icash_seller_call_private.scoped_messages(p_account,target) m where icash_seller_call_private.firm_refusal(m));
end$$;

alter function public.icash_queue_seller_sms_call(uuid,uuid,uuid) rename to icash_queue_seller_sms_before_one_call;
create function public.icash_queue_seller_sms_call(p_account uuid,p_message uuid,p_actor uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;target uuid;pref uuid;p public.icash_voice_contact_targets;j uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if p_actor is not null and not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then return null;end if;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account;
 if not found then return null;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account;
 if not found then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 -- The immutable ledger owns idempotency, including consumed/unknown attempts.
 select job_id into j from icash_seller_call_private.requests where message_id=p_message and account_id=p_account;
 if found then return j;end if;
 target:=icash_seller_call_private.target_for_message(p_account,t.id,p_message);
 if target is null then return public.icash_queue_seller_sms_before_one_call(p_account,p_message,p_actor);end if;
 pref:=icash_seller_call_private.preference_current(p_account,target);
 select * into p from public.icash_voice_contact_targets where id=target and account_id=p_account;
 if pref is null and p.eligibility_source<>'operational_checks_only' then
  if exists(select 1 from icash_seller_call_private.preferences pr where pr.message_id in (select icash_seller_call_private.scoped_preferences(p_account,target)))
   or exists(select 1 from icash_seller_call_private.scoped_messages(p_account,target) msg where icash_seller_call_private.firm_refusal(msg)) then return null;end if;
  return public.icash_queue_seller_sms_before_one_call(p_account,p_message,p_actor);
 end if;
 -- Owner restart cannot renew this prospective consent: always a fresh source.
 if not icash_seller_call_private.request_current(p_account,target,p_message,true) then return null;end if;
 select * into p from public.icash_voice_contact_targets where id=target and account_id=p_account;
 if exists(select 1 from public.icash_voice_jobs prior join public.icash_voice_contact_targets cp on cp.id=coalesce(prior.permission_id,prior.operational_contact_id) and cp.account_id=prior.account_id
  where cp.phone=p.phone and (prior.state='dispatching' or (prior.state='held' and prior.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))))
  or exists(select 1 from public.icash_live_conversations where contact_key=p.contact_key and state in ('waiting','review'))
  or exists(select 1 from public.icash_call_recordings r where r.to_phone=p.phone and r.dial_claimed_at is not null and r.call_ended_at is null
   and not public.icash_seller_recorded_call_finished(r.account_id,r.id))
  or exists(select 1 from public.icash_voice_jobs where sms_source_message_id=p_message)
  or exists(select 1 from public.icash_voice_jobs prior where prior.account_id=p_account
   and coalesce(prior.permission_id,prior.operational_contact_id)=target and prior.state in ('ready','issued')
   and (prior.sms_source_message_id is not null or prior.callback_id is not null or prior.cancellation_notice_id is not null
    or prior.meta_offer_lead_id is not null or prior.meta_followup_lead_id is not null or prior.meta_retry_of is not null
    or prior.operation_key is not null or prior.provider_call_sid is not null or prior.conversation_id is not null
    or exists(select 1 from public.icash_operation_spend o where o.operation_key='voice:'||prior.id)
    or exists(select 1 from public.icash_call_recordings cr where cr.voice_job_id=prior.id or cr.operation_key='voice:'||prior.id)
    or exists(select 1 from public.icash_live_conversations lc where lc.operation_key='voice:'||prior.id))) then return null;end if;
 insert into public.icash_voice_jobs(account_id,permission_id,operational_contact_id,sms_source_message_id,sms_requested_at,sms_requested_by)
 values(p_account,case when p.eligibility_source='operator_record' then target end,
  case when p.eligibility_source='operational_checks_only' then target end,p_message,clock_timestamp(),p_actor) returning id into j;
 insert into icash_seller_call_private.requests(job_id,message_id,preference_id,account_id,target_id,operational,request_binding,target_binding)
 values(j,p_message,pref,p_account,target,p.eligibility_source='operational_checks_only',icash_seller_call_private.message_binding(p_message),icash_seller_call_private.target_binding(p_account,target));
 -- This NEW request prospectively supersedes only untouched ordinary work.
 -- Release its queue slot, never any reserved money, started/unknown evidence,
 -- existing held diagnosis, callback, notice or source-specific Meta sequence.
 update public.icash_voice_jobs prior set state='held',outcome='seller_request_superseded_before_admission',updated_at=clock_timestamp()
 where prior.account_id=p_account and coalesce(prior.permission_id,prior.operational_contact_id)=target
  and prior.id<>j and prior.state in ('ready','issued') and prior.sms_source_message_id is null
  and prior.callback_id is null and prior.cancellation_notice_id is null and prior.meta_offer_lead_id is null
  and prior.meta_followup_lead_id is null and prior.meta_retry_of is null
  and prior.operation_key is null and prior.provider_call_sid is null and prior.conversation_id is null
  and not exists(select 1 from public.icash_operation_spend o where o.operation_key='voice:'||prior.id)
  and not exists(select 1 from public.icash_call_recordings cr where cr.voice_job_id=prior.id or cr.operation_key='voice:'||prior.id)
  and not exists(select 1 from public.icash_live_conversations lc where lc.operation_key='voice:'||prior.id);
 update public.icash_sms_call_requests set state='resolved',updated_at=now() where account_id=p_account and thread_id=t.id and requested_at<=m.created_at and state='needs_review';
 update public.icash_text_attention set state='acknowledged',updated_at=now() where account_id=p_account and thread_id=t.id and kind='callback' and state='open';
 update public.icash_text_ai_jobs set state='superseded',updated_at=now() where account_id=p_account and thread_id=t.id and state in ('pending','issued','drafted');
 update public.icash_text_messages set state='cancelled',updated_at=now() where account_id=p_account and thread_id=t.id and direction='outgoing' and state='ready' and provider_id is null;
 return j;
end$$;

create function public.icash_seller_call_preference_allows_job(p_account uuid,p_job uuid,p_continue boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
begin return icash_seller_call_private.preference_allows_job(p_account,p_job,p_continue);end$$;

-- Guarded edits preserve all other current admission, recording and clock
-- predicates. Any predecessor drift aborts the whole installation.
do $patch$
declare d text;old text;replacement text;signature text;pair text[];
begin
 signature:='public.icash_claim_voice_job(uuid)';d:=pg_get_functiondef(signature::regprocedure);
 old:='if not found or j.state<>''issued'' or j.due_at>now() then return false;end if;';
 if array_length(string_to_array(d,old),1)<>2 then raise exception 'One-call claim boundary changed';end if;
 d:=replace(d,old,old||E'\n if not public.icash_seller_call_preference_allows_job(j.account_id,p_job) then return false;end if;');
 old:='public.icash_seller_voice_permission_current(j.account_id,p.id)';
 if array_length(string_to_array(d,old),1)<>2 then raise exception 'One-call claim permission changed';end if;
 execute replace(d,old,'('||old||' or public.icash_seller_one_call_current(j.account_id,j.id))');

 signature:='public.icash_reserve_paced_voice(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,boolean)';d:=pg_get_functiondef(signature::regprocedure);
 old:='if not found or j.state<>''issued'' then return false;end if;';
 if array_length(string_to_array(d,old),1)<>2 then raise exception 'One-call reservation boundary changed';end if;
 execute replace(d,old,old||E'\n if not public.icash_seller_call_preference_allows_job(p_account,p_job) then return false;end if;');

 signature:='public.icash_seller_response_operation_allowed(uuid,text)';d:=pg_get_functiondef(signature::regprocedure);
 old:='if p_operation like ''voice:%'' then';
 if array_length(string_to_array(d,old),1)<>2 then raise exception 'One-call operation boundary changed';end if;
 d:=replace(d,old,old||E'\n  if exists(select 1 from public.icash_voice_jobs j where j.account_id=p_account and ''voice:''||j.id=p_operation\n   and not public.icash_seller_call_preference_allows_job(p_account,j.id)) then return false;end if;');
 old:='where p.id=scope.permission_id and p.account_id=p_account and m.voice_paused) then return false;end if;';
 if array_length(string_to_array(d,old),1)<>2 then raise exception 'One-call Meta operation boundary changed';end if;
 d:=replace(d,old,'where p.id=scope.permission_id and p.account_id=p_account and m.voice_paused) and not exists(select 1 from public.icash_voice_jobs j where j.account_id=p_account and ''voice:''||j.id=p_operation and public.icash_seller_one_call_current(p_account,j.id)) then return false;end if;');
 execute d;

 signature:='public.icash_create_direct_recorded_call(uuid,text,text,text,text,text,text,jsonb,jsonb)';d:=pg_get_functiondef(signature::regprocedure);
 old:='public.icash_seller_voice_permission_current(j.account_id,p.id)';
 if array_length(string_to_array(d,old),1)<>2 then raise exception 'One-call recording-create permission changed';end if;
 d:=replace(d,old,'('||old||' or public.icash_seller_one_call_current(j.account_id,j.id))');
 old:='and j.conversation_id is null and p.revoked_at is null';
 if array_length(string_to_array(d,old),1)<>2 then raise exception 'One-call recording-create boundary changed';end if;
 execute replace(d,old,'and icash_seller_call_private.preference_allows_job(j.account_id,j.id) '||old);

 signature:='public.icash_transition_call_recording(uuid,uuid,text,text,text,jsonb)';d:=pg_get_functiondef(signature::regprocedure);
 old:='public.icash_seller_voice_permission_current(r.account_id,cp.id)';
 if array_length(string_to_array(d,old),1)<>2 then raise exception 'One-call recording transition permission changed';end if;
 d:=replace(d,old,'('||old||' or case when p_action=''claim_dial'' then public.icash_seller_one_call_current(r.account_id,r.voice_job_id) else icash_seller_call_private.continuing(r.account_id,r.voice_job_id) end)');
 old:='t:=icash_recording_private.clock_now();ns:=r.state;';
 if array_length(string_to_array(d,old),1)<>2 then raise exception 'One-call recording transition clock changed';end if;
 d:=replace(d,old,old||E'\n if p_action in (''claim_dial'',''authorize_recording'',''claim_start'') and not icash_seller_call_private.preference_allows_job(r.account_id,r.voice_job_id,p_action<>''claim_dial'') then return null;end if;');
 -- Lock source capture and final dial in the same budget order as existing
 -- queue/reservation/Stop. The recording lock follows the common budget lock.
 old:=' select * into r from public.icash_call_recordings where id=p_id and account_id=p_account and operation_key=p_operation and state=p_expected_state for update;';
 if array_length(string_to_array(d,old),1)<>2 then raise exception 'One-call recording lock boundary changed';end if;
 execute replace(d,old,E' if p_action in (''claim_dial'',''authorize_recording'',''claim_start'') then perform 1 from public.icash_operating_budget where id=1 for update;end if;\n'||old);
end$patch$;

-- Existing invoker admission functions need service-only proof entry points,
-- without granting clients or service writers access to the private ledger.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='icash_seller_call_private' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end$$;
-- Preserve each existing admission function's invoker/definer boundary.
revoke all on function public.icash_seller_call_invitation_capable(uuid,uuid,uuid),public.icash_seller_one_call_current(uuid,uuid),public.icash_seller_call_preference_allows_job(uuid,uuid,boolean),public.icash_seller_sms_call_current(uuid,uuid),public.icash_seller_sms_call_before_one_call(uuid,uuid),
 public.icash_requested_seller_call_current(uuid,uuid),public.icash_requested_seller_call_before_one_call(uuid,uuid),
 public.icash_queue_seller_sms_call(uuid,uuid,uuid),public.icash_queue_seller_sms_before_one_call(uuid,uuid,uuid),
 public.icash_claim_voice_job(uuid),public.icash_reserve_paced_voice(uuid,uuid,uuid,timestamptz,timestamptz,boolean),
 public.icash_seller_response_operation_allowed(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_seller_call_invitation_capable(uuid,uuid,uuid),public.icash_seller_one_call_current(uuid,uuid),public.icash_seller_call_preference_allows_job(uuid,uuid,boolean),public.icash_seller_sms_call_current(uuid,uuid),public.icash_seller_sms_call_before_one_call(uuid,uuid),
 public.icash_requested_seller_call_current(uuid,uuid),public.icash_requested_seller_call_before_one_call(uuid,uuid),
 public.icash_queue_seller_sms_call(uuid,uuid,uuid),public.icash_queue_seller_sms_before_one_call(uuid,uuid,uuid),
 public.icash_claim_voice_job(uuid),public.icash_reserve_paced_voice(uuid,uuid,uuid,timestamptz,timestamptz,boolean),
 public.icash_seller_response_operation_allowed(uuid,text) to service_role;
commit;
