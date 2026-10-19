-- Receipt-bound seller callbacks. No provider configuration or historical
-- approval, balance, pause, attempt or receipt is changed by this migration.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create schema icash_callback_private;
revoke all on schema icash_callback_private from public,anon,authenticated;
grant usage on schema icash_callback_private to service_role;

-- Count alternatives BEFORE current admission checks. A paused/retired route
-- must not make the same phone's other account appear to be a unique match.
create function icash_callback_private.candidates(p_phone text,p_business text default null)
returns table(account_id uuid,deal_id uuid,screening_id uuid,thread_id uuid,
 business_number text,address text,account_name text,last_contact_at timestamptz,available boolean)
language sql stable security invoker set search_path='' as $$
 select t.account_id,d.id,d.screening_id,t.id,t.sender,
  coalesce(nullif(d.terms->>'address',''),nullif(s.snapshot->>'address',''),'Address pending'),
  coalesce(nullif(a.legal_name,''),nullif(a.assistant_name,''),'Customer account'),contact.at,
  coalesce(not a.bot_paused and t.retired_at is null and not t.paused and not t.manual_only
  and d.stage not in ('closed','cancelled')
  and not exists(select 1 from public.icash_property_controls pc where pc.account_id=t.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
  and not exists(select 1 from public.icash_contact_suppressions cs where cs.contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex'))
  and not exists(select 1 from public.icash_text_suppressions ts where ts.phone=p_phone)
  and not exists(select 1 from public.icash_sms_routes route where route.sender=t.sender and route.recipient=t.recipient and (route.account_id<>t.account_id or route.needs_review))
  and (t.sender='+14243948384' or exists(select 1 from public.icash_business_voice_numbers n where n.phone=t.sender and n.outbound_enabled and n.forwarding_ready)),false)
 from public.icash_text_threads t
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
 join public.icash_accounts a on a.id=t.account_id
 cross join lateral (
  select max(evidence.at) at from (
   select m.created_at at from public.icash_text_messages m
   where m.thread_id=t.id and m.account_id=t.account_id and m.direction='outgoing'
    and m.state in ('accepted','delivered') and nullif(m.provider_id,'') is not null
    and m.created_at between now()-interval '30 days' and now()
   union all
   select r.dial_claimed_at from public.icash_call_recordings r
   where r.account_id=t.account_id and r.screening_id=d.screening_id and r.party='seller'
    and r.to_phone=t.recipient and r.from_phone=t.sender and nullif(r.call_sid,'') is not null
    and r.dial_claimed_at between now()-interval '30 days' and now()
   union all
   select c.created_at from public.icash_customer_phone_calls c
   where c.account_id=t.account_id and c.screening_id=d.screening_id
    and c.recipient_phone=t.recipient and c.business_phone=t.sender and nullif(c.child_sid,'') is not null
    and c.created_at between now()-interval '30 days' and now()
  ) evidence
 ) contact
 where p_phone ~ '^\+1[2-9][0-9]{9}$' and t.recipient=p_phone and t.party='seller'
  and t.sender in ('+14243948384','+17208134296','+14244377030')
  and (p_business is null or p_business=t.sender) and contact.at is not null
  and coalesce(s.snapshot->>'practice','false')<>'true'
  and coalesce(s.snapshot->>'propertyId','') not like 'practice_%'
  and t.owner_buyer_test_id is null;
$$;
revoke all on function icash_callback_private.candidates(text,text) from public,anon,authenticated;
grant execute on function icash_callback_private.candidates(text,text) to service_role;

create function icash_callback_private.route(p_phone text)
returns jsonb language sql stable security invoker set search_path='' as $$
 with candidates as materialized (select * from icash_callback_private.candidates(p_phone)),
 counts as (select count(*) n,count(distinct account_id) accounts,count(distinct deal_id) deals,
  bool_and(available) available,min(account_id::text) account from candidates)
 select case when n=0 then null
  when exists(select 1 from public.icash_text_threads buyer
   join public.icash_text_messages sent on sent.thread_id=buyer.id and sent.account_id=buyer.account_id
   where buyer.recipient=p_phone and buyer.party<>'seller' and sent.direction='outgoing'
    and sent.state in ('accepted','delivered') and nullif(sent.provider_id,'') is not null
    and sent.created_at between now()-interval '30 days' and now()) then jsonb_build_object('status','ambiguous_account')
  when accounts<>1 then jsonb_build_object('status','ambiguous_account')
  when not available then jsonb_build_object('status','held','accountId',account)
  when deals<>1 or n<>1 then jsonb_build_object('status','ambiguous','accountId',account)
  else (select jsonb_build_object('status','matched','accountId',account_id,'dealId',deal_id,
   'threadId',thread_id,'screeningId',screening_id,'businessNumber',business_number) from candidates) end
 from counts;
$$;
revoke all on function icash_callback_private.route(text) from public,anon,authenticated;
grant execute on function icash_callback_private.route(text) to service_role;

-- Human lookup is read-only and owner-authorized; caller ID is only a hint.
create function public.icash_owner_callback_context(p_actor uuid,p_phone text,p_business text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare matches jsonb;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required' using errcode='42501';end if;
 if p_phone is null or p_phone !~ '^\+1[2-9][0-9]{9}$' or p_business is not null and p_business not in ('+14243948384','+17208134296','+14244377030') then raise exception 'Valid callback numbers required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('account',account_name,'accountId',account_id,'address',address,
  'screeningId',screening_id,'businessNumber',business_number,'lastContactAt',last_contact_at,'available',available)
  order by last_contact_at desc,thread_id),'[]'::jsonb) into matches
 from (select * from icash_callback_private.candidates(p_phone,p_business) order by last_contact_at desc,thread_id limit 51) candidates;
 return jsonb_build_object('phone',p_phone,'businessNumber',p_business,'matches',matches,
  'status',case when jsonb_array_length(matches)=0 then 'unknown' when jsonb_array_length(matches)=1 then 'matched' else 'ambiguous' end);
end $$;
revoke all on function public.icash_owner_callback_context(uuid,text,text) from public,anon,authenticated;
grant execute on function public.icash_owner_callback_context(uuid,text,text) to service_role;

alter table icash_recorded_reception_private.configs add column callback_template_id uuid references icash_recorded_reception_private.configs(id);
alter table icash_recorded_reception_private.sessions add column callback_route jsonb;
drop index icash_recorded_reception_private.recorded_reception_one_enabled;
create unique index recorded_reception_one_enabled on icash_recorded_reception_private.configs(called_number) where enabled and callback_template_id is null;
create unique index recorded_reception_callback_account on icash_recorded_reception_private.configs(callback_template_id,account_id) where callback_template_id is not null;

-- Child profiles inherit the EXACT currently enabled, reviewed provider/rate
-- template. Only account ownership and its immutable billing snapshot differ.
create function icash_callback_private.config_current(c icash_recorded_reception_private.configs)
returns boolean language sql stable security invoker set search_path='' as $$
 select c.callback_template_id is null or exists(
  select 1 from icash_recorded_reception_private.configs source
  where source.id=c.callback_template_id and source.callback_template_id is null and source.enabled
   and source.account_id='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid
   and source.owner_user_id='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
   and source.call_profile='normal' and source.entry_policy='direct_recorded_v1'
   and source.reviewed_until='9999-12-31T23:59:59Z'::timestamptz
   and source.approved_at<=now() and source.reviewed_until>now()
   and exists(select 1 from icash_recorded_reception_private.cost_policies policy where policy.id=source.cost_policy_id and policy.enabled and to_jsonb(policy)-'enabled'=source.cost_policy_snapshot)
   and (to_jsonb(source)-array['id','version','account_id','owner_user_id','cost_policy_id','cost_policy_snapshot','callback_template_id','created_at','approval_reference'])
    =(to_jsonb(c)-array['id','version','account_id','owner_user_id','cost_policy_id','cost_policy_snapshot','callback_template_id','created_at','approval_reference'])
   and (source.cost_policy_snapshot-array['id','version','account_id','created_at','approval_reference'])
    =(c.cost_policy_snapshot-array['id','version','account_id','created_at','approval_reference'])
 );
$$;
revoke all on function icash_callback_private.config_current(icash_recorded_reception_private.configs) from public,anon,authenticated,service_role;

-- This narrow server-only function provisions no credits or provider traffic.
-- Existing INSERT guards validate the new account's exact copied cost policy.
create function icash_callback_private.resolve_config(p_called text,p_caller text,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source icash_recorded_reception_private.configs;c icash_recorded_reception_private.configs;
 policy icash_recorded_reception_private.cost_policies;route jsonb;target public.icash_accounts;
begin
 if auth.uid() is not null then raise exception 'Server callback routing required' using errcode='42501';end if;
 if p_id is not null then
  select * into c from icash_recorded_reception_private.configs where id=p_id and called_number=p_called and enabled;
  if not found or not icash_callback_private.config_current(c) then return null;end if;
  if c.callback_template_id is null then return icash_recorded_reception_private.config_json(c);end if;
  select * into source from icash_recorded_reception_private.configs where id=c.callback_template_id;
 else
  select * into source from icash_recorded_reception_private.configs where called_number=p_called and enabled and callback_template_id is null for update;
  if not found then return null;end if;
  if source.call_profile<>'normal' or source.entry_policy<>'direct_recorded_v1' then return icash_recorded_reception_private.config_json(source);end if;
  route:=icash_callback_private.route(p_caller);
  if route is null then return icash_recorded_reception_private.config_json(source);end if;
  if route->>'status' not in ('matched','ambiguous') then return null;end if;
  if (route->>'accountId')::uuid=source.account_id then return icash_recorded_reception_private.config_json(source);end if;
  select * into target from public.icash_accounts where id=(route->>'accountId')::uuid and not bot_paused for update;
  if not found or not public.icash_membership_work_allowed(target.id)
   or not exists(select 1 from public.icash_wallets where account_id=target.id and balance_cents>reserved_cents) then return null;end if;
  select * into c from icash_recorded_reception_private.configs where callback_template_id=source.id and account_id=target.id;
  if not found then
   if source.cost_policy_id is null or source.reviewed_until<>'9999-12-31T23:59:59Z'::timestamptz
    or exists(select 1 from icash_recorded_reception_private.sessions where call_ended_at is null) then return null;end if;
   select * into policy from icash_recorded_reception_private.cost_policies where id=source.cost_policy_id and enabled for share;
   if not found or to_jsonb(policy)-'enabled' is distinct from source.cost_policy_snapshot then return null;end if;
   policy:=jsonb_populate_record(policy,jsonb_build_object('id',gen_random_uuid(),'account_id',target.id,
    'version','seller-callback:'||source.id||':'||target.id,'created_at',now(),
    'approval_reference','Owner standing calling approval for all accounts, 2026-10-14; seller callbacks requested 2026-10-19. Source '||source.id));
   insert into icash_recorded_reception_private.cost_policies select (policy).*;
   c:=jsonb_populate_record(source,jsonb_build_object('id',gen_random_uuid(),'account_id',target.id,'owner_user_id',target.owner_user_id,
    'version',(select coalesce(max(version),0)+1 from icash_recorded_reception_private.configs where account_id=target.id and called_number=p_called),
    'cost_policy_id',policy.id,'cost_policy_snapshot',to_jsonb(policy)-'enabled','callback_template_id',source.id,'created_at',now(),
    'approval_reference','Owner standing calling approval for all accounts, 2026-10-14; receipt-bound seller callback, 2026-10-19. Source '||source.id));
   if not icash_callback_private.config_current(c) then raise exception 'Exact callback template required';end if;
   insert into icash_recorded_reception_private.configs select (c).*;
  end if;
  if not c.enabled or not icash_callback_private.config_current(c) then return null;end if;
 end if;
 return icash_recorded_reception_private.config_json(c)||jsonb_build_object('callback_template',icash_recorded_reception_private.config_json(source));
end $$;
revoke all on function icash_callback_private.resolve_config(text,text,uuid) from public,anon,authenticated;
grant execute on function icash_callback_private.resolve_config(text,text,uuid) to service_role;
create function public.icash_resolve_seller_callback_config(p_called text,p_caller text default null,p_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select icash_callback_private.resolve_config(p_called,p_caller,p_id) $$;
revoke all on function public.icash_resolve_seller_callback_config(text,text,uuid) from public,anon,authenticated;
grant execute on function public.icash_resolve_seller_callback_config(text,text,uuid) to service_role;

-- Preserve the legacy single-template lookup for the compatible previous app.
do $patch$ declare d text;needle text;begin
 d:=pg_get_functiondef('public.icash_get_recorded_reception_config(text)'::regprocedure);
 needle:='where c.called_number=p_called_number and c.enabled';
 if position(needle in d)=0 then raise exception 'Reception template lookup changed';end if;
 execute replace(d,needle,needle||' and c.callback_template_id is null');
end $patch$;

-- Forward patches below preserve the original reserve, final claim, cleanup,
-- time limits, actual-cost settlement and provider idempotency primitives.
create function icash_callback_private.session_current(s icash_recorded_reception_private.sessions)
returns boolean language sql stable security invoker set search_path='' as $$
 select s.callback_route is null or (
  (icash_callback_private.route(s.from_phone)->>'accountId')::uuid=s.account_id
  and case when s.callback_route->>'status'='matched' then exists(
   select 1 from icash_callback_private.candidates(s.from_phone) t where t.account_id=s.account_id
    and t.thread_id=(s.callback_route->>'threadId')::uuid and t.deal_id=(s.callback_route->>'dealId')::uuid and t.available)
   else icash_callback_private.route(s.from_phone)->>'status' in ('matched','ambiguous') end
 );
$$;
revoke all on function icash_callback_private.session_current(icash_recorded_reception_private.sessions) from public,anon,authenticated,service_role;
do $patch$ declare d text;needle text;begin
 d:=pg_get_functiondef('public.icash_reserve_direct_reception(uuid,text,text,text,text,text,text,text,text,text,text)'::regprocedure);
 needle:='declare c icash_recorded_reception_private.configs;';
 if position(needle in d)=0 then raise exception 'Direct reception declaration changed';end if;
 d:=replace(d,needle,'declare callback_route jsonb;c icash_recorded_reception_private.configs;');
 needle:='if not found or not c.enabled then';
 if position(needle in d)=0 then raise exception 'Direct reception config gate changed';end if;
 d:=replace(d,needle,'if not found or not c.enabled or not icash_callback_private.config_current(c) then');
 needle:=' perform 1 from public.icash_wallets where account_id=c.account_id for update;';
 if position(needle in d)=0 then raise exception 'Direct reception wallet gate changed';end if;
 d:=replace(d,needle,$new$
 if c.callback_template_id is not null then
  callback_route:=icash_callback_private.route(p_from_phone);
  if callback_route is null or callback_route->>'status' not in ('matched','ambiguous')
   or (callback_route->>'accountId')::uuid is distinct from c.account_id then
   return jsonb_build_object('allowed',false,'reason','callback_route_changed');end if;
 end if;
 perform 1 from public.icash_wallets where account_id=c.account_id for update;$new$);
 needle:='insert into icash_recorded_reception_private.sessions(entry_policy,';
 if position(needle in d)=0 then raise exception 'Direct reception session insert changed';end if;
 d:=replace(d,needle,'insert into icash_recorded_reception_private.sessions(callback_route,entry_policy,');
 needle:='values(''direct_recorded_v1'',c.cost_policy_id,';
 if position(needle in d)=0 then raise exception 'Direct reception session binding changed';end if;
 execute replace(d,needle,'values(callback_route,''direct_recorded_v1'',c.cost_policy_id,');

 d:=pg_get_functiondef('public.icash_transition_recorded_reception(uuid,uuid,text,bigint,text,jsonb)'::regprocedure);
 needle:='where c.id=r.config_id and c.enabled and not a.bot_paused';
 if position(needle in d)=0 then raise exception 'Reception final admission changed';end if;
 execute replace(d,needle,needle||' and icash_callback_private.config_current(c) and icash_callback_private.session_current(r)');

 d:=pg_get_functiondef('public.icash_reception_context_before_agreement(uuid,text)'::regprocedure);
 needle:='and c.enabled and not a.bot_paused';
 if position(needle in d)=0 then raise exception 'Reception context admission changed';end if;
 d:=replace(d,needle,needle||' and icash_callback_private.config_current(c) and icash_callback_private.session_current(s)');
 needle:='focus_thread:=icash_recorded_reception_private.return_call_focus(r.account_id,r.from_phone,checked_at);';
 if position(needle in d)=0 then raise exception 'Reception property focus changed';end if;
 d:=replace(d,needle,$new$
 if r.callback_route->>'status'='ambiguous' then return jsonb_build_object('status','ambiguous');end if;
 if r.callback_route->>'status'='matched' then focus_thread:=(r.callback_route->>'threadId')::uuid;
 else focus_thread:=icash_recorded_reception_private.return_call_focus(r.account_id,r.from_phone,checked_at);end if;$new$);
 needle:=$old$and exists(select 1 from public.icash_text_messages m where m.account_id=r.account_id and m.thread_id=t.id and m.direction='outgoing' and m.state in ('accepted','delivered') and m.provider_id is not null and m.created_at between checked_at-interval '30 days' and checked_at)$old$;
 if position(needle in d)=0 then raise exception 'Reception contact receipt changed';end if;
 execute replace(d,needle,'and ((r.callback_route->>''status''=''matched'' and t.id=(r.callback_route->>''threadId'')::uuid) or '||substring(needle from 5)||')');

 d:=pg_get_functiondef('public.icash_seller_agreement_recording(text)'::regprocedure);
 needle:='and c.enabled and c.context_policy';
 if position(needle in d)=0 then raise exception 'Reception tool admission changed';end if;
 execute replace(d,needle,'and c.enabled and icash_callback_private.config_current(c) and icash_callback_private.session_current(s) and c.context_policy');
end $patch$;
commit;
