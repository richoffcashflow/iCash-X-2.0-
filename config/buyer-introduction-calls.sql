begin;
-- A first conversation establishes interest and buying criteria. It must not
-- require a buyer to have already passed funds/signatory qualification. Current
-- contact/channel checks still apply; no qualification record is manufactured.
create or replace function public.icash_buyer_voice_context(p_permission uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare context jsonb;package jsonb;p public.icash_voice_contact_targets;url text;deal uuid;doc uuid;
begin
 select * into p from public.icash_voice_contact_targets where id=p_permission and party='buyer';
 if not found then return null;end if;
 context:=public.icash_buyer_voice_context_before_package(p_permission);
 if context is null then
  if not public.icash_buyer_contact_current(p.account_id,p.buyer_id,p.screening_id,p.phone) then return null;end if;
  select d.id,documents.id into deal,doc
  from public.icash_buyer_profiles b
  join public.icash_buyer_candidates candidate on candidate.buyer_id=b.id and candidate.rights_until>now()
  join public.icash_deal_files d on d.id=candidate.deal_id and d.account_id=b.account_id and d.screening_id=p.screening_id
  join public.icash_fulfillment_jobs j on j.account_id=d.account_id and j.deal_id=d.id and j.state='complete'
  join public.icash_deal_documents documents on documents.fulfillment_job_id=j.id and documents.kind='buyer_package'
  where b.id=p.buyer_id and b.account_id=p.account_id and candidate.discovered_at between now()-interval '30 days' and now()
  and exists(select 1 from jsonb_array_elements(coalesce(b.discovery->'phones','[]')) ph where ph->>'number'=p.phone and ph->'doNotCall'='false'::jsonb)
  order by documents.created_at desc limit 1;
  if deal is null then return null;end if;
  package:=public.icash_buyer_package_data(p.account_id,deal);
  if package is null then return null;end if;
  context:=jsonb_build_object('dealId',deal,'address',package->'address','askingPriceCents',package->'askingPriceCents','repairsCents',package->'repairsCents','packageId',doc,'qualificationStatus','unconfirmed');
 else
  package:=public.icash_buyer_package_data(p.account_id,(context->>'dealId')::uuid);
 end if;
 if package is null then return null;end if;
 select 'https://www.geticashx.com/d/'||token into url from public.icash_buyer_package_links where account_id=p.account_id and deal_id=(context->>'dealId')::uuid and revoked_at is null and asking_price_cents=(context->>'askingPriceCents')::bigint;
 return context||jsonb_build_object('purchasePriceCents',package->'purchasePriceCents','assignmentFeeCents',package->'assignmentFeeCents','buyerPaysClosingCosts',true,'packageUrl',url);
end $$;
revoke all on function public.icash_buyer_voice_context(uuid) from public,anon,authenticated;
grant execute on function public.icash_buyer_voice_context(uuid) to service_role;
commit;
