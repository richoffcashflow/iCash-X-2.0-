begin;
-- Preserve server-owned facts atomically, including callers of icash_prepare_deal.
-- No deal, screening, permission or campaign is created or promoted by this patch.
create function public.icash_preserve_deal_provenance() returns trigger language plpgsql set search_path='' as $$
declare editable text[]:=array['dealNotes','seller','buyer','assignee','address','legalDescription','state','priceCents','assignmentFeeCents','earnestCents','assignmentDepositCents','inspectionDays','effectiveDate','closingDate','escrowAgent','titleEmail','payoutMethod','payoutHandle','priceSource'];stored jsonb;entry record;
begin
 if jsonb_typeof(new.terms) is distinct from 'object' then raise exception 'Deal terms must be an object';end if;
 stored:=old.terms-editable;
 for entry in select key,value from jsonb_each(new.terms-editable) loop
  if not stored ? entry.key or stored->entry.key is distinct from entry.value then raise exception 'Stored deal provenance cannot change';end if;
 end loop;
 new.terms:=stored||new.terms;
 return new;
end $$;
-- Run before the existing sent-contract freeze; signed-term rules remain intact.
create trigger icash_00_preserve_deal_provenance before update of terms on public.icash_deal_files for each row execute function public.icash_preserve_deal_provenance();
revoke all on function public.icash_preserve_deal_provenance() from public,anon,authenticated;
grant execute on function public.icash_preserve_deal_provenance() to service_role;
commit;
