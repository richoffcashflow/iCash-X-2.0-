-- Prospective reviewed seller introductions. Install disabled; activate only
-- after exact-release verification. Never rewrite an existing assignment/text.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$
declare expected record;
begin
 for expected in select * from (values
  ('public.icash_assign_seller_opener(uuid,uuid)','73f8280fa29969c9fa3b41e28567fb47'),
  ('public.icash_queue_seller_opener(uuid,uuid)','faaea63aa86126d4a1647920dd349c86'),
  ('public.icash_seller_opener_candidate_body(uuid,uuid)','b0594b0dc985c0012bc2d3b90ae04643'),
  ('public.icash_seller_identity_opener(text,text)','3ed2e032aca8552f3698c9464d99fd0c')
 ) v(signature,checksum) loop
  if md5(pg_get_functiondef(to_regprocedure(expected.signature))) is distinct from expected.checksum then
   raise exception 'Seller SMS v5 prerequisite changed: %',expected.signature;
  end if;
 end loop;
 if to_regprocedure('public.icash_learning_decision_v2(jsonb,text[],boolean)') is null
  or to_regprocedure('public.icash_record_learning_decision(text,text,text,jsonb,text[],boolean)') is null then
  raise exception 'Evidence-v2 decision policy must be installed first';
 end if;
end $guard$;

create table icash_learning_policy_private.sms_settings(
 id integer primary key check(id=1),enabled boolean not null default false
);
insert into icash_learning_policy_private.sms_settings(id) values(1);
alter table icash_learning_policy_private.sms_settings enable row level security;
revoke all on icash_learning_policy_private.sms_settings from public,anon,authenticated;
grant select,update on icash_learning_policy_private.sms_settings to service_role;

alter table public.icash_seller_opener_assignments
 drop constraint icash_seller_opener_assignments_learning_context_check;
alter table public.icash_seller_opener_assignments
 add constraint icash_seller_opener_assignments_learning_context_check
 check(learning_context in ('opener-v1','interest-v2','identity-v3','identity-v4','identity-v5')),
 add column learning_decision_id bigint references icash_learning_policy_private.decisions(id),
 add column learning_policy_version text,
 add column learning_selection_mode text,
 add constraint seller_opener_v5_decision_check check(
  (learning_context='identity-v5' and learning_decision_id is not null and learning_policy_version is not null and learning_policy_version='evidence-v2'
   and learning_selection_mode is not null and learning_selection_mode in ('control','explore','shared'))
  or (learning_context<>'identity-v5' and learning_decision_id is null and learning_policy_version is null and learning_selection_mode is null));
insert into public.icash_seller_opener_variants(key,body,enabled) values
 ('identity_cash_v5','Hi, contacting you for {principal} about a cash offer. Do you own {address}?',true),
 ('identity_as_is_v5','Hi, contacting you for {principal} about buying as is for cash. Do you own {address}?',true),
 ('identity_timing_v5','Hi, contacting you for {principal} about a possible cash sale. Do you own {address}?',true);

create function public.icash_seller_identity_opener_v5(p_variant text,p_principal text,p_address text)
returns text language plpgsql immutable security invoker set search_path='' as $function$
declare body text;subject text;
begin
 if nullif(trim(p_principal),'') is null or nullif(trim(p_address),'') is null then return null;end if;
 subject:=case p_variant when 'identity_cash_v5' then 'a cash offer'
  when 'identity_as_is_v5' then 'buying as is for cash'
  when 'identity_timing_v5' then 'a possible cash sale' end;
 if subject is null then return null;end if;
 body:='Hi, contacting you for '||trim(p_principal)||' about '||subject||'. Do you own '||trim(p_address)||'?';
 if length(body)>160 or body ~ '[^A-Za-z0-9 .,!?&#/-]' then return null;end if;
 return body;
end $function$;

-- Canonical owner identity is defined in lib/owner-inbound-acceptance.ts and
-- was verified against the exact production account before this migration.
-- This predicate has no settings/queue/recency gates: outcome readers reuse it.
create function public.icash_seller_sms_learning_eligible(p_account uuid,p_thread uuid)
returns boolean language sql stable security invoker set search_path='' as $function$
 select exists(select 1 from public.icash_text_threads t
 join public.icash_accounts a on a.id=t.account_id
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 join public.icash_screening_jobs j on j.id=d.screening_id and j.account_id=d.account_id
 where t.id=p_thread and t.account_id=p_account and t.party='seller' and t.seller_intake_id is null
  and a.owner_user_id is not null and a.owner_user_id<>'592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
  and coalesce(d.terms->>'practice','false')<>'true' and coalesce(d.terms->>'test','false')<>'true'
  and coalesce(j.snapshot->>'practice','false')<>'true' and coalesce(j.snapshot->>'test','false')<>'true'
  and coalesce(j.snapshot->>'propertyId','') not like 'practice_%'
  and j.event_key like 'discovery:%' and not j.snapshot ? 'sellerRequest'
  and (not exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='test' and f.state='paid')
   or exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='live' and f.state='paid')));
$function$;
create function public.icash_seller_sms_learning_active(p_account uuid,p_thread uuid)
returns boolean language sql stable security invoker set search_path='' as $function$
 select coalesce((select enabled from icash_learning_policy_private.sms_settings where id=1),false)
  and coalesce((select enabled from icash_learning_policy_private.settings where id=1),false)
  and public.icash_seller_sms_learning_eligible(p_account,p_thread);
$function$;

-- Read-only preview used by both candidate selection and final assignment.
-- It records no decision and never grants contact or provider authority.
create function public.icash_seller_sms_learning_plan(p_account uuid,p_thread uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $function$
declare principal text;address text;choices text[];allowed text[];challengers text[];
 stats jsonb;decision jsonb;chosen text;mode text:='explore';bucket bigint;control boolean;
begin
 if not public.icash_seller_sms_learning_active(p_account,p_thread) then return null;end if;
 select trim(coalesce(nullif(trim(i.company_name),''),i.principal)),public.icash_conversation_street(d.terms->>'address')
 into principal,address from public.icash_text_threads t
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 join public.icash_customer_identities i on i.account_id=t.account_id
 where t.id=p_thread and t.account_id=p_account;
 select array_agg(v.key order by v.key) into choices from public.icash_seller_opener_variants v
 where v.enabled and v.key in ('identity_cash_v5','identity_as_is_v5','identity_timing_v5')
  and v.body=replace(replace(public.icash_seller_identity_opener_v5(v.key,'PRINCIPAL','ADDRESS'),'PRINCIPAL','{principal}'),'ADDRESS','{address}')
  and public.icash_seller_identity_opener_v5(v.key,principal,address) is not null;
 if coalesce(cardinality(choices),0)=0 then return null;end if;
 stats:=public.icash_shared_learning_stats('seller_sms','identity-v5','*');
 decision:=public.icash_learning_decision_v2(stats,choices,false);
 select array_agg(c order by c) into allowed from unnest(choices) c
 where coalesce(decision->'allowedChoices','[]'::jsonb) ? c;
 if coalesce(cardinality(allowed),0)=0 then return null;end if;
 bucket:=('x'||substr(md5(p_account::text||p_thread::text||':seller-sms:identity-v5'),1,8))::bit(32)::bigint%10000;
 control:=('x'||substr(md5(p_account::text||':seller-sms:identity-v5:control'),1,8))::bit(32)::bigint%10000<2000;
 if control then mode:='control';end if;
 if not control and decision->>'status'='shared' and decision->>'winner'=any(allowed) and cardinality(allowed)>1 then
  select array_agg(c order by c) into challengers from unnest(allowed) c where c<>decision->>'winner';
  if bucket<6000 then chosen:=decision->>'winner';mode:='shared';
  else chosen:=challengers[1+(bucket-6000)%cardinality(challengers)];end if;
 else chosen:=allowed[1+bucket%cardinality(allowed)];end if;
 return jsonb_build_object('variant',chosen,'body',public.icash_seller_identity_opener_v5(chosen,principal,address),
  'context','identity-v5','stats',stats,'choices',to_jsonb(choices),'decision',decision,'mode',mode);
end $function$;

create or replace function public.icash_assign_seller_opener(p_account uuid,p_thread uuid) returns jsonb
language plpgsql security invoker set search_path='' as $function$
declare existing public.icash_seller_opener_assignments;chosen public.icash_seller_opener_variants;
 plan jsonb;choices text[];decision_id bigint;saved_decision jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' for update;
 if not found then return null;end if;
 select * into existing from public.icash_seller_opener_assignments where thread_id=p_thread and account_id=p_account;
 if found then return jsonb_build_object('variant',existing.variant,'body',existing.body,'context',existing.learning_context);end if;
 if public.icash_seller_sms_learning_active(p_account,p_thread) then
  plan:=public.icash_seller_sms_learning_plan(p_account,p_thread);
  if plan is null then return null;end if;
  select array_agg(c order by c) into choices from jsonb_array_elements_text(plan->'choices') c;
  decision_id:=public.icash_record_learning_decision('seller_sms','identity-v5','*',plan->'stats',choices,false);
  select decision into saved_decision from icash_learning_policy_private.decisions where id=decision_id;
  if saved_decision is distinct from plan->'decision' then raise exception 'Seller SMS decision changed';end if;
  insert into public.icash_seller_opener_assignments(thread_id,account_id,variant,body,learning_context,
   learning_decision_id,learning_policy_version,learning_selection_mode)
  values(p_thread,p_account,plan->>'variant',plan->>'body','identity-v5',decision_id,'evidence-v2',plan->>'mode');
  return jsonb_build_object('variant',plan->>'variant','body',plan->>'body','context','identity-v5');
 end if;
 select * into chosen from public.icash_seller_opener_variants where key='identity-v4' and enabled;
 if not found then return null;end if;
 insert into public.icash_seller_opener_assignments(thread_id,account_id,variant,body,learning_context)
 values(p_thread,p_account,chosen.key,chosen.body,'identity-v4');
 return jsonb_build_object('variant',chosen.key,'body',chosen.body,'context','identity-v4');
end $function$;

create function public.icash_guard_seller_sms_learning_assignment() returns trigger
language plpgsql security invoker set search_path='' as $function$
begin
 if (old.learning_context='identity-v5' or new.learning_context='identity-v5')
  and (row(new.thread_id,new.account_id,new.variant,new.body,new.learning_context,new.learning_decision_id,new.learning_policy_version,new.learning_selection_mode,new.created_at)
   is distinct from row(old.thread_id,old.account_id,old.variant,old.body,old.learning_context,old.learning_decision_id,old.learning_policy_version,old.learning_selection_mode,old.created_at)
   or (old.message_id is not null and new.message_id is distinct from old.message_id)) then
  raise exception 'Seller SMS learning assignment is immutable';
 end if;
 return new;
end $function$;
create trigger seller_sms_learning_assignment_immutable before update on public.icash_seller_opener_assignments
 for each row execute function public.icash_guard_seller_sms_learning_assignment();

do $queue$
declare signature text;definition text;needle text;
begin
 foreach signature in array array['public.icash_queue_seller_opener(uuid,uuid)','public.icash_seller_opener_candidate_body(uuid,uuid)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:='message_body:=public.icash_seller_identity_opener(principal,address);';
  if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Seller SMS copy expansion changed: %',signature;end if;
  definition:=replace(definition,needle,$new$if public.icash_seller_sms_learning_active(p_account,t.id) then
   choice:=public.icash_seller_sms_learning_plan(p_account,t.id);
   message_body:=choice->>'body';
  else message_body:=public.icash_seller_identity_opener(principal,address);end if;$new$);
  if signature='public.icash_queue_seller_opener(uuid,uuid)' then
   needle:=$old$if choice->>'context'='interest-v2' then$old$;
   if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Seller SMS assigned expansion changed';end if;
   definition:=replace(definition,needle,$new$if choice->>'context'='identity-v5' then
  message_body:=choice->>'body';
  if message_body is null or length(message_body)>160 or message_body ~ '[^A-Za-z0-9 .,!?&#/-]' then raise exception 'Seller SMS v5 copy requires review';end if;
 elsif choice->>'context'='interest-v2' then$new$);
  end if;
  execute definition;
 end loop;
end $queue$;

-- Activation shares the original queue admission lock. Disabling affects only
-- future assignments; it never cancels, reassigns or changes an existing text.
create function public.icash_set_seller_sms_learning_enabled(p_enabled boolean) returns void
language plpgsql security invoker set search_path='' as $function$
begin
 if p_enabled is null then raise exception 'Enabled state required';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 if p_enabled and not coalesce((select enabled from icash_learning_policy_private.settings where id=1),false) then
  raise exception 'Verified evidence-v2 release must be enabled first';
 end if;
 update icash_learning_policy_private.sms_settings set enabled=p_enabled where id=1;
end $function$;
revoke all on function public.icash_seller_identity_opener_v5(text,text,text),public.icash_seller_sms_learning_eligible(uuid,uuid),
 public.icash_seller_sms_learning_active(uuid,uuid),public.icash_seller_sms_learning_plan(uuid,uuid),public.icash_set_seller_sms_learning_enabled(boolean),public.icash_guard_seller_sms_learning_assignment()
 from public,anon,authenticated;
grant execute on function public.icash_seller_identity_opener_v5(text,text,text),public.icash_seller_sms_learning_eligible(uuid,uuid),
 public.icash_seller_sms_learning_active(uuid,uuid),public.icash_seller_sms_learning_plan(uuid,uuid),public.icash_set_seller_sms_learning_enabled(boolean)
 to service_role;
commit;
