begin;
create function public.icash_meta_workspace_leads(p_account uuid,p_query text default '',p_offset integer default 0,p_limit integer default 7,p_screening uuid default null) returns jsonb
language sql security invoker set search_path='' as $$
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
$$;
create function public.icash_meta_pause_lead(p_account uuid,p_lead uuid,p_paused boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_meta_leads where lead_id=p_lead and account_id=p_account for update;
 if not found or m.declined_at is not null and not p_paused then return false;end if;
 update public.icash_meta_leads set paused=p_paused,next_attempt_at=now() where lead_id=p_lead;
 if p_paused then
  update public.icash_text_messages msg set state='cancelled',updated_at=now() from public.icash_meta_lead_messages mm where mm.message_id=msg.id and mm.lead_id=p_lead and msg.state='ready';
  update public.icash_voice_jobs j set state='held',outcome='meta_lead_paused',updated_at=now() from public.icash_contact_permissions p where p.id=j.permission_id and p.seller_intake_id=p_lead and j.account_id=p_account and j.state in ('ready','issued')
   and not exists(select 1 from public.icash_operation_spend where operation_key='voice:'||j.id);
 else
  update public.icash_text_messages msg set state='ready',updated_at=now() from public.icash_meta_lead_messages mm where mm.message_id=msg.id and mm.lead_id=p_lead and msg.state='cancelled' and msg.provider_id is null and not exists(select 1 from public.icash_operation_spend where operation_key='text:'||msg.id);
  update public.icash_voice_jobs j set state='ready',outcome=null,due_at=now(),updated_at=now() from public.icash_contact_permissions p where p.id=j.permission_id and p.seller_intake_id=p_lead and j.account_id=p_account and j.state='held' and j.outcome='meta_lead_paused'
   and not exists(select 1 from public.icash_operation_spend where operation_key='voice:'||j.id);
 end if;
 return true;
end $$;
create function public.icash_meta_text_context(p_event text) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('leadId',m.lead_id,'accountId',m.account_id,'messageId',msg.id,'body',msg.body,'paused',m.paused,'declined',m.declined_at is not null,'complete',s.state='complete')
 from public.icash_text_messages msg join public.icash_text_threads t on t.id=msg.thread_id and t.account_id=msg.account_id
 join public.icash_meta_leads m on m.lead_id=t.seller_intake_id and m.account_id=t.account_id
 join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id
 where msg.event_id=p_event and msg.direction='incoming' and msg.state='received' and t.party='seller' and t.retired_at is null;
$$;
revoke all on function public.icash_meta_workspace_leads(uuid,text,integer,integer,uuid),public.icash_meta_pause_lead(uuid,uuid,boolean),public.icash_meta_text_context(text) from public,anon,authenticated;
grant execute on function public.icash_meta_workspace_leads(uuid,text,integer,integer,uuid),public.icash_meta_pause_lead(uuid,uuid,boolean),public.icash_meta_text_context(text) to service_role;
commit;
