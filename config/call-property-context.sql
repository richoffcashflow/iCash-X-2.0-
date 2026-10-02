-- Read-only context for an already admitted inbound call. Apply after inbound-voice.sql.
-- This does not authorize, admit, charge for, enable, or reroute a call.
-- Caller ID is not identity verification: return the bound property's address and,
-- only when directly supported by the same thread, an unverified conversational
-- first name. Owner-record names, SMS bodies, raw snapshots, prices and ceilings
-- never leave these read-only functions.
create function public.icash_inbound_property_context(
 p_call_sid text,p_conversation text,p_binding_hash text,p_token_hash text
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare c public.icash_live_conversations;matches jsonb;address text;bound_thread uuid;first_name text;
begin
 if p_call_sid is null or p_call_sid !~ '^CA[a-fA-F0-9]{32}$'
 or p_conversation is null or p_conversation !~ '^conv_[A-Za-z0-9]+$' or length(p_conversation)>100
 or p_binding_hash is null or p_binding_hash !~ '^[a-f0-9]{64}$'
 or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then return null;end if;

 -- The server's durable receipt supplies the tenant/property binding. This RPC
 -- accepts neither caller-provided account IDs nor caller-provided property IDs.
 select live.* into c
 from public.icash_inbound_voice_receipts r
 join public.icash_live_conversations live on live.id=r.live_call_id and live.conversation_id=r.conversation_id
 join public.icash_accounts a on a.id=live.account_id and not a.bot_paused
 join public.icash_screening_jobs s on s.id=live.screening_id and s.account_id=live.account_id
 join public.icash_operation_spend o on o.operation_key=live.operation_key and o.account_id=live.account_id and o.state='dispatched'
 join public.icash_operation_rates rate on rate.id=o.rate_id and rate.operation='incoming_call'
 where r.call_sid=p_call_sid and r.conversation_id=p_conversation and r.binding_hash=p_binding_hash
  and live.operation_key='inbound:'||p_call_sid and live.state='waiting' and live.party='seller'
  and live.tool_token_hash=p_token_hash and live.tool_expires_at>now()
  and exists(select 1 from public.icash_voice_configs cfg where cfg.account_id=live.account_id
   and cfg.agent_id=live.agent_id and cfg.enabled and cfg.reviewed_until>now())
  and not exists(select 1 from public.icash_contact_suppressions cs where cs.contact_key=live.contact_key)
  and not exists(select 1 from public.icash_property_controls ctrl where ctrl.account_id=live.account_id
   and ctrl.property_id=s.snapshot->>'propertyId' and ctrl.manual);
 if not found then return null;end if;

 -- Keep the admitted party/contact/deal/account binding exact. Never search a
 -- caller's other properties or choose another tenant when a binding disappears.
 select jsonb_agg(to_jsonb(candidate)) into matches from (
  select distinct d.id as deal_id,t.id as thread_id,d.terms->>'address' as address
  from public.icash_deal_files d
  join public.icash_contact_permissions p on p.account_id=d.account_id and p.screening_id=d.screening_id
  join public.icash_text_threads t on t.account_id=d.account_id and t.deal_id=d.id and t.party=p.party and t.recipient=p.phone and not t.paused
  where d.account_id=c.account_id and d.screening_id=c.screening_id
   and p.party=c.party and p.contact_key=c.contact_key and p.revoked_at is null and p.permission_until>now()
   and not exists(select 1 from public.icash_text_suppressions suppressed where suppressed.phone=p.phone)
   and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
   and jsonb_typeof(d.terms->'address')='string'
  limit 2
 ) candidate;
 if coalesce(jsonb_array_length(matches),0)=0 then return null;end if;
 if jsonb_array_length(matches)<>1 then return jsonb_build_object('status','ambiguous');end if;
 address:=btrim(matches->0->>'address');
 if length(address) not between 1 and 300 then return null;end if;
 bound_thread:=(matches->0->>'thread_id')::uuid;
 -- A record-owner name is not the person on the phone. Only a received self-
 -- introduction after a real outbound message supports a first-name greeting.
 select introduced.name into first_name from (
  select m.created_at,m.id,substring(m.body from '^(?:[Hh]i[, ]+|[Hh]ello[, ]+)?(?:[Tt]his is|[Mm]y name is|I''m|I am) ([A-Z][a-z]{1,24})(?:[.!]?(?:[[:space:]]|$))') as name
  from (select m.id,m.created_at,m.body from public.icash_text_messages m
   where m.account_id=c.account_id and m.thread_id=bound_thread and m.direction='incoming' and m.state='received'
    and m.created_at between now()-interval '30 days' and now()
    and exists(select 1 from public.icash_text_messages sent where sent.account_id=c.account_id and sent.thread_id=m.thread_id
     and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.created_at>=now()-interval '30 days' and sent.created_at<=m.created_at)
   order by m.created_at desc,m.id desc limit 12) m
 ) introduced where introduced.name is not null and lower(introduced.name) not in ('interested','owner','selling','ready','not','yes','no') order by introduced.created_at desc,introduced.id desc limit 1;
 return jsonb_strip_nulls(jsonb_build_object('status','matched','address',address,'returningName',first_name));
end $$;
revoke all on function public.icash_inbound_property_context(text,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_inbound_property_context(text,text,text,text) to service_role;
