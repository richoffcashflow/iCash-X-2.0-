-- Read-only production function definitions captured 2026-10-18. No customer data.
CREATE OR REPLACE FUNCTION public.icash_manual_text_reason(p_account uuid, p_thread uuid, p_exclude uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;screening uuid;reason text;charge bigint;available bigint;cap bigint;used bigint;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found then return 'Conversation unavailable.';end if;
 select screening_id into screening from public.icash_deal_files where id=t.deal_id and account_id=p_account;
 reason:=public.icash_manual_contact_reason(p_account,screening,t.recipient,'sms',p_exclude);
 if reason is not null then return reason;end if;
 if not exists(select 1 from public.icash_text_senders where phone=t.sender and enabled) then return 'Business texting number is unavailable.';end if;
 select greatest(r.charge_cents,ceil(p.customer_micros::numeric/10000)::bigint) into charge from public.icash_operation_rates r cross join public.icash_communication_prices p where r.id=t.sms_rate_id and r.enabled and r.expires_at>now() and r.operation='sms_send' and p.operation='sms_segment';
 if charge is null then return 'Texting setup needs a rate refresh. Your draft is saved.';end if;
 if not public.icash_membership_work_allowed(p_account) then return 'Update your subscription to send texts.';end if;
 select balance_cents-reserved_cents into available from public.icash_wallets where account_id=p_account;
 if coalesce(available,0)<charge then return 'Add credits to send. Your draft is saved.';end if;
 return null;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_next_before_owner_question()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare prior jsonb;candidate record;ticket public.icash_automation_tickets;
begin
 perform pg_advisory_xact_lock(726341927);
 prior:=public.icash_next_before_unstarted_sms_recovery();
 if prior->>'token' is not null then return prior;end if;
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found or exists(select 1 from public.icash_automation_tickets where kind='seller_opener' and created_at>now()-interval '1 minute') then return prior;end if;
 select th.account_id,msg.id as message_id,history.attempt+1 as attempt into candidate
 from public.icash_seller_opener_assignments assignment
 join public.icash_text_messages msg on msg.id=assignment.message_id and msg.thread_id=assignment.thread_id and msg.account_id=assignment.account_id and msg.body=assignment.body
 join public.icash_text_threads th on th.id=msg.thread_id and th.account_id=msg.account_id
 join public.icash_accounts a on a.id=th.account_id and not a.bot_paused
 join public.icash_operation_rates rate on rate.id=th.sms_rate_id
 join public.icash_wallets wallet on wallet.account_id=a.id and wallet.balance_cents-wallet.reserved_cents>=rate.charge_cents
 join public.icash_deal_files deal on deal.id=th.deal_id and deal.account_id=th.account_id and deal.stage='draft' and coalesce(deal.terms->>'practice','false')<>'true'
 join public.icash_screening_jobs sc on sc.id=deal.screening_id and sc.account_id=deal.account_id and sc.state='complete' and sc.result->'financialCheck'->>'status'='eligible' and sc.completed_at between now()-interval '24 hours' and now()
 join public.icash_timezone_names zone on zone.name=th.timezone
 cross join lateral(select count(*) as total,max(issue_attempts) as attempt from public.icash_automation_tickets where opener_message_id=msg.id) history
 cross join lateral(select * from public.icash_automation_tickets where opener_message_id=msg.id order by created_at desc,id desc limit 1) previous
 where msg.direction='outgoing' and msg.state='ready' and msg.provider_id is null and msg.last_delivery_at is null and msg.request_key=th.id and cardinality(msg.asset_ids)=0
 and assignment.delivered_at is null and assignment.first_reply_at is null and not assignment.opted_out
 and th.party='seller' and not th.paused and th.ai_mode='auto' and not th.sms_intake_pending
 and public.icash_outreach_sms_current(th.account_id) and public.icash_sms_thread_review_current(th.account_id,th.id,true)
 and extract(hour from now() at time zone zone.name) between 9 and 19
 and history.total between 1 and 2 and history.attempt between 1 and 2
 and previous.account_id=th.account_id and previous.kind='seller_opener'
 and ((previous.state='issued' and previous.expires_at<=now()) or (previous.state='held' and previous.outcome in ('expired','message_held','messaging_configuration_required','business_number_mismatch','business_number_verification_required')))
 and not exists(select 1 from public.icash_automation_tickets active where active.opener_message_id=msg.id and (active.state='consumed' or (active.state='issued' and active.expires_at>now()) or active.account_id<>th.account_id or active.kind<>'seller_opener'))
 and not exists(select 1 from public.icash_operation_spend where operation_key='text:'||msg.id)
 and not exists(select 1 from public.icash_text_messages other where other.thread_id=th.id and other.id<>msg.id)
 and not exists(select 1 from public.icash_sms_inbound_invitations where message_id=msg.id or thread_id=th.id)
 and not exists(select 1 from public.icash_text_ai_jobs where outgoing_id=msg.id)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=th.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual)
 order by previous.created_at,th.id for update of th,msg skip locked limit 1;
 if not found then return prior;end if;
 insert into public.icash_automation_tickets(account_id,kind,opener_message_id,issue_attempts)
 values(candidate.account_id,'seller_opener',candidate.message_id,candidate.attempt) returning * into ticket;
 return jsonb_build_object('token',ticket.token);
end $function$;

CREATE OR REPLACE FUNCTION public.icash_next_work(p_account uuid)
 RETURNS TABLE(candidate_id uuid, action text, deal_id uuid, charge_cents bigint, reason text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with cfg as (
 select settings from icash_private.engine_configs where engine='deal' and enabled
 ), funding as (
 select a.id,a.daily_limit_cents,w.balance_cents-w.reserved_cents as available,
 w.balance_cents as remaining
 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id
 where a.id=p_account and not a.bot_paused
 )
 select c.id,c.action,c.deal_id,c.estimated_charge_cents,
 case when c.deadline_at<=now()+interval '48 hours' then 'Contract deadline'
 when d.seller_signed_at is not null then 'Protect active contract'
 when c.action='seller_callback' then 'Honor seller callback'
 else 'Verified opportunity within budget' end
 from icash_private.work_candidates c
 join public.icash_deals d on d.account_id=c.account_id and d.id=c.deal_id
 join funding f on f.id=c.account_id cross join cfg
 where c.status='pending' and c.due_at<=now() and c.permission_verified_until>now()
 and d.stage not in ('closed','stopped') and not d.needs_user
 and c.estimated_charge_cents<=least(f.available,f.remaining)
 and (c.action<>'prospect' or not exists (
 select 1 from icash_private.work_candidates urgent
 join public.icash_deals active on active.account_id=urgent.account_id and active.id=urgent.deal_id
 where urgent.account_id=c.account_id and urgent.status='pending' and active.seller_signed_at is not null
 and active.stage not in ('closed','stopped') and urgent.due_at<=now()+interval '48 hours'
 ))
 and (c.estimated_charge_cents/100.0-c.estimated_provider_cost_usd)/(c.estimated_charge_cents/100.0)
 >= coalesce((cfg.settings->>'minimum_gross_margin')::numeric,1)
 order by (c.deadline_at<=now()+interval '48 hours') desc nulls last,
 (d.seller_signed_at is not null) desc,
 (c.action='seller_callback') desc,
 c.deadline_at asc nulls last,c.quality_score desc,c.due_at,c.id
 limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.icash_outbound_search_due(p_account uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare a public.icash_accounts;c public.icash_discovery_configs;policy public.icash_acquisition_policy;capacity bigint;research_spend bigint;cost bigint;target integer;inbound_count integer;outbound_count integer;profile jsonb;
begin
 select * into policy from public.icash_acquisition_policy where id=1;
 if not found or policy.mode='inbound' then return false;end if;
 select * into a from public.icash_accounts where id=p_account;
 if not found or a.bot_paused then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account;
 if not found or not c.enabled or not c.auto_enabled or c.exhausted or c.data_rights_until<=now() or not public.icash_research_zip_known(c.zip) then return false;end if;
 if exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null) then return false;end if;
 select charge_cents into cost from public.icash_operation_rates where id=c.rate_id and enabled and expires_at>now() and operation='property_search';
 if cost is null then return false;end if;
 select w.balance_cents into capacity from public.icash_wallets w where account_id=p_account;
 if capacity is null or capacity<cost then return false;end if;
 if exists(select 1 from public.icash_screening_jobs s where s.account_id=p_account and s.state in ('queued','running') and s.created_at>now()-interval '1 day') then return false;end if;
 if policy.mode='outbound' then return true;end if;
 select bs.profile into profile from public.icash_bot_setups bs where account_id=p_account;
 -- Let an affordable, due inbound request be delivered before buying a page.
 if public.icash_credit_acquisition_allowed(p_account) and exists(select 1 from public.icash_seller_intakes l where l.state in ('qualified','assigned') and l.next_assignment_at<=now() and l.data_rights_until>now() and l.checked_at>now()-interval '8 days'
 and public.icash_research_state_allowed(l.property->>'state') and (profile->>'marketMode'='nationwide' or lower(trim(profile->>'market')) in (lower(l.property->>'city'),lower(l.property->>'city')||', '||lower(l.property->>'state'),l.property->>'zip'))
 and not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id and m.account_id=p_account)
 and (select count(*) from public.icash_seller_matches m where m.lead_id=l.id)<3
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=l.phone)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_live_conversations lc on lc.account_id=sm.account_id and lc.screening_id=sm.screening_id join public.icash_contact_suppressions cs on cs.account_id=lc.account_id and cs.contact_key=lc.contact_key where sm.lead_id=l.id)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_deal_files d on d.account_id=sm.account_id and d.screening_id=sm.screening_id join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='completed' where sm.lead_id=l.id)
 and (select public.icash_seller_assignment_due(count(*)::integer,min(m.assigned_at),max(m.assigned_at)) from public.icash_seller_matches m where m.lead_id=l.id)<=now()
 and not exists(select 1 from public.icash_outbound_property_owners o where o.property_id=l.property->>'id' and o.account_id<>p_account)
 and ceil(ceil((select sum(value::numeric) from jsonb_each_text(coalesce(l.customer_costs,case when public.icash_seller_acquisition_quote(l.id) is not null then l.lookup_costs||jsonb_build_object('acquisition',(public.icash_seller_acquisition_quote(l.id)->>'costMicros')::bigint) end)))*coalesce(l.customer_lead_multiplier,case when l.customer_costs is not null then 3 else 2 end)/10000)*case when public.icash_vip_active(p_account) then 0.8 else 1 end)<=capacity) then return false;end if;
 target:=least(20,greatest(2,ceil(capacity::numeric/1000)::integer));
 select count(*) into inbound_count from public.icash_seller_matches where account_id=p_account and assigned_at>now()-interval '24 hours';
 select count(*) into outbound_count from public.icash_screening_jobs where account_id=p_account and state='complete' and completed_at>now()-interval '24 hours' and event_key like 'discovery:%' and result->'financialCheck'->>'status'='eligible';
 -- Refill a real shortfall. Never buy filler merely to create a daily charge.
 return inbound_count+outbound_count<target and outbound_count<case when inbound_count>=ceil(target*public.icash_hybrid_inbound_share(a.daily_limit_cents)) then ceil(target*(1-public.icash_hybrid_inbound_share(a.daily_limit_cents))) else greatest(1,target-inbound_count) end;
end $function$;
