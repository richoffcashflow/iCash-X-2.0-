begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.icash_screening_wrong_number(p_account uuid,p_screening uuid,p_after timestamptz) returns boolean
language sql stable set search_path='' as $$
 select p_after is not null and (
  exists(select 1 from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id
   join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
   where d.account_id=p_account and d.screening_id=p_screening and t.party='seller'
    and m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)
    and m.created_at between p_after and now() and public.icash_seller_wrong_number(m.body))
  or exists(select 1 from public.icash_live_conversations c
   cross join lateral jsonb_array_elements(case when jsonb_typeof(c.result->'transcript')='array' then c.result->'transcript' else '[]'::jsonb end) t
   where c.account_id=p_account and c.screening_id=p_screening and c.party='seller' and c.state='complete' and c.conversation_id is not null
    and c.completed_at between p_after and now() and t->>'role'='user' and public.icash_seller_wrong_number(t->>'message')))
$$;
revoke all on function public.icash_screening_wrong_number(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.icash_screening_wrong_number(uuid,uuid,timestamptz) to service_role;
do $patch$
declare d text;needle text;name text;
begin
 foreach name in array array['icash_discovery_filter_feedback','icash_targeting_feedback'] loop
  d:=pg_get_functiondef(('public.'||name||'(uuid,text)')::regprocedure);
  needle:='first_attempt.at is not null attempted,';
  if strpos(d,needle)=0 then raise exception 'Feedback attempt boundary changed: %',name;end if;
  d:=replace(d,needle,'public.icash_screening_wrong_number(a.account_id,a.screening_id,first_attempt.at) wrong_number,'||needle);
  needle:=$n$'interested',f.interested,'optedOut',f.opted_out,$n$;
  if strpos(d,needle)=0 then raise exception 'Feedback output boundary changed: %',name;end if;
  d:=replace(d,needle,needle||$n$'wrongNumbers',f.wrong_numbers,$n$);
  d:=replace(d,'attempted and not mature and not interested and not opted_out','attempted and not mature and (not interested or wrong_number) and not opted_out');
  needle:='count(*) filter(where attempted and interested) interested,';
  if strpos(d,needle)=0 then raise exception 'Feedback count boundary changed: %',name;end if;
  execute replace(d,needle,'count(*) filter(where attempted and wrong_number) wrong_numbers,count(*) filter(where attempted and interested and not wrong_number) interested,');
 end loop;
 d:=pg_get_functiondef('public.icash_targeting_learning_evidence(uuid,text,uuid)'::regprocedure);
 needle:='first_attempt.at attempted_at,';
 if strpos(d,needle)=0 then raise exception 'Learning attempt boundary changed';end if;
 d:=replace(d,needle,needle||'public.icash_screening_wrong_number(a.account_id,a.screening_id,first_attempt.at) wrong_number,');
 needle:=$n$'interested',f.interested,'optedOut',f.opted_out,$n$;
 if strpos(d,needle)=0 then raise exception 'Learning output boundary changed';end if;
 d:=replace(d,needle,needle||$n$'wrongNumbers',f.wrong_numbers,$n$);
 needle:=$n$count(*) filter(where attempted_at is not null and opted_out) opted_out,$n$;
 if strpos(d,needle)=0 then raise exception 'Learning count boundary changed';end if;
 d:=replace(d,needle,needle||'count(*) filter(where attempted_at is not null and wrong_number) wrong_numbers,');
 needle:=$n$and not opted_out) interested,$n$;
 if strpos(d,needle)=0 then raise exception 'Learning interest boundary changed';end if;
 execute replace(d,needle,'and not opted_out and not wrong_number) interested,');
end $patch$;
alter function public.icash_targeting_report(uuid) rename to icash_targeting_report_before_list_quality;
create function public.icash_targeting_report(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare report jsonb;
begin
 report:=public.icash_targeting_report_before_list_quality(p_actor);
 return report||jsonb_build_object('listQuality',(select jsonb_build_object('enabled',enabled,'activatedAt',activated_at)
  from icash_research_private.list_quality_settings where id=1));
end $$;
revoke all on function public.icash_targeting_report_before_list_quality(uuid),public.icash_targeting_report(uuid) from public,anon,authenticated;
grant execute on function public.icash_targeting_report(uuid) to service_role;
commit;
