-- A blocked introduction must not stop an account from finding other sellers.
-- This preflight never claims inventory or authorizes contact; final admission
-- retains the existing locked claim, consent, suppression and spending checks.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.icash_cold_inventory_available(p_account uuid,p_screening uuid,p_phone text default null)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare prop text;keys text[];contact text;
begin
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=p_screening and account_id=p_account;
 if prop is null or prop !~ '^prop_[A-Za-z0-9]+$' then return false;end if;
 if exists(select 1 from public.icash_outbound_property_owners where property_id=prop and account_id<>p_account) then return false;end if;
 keys:=array['property:'||prop];
 if p_phone is not null then
  if p_phone !~ '^[+][1-9][0-9]{7,14}$' then return false;end if;
  contact:=encode(sha256(convert_to(p_phone,'UTF8')),'hex');
  if exists(select 1 from public.icash_text_suppressions where phone=p_phone)
   or exists(select 1 from public.icash_contact_suppressions where contact_key=contact) then return false;end if;
  keys:=array_append(keys,'phone:'||contact);
 end if;
 return not exists(select 1 from public.icash_inventory_claims held where held.resource_key=any(keys) and held.account_id<>p_account and (
  held.cooldown_until>now()
  or exists(select 1 from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id
   where d.account_id=held.account_id and d.stage in ('under_contract','buyer_selected','title_open','closing')
    and s.snapshot->>'propertyId'=(select snapshot->>'propertyId' from public.icash_screening_jobs where id=held.screening_id))
  or exists(select 1 from public.icash_live_callbacks where account_id=held.account_id and screening_id=held.screening_id and state in ('pending_dispatch_review','held_for_human'))
  or exists(select 1 from public.icash_live_conversations where account_id=held.account_id and screening_id=held.screening_id and state in ('waiting','review'))
 ));
end $$;
revoke all on function public.icash_cold_inventory_available(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_cold_inventory_available(uuid,uuid,text) to service_role;

do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_research_waiting_on_outreach(uuid)'::regprocedure);
 needle:='   and p.revoked_at is null and p.permission_until>now() and p.dnc_clear';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Research voice priority changed';end if;
 d:=replace(d,needle,needle||$new$
   and j.due_at<=now()
   and public.icash_voice_outreach_hours_current(j.account_id,j.id)
   and public.icash_seller_phone_call_current(j.account_id,j.id)
   and public.icash_cold_inventory_available(j.account_id,p.screening_id,p.phone)$new$);
 needle:='   and m.customer_author_id is null and m.provider_id is null and m.last_delivery_at is null';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Research text priority changed';end if;
 execute replace(d,needle,needle||$new$
   and public.icash_sms_outreach_window_current(t.account_id,t.id)
   and public.icash_cold_inventory_available(t.account_id,s.id,t.recipient)$new$);

 -- A rejected inventory claim is not a credit shortage. Park only a proven
 -- unstarted job; any reservation/receipt keeps its existing reconciliation path.
 d:=pg_get_functiondef('public.icash_reserve_paced_voice(uuid,uuid,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 needle:=$old$  if not public.icash_operational_contact_current(p_account,j.operational_contact_id,'voice',false)
   or not public.icash_claim_inventory(p_account,p.screening_id,p.phone) then return false;end if;$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Voice inventory admission changed';end if;
 execute replace(d,needle,$new$  if not public.icash_operational_contact_current(p_account,j.operational_contact_id,'voice',false) then return false;end if;
  if not public.icash_claim_inventory(p_account,p.screening_id,p.phone) then
   if j.operation_key is null and j.provider_call_sid is null and j.conversation_id is null
    and not exists(select 1 from public.icash_operation_spend where operation_key='voice:'||j.id)
    and not exists(select 1 from public.icash_call_recordings where voice_job_id=j.id)
    and not exists(select 1 from public.icash_live_conversations where operation_key='voice:'||j.id) then
    update public.icash_voice_jobs set state='held',outcome='seller_inventory_unavailable',updated_at=now() where id=j.id and account_id=p_account and state='issued';
   end if;
   return false;
  end if;$new$);

 -- Later scheduler wrappers reintroduced the expensive tzdata catalog scan.
 -- Reuse the existing private name cache; PostgreSQL still calculates DST.
 d:=pg_get_functiondef('public.icash_next_before_closing_gaps()'::regprocedure);
 needle:='join pg_timezone_names tz on tz.name=t.timezone';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>2 then raise exception 'Seller recovery timezone lookup changed';end if;
 execute replace(d,needle,'join public.icash_timezone_names tz on tz.name=t.timezone');
end $patch$;
commit;
