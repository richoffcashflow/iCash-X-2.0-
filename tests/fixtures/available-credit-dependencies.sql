-- Current production dependency definitions; schema only, no customer data.
CREATE OR REPLACE FUNCTION public.icash_customer_text_operation(p_account uuid, p_operation text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.icash_text_messages m join public.icash_accounts a on a.id=m.account_id
 where m.account_id=p_account and 'text:'||m.id=p_operation and m.customer_author_id=a.owner_user_id and m.direction='outgoing' and m.state in ('ready','dispatching')
 and not exists(select 1 from public.icash_text_ai_jobs j where j.outgoing_id=m.id));
$function$
;

CREATE OR REPLACE FUNCTION public.icash_general_reception_pause_exempt(p_account uuid, p_operation text, p_charge bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from icash_reception_private.receipts r
 join icash_reception_private.config c on c.id=1 and c.account_id=r.account_id
 join public.icash_operation_rates rate on rate.id=c.rate_id
 where p_account=c.account_id and r.operation_key=p_operation
  and r.operation_key='reception:'||r.call_sid and r.admission_xid=txid_current()
  and r.state='reserved' and r.conversation_id is null and r.config_hash=c.config_hash
  and r.agent_id=c.agent_id and r.branch_id=c.branch_id and r.reviewed_version_id=c.reviewed_version_id
  and c.enabled and c.allow_inbound_while_paused and c.inbound_pause_approval_reference is not null
  and r.call_profile=c.call_profile and r.rate_id=c.rate_id
  and r.max_duration_seconds=c.max_duration_seconds and r.customer_charge_cap_cents=c.customer_charge_cap_cents
  and (c.call_profile='normal' or (c.call_profile='owner_quick_test' and c.owner_quick_test_enabled
   and c.owner_quick_test_approval_reference is not null and r.caller_hash=c.owner_caller_hash))
  and c.approved_at<=clock_timestamp()
  and c.reviewed_until>=clock_timestamp()+make_interval(secs=>c.max_duration_seconds+60)
  and rate.operation='incoming_call' and rate.enabled and rate.charge_cents=c.customer_charge_cap_cents
  and p_charge=c.customer_charge_cap_cents and rate.voice_max_duration_seconds=c.max_duration_seconds
  and rate.verified_at<=clock_timestamp()
  and rate.expires_at>=clock_timestamp()+make_interval(secs=>c.max_duration_seconds+60)
  and (not exists(select 1 from public.icash_operation_spend o where o.operation_key=p_operation)
   or exists(select 1 from public.icash_operation_spend o where o.operation_key=p_operation
    and o.account_id=c.account_id and o.rate_id=c.rate_id and o.charge_cap_cents=c.customer_charge_cap_cents)));

$function$
;

CREATE OR REPLACE FUNCTION public.icash_membership_work_allowed(p_account uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.icash_accounts a where a.id=p_account and (a.billing_model<>'membership_credits' or exists(select 1 from public.icash_memberships m where m.account_id=a.id and m.mode='live' and m.state='active' and m.paid_through>now())))
$function$
;

CREATE OR REPLACE FUNCTION public.icash_spending_day(p_clock timestamp with time zone DEFAULT now())
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select (p_clock at time zone 'America/Chicago')::date $function$
;

CREATE OR REPLACE FUNCTION public.icash_vip_active(p_account uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.icash_memberships m where m.account_id=p_account and m.mode='live' and m.state='active' and m.paid_through>now() and m.vip_until>now());
$function$
;
