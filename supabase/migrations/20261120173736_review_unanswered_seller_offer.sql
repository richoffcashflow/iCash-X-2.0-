-- Record an unresolved explicit request as a review task on its original deal.
create function icash_reliability_private.review_unanswered_seller_offer(p_call uuid)
returns uuid language plpgsql security definer set search_path='' as $fn$
declare c public.icash_live_conversations;threads uuid[];quote text;
begin
 select * into c from public.icash_live_conversations where id=p_call
  and party='seller' and state='complete' and operation_key like 'voice:%'
  and completed_at between now()-interval '7 days' and now();
 if not found or c.result->>'contactEvidence' is distinct from 'human_response'
  or c.result->>'callbackStatus' is distinct from 'not_requested' or c.result->>'responseDisposition' is not null
  or c.result->'optedOut' is distinct from 'false'::jsonb or c.result->'humanRequested' is distinct from 'false'::jsonb
  or jsonb_typeof(c.result->'transcript') is distinct from 'array' then return null;end if;
 select x->>'message' into quote from jsonb_array_elements(c.result->'transcript') with ordinality q(x,n)
 where x->>'role'='user' and (x->>'message'=c.result->>'offerRequestQuote'
  or x->>'message' ~* '^\s*(?:how much is (?:the|your) (?:cash )?offer|(?:can|could|would|will) you (?:please )?tell (?:me|us) (?:the|your) (?:cash )?offer)[?!. ]*$')
 order by n desc limit 1;
 if quote is null or not public.icash_call_has_seller_response(c.result)
  or exists(select 1 from jsonb_array_elements(c.result->'transcript') x where x->>'role'='agent'
   and x->>'message' ~* '[$]|[0-9][0-9,]{3,}|(thousand|hundred|grand|dollars)\M')
  or public.icash_seller_gap_reason(c.result->'transcript',false) is not null then return null;end if;
 select array_agg(t.id) into threads from public.icash_text_threads t
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id and d.screening_id=c.screening_id
 where t.account_id=c.account_id and t.party='seller' and t.retired_at is null
  and encode(sha256(convert_to(t.recipient,'UTF8')),'hex')=c.contact_key;
 if cardinality(threads) is distinct from 1 then return null;end if;
 if not exists(select 1 from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  where t.id=threads[1] and not t.paused and d.stage='draft' and d.seller_signed_at is null
   and not exists(select 1 from public.icash_text_suppressions s where s.phone=t.recipient))
  or exists(select 1 from public.icash_live_conversations l where l.account_id=c.account_id and l.screening_id=c.screening_id
   and l.contact_key=c.contact_key and l.completed_at>c.completed_at)
  or exists(select 1 from public.icash_text_messages m where m.thread_id=threads[1] and m.account_id=c.account_id
   and m.created_at>c.completed_at and (m.direction='incoming' or m.body ~* '[$]|offer|price|thousand|hundred|dollars'))
  or exists(select 1 from public.icash_seller_gaps g where g.thread_id=threads[1] and g.account_id=c.account_id
   and g.state in ('needs_review','suppressed')) then return null;end if;
 return public.icash_open_seller_gap(c.account_id,threads[1],'call',c.id,'material_facts',quote,c.completed_at);
end $fn$;
revoke all on function icash_reliability_private.review_unanswered_seller_offer(uuid) from public,anon,authenticated,service_role;

do $patch$
declare src text:=pg_get_functiondef('public.icash_capture_seller_call_gap()'::regprocedure);
begin
 if md5(src)<>'e03af3a4fd2c4a0cea574ff2a28caf00' then raise exception 'Seller call gap predecessor changed'; end if;
 src:=replace(src,' perform public.icash_open_seller_gap(new.account_id,ids[1],source,source_id,reason,quote,at_time);',
 ' perform public.icash_open_seller_gap(new.account_id,ids[1],source,source_id,reason,quote,at_time);
 if source=''call'' and reason is null then perform icash_reliability_private.review_unanswered_seller_offer(source_id);end if;');
 execute src;
end $patch$;

do $recent$
declare candidate uuid;
begin
 for candidate in select l.id from public.icash_live_conversations l where l.completed_at between now()-interval '48 hours' and now()
  and l.party='seller' and l.state='complete' and exists(select 1 from jsonb_array_elements(l.result->'transcript') x
   where x->>'role'='user' and x->>'message' ~* '(how much is the (cash )?offer|could you tell me the (cash )?offer)')
 loop perform icash_reliability_private.review_unanswered_seller_offer(candidate);end loop;
end $recent$;
