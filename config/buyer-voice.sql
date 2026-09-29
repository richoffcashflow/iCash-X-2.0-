alter table public.icash_contact_permissions add column buyer_id uuid references public.icash_buyer_profiles(id);
create function public.icash_buyer_voice_context(p_permission uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('dealId',d.id,'address',d.terms->>'address','askingPriceCents',a.asking_price_cents,'repairsCents',a.repairs_cents,'packageId',doc.id)
 from public.icash_contact_permissions p
 join public.icash_buyer_profiles b on b.id=p.buyer_id and b.account_id=p.account_id
 join public.icash_deal_files d on d.screening_id=p.screening_id and d.account_id=p.account_id
 join public.icash_buyer_matches m on m.deal_id=d.id and m.buyer_id=b.id
 join public.icash_disposition_authorities a on a.deal_id=d.id and a.account_id=p.account_id
 join public.icash_signing_envelopes e on e.id=a.purchase_envelope_id and e.deal_id=d.id and e.account_id=p.account_id
 join public.icash_fulfillment_jobs j on j.deal_id=d.id and j.account_id=p.account_id and j.state='complete'
 join public.icash_deal_documents doc on doc.fulfillment_job_id=j.id and doc.kind='buyer_package'
 where p.id=p_permission and p.party='buyer' and p.revoked_at is null and p.permission_until>now()
 and d.stage in ('under_contract','buyer_selected') and e.state='completed' and e.kind='purchase' and not e.test_mode and a.expires_at>now()
 and a.asking_price_cents=(d.terms->>'priceCents')::bigint+(d.terms->>'assignmentFeeCents')::bigint
 and b.criteria->>'permitted'='true'
 and (b.criteria->>'criteriaConfirmedAt')::numeric between extract(epoch from now()-interval '30 days')*1000 and extract(epoch from now())*1000
 and b.criteria->'markets' ? a.market and b.criteria->'propertyTypes' ? a.property_type
 and (b.criteria->>'maxPriceCents')::bigint>=a.asking_price_cents and (b.criteria->>'maxRepairCents')::bigint>=a.repairs_cents
 and exists(select 1 from jsonb_array_elements(coalesce(b.discovery->'phones','[]'::jsonb)) ph where ph->>'number'=p.phone and coalesce((ph->>'doNotCall')::boolean,true)=false)
 order by doc.created_at desc limit 1
$$;
revoke all on function public.icash_buyer_voice_context(uuid) from public,anon,authenticated;
grant execute on function public.icash_buyer_voice_context(uuid) to service_role;
CREATE OR REPLACE FUNCTION public.icash_claim_voice_job(p_job uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_voice_jobs;p public.icash_contact_permissions;c public.icash_voice_configs;prop text;h integer;
begin
 -- Match the ledger lock order so Stop and spending claims serialize.
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job for update;
 if not found or j.state<>'issued' or j.due_at>now() then return false;end if;
 select * into p from public.icash_contact_permissions where id=j.permission_id and account_id=j.account_id for share;
 select * into c from public.icash_voice_configs where account_id=j.account_id for share;
 if p.id is null or not c.enabled or c.reviewed_until<=now() or p.revoked_at is not null or p.permission_until<=now() or not p.dnc_clear or p.dnc_checked_at>now() or p.dnc_checked_at<now()-interval '30 days' then return false;end if;
 if not exists(select 1 from pg_timezone_names where name=p.timezone) then return false;end if;
 h:=extract(hour from now() at time zone p.timezone);
 if h<p.local_start_hour or h>=p.local_end_hour then return false;end if;
 perform 1 from public.icash_accounts where id=j.account_id and not bot_paused for update;if not found then return false;end if;
 if not exists(select 1 from public.icash_wallets where account_id=j.account_id and balance_cents>=reserved_cents and reserved_cents>0) then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(p.contact_key,17));
 if exists(select 1 from public.icash_contact_suppressions where contact_key=p.contact_key) then return false;end if;
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=p.screening_id and account_id=j.account_id and state='complete';
 if prop is null or exists(select 1 from public.icash_property_controls where account_id=j.account_id and property_id=prop and manual) then return false;end if;
 if j.callback_id is not null and not exists(select 1 from public.icash_live_callbacks where id=j.callback_id and account_id=j.account_id and state='pending_dispatch_review' and due_at between now()-interval '15 minutes' and now()) then return false;end if;
 -- Serialize per account and contact. Uncertain dispatches remain held, never auto-retried.
 if exists(select 1 from public.icash_voice_jobs v join public.icash_contact_permissions x on x.id=v.permission_id where v.id<>j.id and (v.state='dispatching' or (v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))) and (v.account_id=j.account_id or x.contact_key=p.contact_key)) then return false;end if;
 if exists(select 1 from public.icash_live_conversations where state in ('waiting','review') and (account_id=j.account_id or contact_key=p.contact_key)) then return false;end if;
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id where o.operation_key='voice:'||j.id and o.account_id=j.account_id and o.rate_id=case when p.party='buyer' then c.buyer_rate_id else c.seller_rate_id end and r.operation=case when p.party='buyer' then 'buyer_call' else 'seller_call' end and r.voice_max_duration_seconds>=c.max_duration_seconds) then return false;end if;
 if p.party='buyer' and public.icash_buyer_voice_context(p.id) is null then return false;end if;
 if not public.icash_claim_operation('voice:'||j.id) then return false;end if;
 update public.icash_voice_jobs set state='dispatching',updated_at=now(),operation_key='voice:'||id where id=j.id;
 return true;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_queue_voice_jobs()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 insert into public.icash_voice_jobs(account_id,permission_id)
 select p.account_id,p.id from public.icash_contact_permissions p join public.icash_voice_configs c on c.account_id=p.account_id and c.enabled join public.icash_accounts a on a.id=p.account_id and not a.bot_paused join public.icash_screening_jobs s on s.id=p.screening_id and s.account_id=p.account_id and s.state='complete'
 where p.revoked_at is null and p.permission_until>now() and p.dnc_clear and s.result->'financialCheck'->>'status'='eligible' and p.party='seller'
 and not exists(select 1 from public.icash_voice_jobs v where v.permission_id=p.id and v.callback_id is null) limit 100
 on conflict do nothing;
 insert into public.icash_voice_jobs(account_id,permission_id)
 select p.account_id,p.id from public.icash_contact_permissions p join public.icash_voice_configs c on c.account_id=p.account_id and c.enabled and c.buyer_rate_id is not null
 join public.icash_accounts a on a.id=p.account_id and not a.bot_paused
 where p.party='buyer' and public.icash_buyer_voice_context(p.id) is not null
 and not exists(select 1 from public.icash_voice_jobs v where v.permission_id=p.id and v.callback_id is null)
 order by p.id limit 5 on conflict do nothing;
 insert into public.icash_voice_jobs(account_id,permission_id,callback_id,due_at)
 select b.account_id,p.id,b.id,b.due_at from public.icash_live_callbacks b join public.icash_live_conversations c on c.id=b.conversation_id join public.icash_contact_permissions p on p.account_id=b.account_id and p.screening_id=b.screening_id and p.contact_key=c.contact_key and p.party=c.party
 where c.state='complete' and (c.result->>'callbackDueAt')::timestamptz=b.due_at and b.state='pending_dispatch_review' and b.due_at>now()-interval '15 minutes' and p.revoked_at is null and p.permission_until>b.due_at and not exists(select 1 from public.icash_voice_jobs v where v.callback_id=b.id) limit 100 on conflict do nothing;
 update public.icash_voice_jobs set state='held',outcome='Callback time passed; review required' where state='ready' and callback_id is not null and due_at<now()-interval '15 minutes';
 update public.icash_live_callbacks b set state='missed' where state='pending_dispatch_review' and due_at<now()-interval '15 minutes';
 -- An expired one-use ticket may be issued again only before provider dispatch was claimed.
 update public.icash_voice_jobs set state='ready' where state='issued' and updated_at<now()-interval '5 minutes';
end $function$
;

