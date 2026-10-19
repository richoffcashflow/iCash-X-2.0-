-- Outcome-driven ranking retains each account's markets, contact gates and prices.
begin;
CREATE OR REPLACE FUNCTION public.icash_meta_workspace_response_leads(p_account uuid, p_query text DEFAULT ''::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 7, p_screening uuid DEFAULT NULL::uuid, p_responses_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(row),'[]'::jsonb) from (
 select m.lead_id "leadId",m.screening_id "screeningId",d.id "dealId",l.name,l.phone,l.address,l.state,m.paused,m.declined_at "declinedAt",
 m.submitted_at "submittedAt",m.first_outreach_at "firstOutreachAt",m.response_at "responseAt",m.address_confirmed_at "addressConfirmedAt",m.form_id "formId",m.campaign_id "campaignId",
 l.hold_reason "holdReason"
 from public.icash_meta_leads m join public.icash_seller_intakes l on l.id=m.lead_id join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id and s.state='awaiting_address'
 join public.icash_deal_files d on d.account_id=m.account_id and d.screening_id=m.screening_id
 where m.account_id=p_account and (p_screening is null or m.screening_id=p_screening)
 and (not p_responses_only or m.response_at is not null)
 and (p_query='' or position(lower(p_query) in lower(coalesce(l.name,'')||' '||l.phone||' '||coalesce(l.address,'')))>0)
 order by m.response_at desc nulls last,m.created_at desc,m.lead_id limit greatest(1,least(25,p_limit)) offset greatest(0,least(60000,p_offset))
 ) row;
$function$
;
revoke all on function public.icash_meta_workspace_response_leads(uuid,text,integer,integer,uuid,boolean) from public,anon,authenticated;
grant execute on function public.icash_meta_workspace_response_leads(uuid,text,integer,integer,uuid,boolean) to service_role;
CREATE OR REPLACE FUNCTION public.icash_enrichment_candidate(p_account uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select s.id from public.icash_screening_jobs s
 left join public.icash_automation_tickets t on t.screening_id=s.id
 where s.account_id=p_account and s.state='complete' and s.snapshot->>'propertyType'='house' and s.snapshot->'sellerRequest' is null and public.icash_research_state_allowed(s.snapshot->'raw'->'data'->>'state') and s.result->'financialCheck'->>'status'='eligible'
 and s.completed_at>now()-interval '24 hours'
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=s.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
 and not exists(select 1 from public.icash_owner_contacts oc join public.icash_screening_jobs prior on prior.id=oc.screening_id where oc.account_id=s.account_id and prior.snapshot->>'propertyId'=s.snapshot->>'propertyId' and oc.created_at>now()-interval '30 days')
 and (t.id is null or (t.kind='contacts' and t.state='held' and t.outcome='expired' and t.issue_attempts<3 and not exists(select 1 from public.icash_operation_spend o where o.operation_key='owners:'||s.account_id||':'||s.id)))
 order by public.icash_opportunity_score(p_account,s.result,left(s.snapshot->'raw'->'data'->>'zip',5)) desc,s.completed_at,s.id limit 1;
$function$
;
CREATE OR REPLACE FUNCTION public.icash_rotate_inventory_market(p_account uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_discovery_configs;m public.icash_inventory_markets;
begin
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or not c.exhausted or not c.enabled or not c.auto_enabled or c.data_rights_until<=now() then return false;end if;
 if not exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id where a.id=p_account and not a.bot_paused and w.balance_cents>w.reserved_cents) then return false;end if;
 select * into m from public.icash_inventory_markets where account_id=p_account and eligible_until>now() and next_scan_at<=now() and public.icash_research_zip_known(zip) order by public.icash_opportunity_market_score(p_account,zip) desc,priority,zip for update skip locked limit 1;
 if not found then return false;end if;
 update public.icash_discovery_configs set zip=m.zip,next_page=1,revision=gen_random_uuid(),exhausted=false where account_id=p_account;
 update public.icash_inventory_markets set next_scan_at=now()+interval '30 days' where account_id=p_account and zip=m.zip;
 return true;
end $function$
;
commit;
