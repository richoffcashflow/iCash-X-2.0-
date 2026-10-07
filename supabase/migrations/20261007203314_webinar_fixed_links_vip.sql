-- Main and VIP recordings have independent permanent links and saved revisions.
alter table public.icash_webinars
 add column parent_webinar_id uuid references public.icash_webinars(id),
 add constraint icash_webinar_no_self_parent check(parent_webinar_id is distinct from id);
create unique index icash_webinar_one_vip on public.icash_webinars(parent_webinar_id) where parent_webinar_id is not null;
alter table public.icash_memberships add column post_purchase_webinar_id uuid references public.icash_webinars(id);
create index icash_membership_post_purchase_webinar on public.icash_memberships(post_purchase_webinar_id) where post_purchase_webinar_id is not null;

-- Both links are created in one transaction; retrying a create does not duplicate them.
create function public.icash_webinar_create_pair(p_main jsonb,p_vip jsonb)
returns setof public.icash_webinars language plpgsql security invoker set search_path='' as $$
declare parent_id uuid:=(p_main->>'id')::uuid; child_id uuid:=(p_vip->>'id')::uuid;
begin
 if parent_id is null or child_id is null or parent_id=child_id or p_vip->>'status' is distinct from 'draft' then raise exception 'Invalid webinar pair';end if;
 perform pg_advisory_xact_lock(hashtextextended(parent_id::text,741));
 if exists(select 1 from public.icash_webinars where id=parent_id and parent_webinar_id is not null) then raise exception 'VIP sessions cannot have another VIP';end if;
 insert into public.icash_webinars(id,revision,config) values(parent_id,1,(p_main-'publicCode'-'parentWebinarId')||'{"revision":1,"intelligenceEnabled":false}'::jsonb) on conflict(id) do nothing;
 if not exists(select 1 from public.icash_webinars where parent_webinar_id=parent_id) then
  insert into public.icash_webinars(id,revision,config,parent_webinar_id) values(child_id,1,(p_vip-'publicCode'-'parentWebinarId')||'{"revision":1,"intelligenceEnabled":false}'::jsonb,parent_id);
 end if;
 return query select * from public.icash_webinars where id=parent_id or parent_webinar_id=parent_id order by public_code;
end $$;
revoke all on function public.icash_webinar_create_pair(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.icash_webinar_create_pair(jsonb,jsonb) to service_role;

-- Retain historical experiment data, but an old client cannot turn routing back on.
update public.icash_webinar_settings set config=jsonb_set(config,'{optimizer,enabled}','false'::jsonb),updated_at=now();
create function public.icash_webinar_fixed_routing() returns trigger language plpgsql set search_path='' as $$
begin
 new.config:=jsonb_set(new.config,'{optimizer}',coalesce(new.config->'optimizer','{}'::jsonb)||'{"enabled":false}'::jsonb);
 return new;
end $$;
revoke all on function public.icash_webinar_fixed_routing() from public,anon,authenticated;
create trigger icash_webinar_fixed_routing before insert or update of config on public.icash_webinar_settings
 for each row execute function public.icash_webinar_fixed_routing();
