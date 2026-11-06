-- A workspace notification only. Progress and access keep their existing read/write paths.
create function public.icash_workspace_course_status(p_account uuid, p_mode text)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  course jsonb := public.icash_read_course_progress(p_account);
  revision integer := (course->>'revision')::integer;
  published_at timestamptz;
  prior_playback boolean := false;
  course_updated boolean := false;
begin
  if revision > 1 and course->>'state' in ('unrecorded', 'in_progress') then
    select a.updated_at into strict published_at from public.icash_course_assets a where a.kind = 'video';
    select exists (
      select 1 from public.icash_course_progress p
      where p.account_id = p_account and p.video_revision < revision
    ) into prior_playback;

    -- Include members who received the previous video even if they never opened it.
    -- A pending checkout can predate the first actual grant of course access.
    course_updated := prior_playback or exists (
      select 1 from public.icash_workspace_walkthroughs w
      where w.account_id = p_account and w.course_opened_at < published_at
    ) or exists (
      select 1 from public.icash_accounts a where a.id = p_account
        and a.billing_model in ('legacy', 'prepaid') and a.created_at < published_at
    ) or exists (
      select 1 from public.icash_memberships m
      where m.account_id = p_account and m.mode = p_mode and (
        m.legacy_trial_started_at < published_at
        or (m.private_invite_id is not null and m.created_at < published_at)
        or exists (select 1 from public.icash_membership_invoices i
                   where i.membership_id = m.id and i.recorded_at < published_at)
      )
    );
  end if;
  return jsonb_build_object('course', course, 'priorPlayback', prior_playback, 'courseUpdated', course_updated);
end $$;

revoke all on function public.icash_workspace_course_status(uuid, text) from public, anon, authenticated;
grant execute on function public.icash_workspace_course_status(uuid, text) to service_role;
