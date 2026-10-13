-- Existing private submissions stay private. Only explicit new shared submissions
-- receive scope metadata and enter the owner review queue.
alter table public.icash_webinar_messages
 add column public_status text not null default 'private'
   check (public_status in ('private','pending','approved','hidden')),
 add column display_name text check (length(display_name) <= 60),
 add column webinar_id uuid references public.icash_webinars(id) on delete cascade,
 add column webinar_revision integer,
 add column recording_version text check (recording_version in ('day','night')),
 add column is_preview boolean not null default false,
 add column moderated_at timestamptz,
 add constraint icash_webinar_shared_message_scope check (
  public_status = 'private' or (
   role = 'user' and webinar_id is not null and webinar_revision is not null
   and recording_version is not null and nullif(btrim(display_name),'') is not null
  )
 ),
 add constraint icash_webinar_shared_message_approved check (
  public_status <> 'approved' or moderated_at is not null
 );

create index icash_webinar_chat_approved_feed
 on public.icash_webinar_messages(webinar_id,webinar_revision,recording_version,is_preview,created_at desc)
 where public_status='approved' and role='user';
create index icash_webinar_chat_review_queue
 on public.icash_webinar_messages(webinar_id,recording_version,is_preview,public_status,created_at desc,id desc)
 where public_status in ('pending','approved','hidden');

-- Continue accessing messages exclusively through session-scoped or owner-only APIs.
alter table public.icash_webinar_messages enable row level security;
revoke all on public.icash_webinar_messages from anon,authenticated;
