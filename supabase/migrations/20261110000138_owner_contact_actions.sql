-- Explicit owner contact controls. Install disabled; enable after verified release.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$
declare r record;
begin
 for r in select * from (values
 ('public.icash_queue_customer_text(uuid,uuid,uuid,uuid,text,uuid[])','7ace9014ac3951fbc9ce105b0f383701'),
 ('public.icash_prepare_manual_text(uuid,uuid,uuid,text,jsonb)','8855fcfd8b8076c8c208f47c9d36967d'),
 ('public.icash_begin_customer_phone_call(uuid,uuid,uuid,text,text,uuid,text,text,text,jsonb)','89098b8df615592d166ec64310d6d813'),
 ('public.icash_start_manual_call(uuid,uuid,uuid,text)','ed5b2a513075e61ec08d3d9c6de8e682'),
 ('public.icash_set_work_control_before_sms_intake(uuid,uuid,text,uuid)','b5f5f4f2e26f31206fdaac4ba511ce1a'),
 ('public.icash_owner_account_view(uuid,uuid,uuid)','cff5fa9278ec297812af43ca28433245')
 ) v(signature,checksum) loop
  if md5(pg_get_functiondef(to_regprocedure(r.signature))) is distinct from r.checksum then raise exception 'Owner contact prerequisite changed: %',r.signature;end if;
 end loop;
end $guard$;
create table icash_private.owner_contact_settings(id integer primary key check(id=1),enabled boolean not null default false);
insert into icash_private.owner_contact_settings(id) values(1);
create table icash_private.owner_contact_events(
 id bigint generated always as identity primary key,actor_id uuid not null,session_id uuid not null,view_id uuid not null,
 account_id uuid not null,action text not null check(action in ('text','prepare_text','begin_call','end_call','return_to_bot')),
 request_hash text not null,resource_id uuid,result jsonb not null,created_at timestamptz not null default now()
);
alter table icash_private.owner_contact_settings enable row level security;
alter table icash_private.owner_contact_events enable row level security;
revoke all on icash_private.owner_contact_settings,icash_private.owner_contact_events from public,anon,authenticated;
grant select,update on icash_private.owner_contact_settings to service_role;
grant select,insert on icash_private.owner_contact_events to service_role;
grant usage,select on sequence icash_private.owner_contact_events_id_seq to service_role;
create function public.icash_owner_contact_actions_enabled() returns boolean language sql stable set search_path='' as $$
 select coalesce((select enabled from icash_private.owner_contact_settings where id=1),false)
$$;
create function public.icash_owner_contact_actor_current(p_actor uuid,p_account uuid) returns boolean
language plpgsql stable set search_path='' as $$
declare c jsonb;v jsonb;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid or not public.icash_owner_contact_actions_enabled() then return false;end if;
 c:=nullif(current_setting('icash.owner_contact_context',true),'')::jsonb;
 if c->>'actor' is distinct from p_actor::text or c->>'account' is distinct from p_account::text then return false;end if;
 v:=public.icash_owner_account_view(p_actor,(c->>'session')::uuid,(c->>'view')::uuid);
 return v->'account'->>'id'=p_account::text;
end $$;
-- Ending the exact owner-started call remains available after a view expires or
-- is closed, while the same owner sign-in is still valid. It grants no reads.
create function public.icash_owner_contact_end_account(p_actor uuid,p_session uuid,p_view uuid,p_call uuid) returns uuid
language sql stable set search_path='' as $$
 select e.account_id from icash_private.owner_contact_events e
 join public.icash_customer_phone_calls c on c.id=e.resource_id and c.account_id=e.account_id and c.actor_id=e.actor_id
 where p_actor='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid and e.actor_id=p_actor and e.session_id=p_session and e.view_id=p_view
  and e.action='begin_call' and e.resource_id=p_call
  and exists(select 1 from auth.sessions where id=p_session and user_id=p_actor and (not_after is null or not_after>now()))
 order by e.id desc limit 1
$$;
-- Keep the real actor in message, call and takeover receipts. The exception is
-- transaction-scoped to the narrow wrapper; it grants no customer Auth session.
do $patch$
declare signature text;definition text;needle text;
begin
 foreach signature in array array[
 'public.icash_queue_customer_text(uuid,uuid,uuid,uuid,text,uuid[])',
 'public.icash_prepare_manual_text(uuid,uuid,uuid,text,jsonb)',
 'public.icash_begin_customer_phone_call(uuid,uuid,uuid,text,text,uuid,text,text,text,jsonb)',
 'public.icash_start_manual_call(uuid,uuid,uuid,text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);needle:='id=p_account and owner_user_id=p_actor for update;';
  if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Contact actor check changed: %',signature;end if;
  execute replace(definition,needle,'id=p_account and (owner_user_id=p_actor or public.icash_owner_contact_actor_current(p_actor,p_account)) for update;');
 end loop;
 signature:='public.icash_set_work_control_before_sms_intake(uuid,uuid,text,uuid)';
 definition:=pg_get_functiondef(signature::regprocedure);needle:='id=p_account and owner_user_id=p_user for update;';
 if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Contact control check changed';end if;
 execute replace(definition,needle,$new$id=p_account and (owner_user_id=p_user or (p_action in ('takeover','return_to_bot') and public.icash_owner_contact_actor_current(p_user,p_account))) for update;$new$);
end $patch$;
create function public.icash_owner_contact_action(p_actor uuid,p_session uuid,p_view uuid,p_account uuid,p_action text,p_request jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb;result jsonb;previous text;resource uuid;assets uuid[];
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if p_action='end_call' and public.icash_owner_contact_end_account(p_actor,p_session,p_view,(p_request->>'p_id')::uuid)=p_account then
  v:=jsonb_build_object('account',jsonb_build_object('id',p_account));
 else
  if not public.icash_owner_contact_actions_enabled() then raise exception 'Owner contact controls are disabled';end if;
  v:=public.icash_owner_account_view(p_actor,p_session,p_view);
 end if;
 if v is null or v->'account'->>'id' is distinct from p_account::text then raise exception 'Current owner view required' using errcode='42501';end if;
 if p_action is null or p_action not in ('text','prepare_text','begin_call','end_call','return_to_bot')
  or jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>12000
  or p_request ? 'p_actor' and p_request->>'p_actor' is distinct from p_actor::text
  or p_request ? 'p_account' and p_request->>'p_account' is distinct from p_account::text then raise exception 'Invalid owner contact request';end if;
 previous:=current_setting('icash.owner_contact_context',true);
 perform set_config('icash.owner_contact_context',jsonb_build_object('actor',p_actor,'account',p_account,'view',p_view,'session',p_session)::text,true);
 if p_action='text' then
  if jsonb_typeof(p_request->'p_assets') is distinct from 'array' or jsonb_array_length(p_request->'p_assets')>3 then raise exception 'Invalid attachments';end if;
  select coalesce(array_agg(x::uuid),'{}'::uuid[]) into assets from jsonb_array_elements_text(p_request->'p_assets') x;
  result:=public.icash_queue_customer_text(p_actor,p_account,(p_request->>'p_thread')::uuid,(p_request->>'p_key')::uuid,p_request->>'p_body',assets);
  resource:=(result->>'id')::uuid;
 elsif p_action='prepare_text' then
  result:=public.icash_prepare_manual_text(p_actor,p_account,(p_request->>'p_screening')::uuid,p_request->>'p_phone',p_request->'p_terms');
  resource:=(result->>'threadId')::uuid;
 elsif p_action='begin_call' then
  if p_request->'p_quote'->>'connectionType' is distinct from 'browser' then raise exception 'Owner browser call required';end if;
  result:=public.icash_begin_customer_phone_call(p_actor,p_account,(p_request->>'p_screening')::uuid,p_request->>'p_recipient',p_request->>'p_callback',(p_request->>'p_id')::uuid,p_request->>'p_sender',p_request->>'p_provider_account',p_request->>'p_nonce_hash',p_request->'p_quote');
  resource:=(result->'call'->>'id')::uuid;
 elsif p_action='end_call' then
  resource:=(p_request->>'p_id')::uuid;
  if not exists(select 1 from public.icash_customer_phone_calls where account_id=p_account and id=resource) then raise exception 'Call unavailable';end if;
  result:=jsonb_build_object('authorized',true);
 else
  resource:=(p_request->>'p_screening')::uuid;
  if not exists(select 1 from public.icash_screening_jobs where account_id=p_account and id=resource) then raise exception 'Property unavailable';end if;
  perform public.icash_set_work_control(p_actor,p_account,'return_to_bot',resource);
  result:=jsonb_build_object('saved',true);
 end if;
 insert into icash_private.owner_contact_events(actor_id,session_id,view_id,account_id,action,request_hash,resource_id,result)
 values(p_actor,p_session,p_view,p_account,p_action,md5(p_request::text),resource,
  jsonb_build_object('error',result->>'error','created',result->'created','manual',result->'manual','authorized',result->'authorized','saved',result->'saved'));
 perform set_config('icash.owner_contact_context',coalesce(previous,''),true);
 return result;
end $$;
revoke all on function public.icash_owner_contact_actions_enabled(),public.icash_owner_contact_actor_current(uuid,uuid),public.icash_owner_contact_end_account(uuid,uuid,uuid,uuid),public.icash_owner_contact_action(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_owner_contact_actions_enabled(),public.icash_owner_contact_actor_current(uuid,uuid),public.icash_owner_contact_end_account(uuid,uuid,uuid,uuid),public.icash_owner_contact_action(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
commit;
