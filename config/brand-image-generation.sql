alter table public.icash_brand_jobs add column render_version integer not null default 1;
alter table public.icash_brand_jobs add column error_code text;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('icash-brand-images','icash-brand-images',false,5000000,array['image/jpeg']) on conflict(id) do nothing;
create function public.icash_claim_brand_images(p_setup uuid,p_name text) returns boolean language plpgsql set search_path='' as $$
declare j public.icash_brand_jobs;s public.icash_bot_setups;used integer;
begin
 select * into s from public.icash_bot_setups where id=p_setup for update;
 if not found or s.profile->>'displayName' is distinct from p_name then return false;end if;
 select * into j from public.icash_brand_jobs where setup_id=p_setup;
 if found and j.render_version=2 and (j.brand_name=p_name or j.attempts>=2 or j.state='creating') then return false;end if;
 insert into public.icash_brand_daily(day,attempts) values((now() at time zone 'UTC')::date,0) on conflict do nothing;
 update public.icash_brand_daily set attempts=attempts+1 where day=(now() at time zone 'UTC')::date and attempts<100 returning attempts into used;
 if not found then return false;end if;
 insert into public.icash_brand_jobs(setup_id,brand_name,state,render_version) values(p_setup,p_name,'creating',2)
 on conflict(setup_id) do update set brand_name=excluded.brand_name,state='creating',render_version=2,designs=null,usage=null,error_code=null,attempts=case when icash_brand_jobs.render_version=1 then 1 else icash_brand_jobs.attempts+1 end,updated_at=now();
 return true;
end $$;
revoke all on function public.icash_claim_brand_images(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_claim_brand_images(uuid,text) to service_role;
