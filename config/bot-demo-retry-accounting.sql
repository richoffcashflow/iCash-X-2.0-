-- Count new demo intents, never exact transport retries. The existing five per
-- hour IP/user buckets remain intact, including pre-release usage. This wrapper
-- is installed in the same transaction as the owner demo restart components.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create or replace function public.icash_submit_limited_bot_demo_intake(
 p_actor uuid,p_account uuid,p_request uuid,p_guest text,p_name text,p_address text,
 p_phone text,p_consented boolean,p_duplicate text,p_timezone text,p_agent_hash text,p_ip_hash text)
returns uuid language plpgsql security invoker set search_path='' as $demo$
declare existing_request boolean;
begin
 -- Only the existing authenticated presenter route uses this admission path.
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
  or p_account is distinct from '48dfb798-8c1a-404f-88c0-c396cc067062'::uuid
  or p_request is null or p_ip_hash is null or p_ip_hash!~'^[a-f0-9]{64}$'
 then raise exception 'Presenting account required';end if;
 -- Match lifecycle/direct-submit lock order. Never hold a request lock while
 -- waiting for a dispatcher that owns the operating budget first.
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then raise exception 'Demo admission unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended('demo-request:'||p_request::text,0));
 select exists(select 1 from public.icash_seller_intakes where request_id=p_request) into existing_request;
 if not existing_request then
  if not public.icash_take_request('bot-demo:ip:'||p_ip_hash,5,3600)
   or not public.icash_take_request('bot-demo:id:'||encode(sha256(convert_to(p_actor::text,'UTF8')),'hex'),5,3600)
  then
   -- Uncaught exception rolls back BOTH counters. No intake or lifecycle run
   -- has been created, and no after-response/provider work can be scheduled.
   raise sqlstate 'PT429' using message='Demo submission limit reached';
  end if;
 end if;
 -- Existence is accounting input, never retry authority. The original RPC
 -- still validates account ownership, guest, complete consent and payload.
 -- A conflicting retry or failed insertion rolls back this whole transaction.
 return public.icash_submit_bot_demo_intake(p_actor,p_account,p_request,p_guest,p_name,p_address,
  p_phone,p_consented,p_duplicate,p_timezone,p_agent_hash);
end $demo$;
revoke all on function public.icash_submit_limited_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_submit_limited_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text,text) to service_role;
commit;
