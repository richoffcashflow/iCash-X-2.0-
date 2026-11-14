-- Additive correction before first checkpoint activation. No operation changes.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 perform 1 from icash_work_private.followup_step_policy where id=1 for update;
 if not exists(select 1 from icash_work_private.followup_step_policy where id=1 and not enabled and activated_at is null)
  or exists(select 1 from icash_work_private.followup_step_attempts)
  or md5(pg_get_functiondef('public.icash_account_followup_context(uuid,uuid)'::regprocedure))<>'4224ae2955abd6e8652294c4167d6ef5'
  or md5(pg_get_functiondef('public.icash_claim_followup_step(uuid,uuid,text)'::regprocedure))<>'795df64cb9eb0a99b07850a8ac3332db'
  or md5(pg_get_functiondef('public.icash_finish_followup_step(uuid,uuid,text,uuid,boolean,jsonb)'::regprocedure))<>'fd75e1c997c061f2e914a4e2ed1817f4'
  or md5(pg_get_functiondef('icash_work_private.activate_followup_steps(text)'::regprocedure))<>'6f99430a78ac7cf85c890ecc41e2ee51'
 then raise exception 'Pending-original checkpoint prerequisite changed';end if;
end$$;
create function public.icash_account_followup_pending(p_account uuid,p_ticket uuid,p_step text) returns boolean
language sql stable security invoker set search_path='' set statement_timeout='3s' as $$
 select case when p_step in ('estimates','voice_receipts') then exists(
  select 1 from public.icash_operation_spend o
  left join public.icash_operation_rates r on r.id=o.rate_id
  where o.account_id=p_account and o.state in ('reserved','dispatched')
   and (r.operation is null or ((r.operation in ('seller_call','buyer_call','incoming_call'))=(p_step='voice_receipts')))
 ) end
 from icash_work_private.account_followups q
 join public.icash_automation_tickets t on t.id=q.ticket_id and t.account_id=q.account_id
 where q.account_id=p_account and q.ticket_id=p_ticket and q.lease_until>clock_timestamp()
  and t.kind='account_reconcile' and t.state='consumed';
$$;
revoke all on function public.icash_account_followup_pending(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_account_followup_pending(uuid,uuid,text) to service_role;
alter table icash_work_private.followup_step_policy add column pending_hash text not null default '';
update icash_work_private.followup_step_policy set pending_hash=md5(pg_get_functiondef('public.icash_account_followup_pending(uuid,uuid,text)'::regprocedure));
do $$declare d text;needle text:='if not found or p.context_hash';begin
 d:=pg_get_functiondef('icash_work_private.activate_followup_steps(text)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Pending-original activation boundary changed';end if;
 execute replace(d,needle,'if not found or p.pending_hash<>md5(pg_get_functiondef(''public.icash_account_followup_pending(uuid,uuid,text)''::regprocedure)) or p.context_hash');
end$$;
