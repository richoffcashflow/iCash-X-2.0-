begin;
-- Private, bounded diagnostics for a claimed support turn. A visitor's email
-- is a lookup hint, never proof of identity; these findings are operator-only.
alter table public.icash_access_help_messages add column access_investigation jsonb;

create function public.icash_access_help_investigate(p_id uuid,p_key uuid,p_token uuid,p_email_ready boolean,p_phone_ready boolean,p_recovery text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.icash_access_help_requests; m public.icash_access_help_messages;
 sender_ready boolean; paid_match boolean; welcome jsonb; challenge jsonb; snapshot jsonb;
begin
 if p_email_ready is null or p_phone_ready is null or p_recovery is null or p_recovery not in ('checked','unavailable') then raise exception 'Invalid investigation';end if;
 select * into r from public.icash_access_help_requests where id=p_id for update;
 if not found or r.expires_at<=now() or r.status in ('resolved','closed') then return null;end if;
 select * into m from public.icash_access_help_messages where request_id=p_id and request_key=p_key and role='user' for update;
 if not found or p_token is null or m.reply_token is distinct from p_token or m.reply_completed_at is not null
 or m.reply_claimed_at is null or m.reply_claimed_at<=now()-interval '1 minute' then return null;end if;
 if exists(select 1 from public.icash_access_help_messages newer where newer.request_id=p_id and newer.role in ('user','operator') and (newer.created_at,newer.id)>(m.created_at,m.id)) then return null;end if;
 select exists(select 1 from public.icash_webinar_text_senders where enabled) into sender_ready;
 select exists(select 1 from public.icash_memberships membership
 where membership.mode='live' and lower(membership.payer_email)=lower(r.email)
 and exists(select 1 from public.icash_membership_invoices invoice where invoice.membership_id=membership.id and invoice.amount_cents>0)) into paid_match;
 select jsonb_build_object('status',e.status,'delivery',e.delivery,'recordedAt',e.updated_at) into welcome
 from public.icash_purchase_access_emails e join public.icash_memberships membership on membership.id=e.membership_id
 where membership.mode='live' and lower(membership.payer_email)=lower(r.email) and lower(e.recipient)=lower(r.email)
 order by e.created_at desc,e.id desc limit 1;
 select jsonb_build_object('status',c.status,'hasReceipt',c.provider_id is not null,'requestedAt',c.requested_at) into challenge
 from public.icash_purchase_phone_challenges c join public.icash_memberships membership on membership.id=c.membership_id
 where membership.mode='live' and lower(c.email)=lower(r.email) and (r.phone is null or c.phone=r.phone)
 and c.requested_at>now()-interval '7 days' order by c.requested_at desc,c.id desc limit 1;
 snapshot:=jsonb_build_object('checkedAt',now(),'recovery',p_recovery,'emailConfigured',p_email_ready,
  'textConfigured',p_phone_ready,'textSenderAvailable',sender_ready,'receiptEmailMatch',paid_match,
  'purchaseEmail',welcome,'phoneChallenge',challenge,'emailCodeDelivery','unverified');
 update public.icash_access_help_messages set access_investigation=snapshot where id=m.id;
 -- Neither account existence nor destination/delivery records leave the private
 -- audit. Welcome-email delivery is NOT evidence that an Auth OTP was delivered.
 return jsonb_build_object('checked',true,'email',case when p_email_ready then 'configured' else 'unavailable' end,
  'phone',case when p_phone_ready and sender_ready then 'configured' else 'unavailable' end);
end $$;
revoke all on function public.icash_access_help_investigate(uuid,uuid,uuid,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.icash_access_help_investigate(uuid,uuid,uuid,boolean,boolean,text) to service_role;

-- Keep the case's earlier failed steps and operator findings through longer
-- conversations. Preserve lease, status, ordering and concurrent-reply guards.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.icash_access_help_claim_reply(uuid,uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,'limit 20','')))/length('limit 20')<>1 then raise exception 'Unexpected support claim definition';end if;
 execute replace(definition,'limit 20','limit 200');
end $$;
commit;
