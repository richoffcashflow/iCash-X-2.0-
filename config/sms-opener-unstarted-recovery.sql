begin;
-- Apply after seller-opener-experiments.sql, sms-inbound-campaign.sql and sms-contact-intake.sql.
-- A fresh ticket can recover an original opener only before any provider operation exists.
-- Existing capabilities, message IDs, operation keys and uncertain work are never reset.
alter function public.icash_next_automation() rename to icash_next_before_unstarted_sms_recovery;
create function public.icash_next_automation() returns jsonb language plpgsql set search_path='' as $$
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
 join pg_timezone_names zone on zone.name=th.timezone
 cross join lateral(select count(*) as total,max(issue_attempts) as attempt from public.icash_automation_tickets where opener_message_id=msg.id) history
 cross join lateral(select * from public.icash_automation_tickets where opener_message_id=msg.id order by created_at desc,id desc limit 1) previous
 where msg.direction='outgoing' and msg.state='ready' and msg.provider_id is null and msg.last_delivery_at is null and msg.request_key=th.id and cardinality(msg.asset_ids)=0
 and assignment.delivered_at is null and assignment.first_reply_at is null and not assignment.opted_out
 and th.party='seller' and not th.paused and th.ai_mode='auto' and not th.sms_intake_pending
 and public.icash_sms_inbound_campaign_current(th.account_id) and public.icash_sms_thread_review_current(th.account_id,th.id,true)
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
end $$;
revoke all on function public.icash_next_automation(),public.icash_next_before_unstarted_sms_recovery() from public,anon,authenticated;
grant execute on function public.icash_next_automation(),public.icash_next_before_unstarted_sms_recovery() to service_role;
commit;
