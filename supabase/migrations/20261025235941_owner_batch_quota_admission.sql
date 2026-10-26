begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_claim_owner_batch(uuid,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
 needle:='for item in select value from jsonb_array_elements(p_items) loop';
 if strpos(d,needle)=0 or strpos(d,'icash_take_dealmachine_request')>0 then raise exception 'Owner batch admission changed';end if;
 -- A refused slot commits only its diagnostic. Any later reservation/claim
 -- failure rolls back both the slot and every financial change atomically.
 execute replace(d,needle,'if not public.icash_take_dealmachine_request(''owner_lookup'',p_account,''owner-batch:''||p_batch,p_batch) then return false;end if;'||E'\n '||needle);
end $$;
create function public.icash_admit_owner_batch(p_account uuid,p_primary uuid,p_batch uuid,p_items jsonb,p_preview jsonb,p_config jsonb) returns text
language plpgsql security definer set search_path='' as $$
begin
 if public.icash_claim_owner_batch(p_account,p_primary,p_batch,p_items,p_preview,p_config) then return 'claimed';end if;
 if exists(select 1 from icash_research_private.requests where id=p_batch and account_id=p_account and kind='owner_lookup' and operation_key='owner-batch:'||p_batch and not admitted)
  and not exists(select 1 from icash_research_private.owner_batches where id=p_batch) then return 'quota_wait';end if;
 return 'held';
end $$;
revoke all on function public.icash_admit_owner_batch(uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.icash_admit_owner_batch(uuid,uuid,uuid,jsonb,jsonb,jsonb) to service_role;
commit;
