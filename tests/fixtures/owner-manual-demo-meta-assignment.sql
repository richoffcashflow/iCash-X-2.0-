-- Saved production function; fixture execution never calls providers.
CREATE OR REPLACE FUNCTION public.icash_meta_assign_contact(p_lead uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare m public.icash_meta_leads;l public.icash_seller_intakes;a record;screen uuid;waiting_priority boolean;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_meta_leads where lead_id=p_lead for update;
 if not found then return jsonb_build_object('status','not_meta');end if;
 if m.account_id is not null then return jsonb_build_object('status','assigned','accountId',m.account_id,'screeningId',m.screening_id);end if;
 select * into l from public.icash_seller_intakes where id=p_lead for update;
 if not public.icash_meta_pool_receipt_current(p_lead) then return jsonb_build_object('status','contact_held');end if;
 perform 1 from public.icash_seller_controls where id=1 and enabled and data_rights_until>now() and length(coalesce(review_ref,''))>=10 for share;
 if not found then return jsonb_build_object('status','pool_unavailable');end if;
 -- Same paid/membership, Run/Pause, VIP-first and weighted rotation policy as
 -- website allocation. Include unfinished intakes so they cannot all pile onto
 -- one buyer before the first property is researched. No estimated charge or
 -- wallet reservation is created merely to display a name-and-phone card.
 select exists(select 1 from public.icash_meta_import_priorities p where p.source_id=m.source_id and p.meta_id=m.meta_id) into waiting_priority;
 select ac.id,i.principal,w.balance_cents into a
 from public.icash_accounts ac join public.icash_wallets w on w.account_id=ac.id
 join public.icash_customer_identities i on i.account_id=ac.id
 where public.icash_credit_acquisition_allowed(ac.id) and not ac.bot_paused and w.balance_cents>0 and nullif(trim(i.principal),'') is not null
 and (public.icash_outreach_sms_current(ac.id) or public.icash_outreach_voice_current(ac.id))
 and not exists(select 1 from public.icash_billing_reviews b where b.account_id=ac.id and b.resolved_at is null)

 order by case when waiting_priority then coalesce(greatest(
  (select max(x.assigned_at) from public.icash_seller_matches x where x.account_id=ac.id),
  (select max(x.routed_at) from public.icash_meta_leads x where x.account_id=ac.id)
 ),ac.created_at) end asc,
 public.icash_vip_active(ac.id) desc,

 case when exists(select 1 from public.icash_seller_matches x where x.account_id=ac.id and x.assigned_at>now()-interval '24 hours')
  or exists(select 1 from public.icash_meta_leads x where x.account_id=ac.id and x.routed_at>now()-interval '24 hours') then 1 else 0 end,
 ((select count(*) from public.icash_seller_matches x where x.account_id=ac.id and x.assigned_at>now()-interval '7 days')
  +(select count(*) from public.icash_meta_leads x where x.account_id=ac.id and x.routed_at>now()-interval '7 days' and not exists(select 1 from public.icash_seller_matches sm where sm.lead_id=x.lead_id and sm.account_id=ac.id))+1)
 /power(greatest(w.balance_cents,1)::numeric,0.75)
 /public.icash_hybrid_inbound_share(ac.daily_limit_cents),w.balance_cents desc,ac.id
 limit 1 for update of ac;
 if a.id is null then return jsonb_build_object('status','waiting_for_funded_buyer');end if;
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state)
 values(a.id,'meta-lead:'||m.meta_id,jsonb_build_object('contactOnly',true,'sellerRequest',jsonb_build_object('id',l.id,'ownerName',l.name,'phone',l.phone,'aiConsented',true,'consentScope',l.contact_consent_scope,'shared',true,'maximumBuyers',3)),'awaiting_address') returning id into screen;
 insert into public.icash_deal_files(account_id,screening_id,terms) values(a.id,screen,jsonb_build_object('buyer',a.principal,'seller','','priceCents',null,'priceSource','proposed','intakeOnly',true));
 update public.icash_meta_leads set account_id=a.id,screening_id=screen,routed_at=now(),next_attempt_at=now() where lead_id=l.id;
 update public.icash_seller_intakes set assigned_account=a.id,screening_id=screen,hold_reason=null where id=l.id;
 return jsonb_build_object('status','assigned','accountId',a.id,'screeningId',screen);
end $function$
