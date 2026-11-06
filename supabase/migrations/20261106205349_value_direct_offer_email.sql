-- A seller asking for an offer by email counts only inside an evidenced sale
-- conversation. Keep the destination in its original private thread.
begin;
set local lock_timeout='3s';
create function icash_work_private.value_email_offer(p_body text) returns boolean
language sql immutable security invoker set search_path='' as $function$
 select length(trim(p_body))<=350 and lower(trim(p_body)) ~
  '^(please )?(send|email) (your|an?|the) (cash |written )?offer (to|at) [a-z0-9._%+-]+@[a-z0-9.-]+[.][a-z]{2,}[.! ]*$'
$function$;
revoke all on function icash_work_private.value_email_offer(text) from public,anon,authenticated;
grant execute on function icash_work_private.value_email_offer(text) to service_role;

do $patch$
declare def text:=pg_get_functiondef('icash_work_private.value_sellers(uuid,timestamptz,timestamptz)'::regprocedure);
 old_class text:='and case when icash_work_private.value_offer_request(m.body) then true';
 old_quote text:='m.id,t.id,m.created_at,left(m.body,240)';
begin
 if (length(def)-length(replace(def,old_class,'')))/length(old_class)<>1 or (length(def)-length(replace(def,old_quote,'')))/length(old_quote)<>1
  then raise exception 'Seller evidence prerequisite changed'; end if;
 def:=replace(def,old_class,$class$and case when icash_work_private.value_offer_request(m.body) then true
     when icash_work_private.value_email_offer(m.body) then coalesce((
      select prev.body ~* '\m(own|owner|selling|sell|cash offer|offer on)\M'
      from public.icash_text_messages prev where prev.account_id=m.account_id and prev.thread_id=m.thread_id
       and prev.direction='outgoing' and prev.state in ('accepted','delivered') and nullif(prev.provider_id,'') is not null
       and prev.created_at<m.created_at order by prev.created_at desc,prev.id desc limit 1),false)$class$);
 execute replace(def,old_quote,$quote$m.id,t.id,m.created_at,case when icash_work_private.value_email_offer(m.body)
    then left(regexp_replace(trim(m.body),'[^[:space:]@]+@[^[:space:]@]+','[email]','g'),240) else left(m.body,240) end$quote$);
end $patch$;
commit;
