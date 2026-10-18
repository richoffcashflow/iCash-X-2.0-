begin;
set local lock_timeout='3s';
-- Network forms enter the existing buyer pool. Their first contact assignment
-- is provisional until research, but the screening/deal/thread are retained.
alter table public.icash_meta_lead_sources add column routing_mode text not null default 'direct' check(routing_mode in ('direct','network_pool')),
 add column sharing_text text,alter column account_id drop not null;
alter table public.icash_meta_lead_sources add constraint icash_meta_source_routing check(
 (routing_mode='direct' and account_id is not null) or
 (routing_mode='network_pool' and account_id is null and principal='HomeOffer Network' and sharing_text is not null and length(sharing_text) between 40 and 2000));
alter table public.icash_meta_leads alter column account_id drop not null,alter column screening_id drop not null,
 add column routed_at timestamptz,add constraint icash_meta_contact_assignment check((account_id is null)=(screening_id is null));

create function public.icash_meta_pool_receipt_current(p_lead uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_meta_leads m join public.icash_seller_intakes l on l.id=m.lead_id
 join public.icash_meta_lead_sources src on src.id=m.source_id
 where m.lead_id=p_lead and src.routing_mode='network_pool' and src.account_id is null and src.principal='HomeOffer Network'
 and src.enabled and src.reviewed_until>now() and src.page_id=m.page_id and src.form_id=m.form_id
 and src.consent_text=m.consent_text and src.consent_version=m.consent_version and src.timezone=m.timezone
 and l.ai_consented and l.contact_consent_scope='homeoffer_network_and_matched_buyers'
 and l.consent_text=m.consent_text and l.consent_version=m.consent_version and l.sharing_text=src.sharing_text
 and l.state<>'duplicate' and not m.paused and m.declined_at is null and m.contact_until>now() and l.data_rights_until>now()
 and m.submitted_at<=now() and m.submitted_at>now()-interval '30 days'
 and (select count(*) from jsonb_array_elements(m.consent_receipt) e where e->>'checkbox_key'=src.consent_key)=1
 and exists(select 1 from jsonb_array_elements(m.consent_receipt) e where e->>'checkbox_key'=src.consent_key and e->'is_checked'='true'::jsonb)
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=l.phone)
 and not exists(select 1 from public.icash_contact_suppressions s where s.contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex')));
$$;

create function public.icash_meta_assign_contact(p_lead uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;l public.icash_seller_intakes;a record;screen uuid;
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
 select ac.id,i.principal,w.balance_cents into a
 from public.icash_accounts ac join public.icash_wallets w on w.account_id=ac.id
 join public.icash_customer_identities i on i.account_id=ac.id
 where public.icash_credit_acquisition_allowed(ac.id) and not ac.bot_paused and w.balance_cents>0 and nullif(trim(i.principal),'') is not null
 and (public.icash_outreach_sms_current(ac.id) or public.icash_outreach_voice_current(ac.id))
 and not exists(select 1 from public.icash_billing_reviews b where b.account_id=ac.id and b.resolved_at is null)
 order by public.icash_vip_active(ac.id) desc,
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
end $$;

-- Keep the original direct-principal lane available for existing reviewed
-- sources, while network consent is bound to each actual pool recipient.
alter function public.icash_seller_contact_evidence(uuid,uuid,uuid,text) rename to icash_meta_direct_contact_evidence;
create function public.icash_seller_contact_evidence(p_account uuid,p_screening uuid,p_lead uuid,p_phone text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;l public.icash_seller_intakes;principal text;binding jsonb;
begin
 select ml.* into m from public.icash_meta_leads ml join public.icash_meta_lead_sources src on src.id=ml.source_id where ml.lead_id=p_lead and src.routing_mode='network_pool';
 if not found then return public.icash_meta_direct_contact_evidence(p_account,p_screening,p_lead,p_phone);end if;
 select * into l from public.icash_seller_intakes where id=p_lead;
 if l.phone is distinct from p_phone or not public.icash_meta_pool_receipt_current(p_lead)
 or ((m.account_id=p_account and m.screening_id=p_screening and l.assigned_account=p_account and l.screening_id=p_screening)
  or exists(select 1 from public.icash_seller_matches sm where sm.lead_id=p_lead and sm.account_id=p_account and sm.screening_id=p_screening)) is not true
 or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=p_screening and state<>'resolved') then return null;end if;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=p_account;
 if nullif(trim(principal),'') is null then return null;end if;
 binding:=jsonb_build_object('lead',l.id,'account',p_account,'screening',p_screening,'phone',p_phone,'principal',principal,'metaLeadId',m.meta_id,'formId',m.form_id,'consent',m.consent_receipt,'consentVersion',m.consent_version,'consentText',m.consent_text,'scope',l.contact_consent_scope,'sharing',l.sharing_text,'submittedAt',m.submitted_at,'timezone',m.timezone);
 return jsonb_build_object('timezone',m.timezone,'until',m.contact_until,'evidence','meta-network:'||l.id||':'||encode(sha256(convert_to(binding::text,'UTF8')),'hex'));
end $$;
revoke all on function public.icash_seller_contact_evidence(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_seller_contact_evidence(uuid,uuid,uuid,text) to service_role;

do $patch$
declare def text;needle text;branch text;
begin
 def:=pg_get_functiondef('public.icash_meta_accept_lead(uuid,jsonb,text)'::regprocedure);
 needle:='where ml.account_id=src.account_id and i.phone=lead_phone';
 if position(needle in def)=0 then raise exception 'Meta duplicate receipt prerequisite changed';end if;
 def:=replace(def,needle,'where (ml.account_id=src.account_id or src.routing_mode=''network_pool'' and exists(select 1 from public.icash_meta_lead_sources oldsrc where oldsrc.id=ml.source_id and oldsrc.routing_mode=''network_pool'')) and i.phone=lead_phone');
 needle:=' select i.principal into principal from public.icash_customer_identities i where i.account_id=src.account_id;';
 if position(needle in def)=0 then raise exception 'Meta contact allocation prerequisite changed';end if;
 branch:=$network$
 if src.routing_mode='network_pool' then
  insert into public.icash_seller_intakes(id,request_id,guest_hash,duplicate_key,agent_hash,name,address,phone,ai_consented,consent_version,consent_text,sharing_text,attribution,state,contact_consent_scope,data_rights_until,created_at)
  values(lead,gen_random_uuid(),encode(sha256(convert_to('meta:'||meta,'UTF8')),'hex'),encode(sha256(convert_to('meta-network:'||lead_phone,'UTF8')),'hex'),encode(sha256(convert_to('meta-webhook:'||src.id,'UTF8')),'hex'),p_payload->>'name',null,lead_phone,true,src.consent_version,src.consent_text,src.sharing_text,
   jsonb_build_object('source','meta','channel','instant_form','campaign',p_payload->>'campaignId','adId',p_payload->>'adId','adsetId',p_payload->>'adsetId','formId',src.form_id,'pageId',src.page_id,'metaLeadId',meta,'contactTimezone',src.timezone,'contactTimezoneSource','reviewed_meta_form'),
   'awaiting_address','homeoffer_network_and_matched_buyers',least(submitted+interval '30 days',src.reviewed_until),submitted);
  insert into public.icash_meta_leads(lead_id,source_id,meta_id,submitted_at,page_id,form_id,ad_id,adset_id,campaign_id,consent_receipt,consent_text,consent_version,timezone,call_now,contact_until,link_hash,link_expires_at)
  values(lead,src.id,meta,submitted,src.page_id,src.form_id,p_payload->>'adId',p_payload->>'adsetId',p_payload->>'campaignId',p_payload->'consentResponses',src.consent_text,src.consent_version,src.timezone,
   src.call_now_key is not null and exists(select 1 from jsonb_array_elements(p_payload->'consentResponses') e where e->>'checkbox_key'=src.call_now_key and e->'is_checked'='true'::jsonb),least(submitted+interval '30 days',src.reviewed_until),p_link_hash,submitted+interval '7 days');
  insert into public.icash_meta_lead_receipts(meta_id,lead_id,source_id,ad_id,campaign_id,submitted_at) values(meta,lead,src.id,p_payload->>'adId',p_payload->>'campaignId',submitted);
  perform public.icash_meta_assign_contact(lead);
  select * into m from public.icash_meta_leads where lead_id=lead;
  return jsonb_build_object('leadId',lead,'accountId',m.account_id,'duplicate',false);
 end if;
$network$;
 execute replace(def,needle,branch||needle);

 -- The generic website worker must not race the first buyer's in-call lookup
 -- or create a replacement screening before same-card promotion completes.
 def:=pg_get_functiondef('public.icash_claim_seller_lookup_for(uuid)'::regprocedure);
 needle:='contact_consent_scope is distinct from ''meta_direct_principal''';
 if position(needle in def)=0 then raise exception 'Meta research prerequisite changed';end if;
 execute replace(def,needle,'not exists(select 1 from public.icash_meta_leads ml where ml.lead_id=icash_seller_intakes.id)');
 def:=pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure);
 needle:='and contact_consent_scope is distinct from ''meta_direct_principal''';
 if position(needle in def)=0 then raise exception 'Meta shared assignment prerequisite changed';end if;
 execute replace(def,needle,needle||' and (not exists(select 1 from public.icash_meta_leads ml where ml.lead_id=icash_seller_intakes.id) or exists(select 1 from public.icash_meta_leads ml join public.icash_seller_matches sm on sm.lead_id=ml.lead_id and sm.account_id=ml.account_id and sm.screening_id=ml.screening_id where ml.lead_id=icash_seller_intakes.id and public.icash_meta_pool_receipt_current(ml.lead_id)))');

 def:=pg_get_functiondef('public.icash_meta_promote_property(uuid)'::regprocedure);
 needle:='next_assignment_at=''9999-12-31T23:59:59Z''';
 if position(needle in def)=0 then raise exception 'Meta promotion prerequisite changed';end if;
 def:=replace(def,needle,'next_assignment_at=case when l.contact_consent_scope=''homeoffer_network_and_matched_buyers'' then public.icash_seller_assignment_due(1,now(),now()) else ''9999-12-31T23:59:59Z''::timestamptz end');
 def:=replace(def,'''shared'',false,''maximumBuyers'',1','''shared'',l.contact_consent_scope=''homeoffer_network_and_matched_buyers'',''maximumBuyers'',case when l.contact_consent_scope=''homeoffer_network_and_matched_buyers'' then 3 else 1 end');
 def:=replace(def,'''meta-direct-acquisition-v1; pricing all-usage-2x-20261018; ''','''meta-acquisition-v1; pricing all-usage-2x-20261018; ''');
 execute def;

 -- Seller-requested text-only / stop choices survive later pool assignments.
 def:=pg_get_functiondef('public.icash_seller_voice_permission_current(uuid,uuid)'::regprocedure);
 needle:=' and m.account_id=p.account_id';
 if position(needle in def)=0 then raise exception 'Meta voice-choice prerequisite changed';end if;
 execute replace(def,needle,'');
 def:=pg_get_functiondef('public.icash_meta_observe_text()'::regprocedure);
 needle:='t.seller_intake_id=m.lead_id and t.account_id=m.account_id';
 if position(needle in def)=0 then raise exception 'Meta text observation prerequisite changed';end if;
 execute replace(def,needle,'t.seller_intake_id=m.lead_id and (t.account_id=m.account_id or exists(select 1 from public.icash_seller_matches sm where sm.lead_id=m.lead_id and sm.account_id=t.account_id and sm.screening_id=(select d.screening_id from public.icash_deal_files d where d.id=t.deal_id and d.account_id=t.account_id)))');
end $patch$;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'icash_meta_%'
 loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
commit;
