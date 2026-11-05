begin;
-- Small private audio cache, separate from frequently read voice configuration.
-- Each rejected attempt retains its own receipt. Unknown requests never retry.
create table public.icash_custom_voice_previews (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.icash_accounts(id),
 custom_voice_id uuid not null,
 voice_id text not null check (voice_id ~ '^[A-Za-z0-9_-]{5,100}$'),
 attempt integer not null check (attempt between 1 and 3),
 state text not null default 'generating' check (state in ('generating','ready','rejected','unknown')),
 request jsonb not null check (jsonb_typeof(request)='object' and length(request->>'text') between 1 and 200),
 audio_base64 text check (length(audio_base64) between 1000 and 666668),
 history_item_id text check (history_item_id ~ '^[A-Za-z0-9_-]{1,200}$'),
 request_id text check (request_id ~ '^[A-Za-z0-9_-]{1,200}$'),
 provider_status integer check (provider_status between 100 and 599),
 character_cost integer check (character_cost >= 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (custom_voice_id,attempt),
 check ((state='ready') = (audio_base64 is not null))
);
create index icash_custom_voice_previews_account on public.icash_custom_voice_previews(account_id,custom_voice_id,attempt desc);
alter table public.icash_custom_voice_previews enable row level security;
revoke all on public.icash_custom_voice_previews from public,anon,authenticated;
grant select,insert,update on public.icash_custom_voice_previews to service_role;

create function public.icash_begin_custom_voice_preview(p_user uuid,p_account uuid,p_voice uuid,p_provider_voice text,p_request jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v public.icash_custom_voices; prior public.icash_custom_voice_previews; next_attempt integer:=1;
begin
 -- Same account -> voice lock order as voice creation/toggle. No wallet access:
 -- paused bots and zero credit balances can still hear their own ready clone.
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for update;
 if not found or public.icash_vip_features_active(p_account) is distinct from true then raise exception 'VIP required';end if;
 select * into v from public.icash_custom_voices where account_id=p_account for update;
 if not found or v.id is distinct from p_voice or v.voice_id is distinct from p_provider_voice or v.state<>'ready' then raise exception 'Voice is not ready';end if;
 if p_request is null or p_request->>'model_id' is distinct from 'eleven_v4_turbo'
  or p_request->>'text' is distinct from 'Hi, this is a preview of my AI voice. I''m calling about your property. Is now a good time to talk?'
  or p_request is distinct from jsonb_build_object('text',p_request->>'text','model_id','eleven_v4_turbo','voice_settings',jsonb_build_object('stability',0.5,'similarity_boost',0.75))
 then raise exception 'Invalid preview';end if;
 select * into prior from public.icash_custom_voice_previews where custom_voice_id=v.id order by attempt desc limit 1;
 if found then
  if prior.state<>'rejected' or prior.attempt>=3 or prior.updated_at>now()-interval '1 minute' then
   return jsonb_build_object('started',false,'preview',to_jsonb(prior));
  end if;
  next_attempt:=prior.attempt+1;
 end if;
 insert into public.icash_custom_voice_previews(account_id,custom_voice_id,voice_id,attempt,request)
 values(p_account,v.id,v.voice_id,next_attempt,p_request) returning * into prior;
 return jsonb_build_object('started',true,'preview',to_jsonb(prior));
end $$;
revoke all on function public.icash_begin_custom_voice_preview(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_begin_custom_voice_preview(uuid,uuid,uuid,text,jsonb) to service_role;
commit;
