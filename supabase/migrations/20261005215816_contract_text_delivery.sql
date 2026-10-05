begin;
-- SMS alphabet accounting: links and apostrophes do not reduce drafts to 35 chars.
create function public.icash_sms_single_segment(p_body text) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare ch text;units integer:=0;basic text:=E'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&''()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';extended text:=E'\f^{}\\[~]|€';
begin
 for ch in select regexp_split_to_table(p_body,'') loop
  if position(ch in basic)>0 then units:=units+1;
  elsif position(ch in extended)>0 then units:=units+2;
  else return (select coalesce(sum(case when ascii(c)>65535 then 2 else 1 end),0)<=70 from regexp_split_to_table(p_body,'') c);end if;
 end loop;
 return units<=160;
end $$;
do $patch$ declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_queue_text(uuid,uuid,uuid,text,uuid[])'::regprocedure);
 needle:=$n$(length(p_body)>160 or (p_body ~ '[^A-Za-z0-9 .,!?]' and length(p_body)>35))$n$;
 if position(needle in def)=0 then raise exception 'SMS length boundary changed';end if;
 execute replace(def,needle,'not public.icash_sms_single_segment(p_body)');
end $patch$;

create table public.icash_contract_text_deliveries(
 envelope_id uuid not null references public.icash_signing_envelopes(id),
 signer_id text not null,account_id uuid not null references public.icash_accounts(id),
 thread_id uuid not null references public.icash_text_threads(id),
 message_id uuid not null references public.icash_text_messages(id),
 created_at timestamptz not null default now(),primary key(envelope_id,signer_id),unique(message_id)
);
alter table public.icash_contract_text_deliveries enable row level security;
revoke all on public.icash_contract_text_deliveries from public,anon,authenticated;
grant all on public.icash_contract_text_deliveries to service_role;
create function public.icash_queue_contract_text(p_account uuid,p_envelope uuid,p_signer text,p_phone text,p_body text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare e public.icash_signing_envelopes;t public.icash_text_threads;r jsonb;mid uuid;
begin
 select * into e from public.icash_signing_envelopes where id=p_envelope and account_id=p_account for update;
 if not found or e.test_mode or e.state<>'awaiting_counterparty' or e.provider_id is null then raise exception 'Live pending contract required';end if;
 if not exists(select 1 from public.icash_deal_files where id=e.deal_id and account_id=p_account and terms=e.terms and stage not in ('closed','cancelled')) then raise exception 'Current agreement required';end if;
 select value into r from jsonb_array_elements(e.recipients) where value->>'id'=p_signer;
 if r is null or r->>'phone' is distinct from p_phone or (e.recipients->-1->>'id')=p_signer then raise exception 'Counterparty phone mismatch';end if;
 select * into strict t from public.icash_text_threads where account_id=p_account and deal_id=e.deal_id and recipient=p_phone and party=case when e.kind='purchase' then 'seller' else 'buyer' end;
 if not public.icash_sms_thread_review_current(p_account,t.id,true) or exists(select 1 from public.icash_text_suppressions where phone=p_phone) then raise exception 'Text contact unavailable';end if;
 select message_id into mid from public.icash_contract_text_deliveries where envelope_id=e.id and signer_id=p_signer;
 if mid is not null then return mid;end if;
 if p_body !~ '^Review your contract: https://docuseal\.com/s/[A-Za-z0-9_-]+$' or not public.icash_sms_single_segment(p_body) then raise exception 'Verified signing link required';end if;
 mid:=public.icash_queue_text(p_account,t.id,gen_random_uuid(),p_body,'{}'::uuid[]);
 insert into public.icash_contract_text_deliveries(envelope_id,signer_id,account_id,thread_id,message_id) values(e.id,p_signer,p_account,t.id,mid);
 return mid;
end $$;
create function public.icash_live_contract_context(p_hash text,p_conversation text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c public.icash_live_conversations;matches jsonb;
begin
 select * into c from public.icash_live_conversations where tool_token_hash=p_hash and conversation_id=p_conversation and tool_expires_at>now() and state='waiting' and party='seller';
 if not found then return null;end if;
 if not exists(select 1 from public.icash_accounts where id=c.account_id and not bot_paused) or not public.icash_membership_work_allowed(c.account_id) then return null;end if;
 if exists(select 1 from public.icash_property_controls pc join public.icash_screening_jobs s on s.account_id=pc.account_id and s.snapshot->>'propertyId'=pc.property_id where s.id=c.screening_id and pc.manual) then return null;end if;
 select jsonb_agg(jsonb_build_object('accountId',e.account_id,'envelopeId',e.id,'phone',t.recipient)) into matches
 from public.icash_deal_files d join public.icash_signing_envelopes e on e.deal_id=d.id and e.account_id=d.account_id
 join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
 where d.account_id=c.account_id and d.screening_id=c.screening_id and d.stage='draft' and e.kind='purchase' and e.state='awaiting_counterparty' and not e.test_mode and e.terms=d.terms
 and encode(extensions.digest(t.recipient,'sha256'),'hex')=c.contact_key
 and exists(select 1 from jsonb_array_elements(e.recipients) r where r->>'phone'=t.recipient and (r->>'id')<>(e.recipients->-1->>'id'));
 if jsonb_array_length(matches)<>1 then return null;end if;
 return matches->0;
end $$;
revoke all on function public.icash_sms_single_segment(text),public.icash_queue_contract_text(uuid,uuid,text,text,text),public.icash_live_contract_context(text,text) from public,anon,authenticated;
grant execute on function public.icash_sms_single_segment(text),public.icash_queue_contract_text(uuid,uuid,text,text,text),public.icash_live_contract_context(text,text) to service_role;
commit;
