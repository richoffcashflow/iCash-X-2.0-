-- Owner approved twenty total calls, eighteen outgoing, two incoming and
-- 1,000 daily outgoing conversations on 2026-10-26. Provider limits are read
-- afresh by the compatible live app. This migration never fabricates capacity
-- observations, edits contact/money holds, or starts a provider request.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $$
declare item record;definition text;needle text;replacement text;
begin
 for item in select * from (values
  ('icash_save_voice_capacity(integer,jsonb,text)','42d82ad650a1215440cbacd0233b6f08'),
  ('icash_voice_capacity_available(uuid,text,text,text,boolean)','bbb2058c0302a6b2d8e93a981928d6d0'),
  ('icash_outgoing_voice_capacity_open()','580669034e25e508a84bd08777ff744f')
 ) expected(signature,definition_hash) loop
  definition:=pg_get_functiondef(('public.'||item.signature)::regprocedure);
  if md5(definition)<>item.definition_hash then raise exception 'Voice capacity function changed: %',item.signature;end if;
  if item.signature like 'icash_save_voice_capacity%' then
   needle:='p_limit not between 1 and 10';replacement:='p_limit not between 1 and 20';
  else
   needle:='least(10,workspace_limit)';replacement:='least(20,workspace_limit)';
  end if;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Capacity ceiling changed: %',item.signature;end if;
  execute replace(definition,needle,replacement);
 end loop;
end $$;

-- The ordinary observation UPSERT names its columns explicitly and cannot
-- reset this one-time provider-write claim or its verified completion receipt.
alter table public.icash_voice_capacity_policy
 add column pro_change_claimed_at timestamptz,
 add column pro_change_applied_at timestamptz,
 add constraint icash_voice_capacity_pro_change_receipt_check check
  (pro_change_applied_at is null or (pro_change_claimed_at is not null and pro_change_applied_at>=pro_change_claimed_at));

create function public.icash_pro_voice_capacity_change(p_action text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare policy public.icash_voice_capacity_policy;claimed boolean:=false;
begin
 if p_action is null or p_action not in ('status','claim','complete') then raise exception 'Invalid capacity change action';end if;
 if p_action='claim' then
  update public.icash_voice_capacity_policy set pro_change_claimed_at=now()
   where id=1 and pro_change_claimed_at is null and pro_change_applied_at is null;
  claimed:=found;
 elsif p_action='complete' then
  update public.icash_voice_capacity_policy set pro_change_applied_at=now()
   where id=1 and pro_change_claimed_at is not null and pro_change_applied_at is null;
 end if;
 select * into policy from public.icash_voice_capacity_policy where id=1;
 if not found then raise exception 'Capacity policy unavailable';end if;
 return jsonb_build_object('claimed',claimed,'status',case when policy.pro_change_applied_at is not null then 'applied'
  when policy.pro_change_claimed_at is not null then 'claimed' else 'ready' end);
end $$;
revoke all on function public.icash_pro_voice_capacity_change(text) from public,anon,authenticated;
grant execute on function public.icash_pro_voice_capacity_change(text) to service_role;
commit;
