begin;
create table icash_seller_agreement_private.call_history(
 session_id uuid primary key references icash_recorded_reception_private.sessions(id),
 account_id uuid not null, screening_id uuid not null, contact_key text not null,
 conversation_id text not null, completed_at timestamptz not null,
 transcript jsonb not null check(jsonb_typeof(transcript)='array' and jsonb_array_length(transcript) between 1 and 80)
);
alter table icash_seller_agreement_private.call_history enable row level security;
revoke all on icash_seller_agreement_private.call_history from public,anon,authenticated,service_role;
create index seller_inbound_history_contact on icash_seller_agreement_private.call_history(account_id,screening_id,contact_key,completed_at desc);
-- The worker first verifies the canonical provider's completed conversation,
-- exact agent/version/phone/session identity. SQL also requires the immutable
-- seller/property binding established when this incoming call connected.
create function public.icash_save_seller_inbound_history(p_session uuid,p_conversation text,p_transcript jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare s icash_recorded_reception_private.sessions; b icash_seller_agreement_private.inbound_bindings;screen uuid;
begin
 if jsonb_typeof(p_transcript) is distinct from 'array' or jsonb_array_length(p_transcript) not between 1 and 80
 or exists(select 1 from jsonb_array_elements(p_transcript) t where jsonb_typeof(t) is distinct from 'object' or coalesce(t->>'role','') not in ('agent','user') or jsonb_typeof(t->'message') is distinct from 'string' or length(t->>'message')>12000 or t-array['role','message']<>'{}'::jsonb) then return false;end if;
 select * into s from icash_recorded_reception_private.sessions where id=p_session and conversation_id=p_conversation and call_ended_at between now()-interval '30 days' and now();
 if not found then return false;end if;
 select * into b from icash_seller_agreement_private.inbound_bindings where session_id=s.id and account_id=s.account_id;
 if not found then return false;end if;
 select d.screening_id into screen from public.icash_deal_files d join public.icash_text_threads t on t.id=b.thread_id and t.account_id=d.account_id and t.deal_id=d.id and t.party='seller' and t.recipient=s.from_phone where d.id=b.deal_id and d.account_id=s.account_id;
 if screen is null then return false;end if;
 delete from icash_seller_agreement_private.call_history where completed_at<now()-interval '30 days';
 insert into icash_seller_agreement_private.call_history values(s.id,s.account_id,screen,encode(sha256(convert_to(s.from_phone,'UTF8')),'hex'),s.conversation_id,s.call_ended_at,p_transcript) on conflict do nothing;
 return true;
end $$;
create or replace function public.icash_seller_prior_call_context(p_account uuid,p_screening uuid,p_phone text)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('completed_at',completed_at,'result',jsonb_build_object('transcript',result->'transcript','summary',left(result->>'summary',1500))) order by completed_at desc),'[]'::jsonb)
 from (select * from (
  select completed_at,result from public.icash_live_conversations
   where account_id=p_account and screening_id=p_screening and contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex')
   and party='seller' and state='complete' and operation_key like 'voice:%' and completed_at between now()-interval '30 days' and now()
  union all
  select completed_at,jsonb_build_object('transcript',transcript) from icash_seller_agreement_private.call_history
   where account_id=p_account and screening_id=p_screening and contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex') and completed_at between now()-interval '30 days' and now()
 ) histories order by completed_at desc limit 3) calls
$$;
revoke all on function public.icash_save_seller_inbound_history(uuid,text,jsonb),public.icash_seller_prior_call_context(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_save_seller_inbound_history(uuid,text,jsonb),public.icash_seller_prior_call_context(uuid,uuid,text) to service_role;
commit;
