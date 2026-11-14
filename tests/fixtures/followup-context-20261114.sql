CREATE OR REPLACE FUNCTION public.icash_account_followup_context(p_account uuid, p_ticket uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('notify',q.claimed_notify_version>q.notified_version)
 from icash_work_private.account_followups q
 join public.icash_automation_tickets t on t.id=q.ticket_id and t.account_id=q.account_id
 where q.account_id=p_account and q.ticket_id=p_ticket and q.lease_until>clock_timestamp()
  and t.kind='account_reconcile' and t.state='consumed';
$function$
;
