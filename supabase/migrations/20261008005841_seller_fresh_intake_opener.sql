begin;
set local lock_timeout='2s';
-- A new consented form can ask its own ownership question even if an older
-- property's reply was ambiguous. It never resolves or reassigns that old reply.
create function public.icash_fresh_intake_opener_current(p_account uuid,p_thread uuid,p_key uuid,p_body text,p_revision bigint)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_text_threads t
 join public.icash_seller_intakes l on l.id=t.seller_intake_id and l.phone=t.recipient
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 join public.icash_seller_opener_assignments o on o.thread_id=t.id and o.account_id=t.account_id
 join public.icash_sms_routes r on r.sender=t.sender and r.recipient=t.recipient and r.account_id=t.account_id
 join public.icash_customer_identities i on i.account_id=t.account_id
 where t.account_id=p_account and t.id=p_thread and p_key=t.id and t.party='seller' and t.retired_at is null
 and not t.paused and not t.manual_only and t.ai_mode='auto' and d.stage='draft'
 and l.state='assigned' and l.ai_consented and l.created_at between now()-interval '24 hours' and now()
 and public.icash_seller_contact_evidence(p_account,d.screening_id,l.id,t.recipient) is not null
 and public.icash_sms_thread_review_current(p_account,t.id,true)
 and r.revision=p_revision and o.body=p_body
 and p_body=public.icash_seller_recipient_opener(p_account,t.id,case when split_part(trim(l.name),' ',1) ~ '^[A-Za-z][A-Za-z]{0,30}$' then split_part(trim(l.name),' ',1) else null end,trim(i.principal),trim(d.terms->>'address'))
 and not exists(select 1 from public.icash_text_messages m where m.thread_id=t.id and (m.direction='incoming' or m.state in ('dispatching','accepted','delivered')))
 and not exists(select 1 from public.icash_sms_route_reviews q join public.icash_text_messages m on m.id=q.message_id
  where q.sender=t.sender and q.recipient=t.recipient and q.resolved_at is null and m.created_at>=l.created_at));
$$;
revoke all on function public.icash_fresh_intake_opener_current(uuid,uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.icash_fresh_intake_opener_current(uuid,uuid,uuid,text,bigint) to service_role;
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_sms_message_route()'::regprocedure);
 needle:='r.needs_review and not public.icash_seller_clarification_current(new.account_id,new.thread_id,new.request_key,new.body,r.revision)';
 if position(needle in definition)=0 then raise exception 'Fresh intake insert prerequisite changed';end if;
 execute replace(definition,needle,needle||' and not (cardinality(new.asset_ids)=0 and new.attachments=''[]''::jsonb and public.icash_fresh_intake_opener_current(new.account_id,new.thread_id,new.request_key,new.body,r.revision))');
 definition:=pg_get_functiondef('public.icash_sms_message_route_current(uuid,uuid)'::regprocedure);
 needle:=' if r.account_id is distinct from p_account or r.needs_review or m.route_revision is distinct from r.revision then';
 if position(needle in definition)=0 then raise exception 'Fresh intake dispatch prerequisite changed';end if;
 execute replace(definition,needle,$new$ if m.direction='outgoing' and m.state='ready' and cardinality(m.asset_ids)=0 and m.attachments='[]'::jsonb and public.icash_fresh_intake_opener_current(p_account,m.thread_id,m.request_key,m.body,m.route_revision) then return true;end if;
$new$||needle);
end $patch$;
commit;
