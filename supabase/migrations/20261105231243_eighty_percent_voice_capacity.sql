-- Owner requested 80% of forty-call Business capacity: 32 total, 30 outgoing,
-- two incoming, daily allowance unchanged. Install disabled. Enable the one-use
-- provider change only after exact-main web AND worker verification. No observed
-- capacity, prior receipts, contact/credit holds or billing are changed here.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $$
declare item record;definition text;needle text;replacement text;
begin
 -- Check every current entry point and its snapshot before replacing anything.
 for item in select * from (values
  ('public.icash_save_voice_capacity(integer,jsonb,text)','272b1a0b87f6e0f71d3ac149359f26ee'),
  ('public.icash_outgoing_voice_capacity_open()','0de9b034cc837a069c98649146265fa2'),
  ('public.icash_voice_capacity_available(uuid,text,text,text,boolean)','ec76711357fe24dbcd75a351f68acc85'),
  ('icash_recording_private.voice_capacity_from_snapshot(uuid,text,text,text,boolean,jsonb)','adf3fcc3a9cb0d204cea26d1a4fe130f'),
  ('icash_recording_private.voice_capacity_snapshot()','2d9e037c510cc91c9b5757c0d7177bfb')
 ) expected(signature,definition_hash) loop
  definition:=pg_get_functiondef(item.signature::regprocedure);
  if md5(definition)<>item.definition_hash then raise exception 'Voice capacity function changed: %',item.signature;end if;
 end loop;
 for item in select * from (values
  ('public.icash_save_voice_capacity(integer,jsonb,text)','p_limit not between 1 and 20','p_limit not between 1 and 32'),
  ('public.icash_outgoing_voice_capacity_open()','least(20,workspace_limit)','least(32,workspace_limit)'),
  ('icash_recording_private.voice_capacity_from_snapshot(uuid,text,text,text,boolean,jsonb)','least(20,workspace_limit)','least(32,workspace_limit)')
 ) replacements(signature,needle,replacement) loop
  definition:=pg_get_functiondef(item.signature::regprocedure);
  if (length(definition)-length(replace(definition,item.needle,'')))/length(item.needle)<>1 then raise exception 'Capacity ceiling changed: %',item.signature;end if;
  execute replace(definition,item.needle,item.replacement);
 end loop;
end $$;

-- The ordinary observation UPSERT names its columns explicitly and cannot
-- reset this one-time provider-write claim or its verified completion receipt.
alter table public.icash_voice_capacity_policy
 add column eighty_change_enabled boolean not null default false,
 add column eighty_change_claimed_at timestamptz,
 add column eighty_change_applied_at timestamptz,
 add constraint icash_voice_capacity_eighty_change_receipt_check check
  (eighty_change_applied_at is null or (eighty_change_claimed_at is not null and eighty_change_applied_at>=eighty_change_claimed_at));

create function public.icash_eighty_percent_voice_capacity_change(p_action text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare policy public.icash_voice_capacity_policy;claimed boolean:=false;
begin
 if p_action is null or p_action not in ('status','enable','claim','complete') then raise exception 'Invalid capacity change action';end if;
 if p_action='enable' then
  update public.icash_voice_capacity_policy set eighty_change_enabled=true where id=1;
 elsif p_action='claim' then
  update public.icash_voice_capacity_policy set eighty_change_claimed_at=now()
   where id=1 and eighty_change_enabled and eighty_change_claimed_at is null and eighty_change_applied_at is null;
  claimed:=found;
 elsif p_action='complete' then
  update public.icash_voice_capacity_policy set eighty_change_applied_at=now()
   where id=1 and eighty_change_enabled and eighty_change_claimed_at is not null and eighty_change_applied_at is null;
 end if;
 select * into policy from public.icash_voice_capacity_policy where id=1;
 if not found then raise exception 'Capacity policy unavailable';end if;
 return jsonb_build_object('claimed',claimed,'status',case when not policy.eighty_change_enabled then 'disabled' when policy.eighty_change_applied_at is not null then 'applied'
  when policy.eighty_change_claimed_at is not null then 'claimed' else 'ready' end);
end $$;
revoke all on function public.icash_eighty_percent_voice_capacity_change(text) from public,anon,authenticated;
grant execute on function public.icash_eighty_percent_voice_capacity_change(text) to service_role;
commit;
