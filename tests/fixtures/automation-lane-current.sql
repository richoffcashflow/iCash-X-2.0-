CREATE OR REPLACE FUNCTION public.icash_next_automation_lane(p_lane text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t jsonb;
begin
 if p_lane not in ('general','research','voice','messages','recovery') or p_lane is null then raise exception 'Unknown automation lane';end if;
 if not pg_try_advisory_xact_lock(726341927) then return null;end if;
 if not exists(select 1 from icash_work_private.dispatch_policy where id=1 and enabled) then
  -- Rollback/rolling deployment keeps the compatible original dispatcher alive.
  if p_lane='general' then return public.icash_next_automation();end if;
  return null;
 end if;
 if p_lane='general' then return public.icash_next_automation();end if;
 if p_lane='research' then return public.icash_next_acquisition();end if;
 if p_lane='voice' then return public.icash_issue_ready_voice_ticket();end if;
 if p_lane='messages' then
  t:=public.icash_issue_due_text_ai();if t->>'token' is not null then return t;end if;
  t:=public.icash_next_seller_followup();if t->>'token' is not null then return t;end if;
  t:=public.icash_recover_unstarted_seller_opener();if t->>'token' is not null then return t;end if;
  return public.icash_issue_ready_seller_text();
 end if;
 t:=public.icash_issue_due_signing_result();if t->>'token' is not null then return t;end if;
 t:=public.icash_issue_due_voice_result();if t->>'token' is not null then return t;end if;
 return public.icash_issue_account_followup();
end $function$
