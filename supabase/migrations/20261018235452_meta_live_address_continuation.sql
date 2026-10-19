begin;
set local lock_timeout='3s';

-- interested=false also means no confirmed interest was extracted. Only actual
-- seller words or an explicit opt-out may stop a contact-only lead.
create or replace function public.icash_meta_call_outcome(p_result jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare transcript jsonb;turn jsonb;message text;last_agent text:='';
begin
 if p_result->>'optedOut'='true' then return 'opted_out';end if;
 transcript:=case when jsonb_typeof(p_result->'transcript')='array' then p_result->'transcript' else '[]'::jsonb end;
 if not public.icash_seller_human_answer(transcript)
 or not exists(select 1 from jsonb_array_elements(transcript) t where t->>'role'='user' and t->>'message' ~ '[[:alnum:]]')
 or exists(select 1 from jsonb_array_elements(transcript) t where t->>'role'='user' and t->>'message' ~* '(buz[oó]n de voz|correo de voz|(graba|grabe|deja|deje).{0,25}mensaje|despu[eé]s.{0,15}(tono|se[nñ]al)|terminado de grabar)')
 then return 'no_response';end if;
 for turn in select value from jsonb_array_elements(transcript) loop
  message:=trim(replace(coalesce(turn->>'message',''),'’',chr(39)));
  if turn->>'role'='agent' then last_agent:=message;
  elsif turn->>'role'='user' then
   if message ~* $rx$^(no[,! .]+)?(thanks[,! .]+)?(i'm |i am |we're |we are )?not interested([,! .]+(thanks|thank you))?[.! ]*\Z$rx$
   or (message ~* $rx$\m(not interested in (selling|a cash offer)|not selling (my|our|the) (house|home|property)|do not want to sell|don't want to sell|no quiero vender|no me interesa vender)\M$rx$
    and message !~* $rx$([0-9$]|\m(unless|but|if)\M|at (that|this|your|the) price|for (that|this) (price|amount))$rx$)
   or (message ~* $rx$^no([,! .]+(thanks|thank you|gracias))?[.! ]*\Z$rx$
     and last_agent ~* '(interested.{0,35}(sell|cash offer)|consider selling|want to sell|open to.{0,15}cash offer)')
   then return 'declined';end if;
   last_agent:='';
  end if;
 end loop;
 return 'responded';
end $$;

create or replace function public.icash_meta_observe_call() returns trigger
language plpgsql security invoker set search_path='' as $$
declare lead uuid;outcome text;
begin
 select m.lead_id into lead from public.icash_meta_leads m join public.icash_seller_intakes l on l.id=m.lead_id
 where m.account_id=new.account_id and m.screening_id=new.screening_id and new.party='seller' and new.contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex');
 if lead is null or new.state<>'complete' or new.completed_at is null then return new;end if;
 outcome:=public.icash_meta_call_outcome(new.result);
 if outcome in ('opted_out','declined') then
  update public.icash_meta_leads set declined_at=coalesce(declined_at,new.completed_at),paused=true where lead_id=lead;
 elsif outcome='responded' then
  update public.icash_meta_leads set response_at=coalesce(response_at,new.completed_at),response_channel=coalesce(response_channel,'call') where lead_id=lead;
 end if;
 -- Never clear a previous decline, manual pause, text-only request or handoff.
 return new;
end $$;

-- Return only a presence flag; the greeting must not disclose a saved address
-- based on caller ID, or force the seller to start over.
create or replace function public.icash_recorded_reception_property_context(p_id uuid,p_nonce_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;s icash_recorded_reception_private.sessions;m public.icash_meta_leads;t public.icash_text_threads;ids uuid[];principal text;assistant text;
begin
 context:=public.icash_reception_context_before_meta(p_id,p_nonce_hash);
 if context is null or context->>'status'<>'ambiguous' then return context;end if;
 select session.* into s from icash_recorded_reception_private.sessions session join icash_recorded_reception_private.configs c on c.id=session.config_id
 where session.id=p_id and session.nonce_hash=p_nonce_hash and session.state='recording' and session.recording_sid is not null
 and session.register_claimed_at is null and session.conversation_id is null and session.call_ended_at is null and session.end_requested_at is null
 and session.call_deadline_at>now() and c.enabled and c.reviewed_until>now() and c.context_policy='automatic_offer_v18';
 if not found then return context;end if;
 -- Only the single, already messaged seller thread can supply the return-call
 -- context. An ambiguous number never selects another account or property.
 select array_agg(id) into ids from public.icash_text_threads where account_id=s.account_id and sender=s.to_phone and recipient=s.from_phone and retired_at is null;
 if cardinality(ids) is distinct from 1 then return context;end if;
 select * into t from public.icash_text_threads where id=ids[1] and party='seller' and not paused and not manual_only;
 if not found then return context;end if;
 select * into m from public.icash_meta_leads where lead_id=t.seller_intake_id and account_id=s.account_id;
 if not found or not public.icash_meta_contact_only(m.account_id,m.screening_id,t.recipient)
 or not exists(select 1 from public.icash_text_messages where thread_id=t.id and account_id=t.account_id and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null and created_at>now()-interval '30 days') then return context;end if;
 insert into icash_seller_agreement_private.inbound_bindings(session_id,account_id,deal_id,thread_id) values(s.id,m.account_id,t.deal_id,t.id) on conflict do nothing;
 if not exists(select 1 from icash_seller_agreement_private.inbound_bindings where session_id=s.id and account_id=m.account_id and deal_id=t.deal_id and thread_id=t.id) then return null;end if;
 select i.principal,a.assistant_name into principal,assistant from public.icash_customer_identities i join public.icash_accounts a on a.id=i.account_id and not a.bot_paused where i.account_id=m.account_id;
 if principal is null then return null;end if;
 return jsonb_build_object('status','instant_lead','principal',principal,'assistantName',assistant,'addressProvided',exists(select 1 from public.icash_seller_intakes l where l.id=m.lead_id and nullif(trim(l.address),'') is not null));
end $$;

revoke all on function public.icash_meta_call_outcome(jsonb) from public,anon,authenticated;
grant execute on function public.icash_meta_call_outcome(jsonb) to service_role;
commit;
