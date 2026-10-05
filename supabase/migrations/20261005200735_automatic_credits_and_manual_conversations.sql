begin;
-- One-time work credits start automatically. Software access remains $50/month;
-- historical receipts and subscription prices are not rewritten.
update public.icash_membership_offer set price_cents=5000,enabled=true,revision=revision+1,updated_at=now()
where id=1 and (price_cents<>5000 or not enabled);

-- Retire unfinished daily checkouts. The existing billing reconciler expires
-- their hosted sessions and confirms cancellation before marking them stopped.
update public.icash_daily_plans set state='stop_requested' where mode='live' and state='pending';

-- Internal pacing is a maximum, never a daily charge or a spend target. A new
-- purchase increases capacity; a small balance still supports a useful task.
create function public.icash_credit_work_pace(p_available bigint) returns bigint
language sql immutable security invoker set search_path='' as $$
 select case when coalesce(p_available,0)<=0 then 0 else least(p_available,greatest(1000,least(100000,ceil(p_available::numeric/5)::bigint))) end
$$;
do $patch$ declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_apply_prepaid_purchase(uuid)'::regprocedure);
 needle:=$n$c.version='work-credits-2026-10-03.1'$n$;
 if position(needle in def)=0 then raise exception 'Credit consent boundary changed';end if;
 def:=replace(def,needle,$n$c.version in ('work-credits-2026-10-03.1','work-credits-2026-10-05.1')$n$);
 needle:='daily_limit_cents=funded';
 if position(needle in def)=0 then raise exception 'Credit pacing boundary changed';end if;
 def:=replace(def,needle,$n$daily_limit_cents=(select reserved_cents+public.icash_credit_work_pace(greatest(0,balance_cents-reserved_cents))+coalesce((select sum(-delta_cents) from public.icash_credit_ledger where account_id=a.id and kind='usage' and created_at>now()-interval '24 hours'),0) from public.icash_wallets where account_id=a.id)$n$);
 execute def;
end $patch$;

-- Paid software + funded work credits participate in the same inbound/outbound
-- distribution. Every later claim still checks funds, permissions and pricing.
create function public.icash_credit_acquisition_allowed(p_account uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id
 join public.icash_spend_activations sa on sa.account_id=a.id and sa.enabled
 where a.id=p_account and not a.bot_paused and w.balance_cents>w.reserved_cents
 and public.icash_membership_work_allowed(a.id)
 and not exists(select 1 from public.icash_billing_reviews where account_id=a.id and resolved_at is null)
 and (a.billing_model in ('prepaid','membership_credits') or (a.billing_model='daily' and exists(select 1 from public.icash_daily_plans p where p.account_id=a.id and p.state='active' and p.mode='live' and p.consent_version like 'daily-2026-10-04.1%'))))
$$;
do $patch$ declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure);
 needle:=$n$ac.billing_model='daily' and not ac.bot_paused$n$;
 if (length(def)-length(replace(def,needle,'')))/length(needle)<>2 then raise exception 'Inbound account boundaries changed';end if;
 def:=replace(def,needle,'public.icash_credit_acquisition_allowed(ac.id) and not ac.bot_paused');
 needle:=$n$ and exists(select 1 from public.icash_daily_plans p where p.account_id=ac.id and p.state='active' and p.mode='live' and p.consent_version like 'daily-2026-10-04.1%')$n$;
 if position(needle in def)=0 then raise exception 'Inbound billing boundary changed';end if;
 def:=replace(def,needle,'');
 def:=replace(def,'Waiting for a funded bot whose market and daily limit fit this lead','Waiting for a funded bot whose market and available credits fit this lead');execute def;
 def:=pg_get_functiondef('public.icash_outbound_search_due(uuid)'::regprocedure);
 needle:=$n$a.billing_model='daily' and exists(select 1 from public.icash_daily_plans p where p.account_id=p_account and p.state='active' and p.mode='live' and p.consent_version like 'daily-2026-10-04.1%')$n$;
 if position(needle in def)=0 then raise exception 'Hybrid inbound priority boundary changed';end if;
 execute replace(def,needle,'public.icash_credit_acquisition_allowed(p_account)');
end $patch$;

-- The authenticated customer's send takes control in the same transaction that
-- queues their message. Automated messages never receive this authorship marker.
alter table public.icash_text_messages add column customer_author_id uuid references auth.users(id);
create function public.icash_customer_authored_text(p_account uuid,p_message uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_text_messages m join public.icash_accounts a on a.id=m.account_id
 where m.id=p_message and a.id=p_account and m.direction='outgoing' and m.customer_author_id=a.owner_user_id)
$$;
create function public.icash_queue_customer_text(p_actor uuid,p_account uuid,p_thread uuid,p_key uuid,p_body text,p_assets uuid[]) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare screening uuid;message uuid;prior public.icash_text_messages;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor for update;
 if not found then raise exception 'Account owner required';end if;
 select d.screening_id into screening from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 where t.id=p_thread and t.account_id=p_account and d.stage not in ('closed','cancelled');
 if screening is null then raise exception 'Lead conversation unavailable';end if;
 select * into prior from public.icash_text_messages where request_key=p_key;
 if found and (prior.account_id<>p_account or prior.customer_author_id is distinct from p_actor) then raise exception 'Message key conflict';end if;
 message:=public.icash_queue_text(p_account,p_thread,p_key,p_body,p_assets);
 if prior.id is null then
  update public.icash_text_messages set customer_author_id=p_actor where id=message and account_id=p_account;
  perform public.icash_set_work_control(p_actor,p_account,'takeover',screening);
 end if;
 return jsonb_build_object('id',message,'manual',exists(select 1 from public.icash_property_controls c join public.icash_screening_jobs s on s.account_id=c.account_id and s.snapshot->>'propertyId'=c.property_id where s.id=screening and s.account_id=p_account and c.manual));
end $$;
do $patch$ declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_claim_text_before_owner_question(uuid,uuid,text)'::regprocedure);
 needle:='public.icash_manual_handoff_reply(p_account,t.id)';
 if (length(def)-length(replace(def,needle,'')))/length(needle)<>1 then raise exception 'Manual text boundary changed';end if;
 def:=replace(def,needle,'(public.icash_manual_handoff_reply(p_account,t.id) or public.icash_customer_authored_text(p_account,p_message))');
 -- A customer's conversation does not expire with yesterday's valuation.
 -- Contact permission, suppression, sender and payment checks still apply.
 needle:=$n$if not found or s.result->'financialCheck'->>'status' is distinct from 'eligible' or s.completed_at is null or s.completed_at>now() or s.completed_at<now()-interval '24 hours' then return null;end if;$n$;
 if position(needle in def)=0 then raise exception 'Customer conversation boundary changed';end if;
 def:=replace(def,needle,$n$if not found then return null;end if;
 if not public.icash_customer_authored_text(p_account,p_message) and (s.result->'financialCheck'->>'status' is distinct from 'eligible' or s.completed_at is null or s.completed_at>now() or s.completed_at<now()-interval '24 hours') then return null;end if;$n$);
 execute def;
end $patch$;

-- A submitted seller email can be contacted before a contract exists, only by
-- the account actually assigned that lead and only within its recorded scope.
alter function public.icash_deal_email_contacts(uuid,uuid) rename to icash_deal_email_contacts_before_leads;
create function public.icash_deal_email_contacts(p_account uuid,p_deal uuid)
returns table(contact_key text,email text,display_name text,party text,verified_until timestamptz)
language sql stable security invoker set search_path='' as $$
 select * from public.icash_deal_email_contacts_before_leads(p_account,p_deal)
 union all
 select 'seller-lead:'||l.id,lower(l.email),l.name,'seller',least(l.data_rights_until,l.created_at+interval '90 days')
 from public.icash_deal_files d join public.icash_seller_matches m on m.account_id=d.account_id and m.screening_id=d.screening_id
 join public.icash_seller_intakes l on l.id=m.lead_id
 where d.account_id=p_account and d.id=p_deal and d.stage not in ('closed','cancelled')
 and l.email_consented and l.email is not null and l.email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
 and l.data_rights_until>now() and l.created_at>now()-interval '90 days'
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=l.phone)
 and not exists(select 1 from public.icash_email_suppressions s where s.account_id=p_account and s.email=lower(l.email))
$$;
revoke all on function public.icash_credit_work_pace(bigint),public.icash_credit_acquisition_allowed(uuid),public.icash_customer_authored_text(uuid,uuid),public.icash_queue_customer_text(uuid,uuid,uuid,uuid,text,uuid[]),public.icash_deal_email_contacts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_credit_work_pace(bigint),public.icash_credit_acquisition_allowed(uuid),public.icash_customer_authored_text(uuid,uuid),public.icash_queue_customer_text(uuid,uuid,uuid,uuid,text,uuid[]),public.icash_deal_email_contacts(uuid,uuid) to service_role;
commit;
