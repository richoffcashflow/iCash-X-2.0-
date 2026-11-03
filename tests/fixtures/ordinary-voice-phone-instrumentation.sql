-- Synthetic boundary instrumentation; production guards remain unchanged.
create sequence fixture_slot_checks;
create or replace function icash_recording_private.voice_queue_slot_from_snapshot(uuid,uuid,jsonb)
returns boolean language plpgsql stable set search_path='' as $f$
begin
 if exists(select 1 from public.fixture_guards where job_id=$2 and kind='explode_slot') then
  raise exception 'Capacity evaluated for a phone-blocked ordinary job';
 end if;
 perform nextval('public.fixture_slot_checks');
 return not exists(select 1 from public.fixture_guards where job_id=$2 and kind='capacity');
end $f$;
