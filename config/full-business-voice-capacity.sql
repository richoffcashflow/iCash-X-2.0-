-- November 17: forty existing Business slots, 38 outgoing and two incoming.
-- Install before the matching web/worker release. Provider mutation stays disabled
-- until an operator binds activation to the verified exact main release.
set local lock_timeout='2s';
set local statement_timeout='10s';
do $patch$
declare item record;definition text;before_acl aclitem[];before_owner oid;
begin
 for item in select * from (values
  ('public.icash_save_voice_capacity(integer,jsonb,text)','86a9c48e5dabedbb3b0a6d4a00aaea32'),
  ('public.icash_outgoing_voice_capacity_open()','d105b750747c5536f1c5eb2c36787c1b'),
  ('public.icash_voice_capacity_available(uuid,text,text,text,boolean)','ec76711357fe24dbcd75a351f68acc85'),
  ('icash_recording_private.voice_capacity_from_snapshot(uuid,text,text,text,boolean,jsonb)','5386ae4fdc36ac71e76d645e1907b314'),
  ('icash_recording_private.voice_capacity_snapshot()','2d9e037c510cc91c9b5757c0d7177bfb')
 ) expected(signature,definition_hash) loop
  select pg_get_functiondef(p.oid),p.proacl into strict definition,before_acl from pg_proc p where p.oid=item.signature::regprocedure;
  if md5(definition)<>item.definition_hash or before_acl is distinct from '{postgres=X/postgres,service_role=X/postgres}'::aclitem[]
  then raise exception 'Full capacity prerequisite changed: %',item.signature;end if;
 end loop;
 for item in select * from (values
  ('public.icash_save_voice_capacity(integer,jsonb,text)','p_limit not between 1 and 32','p_limit not between 1 and 40'),
  ('public.icash_outgoing_voice_capacity_open()','least(32,workspace_limit)','least(40,workspace_limit)'),
  ('icash_recording_private.voice_capacity_from_snapshot(uuid,text,text,text,boolean,jsonb)','least(32,workspace_limit)','least(40,workspace_limit)')
 ) replacements(signature,needle,replacement) loop
  select pg_get_functiondef(p.oid),p.proacl,p.proowner into strict definition,before_acl,before_owner from pg_proc p where p.oid=item.signature::regprocedure;
  if (length(definition)-length(replace(definition,item.needle,'')))/length(item.needle)<>1 then raise exception 'Full capacity ceiling changed: %',item.signature;end if;
  definition:=replace(definition,item.needle,item.replacement);execute definition;
  if not exists(select 1 from pg_proc p where p.oid=item.signature::regprocedure and p.proacl is not distinct from before_acl
   and p.proowner=before_owner and md5(pg_get_functiondef(p.oid))=md5(definition)) then raise exception 'Full capacity metadata changed';end if;
 end loop;
end $patch$;

alter table public.icash_voice_capacity_policy
 add column full_change_enabled boolean not null default false,
 add column full_change_release_sha text check(full_change_release_sha~'^[a-f0-9]{40}$'),
 add column full_change_claimed_at timestamptz,
 add column full_change_applied_at timestamptz,
 add column full_change_before_hash text check(full_change_before_hash~'^[a-f0-9]{64}$'),
 add column full_change_after_hash text check(full_change_after_hash~'^[a-f0-9]{64}$'),
 add constraint icash_full_voice_change_binding check(
  (full_change_enabled=(full_change_release_sha is not null))
  and ((full_change_claimed_at is null)=(full_change_before_hash is null))
  and ((full_change_claimed_at is null)=(full_change_after_hash is null))
  and (full_change_claimed_at is null or full_change_enabled and full_change_before_hash<>full_change_after_hash)
  and (full_change_applied_at is null or full_change_claimed_at is not null and full_change_applied_at>=full_change_claimed_at));

create function public.icash_full_business_voice_capacity_change(p_action text,p_release text default null,p_before text default null,p_after text default null) returns jsonb
language plpgsql security invoker set search_path='' as $function$
declare policy public.icash_voice_capacity_policy;claimed boolean:=false;
begin
 if p_action is null or p_action not in ('status','enable','claim','complete') then raise exception 'Invalid full capacity action';end if;
 if p_action='status' then select * into policy from public.icash_voice_capacity_policy where id=1;
 else
  if p_release is null or p_release!~'^[a-f0-9]{40}$' then raise exception 'Exact release required';end if;
  select * into policy from public.icash_voice_capacity_policy where id=1 for update;
 end if;
 if not found then raise exception 'Capacity policy unavailable';end if;
 if p_action='enable' then
  if policy.full_change_release_sha is not null and policy.full_change_release_sha<>p_release then raise exception 'Full capacity release already bound';end if;
  if not policy.full_change_enabled then
   update public.icash_voice_capacity_policy set full_change_enabled=true,full_change_release_sha=p_release where id=1 returning * into policy;
  end if;
 elsif p_action in ('claim','complete') and policy.full_change_enabled then
  if policy.full_change_release_sha<>p_release then raise exception 'Full capacity release mismatch';end if;
  if p_before is null or p_after is null or p_before!~'^[a-f0-9]{64}$' or p_after!~'^[a-f0-9]{64}$' or p_before=p_after then raise exception 'Full capacity original evidence required';end if;
  if policy.full_change_claimed_at is not null and (policy.full_change_before_hash<>p_before or policy.full_change_after_hash<>p_after) then raise exception 'Full capacity original evidence changed';end if;
  if p_action='claim' and policy.full_change_claimed_at is null then
   update public.icash_voice_capacity_policy set full_change_claimed_at=clock_timestamp(),full_change_before_hash=p_before,full_change_after_hash=p_after where id=1 returning * into policy;claimed:=true;
  elsif p_action='complete' and policy.full_change_claimed_at is not null and policy.full_change_applied_at is null then
   update public.icash_voice_capacity_policy set full_change_applied_at=clock_timestamp() where id=1 returning * into policy;
  end if;
 end if;
 return jsonb_build_object('claimed',claimed,'releaseSha',policy.full_change_release_sha,'beforeHash',policy.full_change_before_hash,'afterHash',policy.full_change_after_hash,
  'status',case when not policy.full_change_enabled then 'disabled' when policy.full_change_applied_at is not null then 'applied' when policy.full_change_claimed_at is not null then 'claimed' else 'ready' end);
end $function$;
revoke all on function public.icash_full_business_voice_capacity_change(text,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_full_business_voice_capacity_change(text,text,text,text) to service_role;
