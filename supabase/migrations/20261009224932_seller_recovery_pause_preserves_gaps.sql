begin;
set local lock_timeout='3s';
create or replace function public.icash_prepare_seller_recovery(p_account uuid,p_gap uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare g public.icash_seller_gaps;v public.icash_seller_recovery_variants;mid uuid;bucket integer;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into g from public.icash_seller_gaps where id=p_gap and account_id=p_account for update;
 if not found or g.state<>'open' or g.due_at>now() or g.expires_at<=now() or g.outgoing_id is not null then return null;end if;
 -- A release/operator pause is temporary, not evidence that the seller needs review.
 if not exists(select 1 from public.icash_seller_recovery_variants where reason=g.reason and enabled) then return null;end if;
 perform 1 from public.icash_text_threads where id=g.thread_id and account_id=p_account for update;
 if not public.icash_seller_recovery_current(g.id) then return null;end if;
 if (select count(*) from public.icash_seller_recovery_attempts where account_id=p_account and thread_id=g.thread_id and assigned_at>now()-interval '7 days')>=3
 or exists(select 1 from public.icash_seller_recovery_attempts where account_id=p_account and thread_id=g.thread_id and (assigned_at>now()-interval '24 hours' or reason=g.reason and assigned_at>now()-interval '7 days')) then
  update public.icash_seller_gaps set state='needs_review',updated_at=now() where id=g.id;return null;
 end if;
 bucket:=((('x'||substr(md5(g.id::text),1,7))::bit(28)::integer)%10000);
 select variants.* into v from public.icash_seller_recovery_variants variants where enabled and key=coalesce(
  (select variant from public.icash_seller_recovery_attempts where account_id=p_account and deal_id=g.deal_id and reason=g.reason and stage=g.stage and source_channel=g.channel order by assigned_at,gap_id limit 1),
  public.icash_choose_seller_recovery(p_account,g.reason,g.stage,g.channel,bucket));
 if not found then update public.icash_seller_gaps set state='needs_review',updated_at=now() where id=g.id;return null;end if;
 mid:=public.icash_queue_text(p_account,g.thread_id,g.id,v.body,'{}');if mid is null then return null;end if;
 update public.icash_seller_gaps set state='queued',outgoing_id=mid,updated_at=now() where id=g.id;
 insert into public.icash_seller_recovery_attempts(gap_id,account_id,deal_id,thread_id,variant,reason,stage,source_channel,message_id)
 values(g.id,p_account,g.deal_id,g.thread_id,v.key,g.reason,g.stage,g.channel,mid);
 return mid;
end $$;
commit;
