-- Reviewed schema-only display predecessors; no customer data.

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

CREATE OR REPLACE FUNCTION public.icash_workspace_response_counts(p_account uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('responded',count(*) filter(where (coalesce(o.responded,false) or reply.message_id is not null) or coalesce(o.purchase_signed,false) or exists(select 1 from public.icash_meta_leads m where m.screening_id=s.id and m.account_id=s.account_id and m.response_at is not null)),'total',count(*))
 from public.icash_screening_jobs s left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
 left join public.icash_workspace_seller_texts(p_account,null) reply on reply.screening_id=s.id
 where s.account_id=p_account and s.state in ('complete','awaiting_address');
$function$
;

CREATE OR REPLACE FUNCTION public.icash_meta_workspace_leads(p_account uuid, p_query text DEFAULT ''::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 7, p_screening uuid DEFAULT NULL::uuid)
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
 and (p_query='' or position(lower(p_query) in lower(coalesce(l.name,'')||' '||l.phone||' '||coalesce(l.address,'')))>0)
 order by m.created_at desc,m.lead_id limit greatest(1,least(25,p_limit)) offset greatest(0,least(60000,p_offset))
 ) row;
$function$
;
