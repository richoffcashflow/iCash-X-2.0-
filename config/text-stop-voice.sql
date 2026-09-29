create function public.icash_text_stop_voice() returns trigger language plpgsql set search_path='' as $$
begin
 update public.icash_contact_permissions set revoked_at=coalesce(revoked_at,now()) where phone=new.phone;
 update public.icash_voice_jobs j set state='held',outcome='Contact opted out',updated_at=now() from public.icash_contact_permissions p where j.permission_id=p.id and p.phone=new.phone and j.state='ready';
 update public.icash_live_callbacks b set state='canceled' from public.icash_live_conversations c where b.conversation_id=c.id and b.state in ('pending_dispatch_review','held_for_human','missed') and exists(select 1 from public.icash_contact_permissions p where p.phone=new.phone and p.contact_key=c.contact_key);
 return new;
end $$;
revoke all on function public.icash_text_stop_voice() from public,anon,authenticated;
create trigger icash_text_stop_voice after insert on public.icash_text_suppressions for each row execute function public.icash_text_stop_voice();
