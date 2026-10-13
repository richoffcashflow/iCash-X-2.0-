-- Nullable for messages saved before playback positions were recorded.
-- Existing session ownership checks and service-role-only access stay intact.
alter table public.icash_webinar_messages
  add column playback_seconds integer
  check (playback_seconds between 0 and 14400);
comment on column public.icash_webinar_messages.playback_seconds is
  'Playback position when a viewer submitted this private session message.';
