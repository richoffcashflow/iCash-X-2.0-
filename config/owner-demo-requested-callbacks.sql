-- The demo-only introduction exception must follow the existing receipt-bound
-- conversation/callback paths, so a real requested callback stays permitted.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare definition text;block text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_seller_phone_call_current(uuid,uuid)'::regprocedure);
 block:=$guard$
 -- Owner self-demonstrations require their own fresh form receipt even when
 -- the rolling-day window clears. Expired requests cannot dial tomorrow.
 if p_account='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid and p.phone='+12142185280'
  and exists(select 1 from public.icash_contact_permissions cp
   join public.icash_seller_intakes l on l.id=cp.seller_intake_id
   where cp.id=j.permission_id and cp.account_id=p_account and l.contact_consent_scope='icash_x_demo') then
  return public.icash_owner_demo_call_current(p_account,p_job);
 end if;$guard$;
 needle:=E'\n -- One new automatic introduction per phone per rolling day.';
 if position(block||needle in definition)>0 then null;
 elsif (length(definition)-length(replace(definition,block,'')))/length(block)=1
  and (length(definition)-length(replace(definition,needle,'')))/length(needle)=1 then
  execute replace(replace(definition,block,''),needle,block||needle);
 else raise exception 'Owner demo callback prerequisite changed';end if;
end $patch$;
commit;
