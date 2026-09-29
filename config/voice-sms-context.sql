-- Preserve the exact bounded text context supplied to a call for audit and support.
alter table public.icash_voice_jobs add column sms_context jsonb;
create function public.icash_voice_sms_context(p_account uuid,p_permission uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('threadId',t.id,'messages',(
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'direction',m.direction,'body',left(m.body,1000),'at',m.created_at) order by m.created_at,m.id),'[]'::jsonb)
  from (select m.id,m.direction,m.body,m.created_at from public.icash_text_messages m
   where m.account_id=p_account and m.thread_id=t.id
    and (m.direction='incoming' and m.state='received' or m.direction='outgoing' and m.state in ('accepted','delivered'))
    and m.created_at>=now()-interval '30 days'
   order by m.created_at desc,m.id desc limit 12) m
 ))
 from public.icash_contact_permissions p
 join public.icash_deal_files d on d.screening_id=p.screening_id and d.account_id=p.account_id
 join public.icash_text_threads t on t.deal_id=d.id and t.account_id=p.account_id and t.recipient=p.phone and t.party=p.party
 where p.id=p_permission and p.account_id=p_account and p.party='seller'
  and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
 order by t.id limit 1
$$;
revoke all on function public.icash_voice_sms_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_voice_sms_context(uuid,uuid) to service_role;
