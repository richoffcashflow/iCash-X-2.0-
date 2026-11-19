CREATE OR REPLACE FUNCTION public.icash_auto_recharge_allowed(p_attempt uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.icash_auto_recharge_attempts t join public.icash_auto_recharges r using(account_id,mode) join public.icash_accounts a on a.id=t.account_id
 where t.id=p_attempt and t.state='pending' and r.enabled and r.approved_order=t.approved_order and not a.bot_paused and public.icash_membership_work_allowed(a.id)
 and not exists(select 1 from public.icash_billing_reviews where account_id=a.id and resolved_at is null)
 and not exists(select 1 from public.icash_daily_plans where account_id=a.id and mode=t.mode and state<>'stopped'));
$function$;
CREATE OR REPLACE FUNCTION public.icash_claim_auto_recharge(p_account uuid, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.icash_auto_recharges;t public.icash_auto_recharge_attempts;o public.icash_funding_orders;oid uuid:=gen_random_uuid();available bigint;
begin
 select * into r from public.icash_auto_recharges where account_id=p_account and mode=p_mode for update;
 if not found then return null;end if;
 select * into t from public.icash_auto_recharge_attempts where account_id=p_account and mode=p_mode and state='pending' for update;
 if found then
  if t.lease_until>now() then return null;end if;
  update public.icash_auto_recharge_attempts set lease_until=now()+interval '3 minutes' where id=t.id;
  return to_jsonb(t);
 end if;
 if not r.enabled or r.approved_order is null or r.last_attempt_at>now()-interval '24 hours'
 or not public.icash_membership_work_allowed(p_account)
 or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused)
 or exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null)
 or exists(select 1 from public.icash_daily_plans where account_id=p_account and mode=p_mode and state<>'stopped') then return null;end if;
 select case when p_mode='live' then balance_cents-reserved_cents else 100000 end into available from public.icash_wallets where account_id=p_account;
 if available is null or available>=500 then return null;end if;
 select * into strict o from public.icash_funding_orders where id=r.approved_order and state='paid';
 insert into public.icash_funding_orders(id,mode,guest_hash,account_id,pack_code,price_cents,credit_cents,run_days,flexible_pacing)
 values(oid,p_mode,repeat(md5(oid::text),2),p_account,o.pack_code,r.amount_cents,r.amount_cents,1,true);
 insert into public.icash_auto_recharge_attempts(account_id,mode,order_id,approved_order,amount_cents,stripe_customer_id,stripe_payment_method_id,lease_until)
 values(p_account,p_mode,oid,r.approved_order,r.amount_cents,r.stripe_customer_id,r.stripe_payment_method_id,now()+interval '3 minutes') returning * into t;
 update public.icash_auto_recharges set last_attempt_at=now() where account_id=p_account and mode=p_mode;
 return to_jsonb(t);
end $function$;
CREATE OR REPLACE FUNCTION public.icash_due_auto_recharges(p_mode text)
 RETURNS TABLE(account_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select candidates.account_id from (
  select t.account_id,t.created_at as due from public.icash_auto_recharge_attempts t where t.mode=p_mode and t.state='pending' and (t.lease_until is null or t.lease_until<=now())
  union
  select r.account_id,coalesce(r.last_attempt_at,'epoch'::timestamptz) from public.icash_auto_recharges r join public.icash_wallets w on w.account_id=r.account_id join public.icash_accounts a on a.id=r.account_id
  where r.mode=p_mode and r.enabled and not a.bot_paused and w.balance_cents-w.reserved_cents<500 and (r.last_attempt_at is null or r.last_attempt_at<=now()-interval '24 hours')
  and public.icash_membership_work_allowed(a.id) and not exists(select 1 from public.icash_billing_reviews where account_id=a.id and resolved_at is null)
 ) candidates order by due limit 20;
$function$;
CREATE OR REPLACE FUNCTION public.icash_settle_auto_recharge(p_attempt uuid, p_payment text, p_amount bigint, p_customer text, p_method text, p_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_auto_recharge_attempts;o public.icash_funding_orders;funded bigint;
begin
 select * into strict t from public.icash_auto_recharge_attempts where id=p_attempt for update;
 if t.mode is distinct from p_mode or p_payment is null or p_payment !~ '^pi_[A-Za-z0-9]+$' or t.amount_cents is distinct from p_amount or t.stripe_customer_id is distinct from p_customer or t.stripe_payment_method_id is distinct from p_method or (t.stripe_payment_id is not null and t.stripe_payment_id<>p_payment) then raise exception 'Auto recharge payment mismatch';end if;
 select * into strict o from public.icash_funding_orders where id=t.order_id for update;
 if o.credited_at is null then
  update public.icash_funding_orders set state='paid',stripe_payment_id=p_payment,paid_at=now(),charged_total_cents=p_amount,credited_at=now(),payer_email=(select payer_email from public.icash_funding_orders where id=t.approved_order) where id=o.id;
  if p_mode='live' then perform public.icash_post_credit(t.account_id,'stripe-funding:'||o.id,'purchase',o.credit_cents,p_payment);end if;
 end if;
 update public.icash_auto_recharge_attempts set state='paid',stripe_payment_id=p_payment,lease_until=null where id=t.id;
 -- Grow the already-authorized work cap; never undo a pause or cancellation.
 if p_mode='live' then
  select coalesce(sum(credit_cents),0)+public.icash_authorized_grant_cents(t.account_id) into funded from public.icash_funding_orders where account_id=t.account_id and mode='live' and state='paid' and credited_at is not null;
  update public.icash_spend_activations set customer_cap_cents=funded where account_id=t.account_id and enabled;
 end if;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_lifecycle_frequency_ok(p_channel text, p_recipient text, p_update uuid DEFAULT NULL::uuid, p_followup uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select count(*)<case when p_channel='sms' then 1 else 2 end and not coalesce(bool_or(at>now()-interval '1 hour'),false) from (
 select authorized_at at from public.icash_customer_update_deliveries where channel=p_channel and recipient=p_recipient and id is distinct from p_update and authorized_at>now()-interval '24 hours'
 union all select coalesce(sent_at,first_attempt_at) from public.icash_webinar_outbox where channel=p_channel and recipient=p_recipient and id is distinct from p_followup and (sent_at>now()-interval '24 hours' or state in ('sending','unknown') and first_attempt_at>now()-interval '24 hours')
 ) deliveries;
$function$;
