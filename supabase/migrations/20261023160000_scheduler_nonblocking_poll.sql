-- Only one poll needs to select work. Waiting polls consume connections and
-- amplify slow transactions; the next normal poll retries without issuing work.
create or replace function public.icash_next_automation() returns jsonb
language plpgsql security definer set search_path='' as $$
declare retry jsonb;
begin
 if not pg_try_advisory_xact_lock(726341927) then return null;end if;
 retry:=public.icash_resume_prospecting_ticket();
 if retry->>'token' is not null then return retry;end if;
 return public.icash_next_before_prospecting_budget();
end $$;
revoke all on function public.icash_next_automation() from public,anon,authenticated;
grant execute on function public.icash_next_automation() to service_role;
