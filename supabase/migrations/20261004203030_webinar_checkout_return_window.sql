-- Skip only the expired session. A concurrent newer session must still resume.
drop function public.icash_webinar_begin(uuid,uuid,jsonb,boolean);
create function public.icash_webinar_begin(p_visitor uuid,p_id uuid,p_config jsonb,p_preview boolean,p_advance_from uuid default null)
returns public.icash_webinar_sessions language plpgsql security invoker set search_path=public as $$
declare s public.icash_webinar_sessions; zone text;
begin
 -- Serialize simultaneous tabs, including tabs which chose different variants.
 perform pg_advisory_xact_lock(hashtextextended(p_visitor::text||':'||p_preview::text,729));
 select timezone into zone from icash_webinar_visitors where id=p_visitor;
 select h.* into s from icash_webinar_sessions h join icash_webinars w on w.id=h.webinar_id
 where h.visitor_id=p_visitor and h.completed_at is null and h.superseded_at is null and h.is_preview=p_preview
 and (p_advance_from is null or h.id<>p_advance_from)
 and timezone(zone,h.updated_at)::date=timezone(zone,now())::date
 and (case when p_preview then h.webinar_id=(p_config->>'id')::uuid and h.revision=(p_config->>'revision')::integer else w.config->>'status'='published' end)
 order by h.updated_at desc limit 1;
 if found then return s;end if;
 if not exists(select 1 from icash_webinars w where w.id=(p_config->>'id')::uuid and (p_preview or w.config->>'status'='published')) then raise exception 'session unavailable';end if;
 update icash_webinar_sessions set superseded_at=now() where visitor_id=p_visitor and completed_at is null and superseded_at is null and is_preview=p_preview
 and (not p_preview or webinar_id=(p_config->>'id')::uuid);
 insert into icash_webinar_sessions(id,visitor_id,webinar_id,revision,config,is_preview)
 values(p_id,p_visitor,(p_config->>'id')::uuid,(p_config->>'revision')::integer,p_config,p_preview) returning * into s;
 return s;
end $$;

revoke all on function public.icash_webinar_begin(uuid,uuid,jsonb,boolean,uuid) from public,anon,authenticated;
grant execute on function public.icash_webinar_begin(uuid,uuid,jsonb,boolean,uuid) to service_role;
