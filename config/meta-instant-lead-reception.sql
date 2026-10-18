begin;
set local lock_timeout='3s';
alter function public.icash_recorded_reception_property_context(uuid,text) rename to icash_reception_context_before_meta;
create function public.icash_recorded_reception_property_context(p_id uuid,p_nonce_hash text) returns jsonb
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
 return jsonb_build_object('status','instant_lead','principal',principal,'assistantName',assistant);
end $$;
alter function public.icash_meta_call_context(text,text) rename to icash_meta_outbound_call_context;
create function public.icash_meta_call_context(p_hash text,p_conversation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;
begin
 context:=public.icash_meta_outbound_call_context(p_hash,p_conversation);
 if context is not null then return context;end if;
 select jsonb_build_object('leadId',m.lead_id,'accountId',m.account_id,'screeningId',m.screening_id,'state',l.state,'metaId',m.meta_id,'submittedAt',m.submitted_at,'address',l.address,'complete',screen.state='complete') into context
 from icash_recorded_reception_private.sessions s join icash_recorded_reception_private.configs c on c.id=s.config_id
 join icash_seller_agreement_private.inbound_bindings b on b.session_id=s.id and b.account_id=s.account_id
 join public.icash_text_threads t on t.id=b.thread_id and t.account_id=b.account_id and t.deal_id=b.deal_id and t.recipient=s.from_phone and t.sender=s.to_phone
 join public.icash_meta_leads m on m.lead_id=t.seller_intake_id and m.account_id=t.account_id
 join public.icash_seller_intakes l on l.id=m.lead_id join public.icash_screening_jobs screen on screen.id=m.screening_id and screen.account_id=m.account_id
 where s.stop_token_hash=p_hash and s.conversation_id=p_conversation and s.state='recording' and s.recording_sid is not null
 and s.call_ended_at is null and s.end_requested_at is null and s.call_deadline_at>now() and c.enabled and c.reviewed_until>now()
 and t.party='seller' and not t.paused and not t.manual_only and t.retired_at is null
 and public.icash_seller_contact_evidence(m.account_id,m.screening_id,m.lead_id,l.phone) is not null;
 return context;
end $$;
create function public.icash_meta_inbound_call_pending(p_hash text) returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from icash_recorded_reception_private.sessions s join icash_seller_agreement_private.inbound_bindings b on b.session_id=s.id and b.account_id=s.account_id
 join public.icash_text_threads t on t.id=b.thread_id and t.account_id=b.account_id join public.icash_meta_leads m on m.lead_id=t.seller_intake_id and m.account_id=t.account_id
 where s.stop_token_hash=p_hash and s.state='recording' and s.conversation_id is null and s.call_ended_at is null and s.end_requested_at is null and s.call_deadline_at>now());
$$;
revoke all on function public.icash_recorded_reception_property_context(uuid,text),public.icash_meta_call_context(text,text),public.icash_meta_inbound_call_pending(text) from public,anon,authenticated;
grant execute on function public.icash_recorded_reception_property_context(uuid,text),public.icash_meta_call_context(text,text),public.icash_meta_inbound_call_pending(text) to service_role;
commit;
