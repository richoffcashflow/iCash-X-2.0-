-- Start expired unpaid returns before the first offer, atomically with session
-- creation. The server supplies a bounded offset for the selected Day/Night video.
-- Keep the private RPC signature, preview behavior, locks and historical analytics.
create or replace function public.icash_webinar_begin(p_visitor uuid,p_id uuid,p_config jsonb,p_preview boolean,p_advance_from uuid default null)
returns public.icash_webinar_sessions language plpgsql security invoker set search_path='' as $$
declare s public.icash_webinar_sessions; zone text; target uuid:=(p_config->>'id')::uuid; start_seconds integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_visitor::text||':'||p_preview::text,729));
 select timezone into zone from public.icash_webinar_visitors where id=p_visitor;
 if not found then raise exception 'visitor unavailable';end if;
 if not exists(select 1 from public.icash_webinars w where w.id=target and (p_preview or w.config->>'status'='published')) then raise exception 'session unavailable';end if;
 select h.* into s from public.icash_webinar_sessions h
 where h.visitor_id=p_visitor and h.webinar_id=target and h.completed_at is null and h.superseded_at is null and h.is_preview=p_preview
 and (p_advance_from is null or h.id<>p_advance_from)
 and ((p_preview and timezone(zone,h.updated_at)::date=timezone(zone,now())::date)
   or (not p_preview and h.updated_at>now()-interval '1 hour' and h.updated_at<=now()))
 and (not p_preview or (h.revision=(p_config->>'revision')::integer and coalesce(h.config->>'recordingVersion','day')=coalesce(p_config->>'recordingVersion','day')))
 order by h.created_at desc,h.updated_at desc limit 1;
 if found then return s;end if;
 if not p_preview and p_config->>'parentWebinarId' is null
 and exists(select 1 from public.icash_webinar_sessions h where h.id=p_advance_from
   and h.visitor_id=p_visitor and h.webinar_id=target and not h.is_preview
   and h.updated_at<=now()-interval '1 hour') then
  start_seconds:=greatest(0,least(coalesce((p_config->>'_returnStartSeconds')::integer,0),greatest(0,(p_config->>'durationSeconds')::integer-1)));
 end if;
 -- This control value is never persisted in the public webinar snapshot.
 p_config:=p_config-'_returnStartSeconds';
 update public.icash_webinar_sessions set superseded_at=now() where visitor_id=p_visitor and webinar_id=target and completed_at is null and superseded_at is null and is_preview=p_preview;
 insert into public.icash_webinar_sessions(id,visitor_id,webinar_id,revision,config,is_preview,progress_seconds,max_seconds,watch_position_seconds)
 values(p_id,p_visitor,target,(p_config->>'revision')::integer,p_config,p_preview,start_seconds,start_seconds,start_seconds) returning * into s;
 return s;
end $$;
revoke all on function public.icash_webinar_begin(uuid,uuid,jsonb,boolean,uuid) from public,anon,authenticated;
grant execute on function public.icash_webinar_begin(uuid,uuid,jsonb,boolean,uuid) to service_role;
