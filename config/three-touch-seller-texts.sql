-- Keep the original sender/thread and cap unanswered seller outreach at three
-- texts in total. Current evidence and final sender admission remain mandatory.
set local lock_timeout='3s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$ begin
 if md5(pg_get_functiondef('public.icash_prepare_seller_recovery(uuid,uuid)'::regprocedure))<>'d1e27541c308e6bd859c4f7fdf8ed8f4'
  or md5(pg_get_functiondef('public.icash_seller_text_cadence_current(uuid,uuid,uuid,boolean)'::regprocedure))<>'c008883c7c0b7ca98468e79f4ce9b673'
  or md5(pg_get_functiondef('public.icash_open_seller_gap(uuid,uuid,text,uuid,text,text,timestamptz)'::regprocedure))<>'509419b39d15eba62ced46cef6a8f67a'
  or md5(pg_get_functiondef('public.icash_observe_seller_recovery_text()'::regprocedure))<>'d72b5baca0c9059be65805ff439fbf47'
 then raise exception 'Three-touch seller text prerequisite changed';end if;
end $guard$;
do $patch$
declare d text;old text;
begin
 d:=pg_get_functiondef('public.icash_prepare_seller_recovery(uuid,uuid)'::regprocedure);
 old:=$old$if (select count(*) from public.icash_seller_recovery_attempts where account_id=p_account and thread_id=g.thread_id and assigned_at>now()-interval '7 days')>=3
 or exists(select 1 from public.icash_seller_recovery_attempts where account_id=p_account and thread_id=g.thread_id and (assigned_at>now()-interval '24 hours' or reason=g.reason and assigned_at>now()-interval '7 days')) then$old$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Three-touch reminder preparation changed';end if;
 execute replace(d,old,$new$if ((select count(*) from public.icash_seller_recovery_attempts where account_id=p_account and thread_id=g.thread_id and assigned_at>now()-interval '7 days')>=3
 or exists(select 1 from public.icash_seller_recovery_attempts where account_id=p_account and thread_id=g.thread_id and (assigned_at>now()-interval '24 hours' or reason=g.reason and assigned_at>now()-interval '7 days')))
 and not (g.reason='no_response' and g.stage='draft' and g.source='text'
  and exists(select 1 from icash_seller_recovery_private.unanswered_policy where id=1 and enabled and three_touch_enabled)
  and exists(select 1 from public.icash_text_threads where id=g.thread_id and account_id=p_account and operational_contact_id is not null)
  and (select count(*) from public.icash_seller_recovery_attempts where account_id=p_account and thread_id=g.thread_id)<2
  and not exists(select 1 from public.icash_seller_recovery_attempts a
   left join public.icash_text_messages m on m.id=a.message_id and m.account_id=a.account_id and m.thread_id=a.thread_id
   where a.account_id=p_account and a.thread_id=g.thread_id and
    (a.reason is distinct from 'no_response' or a.delivered_at is null or a.responded_at is not null or a.opted_out_at is not null
     or m.state is distinct from 'delivered' or m.provider_id is null
     or not exists(select 1 from public.icash_operation_spend o where o.operation_key='text:'||m.id and o.account_id=p_account and o.state='settled')))) then$new$);
 d:=pg_get_functiondef('public.icash_seller_text_cadence_current(uuid,uuid,uuid,boolean)'::regprocedure);
 old:='  limit 2';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Three-touch text count changed';end if;
 d:=replace(d,old,'  limit 3');
 old:=' if n=0 then return not p_followup;end if;';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Three-touch text gate changed';end if;
 d:=replace(d,old,old||$new$
 if exists(select 1 from icash_seller_recovery_private.unanswered_policy where id=1 and enabled and three_touch_enabled) then
  if n not in (1,2) or not p_followup then return false;end if;
  -- All previously submitted cold texts must be delivered on this exact thread.
  -- Dispatch time is the cadence anchor; retries never reset it.
  if exists(select 1 from public.icash_text_threads other
   join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
   left join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
   where other.recipient=t.recipient and other.party='seller' and m.direction='outgoing' and m.id is distinct from p_message
    and (m.provider_id is not null or o.dispatched_at is not null)
    and (m.thread_id<>t.id or m.state is distinct from 'delivered' or m.provider_id is null
     or coalesce(o.dispatched_at,m.created_at) is null
     or coalesce(o.dispatched_at,m.created_at)>now()-interval '4 hours')) then return false;end if;
  -- A reply exits cold pursuit even if it was on a different property/account.
  if exists(select 1 from public.icash_text_threads other
   join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
   where other.recipient=t.recipient and other.party='seller' and m.direction='incoming'
    and m.state='received' and (m.provider_id is not null or m.event_id is not null))
   or exists(select 1 from public.icash_live_conversations c where c.contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex')
    and c.party='seller' and c.state='complete' and (public.icash_call_has_seller_response(c.result) or public.icash_seller_call_disposition(c.result) is not null))
   then return false;end if;
  return true;
 end if;
$new$);
 execute d;
 d:=pg_get_functiondef('public.icash_open_seller_gap(uuid,uuid,text,uuid,text,text,timestamptz)'::regprocedure);
 old:='policy.enabled and p_at>=policy.activated_at';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Three-touch text due changed';end if;
 execute replace(d,old,'policy.enabled and (policy.three_touch_enabled or p_at>=policy.activated_at)');
 d:=pg_get_functiondef('public.icash_observe_seller_recovery_text()'::regprocedure);
 old:='if not exists(select 1 from public.icash_seller_recovery_attempts where message_id=new.id) and new.body like ''%?%''';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Three-touch delivery observation changed';end if;
 execute replace(d,old,$new$if ((not exists(select 1 from public.icash_seller_recovery_attempts where message_id=new.id) and new.body like '%?%')
    or (t.operational_contact_id is not null and exists(select 1 from icash_seller_recovery_private.unanswered_policy where id=1 and enabled and three_touch_enabled)
     and exists(select 1 from public.icash_seller_recovery_attempts a where a.message_id=new.id and a.account_id=t.account_id and a.thread_id=t.id and a.reason='no_response')
     and (select count(*) from (select 1 from public.icash_text_threads other
      join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
      where other.recipient=t.recipient and other.party='seller' and m.direction='outgoing' and m.provider_id is not null limit 3) sent)<3))$new$);
end $patch$;
